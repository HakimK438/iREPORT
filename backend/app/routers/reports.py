from fastapi import APIRouter, Query
from sqlalchemy import text

from .. import incidents as svc
from .. import paging
from ..deps import Citizen, Db
from ..schemas import ReportCreated, ReportIn
from ..storage import get_storage

router = APIRouter(tags=["reports"])


@router.post("/reports", status_code=201, response_model=ReportCreated)
async def create_report(body: ReportIn, citizen: Citizen, db: Db):
    result = await svc.create_report(db, citizen.id, body)
    await db.commit()
    return result


@router.get("/reports/mine")
async def my_reports(citizen: Citizen, db: Db, cursor: str | None = None, limit: int = Query(20, ge=1, le=50)):
    """The citizen's own reports with status timeline and messages. Opening this marks messages as seen."""
    after = paging.decode(cursor, 2)
    after = paging.typed(after, ["timestamptz", "uuid"]) if after else None
    params: dict = {"u": citizen.id, "n": limit + 1}
    keyset = ""
    if after:
        keyset = "AND (r.created_at, r.id) < (CAST(:c_at AS timestamptz), CAST(:c_id AS uuid))"
        params.update(c_at=after[0], c_id=after[1])
    rows = (await db.execute(text(f"""
        SELECT r.id AS report_id, r.created_at AS reported_at, r.problem_type AS my_problem, i.id, i.public_id, c.name AS category,
               w.name AS area, i.address_text, i.severity::text AS severity, i.status::text AS status, i.affected_count,
               i.created_at, i.updated_at, m.storage_key, m.thumb_key, d.name AS department, r.citizen_message, r.location_source,
               r.ai_confidence, r.ai_source, ac.name AS ai_category, r.user_corrected
        FROM reports r JOIN incidents i ON i.id = r.incident_id JOIN categories c ON c.id = i.category_id
        LEFT JOIN departments d ON d.id = c.department_id LEFT JOIN categories ac ON ac.id = r.ai_category_id
        LEFT JOIN wards w ON w.id = i.ward_id
        LEFT JOIN LATERAL (SELECT storage_key, thumb_key FROM media WHERE report_id = r.id ORDER BY created_at LIMIT 1) m ON true
        WHERE r.user_id = :u {keyset}
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
        "created_at": r.reported_at, "updated_at": r.updated_at,
        "image_url": storage.signed_url(r.storage_key) if r.storage_key else None,
        "thumb_url": storage.signed_url(r.thumb_key) if r.thumb_key else None,
        "history": hist[r.id], "messages": msgs[r.id],
        "department": r.department, "citizen_message": r.citizen_message, "location_source": r.location_source,
        "ai": {"category": r.ai_category, "confidence": r.ai_confidence, "source": r.ai_source, "user_corrected": r.user_corrected},
    } for r in rows]
    if not cursor:
        await db.execute(text("UPDATE users SET messages_seen_at = now() WHERE id = :u"), {"u": citizen.id})
        await db.commit()
    next_cursor = paging.encode([rows[-1].reported_at.isoformat(), str(rows[-1].report_id)]) if more and rows else None
    return {"items": items, "next_cursor": next_cursor}
