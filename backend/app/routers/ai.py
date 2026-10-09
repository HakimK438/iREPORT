import logging
import time

from fastapi import APIRouter, File, Form, UploadFile
from starlette.concurrency import run_in_threadpool

from .. import images, ratelimit
from ..ai import pipeline
from ..config import get_settings
from ..deps import Citizen, Db
from ..errors import ApiError
from ..models import Media
from ..refdata import ref
from ..storage import get_storage, new_keys

router = APIRouter(prefix="/ai", tags=["ai"])
log = logging.getLogger("ireport.ai")


async def _read_limited(upload: UploadFile, limit: int) -> bytes:
    data = await upload.read(limit + 1)
    if len(data) > limit:
        raise ApiError(413, "file_too_large", f"Photos must be under {limit // (1024 * 1024)} MB.")
    return data


@router.post("/analyze")
async def analyze(
    citizen: Citizen, db: Db,
    photos: list[UploadFile] = File(default_factory=list),
    text: str | None = Form(None, max_length=500),
    lang: str = Form("en", pattern="^(en|hi|mr)$"),
    lat: float | None = Form(None, ge=-90, le=90),
    lng: float | None = Form(None, ge=-180, le=180),
    category: str | None = Form(None, max_length=40),
    problem_type: str | None = Form(None, max_length=60),
):
    """Stores the photos as drafts (linked to the report on submit) and returns the AI suggestion.
    The AI never blocks reporting: if it is unsure or fails, the response says uncertain: true."""
    s = get_settings()
    ratelimit.check("analyze", str(citizen.id), s.rate_analyze)
    if len(photos) > s.max_photos:
        raise ApiError(422, "too_many_photos", f"Add up to {s.max_photos} photos.")
    started = time.perf_counter()
    processed, photo_errors, first_error = [], [], None
    for n, upload in enumerate(photos):
        try:
            processed.append(await run_in_threadpool(images.process, await _read_limited(upload, s.max_upload_bytes)))
        except ApiError as exc:  # one bad photo must not discard the others
            photo_errors.append({"index": n, "code": exc.code, "message": exc.message})
            first_error = first_error or exc
    if first_error and not processed and not (text and text.strip()):
        raise first_error  # nothing usable at all: tell the citizen why

    storage = get_storage()
    media_ids, thumbs = [], []
    for p in processed:
        key, thumb_key = new_keys()
        await storage.put(key, p.main, "image/webp")
        await storage.put(thumb_key, p.thumb, "image/webp")
        m = Media(uploader_id=citizen.id, storage_key=key, thumb_key=thumb_key, width=p.width, height=p.height, bytes=len(p.main))
        db.add(m)
        await db.flush()
        media_ids.append(m.id)
        thumbs.append(storage.signed_url(thumb_key))
    await db.commit()

    try:
        result = await run_in_threadpool(pipeline.analyze, [p.image for p in processed], text, problem_type, category, s.ai_uncertain_below)
    except Exception:  # noqa: BLE001 - the AI must never fail the request
        log.exception("analyze failed")
        result = pipeline.combine(None, None, s.ai_uncertain_below)
        result.update(severity=None, flags=[], explanation=None, model_version=None, source="none", inference_ms=None,
                      ai_available=False, models={"image": "error", "text": "error"}, nlp=None,
                      image_confidence=None, text_confidence=None, image_model_active=pipeline.models.image is not None, photo_checks=[])
    basis = result.get("category") or category
    cat = ref.category(basis) if basis else None
    # Tie each per-photo check to the stored photo so the client can drop or move the ones that do not match.
    for chk in result.get("photo_checks", []):
        chk["media_id"] = media_ids[chk["index"]]
        chk["thumb_url"] = thumbs[chk["index"]]
    gps = next((p.gps for p in processed if p.gps), None)
    result.update(
        department=ref.departments.get(cat.department_id) if cat else None,
        media_ids=media_ids, thumb_urls=thumbs, lang=lang, photo_errors=photo_errors,
        photo_quality=[p.quality for p in processed],
        gps_suggestion={"lat": gps[0], "lng": gps[1]} if gps else None,
        total_ms=round((time.perf_counter() - started) * 1000, 1),
    )
    return result
