"""The incident brief: everything an officer needs on one complaint, in the order of a work order.
What / why urgent / where / evidence / history at this spot / nearby open work / timeline / messages / next action.
Each fact is returned once. Wording is done in the browser (en/hi/mr); this module only returns structured facts."""

import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from . import incidents as svc
from . import risk_config as cfg
from .errors import not_found
from .priority import reasons_of
from .status import open_sql
from .storage import get_storage


def _near(geo: dict) -> dict | None:
    """The school or hospital within 100 m found on the map (never a citizen claim), nearest first."""
    found = [{"kind": k, **geo[k]} for k in ("school", "hospital") if isinstance(geo.get(k), dict)]
    return min(found, key=lambda f: f.get("distance_m") or 0) if found else None


async def build_brief(db: AsyncSession, incident_id: uuid.UUID, viewer_id: uuid.UUID, include_phone: bool = False) -> dict:
    row = (await db.execute(text(f"""
        WITH page AS (SELECT * FROM incidents WHERE id = :id)
        {svc.ROW_SELECT.format(extra=", ST_Y(i.location::geometry) AS lat, ST_X(i.location::geometry) AS lng, i.geo_facts, i.duplicate_of, i.category_id")}"""), {"id": incident_id})).first()
    if not row:
        raise not_found("Incident")
    storage = get_storage()
    d = svc.authority_row(row)

    facts = (await svc.risk_inputs(db, [incident_id])).get(incident_id)
    geo = row.geo_facts or {}
    d["reasons"] = reasons_of(facts) if facts else []
    d["map_checked"] = bool(geo.get("checked"))
    d["what"] = {"problem": row.problem_type, "category": row.category, "address": row.address_text, "near": _near(geo)}
    d["where"] = {"address": row.address_text, "area": row.area, "lat": row.lat, "lng": row.lng, "point_source": row.location_source}
    d["duplicate_of"] = None
    if row.duplicate_of:
        d["duplicate_of"] = await db.scalar(text("SELECT public_id FROM incidents WHERE id = :i"), {"i": row.duplicate_of})

    # Evidence: one entry per real report (repeat reports are hidden), with its own photos, time and reporter.
    reports = (await db.execute(text("""
        SELECT r.id, u.name, u.phone, r.problem_type, r.description, r.created_at, r.citizen_message
        FROM reports r JOIN users u ON u.id = r.user_id
        WHERE r.incident_id = :id AND r.duplicate_of_report_id IS NULL ORDER BY r.created_at"""), {"id": incident_id})).all()
    media = (await db.execute(text("""
        SELECT m.report_id, m.storage_key, m.thumb_key FROM media m JOIN reports r ON r.id = m.report_id
        WHERE r.incident_id = :id AND r.duplicate_of_report_id IS NULL ORDER BY m.created_at"""), {"id": incident_id})).all()
    by_report: dict = {}
    for m in media:
        by_report.setdefault(m.report_id, []).append({"url": storage.signed_url(m.storage_key), "thumb_url": storage.signed_url(m.thumb_key)})
    d["evidence"] = [{
        "reporter": r.name, "phone": r.phone if include_phone else None, "at": r.created_at, "problem_type": r.problem_type,
        "description": r.description, "citizen_message": r.citizen_message, "photos": by_report.get(r.id, []),
    } for r in reports]

    # History at this spot: same-category complaints within 50 m in the last 180 days (any status except merged or rejected).
    here = (await db.execute(text(f"""
        SELECT o.public_id, o.status::text AS status, o.created_at, o.resolved_at
        FROM incidents o WHERE o.category_id = :c AND o.id <> :id AND o.status NOT IN ('Duplicate', 'Rejected')
          AND o.created_at > now() - make_interval(days => {cfg.HISTORY_DAYS})
          AND ST_DWithin(o.location, (SELECT location FROM incidents WHERE id = :id), {cfg.HISTORY_RADIUS_M})
        ORDER BY o.created_at DESC"""), {"c": row.category_id, "id": incident_id})).all()
    d["history_here"] = {"count": len(here), "days": cfg.HISTORY_DAYS, "radius_m": cfg.HISTORY_RADIUS_M,
                         "items": [{"public_id": h.public_id, "status": h.status, "created_at": h.created_at, "resolved_at": h.resolved_at} for h in here[:5]],
                         "since": here[-1].created_at if here else None}

    # Nearby open work: other open complaints within 300 m (send the same crew).
    nearby = (await db.execute(text(f"""
        SELECT o.id, o.public_id, c.name AS category, o.status::text AS status, o.due_at,
               ST_Distance(o.location, (SELECT location FROM incidents WHERE id = :id)) AS distance_m
        FROM incidents o JOIN categories c ON c.id = o.category_id
        WHERE o.id <> :id AND {open_sql('o')} AND ST_DWithin(o.location, (SELECT location FROM incidents WHERE id = :id), {cfg.NEARBY_WORK_RADIUS_M})
        ORDER BY distance_m"""), {"id": incident_id})).all()
    d["nearby_open"] = {"count": len(nearby), "radius_m": cfg.NEARBY_WORK_RADIUS_M,
                        "items": [{"id": n.id, "public_id": n.public_id, "category": n.category, "status": n.status, "distance_m": round(n.distance_m)} for n in nearby[:5]]}

    d["timeline"] = (await svc.history(db, [incident_id], internal=True))[incident_id]
    d["messages"] = (await svc.thread(db, [incident_id], viewer_id, as_authority=True))[incident_id]
    return d
