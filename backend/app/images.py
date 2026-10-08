"""Server-side photo pipeline. Never trusts the client: checks the real type from magic bytes, limits
size and pixel count, fixes orientation, reads GPS once (to suggest a location), strips every piece of
metadata and re-encodes to WebP. The original upload is never stored."""

import io
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from .config import get_settings
from .errors import ApiError

try:
    import pillow_heif

    pillow_heif.register_heif_opener()
    HEIC = True
except ImportError:  # pragma: no cover - optional at runtime
    HEIC = False

MAX_STORED_BYTES = 500 * 1024
GPS_IFD = 0x8825


def sniff(data: bytes) -> str | None:
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data[4:8] == b"ftyp" and data[8:12] in (b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1"):
        return "heic"
    return None


@dataclass
class Processed:
    main: bytes
    thumb: bytes
    width: int
    height: int
    gps: tuple[float, float] | None
    image: Image.Image  # decoded, oriented RGB copy for the classifier (kept in memory only)
    quality: dict | None = None  # deterministic checks, see photo_quality()


def _ratio(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError, ZeroDivisionError):
        return float(v[0]) / float(v[1])


def read_gps(img: Image.Image) -> tuple[float, float] | None:
    try:
        gps = img.getexif().get_ifd(GPS_IFD)
        if not gps or 2 not in gps or 4 not in gps:
            return None

        def deg(dms) -> float:
            d, m, s = (_ratio(x) for x in dms)
            return d + m / 60 + s / 3600

        lat, lng = deg(gps[2]), deg(gps[4])
        if str(gps.get(1, "N")).upper().startswith("S"):
            lat = -lat
        if str(gps.get(3, "E")).upper().startswith("W"):
            lng = -lng
        if not (-90 <= lat <= 90 and -180 <= lng <= 180) or (lat == 0 and lng == 0):
            return None
        return round(lat, 6), round(lng, 6)
    except Exception:  # noqa: BLE001 - broken EXIF must never fail an upload
        return None


def _webp(img: Image.Image, quality: int) -> bytes:
    out = io.BytesIO()
    # method=2: about 4x faster than the default 4 for nearly the same size (measured, see README).
    img.save(out, "WEBP", quality=quality, method=2)  # no exif=, icc_profile= or xmp=: metadata is dropped
    return out.getvalue()


# Heuristic thresholds (not learned): chosen so an ordinary phone photo reads "good".
MIN_SIDE_PX, DARK_BELOW, BLURRY_BELOW = 480, 45.0, 60.0


def photo_quality(img: Image.Image) -> dict:
    """Cheap, deterministic photo checks with Pillow/NumPy only: resolution, brightness and blur
    (variance of the Laplacian on a grey image of at most 512 px). Not machine learning."""
    small = img.copy()
    small.thumbnail((512, 512), Image.Resampling.BILINEAR)
    g = np.asarray(small.convert("L"), dtype=np.float32)
    brightness = float(g.mean())
    sharpness = 0.0
    if g.shape[0] >= 3 and g.shape[1] >= 3:
        lap = g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:] - 4 * g[1:-1, 1:-1]
        sharpness = float(lap.var())
    low_res = min(img.width, img.height) < MIN_SIDE_PX
    label = "dark" if brightness < DARK_BELOW else "blurry" if sharpness < BLURRY_BELOW else "low resolution" if low_res else "good"
    return {"label": label, "width": img.width, "height": img.height, "brightness": round(brightness, 1), "sharpness": round(sharpness, 1)}


def process(data: bytes) -> Processed:
    s = get_settings()
    if len(data) > s.max_upload_bytes:
        raise ApiError(413, "file_too_large", f"Photos must be under {s.max_upload_bytes // (1024 * 1024)} MB.")
    kind = sniff(data)
    if kind is None or (kind == "heic" and not HEIC):
        raise ApiError(415, "unsupported_type", "Please upload a JPEG, PNG, WebP or HEIC photo.")
    try:
        img = Image.open(io.BytesIO(data))
        if img.width * img.height > s.max_pixels:
            raise ApiError(413, "too_many_pixels", "This photo is too large. Please use a smaller photo.")
        gps = read_gps(img)
        if kind == "jpeg":
            img.draft("RGB", (s.main_max_side, s.main_max_side))  # fast DCT downscale while decoding
        img = ImageOps.exif_transpose(img)
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
            background = Image.new("RGB", img.size, (255, 255, 255))
            background.paste(img, mask=img.getchannel("A"))
            img = background
        else:
            img = img.convert("RGB")
    except ApiError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise ApiError(415, "unreadable_image", "This photo could not be read. Please try another one.") from None

    photo_q = photo_quality(img)
    main = img.copy()
    main.thumbnail((s.main_max_side, s.main_max_side), Image.Resampling.LANCZOS)
    main_bytes = b""
    for quality in (80, 70, 60, 50):
        main_bytes = _webp(main, quality)
        if len(main_bytes) <= MAX_STORED_BYTES:
            break
    thumb = main.copy()
    thumb.thumbnail((s.thumb_max_side, s.thumb_max_side), Image.Resampling.LANCZOS)
    thumb_bytes = _webp(thumb, 70)
    return Processed(main_bytes, thumb_bytes, main.width, main.height, gps, main, photo_q)
