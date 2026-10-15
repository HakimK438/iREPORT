"""Stores photos for the extra upload routes (add a photo to my report, officer after-photos). Same pipeline as
/ai/analyze: real type from magic bytes, size and pixel limits, EXIF stripped, re-encoded to WebP, thumbnail."""

import uuid

from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from . import images
from .config import get_settings
from .errors import ApiError
from .models import Media
from .storage import get_storage, new_keys


async def read_limited(upload: UploadFile, limit: int) -> bytes:
    data = await upload.read(limit + 1)
    if len(data) > limit:
        raise ApiError(413, "file_too_large", f"Photos must be under {limit // (1024 * 1024)} MB.")
    return data


async def save_photos(db: AsyncSession, uploader_id: uuid.UUID, uploads: list[UploadFile], *, report_id: uuid.UUID | None = None,
                      incident_id: uuid.UUID | None = None) -> list[dict]:
    """Processes and stores every upload (a bad photo fails the call: the caller asked for these exact photos)."""
    s = get_settings()
    storage = get_storage()
    out = []
    for upload in uploads:
        p = await run_in_threadpool(images.process, await read_limited(upload, s.max_upload_bytes))
        key, thumb_key = new_keys()
        await storage.put(key, p.main, "image/webp")
        await storage.put(thumb_key, p.thumb, "image/webp")
        m = Media(uploader_id=uploader_id, report_id=report_id, storage_key=key, thumb_key=thumb_key, width=p.width, height=p.height, bytes=len(p.main), incident_id=incident_id,
                  dhash=p.dhash, gps_lat=p.gps[0] if p.gps else None, gps_lng=p.gps[1] if p.gps else None)
        db.add(m)
        await db.flush()
        out.append({"id": m.id, "thumb_url": storage.signed_url(thumb_key), "url": storage.signed_url(key)})
    return out
