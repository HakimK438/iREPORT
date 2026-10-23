"""Small scheduled jobs (APScheduler, in the API process): draft cleanup, image retention and the
hourly priority refresh (age points change with time)."""

import logging

from sqlalchemy import text

from .config import get_settings
from .db import SessionLocal
from . import workflow
from .incidents import recompute_priority
from .storage import get_storage

log = logging.getLogger("ireport.jobs")


async def _delete_objects(keys: list[str]) -> None:
    storage = get_storage()
    for key in keys:
        try:
            await storage.delete(key)
        except Exception:  # noqa: BLE001 - a missing object must not stop the cleanup
            log.warning("could not delete %s", key)


async def cleanup_drafts() -> int:
    """Delete photos uploaded by /ai/analyze that never became part of a report."""
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            DELETE FROM media m WHERE m.report_id IS NULL AND m.created_at < now() - make_interval(mins => :m)
              AND NOT EXISTS (SELECT 1 FROM resolution_proofs p WHERE m.id = ANY(p.media_ids))
            RETURNING storage_key, thumb_key"""), {"m": get_settings().draft_ttl_minutes})).all()
        await db.commit()
    await _delete_objects([k for r in rows for k in (r.storage_key, r.thumb_key)])
    if rows:
        log.info("deleted %d draft photos", len(rows))
    return len(rows)


async def expire_full_images() -> int:
    """For incidents resolved more than N days ago, delete the full image and keep the thumbnail."""
    async with SessionLocal() as db:
        rows = (await db.execute(text("""
            WITH old AS (
              SELECT m.id, m.storage_key FROM media m JOIN reports r ON r.id = m.report_id JOIN incidents i ON i.id = r.incident_id
              WHERE i.status IN ('Resolved', 'Closed') AND i.resolved_at < now() - make_interval(days => :d) AND m.storage_key <> m.thumb_key
              LIMIT 5000)
            UPDATE media m SET storage_key = m.thumb_key, bytes = NULL FROM old WHERE m.id = old.id
            RETURNING old.storage_key"""), {"d": get_settings().full_image_retention_days})).all()
        await db.commit()
    await _delete_objects([r.storage_key for r in rows])
    if rows:
        log.info("removed %d full-size images past retention", len(rows))
    return len(rows)


async def refresh_priorities() -> int:
    async with SessionLocal() as db:
        n = await recompute_priority(db, None)
        await db.commit()
    log.info("priority refresh updated %d incidents", n)
    return n


async def auto_close() -> int:
    """Resolved complaints the citizen has not answered for 72 hours are Closed."""
    async with SessionLocal() as db:
        n = await workflow.auto_close_resolved(db)
        await db.commit()
    if n:
        log.info("auto-closed %d resolved complaints with no citizen answer", n)
    return n


def start_scheduler():
    from apscheduler.schedulers.asyncio import AsyncIOScheduler

    scheduler = AsyncIOScheduler(timezone="UTC", job_defaults={"coalesce": True, "max_instances": 1, "misfire_grace_time": 300})
    scheduler.add_job(cleanup_drafts, "interval", minutes=10, id="cleanup_drafts")
    scheduler.add_job(refresh_priorities, "interval", hours=1, id="refresh_priorities")
    scheduler.add_job(auto_close, "interval", minutes=15, id="auto_close")
    scheduler.add_job(expire_full_images, "interval", hours=24, id="expire_full_images")
    scheduler.start()
    return scheduler
