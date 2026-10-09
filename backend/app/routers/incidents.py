import uuid
from typing import Literal

from fastapi import APIRouter, Query
from sqlalchemy import text

from .. import incidents as svc
from .. import paging
from ..deps import Citizen, Db, OptionalUser
from ..errors import ApiError, not_found
from ..models import STATUSES
from ..refdata import ref
from ..schemas import CitizenReopen, MessageIn
from ..status import is_open
from .. import workflow

router = APIRouter(tags=["community"])

# ORDER BY inside the page CTE; the outer query repeats it with the "i." alias.
_NEARBY_ORDER = {
    "nearest": "distance_m, id",
    "recent": "created_at DESC, id",
    "affected": "affected_count DESC, id",
    "severity": "severity DESC, priority_score DESC, id",
}


def _outer(order: str) -> str:
    return ", ".join(f"i.{part.strip()}" for part in order.split(","))


def _statuses(value: str | None) -> list[str] | None:
    if not value:
        return None
    statuses = [s.strip() for s in value.split(",") if s.strip()]
    if any(s not in STATUSES for s in statuses):
        raise ApiError(422, "validation_error", "Unknown status.")
    return statuses


@router.get("/incidents/nearby")
async def nearby(
    db: Db, viewer: OptionalUser,
    lat: float = Query(ge=-90, le=90), lng: float = Query(ge=-180, le=180),
    radius: float = Query(2000, gt=0, le=50000), category: str | None = None, status: str | None = None,
    sort: Literal["nearest", "recent", "affected", "severity"] = "nearest",
    cursor: str | None = None, limit: int = Query(20, ge=1, le=50),
):
    """Community feed. Public fields only: no names, emails or phone numbers."""
    offset = int(paging.decode(cursor, 1)[0]) if cursor else 0
    where, params = [], {"lat": lat, "lng": lng, "radius": radius, "n": limit + 1, "off": offset, "v": viewer.id if viewer else None}
    if category:
        cat = ref.category(category)
        if not cat:
            raise ApiError(422, "validation_error", "Unknown category.")
        where.append("i.category_id = :cat")
        params["cat"] = cat.id
    if statuses := _statuses(status):
        where.append("i.status::text = ANY(CAST(:st AS text[]))")
        params["st"] = statuses
    order = _NEARBY_ORDER[sort]
    rows = (await db.execute(text(f"""
        WITH page AS (
          SELECT i.*, ST_Distance(i.location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography) AS distance_m
          FROM incidents i
          WHERE ST_DWithin(i.location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :radius) {''.join(' AND ' + w for w in where)}
          ORDER BY {order} LIMIT :n OFFSET :off)
        {svc.ROW_SELECT.format(extra=''', i.distance_m,
               EXISTS (SELECT 1 FROM confirmations f WHERE f.incident_id = i.id AND f.user_id = :v) AS confirmed_by_me,
               EXISTS (SELECT 1 FROM reports r WHERE r.incident_id = i.id AND r.user_id = :v AND r.duplicate_of_report_id IS NULL) AS reported_by_me''')}
        ORDER BY {_outer(order)}"""), params)).all()
    more = len(rows) > limit
    items = []
    for r in rows[:limit]:
        d = svc.public_row(r)
        d.update(distance_m=round(r.distance_m), confirmed_by_me=r.confirmed_by_me, reported_by_me=r.reported_by_me)
        items.append(d)
    return {"items": items, "next_cursor": paging.encode([offset + limit]) if more else None}


@router.get("/incidents/{incident_id}")
async def incident_detail(incident_id: uuid.UUID, db: Db, viewer: OptionalUser):
    row = (await db.execute(text(f"""
        WITH page AS (SELECT * FROM incidents WHERE id = :id)
        {svc.ROW_SELECT.format(extra=''', ST_Y(i.location::geometry) AS lat, ST_X(i.location::geometry) AS lng,
               EXISTS (SELECT 1 FROM confirmations f WHERE f.incident_id = i.id AND f.user_id = :v) AS confirmed_by_me,
               EXISTS (SELECT 1 FROM reports r WHERE r.incident_id = i.id AND r.user_id = :v AND r.duplicate_of_report_id IS NULL) AS reported_by_me''')}"""),
        {"id": incident_id, "v": viewer.id if viewer else None})).first()
    if not row:
        raise not_found("Incident")
    d = svc.public_row(row)
    d.update(lat=row.lat, lng=row.lng, confirmed_by_me=row.confirmed_by_me, reported_by_me=row.reported_by_me)
    d["history"] = (await svc.history(db, [row.id]))[row.id]
    return d


async def _change_affected(db: Db, incident_id: uuid.UUID, delta: int) -> int:
    count = await db.scalar(text("UPDATE incidents SET affected_count = greatest(1, affected_count + :d), updated_at = now() WHERE id = :i RETURNING affected_count"), {"d": delta, "i": incident_id})
    await svc.recompute_priority(db, [incident_id])
    return count


