import io

import pytest
from PIL import Image

from app import images
from app.errors import ApiError


def jpeg_with_exif(size=(3000, 2000), orientation=6, gps=True, colour=(200, 40, 40)) -> bytes:
    img = Image.new("RGB", size, colour)
    # some texture so the encoder has real work to do
    for x in range(0, size[0], 50):
        for y in range(0, size[1], 50):
            img.putpixel((x, y), (x % 255, y % 255, 90))
    exif = Image.Exif()
    exif[0x0112] = orientation
    exif[0x010F] = "PhoneMaker"  # camera make: must not survive
    if gps:
        exif[0x8825] = {1: "N", 2: (19.0, 8.0, 11.04), 3: "E", 4: (72.0, 49.0, 46.56)}
    out = io.BytesIO()
    img.save(out, "JPEG", quality=92, exif=exif)
    return out.getvalue()


def test_orientation_gps_and_metadata_stripped():
    data = jpeg_with_exif()
    p = images.process(data)
    # orientation 6 = rotated 90 degrees: 3000x2000 becomes portrait, longest side 1280
    assert (p.width, p.height) == (854, 1280) or (p.width, p.height) == (853, 1280)
    assert p.gps == pytest.approx((19.136400, 72.829600), abs=1e-4)
    out = Image.open(io.BytesIO(p.main))
    assert out.format == "WEBP" and len(out.getexif()) == 0 and "exif" not in out.info and "icc_profile" not in out.info
    assert len(p.main) <= 500 * 1024
    thumb = Image.open(io.BytesIO(p.thumb))
    assert max(thumb.size) == 400 and len(p.thumb) < 40 * 1024
    assert b"PhoneMaker" not in p.main and b"PhoneMaker" not in p.thumb


def test_png_with_alpha_and_no_gps():
    img = Image.new("RGBA", (800, 600), (0, 0, 255, 128))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    p = images.process(buf.getvalue())
    assert p.gps is None and (p.width, p.height) == (800, 600) and p.image.mode == "RGB"


def test_type_checked_by_magic_bytes_not_name():
    with pytest.raises(ApiError) as e:
        images.process(b"<?php echo 'hello'; ?>" + b"\0" * 100)
    assert e.value.status == 415
    with pytest.raises(ApiError) as e:
        images.process(b"\xff\xd8\xff" + b"not really a jpeg" * 10)
    assert e.value.status == 415 and e.value.code == "unreadable_image"


def test_size_and_pixel_limits():
    with pytest.raises(ApiError) as e:
        images.process(b"\xff\xd8\xff" + b"0" * (8 * 1024 * 1024 + 1))
    assert e.value.status == 413
    big = io.BytesIO()
    Image.new("RGB", (6000, 5000), (10, 10, 10)).save(big, "PNG")  # 30 MP but a tiny file
    with pytest.raises(ApiError) as e:
        images.process(big.getvalue())
    assert e.value.code == "too_many_pixels"


def test_heic_accepted():
    pillow_heif = pytest.importorskip("pillow_heif")
    buf = io.BytesIO()
    try:
        Image.new("RGB", (640, 480), (30, 160, 30)).save(buf, "HEIF")
    except Exception as exc:  # encoder not available in this build
        pytest.skip(f"no HEIF encoder: {exc}")
    assert images.sniff(buf.getvalue()) == "heic"
    p = images.process(buf.getvalue())
    assert Image.open(io.BytesIO(p.main)).format == "WEBP"
    del pillow_heif
