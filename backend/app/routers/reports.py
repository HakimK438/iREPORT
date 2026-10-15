import uuid
from datetime import timedelta

from fastapi import APIRouter, File, Query, UploadFile
from sqlalchemy import text

from .. import incidents as svc
from .. import paging, ratelimit
from .. import risk_config as cfg
from ..brief import resolution_proof
from ..config import get_settings
from ..deps import Citizen, Db
from ..errors import ApiError, not_found
from ..schemas import ReportCreated, ReportIn
from ..status import open_sql
from ..storage import get_storage
from ..uploads import save_photos

router = APIRouter(tags=["reports"])


@router.post("/reports", status_code=201, response_model=ReportCreated)
async def create_report(body: ReportIn, citizen: Citizen, db: Db):
    s = get_settings()
    ratelimit.check_window("reports", str(citizen.id), s.rate_reports_per_hour, 3600,
                           f"You can send {s.rate_reports_per_hour} reports an hour. Please try again later.")
    ratelimit.check_window("reports_day", str(citizen.id), s.rate_reports_per_day, 86400,
                           f"You can send {s.rate_reports_per_day} reports in a day. Please try again tomorrow.")
    result = await svc.create_report(db, citizen.id, body)
    await db.commit()
    return result


@router.get("/reports/nearby-check")
async def nearby_check(citizen: Citizen, db: Db, lat: float = Query(ge=-90, le=90), lng: float = Query(ge=-180, le=180)):
    """Called by the report flow as soon as the location is set: my own open report within 50 m (any category), and the
    open complaints of other people within 50 m that I can confirm instead of reporting again."""
    return await svc.nearby_check(db, citizen.id, lat, lng)


@router.post("/reports/{incident_id}/photos", status_code=201)
async def add_photos(incident_id: uuid.UUID, citizen: Citizen, db: Db, photos: list[UploadFile] = File(...)):
    """The original reporter adds photos to their own report on an open complaint (same limit as the first upload)."""
    s = get_settings()
    ratelimit.check_window("photos", str(citizen.id), s.rate_photos_per_hour, 3600, "Too many photo uploads. Please try again later.")
    report = (await db.execute(text(f"""
        SELECT r.id, (SELECT count(*) FROM media m WHERE m.report_id = r.id) AS photos, {open_sql('i')} AS is_open
        FROM reports r JOIN incidents i ON i.id = r.incident_id
        WHERE r.incident_id = :i AND r.user_id = :u AND r.duplicate_of_report_id IS NULL ORDER BY r.created_at LIMIT 1"""), {"i": incident_id, "u": citizen.id})).first()
    if not report:
        raise not_found("Report")
    if not report.is_open:
        raise ApiError(409, "not_open", "This complaint is no longer open for new photos.")
    if report.photos + len(photos) > s.max_photos:
        raise ApiError(422, "too_many_photos", f"A report can have up to {s.max_photos} photos. This one has {report.photos}.")
    saved = await save_photos(db, citizen.id, photos, report_id=report.id)
    await db.execute(text("UPDATE incidents SET updated_at = now() WHERE id = :i"), {"i": incident_id})
    await db.commit()
    return {"added": len(saved), "photos_total": report.photos + len(saved), "thumb_urls": [p["thumb_url"] for p in saved]}


@router.get("/reports/mine")
async def my_reports(citizen: Citizen, db: Db, cursor: str | None = None, limit: int = Query(20, ge=1, le=50)):
    """The citizen's own reports with status timeline and messages. Opening this marks messages as seen.
    Repeat reports flagged as duplicates are not listed."""
    after = paging.decode(cursor, 2)
    after = paging.typed(after, ["timestamptz", "uuid"]) if after else None
    params: dict = {"u": citizen.id, "n": limit + 1}
    keyset = ""
    if after:
        keyset = "AND (r.created_at, r.id) < (CAST(:c_at AS timestamptz), CAST(:c_id AS uuid))"
        params.update(c_at=after[0], c_id=after[1])
    rows = (await db.execute(text(f"""
        SELECT r.id AS report_id, r.created_at AS reported_at, r.problem_type AS my_problem, i.id, i.public_id, c.name AS category,
               w.name AS area, i.address_text, i.severity::text AS severity, i.status::text AS status, i.affected_count, i.reopen_count, i.resolved_at,
               i.created_at, i.updated_at, m.storage_key, m.thumb_key, d.name AS department, r.citizen_message, r.location_source,
               r.ai_confidence, r.ai_source, ac.name AS ai_category, r.user_corrected,
               (SELECT count(*) FROM media x WHERE x.report_id = r.id)::int AS photo_count
        FROM reports r JOIN incidents i ON i.id = r.incident_id JOIN categories c ON c.id = i.category_id
        LEFT JOIN departments d ON d.id = c.department_id LEFT JOIN categories ac ON ac.id = r.ai_category_id
        LEFT JOIN wards w ON w.id = i.ward_id
        LEFT JOIN LATERAL (SELECT storage_key, thumb_key FROM media WHERE report_id = r.id ORDER BY created_at LIMIT 1) m ON true
        WHERE r.user_id = :u AND r.duplicate_of_report_id IS NULL {keyset}
        ORDER BY r.created_at DESC, r.id DESC LIMIT :n"""), params)).all()
    more = len(rows) > limit
    rows = rows[:limit]
    ids = list(dict.fromkeys(r.id for r in rows))
    hist = await svc.history(db, ids)
    msgs = await svc.thread(db, ids, citizen.id, as_authority=False)
    storage = get_storage()
    items = [{
        "report_id": r.report_id, "incident_id": r.id, "public_id": r.public_id,
        "title": svc.title_of(r.my_problem, r.category, r.address_text), "category": r.category, "area": r.area,
        "address_text": r.address_text, "severity": r.severity, "status": r.status, "affected_count": r.affected_count,
        "created_at": r.reported_at, "updated_at": r.updated_at, "photo_count": r.photo_count, "max_photos": get_settings().max_photos,
        "image_url": storage.signed_url(r.storage_key) if r.storage_key else None,
        "thumb_url": storage.signed_url(r.thumb_key) if r.thumb_key else None,
        "history": hist[r.id], "messages": msgs[r.id],
        "department": r.department, "citizen_message": r.citizen_message, "location_source": r.location_source,
        "ai": {"category": r.ai_category, "confidence": r.ai_confidence, "source": r.ai_source, "user_corrected": r.user_corrected},
        "reopen_count": r.reopen_count, "can_respond": r.status == "Resolved",
        "closes_at": (r.resolved_at + timedelta(hours=cfg.AUTO_CLOSE_HOURS)) if r.status == "Resolved" and r.resolved_at else None,
    } for r in rows]
    for it in items:  # the officer's site photo, so the citizen can judge the fix before confirming or reopening
        it["resolution_proof"] = await resolution_proof(db, it["incident_id"]) if it["status"] in ("Resolved", "Closed") else None
    if not cursor:
        await db.execute(text("UPDATE users SET messages_seen_at = now() WHERE id = :u"), {"u": citizen.id})
        await db.commit()
    next_cursor = paging.encode([rows[-1].reported_at.isoformat(), str(rows[-1].report_id)]) if more and rows else None
    return {"items": items, "next_cursor": next_cursor}