@router.post("/incidents/{incident_id}/confirm")
async def confirm(incident_id: uuid.UUID, citizen: Citizen, db: Db):
    row = (await db.execute(text("""
        SELECT status::text AS status, affected_count,
               EXISTS (SELECT 1 FROM reports r WHERE r.incident_id = i.id AND r.user_id = :u AND r.duplicate_of_report_id IS NULL) AS reported
        FROM incidents i WHERE id = :i FOR UPDATE"""), {"i": incident_id, "u": citizen.id})).first()
    if not row:
        raise not_found("Incident")
    if row.reported:  # a reporter is already counted
        return {"confirmed": True, "affected_count": row.affected_count}
    if not is_open(row.status):
        raise ApiError(409, "already_resolved", "This problem is no longer open.")
    inserted = await db.scalar(text("INSERT INTO confirmations (incident_id, user_id) VALUES (:i, :u) ON CONFLICT DO NOTHING RETURNING true"), {"i": incident_id, "u": citizen.id})
    count = await _change_affected(db, incident_id, 1) if inserted else row.affected_count
    await db.commit()
    return {"confirmed": True, "affected_count": count}


@router.delete("/incidents/{incident_id}/confirm")
async def unconfirm(incident_id: uuid.UUID, citizen: Citizen, db: Db):
    current = await db.scalar(text("SELECT affected_count FROM incidents WHERE id = :i FOR UPDATE"), {"i": incident_id})
    if current is None:
        raise not_found("Incident")
    deleted = await db.scalar(text("DELETE FROM confirmations WHERE incident_id = :i AND user_id = :u RETURNING true"), {"i": incident_id, "u": citizen.id})
    count = await _change_affected(db, incident_id, -1) if deleted else current
    await db.commit()
    return {"confirmed": False, "affected_count": count}


@router.post("/incidents/{incident_id}/resolution/confirm")
async def confirm_fixed(incident_id: uuid.UUID, citizen: Citizen, db: Db):
    """The reporter confirms the work is done: Resolved -> Closed."""
    result = await workflow.citizen_resolution(db, citizen.id, incident_id, confirm=True)
    await db.commit()
    return result


@router.post("/incidents/{incident_id}/resolution/reopen")
async def reopen(incident_id: uuid.UUID, body: CitizenReopen, citizen: Citizen, db: Db):
    """The reporter says the work is not done: Resolved -> Reopened with a reason (the SLA clock keeps running)."""
    result = await workflow.citizen_resolution(db, citizen.id, incident_id, confirm=False, reason=body.reason)
    await db.commit()
    return result


@router.post("/incidents/{incident_id}/messages", status_code=201)
async def reply(incident_id: uuid.UUID, body: MessageIn, citizen: Citizen, db: Db):
    """A citizen reply to the authority. Only reporters of the incident can write."""
    reported = await db.scalar(text("SELECT EXISTS (SELECT 1 FROM reports WHERE incident_id = :i AND user_id = :u AND duplicate_of_report_id IS NULL)"), {"i": incident_id, "u": citizen.id})
    if not reported:
        raise not_found("Report")
    row = (await db.execute(text("INSERT INTO messages (incident_id, sender_id, body) VALUES (:i, :u, :b) RETURNING id, created_at"), {"i": incident_id, "u": citizen.id, "b": body.body})).first()
    await db.commit()
    return {"id": row.id, "from": "citizen", "by": "You", "text": body.body, "at": row.created_at}


@router.get("/messages/unread-count")
async def unread_count(citizen: Citizen, db: Db):
    count = await db.scalar(text("""
        SELECT count(*) FROM messages m JOIN users s ON s.id = m.sender_id
        WHERE s.role <> 'citizen' AND (m.recipient_id IS NULL OR m.recipient_id = :u)
          AND m.created_at > coalesce((SELECT messages_seen_at FROM users WHERE id = :u), '-infinity')
          AND m.incident_id IN (SELECT incident_id FROM reports WHERE user_id = :u)"""), {"u": citizen.id})
    return {"unread": count}


@router.get("/geo/resolve")
async def resolve_point(db: Db, lat: float = Query(ge=-90, le=90), lng: float = Query(ge=-180, le=180)):
    """GIS-derived context for a point: the area it falls in (PostGIS polygon, else nearest area centre) and the
    department responsible for each category. The report flow shows this on the review screen."""
    ward_id = await svc.resolve_ward(db, lat, lng)
    return {
        "area": ref.wards.get(ward_id) if ward_id else None,
        "method": "polygon" if ward_id and await db.scalar(text("SELECT geom IS NOT NULL FROM wards WHERE id = :w"), {"w": ward_id}) else "nearest_area_centre",
        "departments": {c.name: ref.departments.get(c.department_id) for c in ref.categories.values()},
    }
