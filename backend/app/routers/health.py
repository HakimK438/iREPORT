from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from ..ai import pipeline
from ..config import get_settings
from ..db import SessionLocal

router = APIRouter(tags=["health"])


@router.get("/health")
async def health():
    return {"status": "ok"}


@router.get("/ready")
async def ready():
    checks: dict[str, object] = {}
    try:
        async with SessionLocal() as db:
            await db.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:  # noqa: BLE001 - report any failure as not ready
        checks["database"] = f"error: {type(exc).__name__}"
    checks["image_model"] = pipeline.models.status.get("image", "not loaded")
    checks["text_model"] = pipeline.models.status.get("text", "not loaded")
    ok = checks["database"] == "ok" and pipeline.models.text is not None
    if get_settings().require_image_model:
        ok = ok and pipeline.models.image is not None
    return JSONResponse({"status": "ready" if ok else "not_ready", "checks": checks}, status_code=200 if ok else 503)
