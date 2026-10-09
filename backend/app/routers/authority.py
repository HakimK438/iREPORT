import uuid
from typing import Literal

from fastapi import APIRouter, Query
from sqlalchemy import text

from .. import incidents as svc
from .. import paging
from ..deps import Authority, Db
from ..errors import ApiError, not_found
from ..models import STATUSES
from ..priority import level_of
from ..refdata import ref
from ..schemas import AuthorityUpdate, BulkUpdate
from ..storage import get_storage

router = APIRouter(prefix="/authority", tags=["authority"])

# Keyset paging: every column in a sort runs the same direction, so a row comparison works and
# the priority sort walks the incidents_priority_page_idx index. Resolved incidents come last.
SORTS: dict[str, tuple[list[tuple[str, str]], str]] = {
    "priority": ([("(i.status <> 'Resolved')", "boolean"), ("i.priority_score", "int"), ("i.id", "uuid")], "DESC"),
    "newest": ([("i.created_at", "timestamptz"), ("i.id", "uuid")], "DESC"),
    "oldest": ([("(i.status = 'Resolved')", "boolean"), ("i.created_at", "timestamptz"), ("i.id", "uuid")], "ASC"),
    "affected": ([("i.affected_count", "int"), ("i.id", "uuid")], "DESC"),
}


def _sort_values(sort: str, row) -> list:
    return {
        "priority": [row.status != "Resolved", row.priority_score, str(row.id)],
        "newest": [row.created_at.isoformat(), str(row.id)],
        "oldest": [row.status == "Resolved", row.created_at.isoformat(), str(row.id)],
        "affected": [row.affected_count, str(row.id)],
    }[sort]


def _filters(ward: str | None, category: str | None, status: str | None, q: str | None, hide_resolved: bool,
             min_priority: int | None = None, flag: str | None = None) -> tuple[list[str], dict]:
    where, params = [], {}
    if min_priority is not None:  # quick filters: Critical = 65+, High = 48+
        where.append("i.priority_score >= :minp")
        params["minp"] = min_priority
    if flag:
        where.append(":flag = ANY(i.flags)")
        params["flag"] = flag
    if ward:
        ward_id = ref.ward_id(ward)
        if ward_id is None:
            raise ApiError(422, "validation_error", "Unknown area.")
        where.append("i.ward_id = :ward")
        params["ward"] = ward_id
    if category:
        cat = ref.category(category)
        if not cat:
            raise ApiError(422, "validation_error", "Unknown category.")
        where.append("i.category_id = :cat")
        params["cat"] = cat.id
    if status:
        if status not in STATUSES:
            raise ApiError(422, "validation_error", "Unknown status.")
        where.append("i.status = CAST(:status AS issue_status)")
        params["status"] = status
    if hide_resolved:
        where.append("i.status <> 'Resolved'")
    if q and q.strip():
        # Report ID and address use the pg_trgm indexes (migration 0003); category and area names are
        # matched here against the small reference lists, so the query stays index-friendly.
        term = q.strip().lower()
        parts = ["i.public_id ILIKE :q", "i.address_text ILIKE :q"]
        params["q"] = "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        if cats := [c.id for c in ref.categories.values() if term in c.name.lower()]:
            parts.append("i.category_id = ANY(CAST(:qcats AS smallint[]))")
            params["qcats"] = cats
        if wards := [w for w, n in ref.wards.items() if term in n.lower()]:
            parts.append("i.ward_id = ANY(CAST(:qwards AS smallint[]))")
            params["qwards"] = wards
        where.append("(" + " OR ".join(parts) + ")")
    return where, params


@router.get("/incidents")
async def list_incidents(
    _: Authority, db: Db,
    ward: str | None = None, category: str | None = None, status: str | None = None, q: str | None = Query(None, max_length=100),
    hide_resolved: bool = False, min_priority: int | None = Query(None, ge=0, le=100), flag: str | None = Query(None, max_length=40), sort: Literal["priority", "newest", "oldest", "affected"] = "priority",
    cursor: str | None = None, limit: int = Query(50, ge=1, le=100),
):
    cols, direction = SORTS[sort]
    where, params = _filters(ward, category, status, q, hide_resolved, min_priority, flag)
    after = paging.decode(cursor, len(cols))
    if after:
        op = "<" if direction == "DESC" else ">"
        where.append(f"({', '.join(c for c, _ in cols)}) {op} ({', '.join(f'CAST(:k{n} AS {t})' for n, (_, t) in enumerate(cols))})")
        params.update({f"k{n}": v for n, v in enumerate(paging.typed(after, [t for _, t in cols]))})
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    order = ", ".join(f"{c} {direction}" for c, _ in cols)
    rows = (await db.execute(text(f"""
        WITH page AS (SELECT i.* FROM incidents i {where_sql} ORDER BY {order} LIMIT :n)
        {svc.ROW_SELECT.format(extra=", ST_Y(i.location::geometry) AS lat, ST_X(i.location::geometry) AS lng")}
        ORDER BY {order}"""), {**params, "n": limit + 1})).all()
    more = len(rows) > limit
    rows = rows[:limit]
    total = None
    if not cursor:  # the count is only needed once per filter set
        total = await db.scalar(text(f"SELECT count(*) FROM incidents i {where_sql}"), params)
    return {
        "items": [svc.authority_row(r) for r in rows],
        "next_cursor": paging.encode(_sort_values(sort, rows[-1])) if more and rows else None,
        "total": total,
    }


@router.get("/stats")
async def stats(_: Authority, db: Db):
    """Totals plus per-category and per-ward counts, in one query."""
    row = (await db.execute(text("""
        WITH s AS MATERIALIZED (SELECT category_id, ward_id, status, priority_score, created_at FROM incidents)
        SELECT
          (SELECT json_build_object(
              'total', count(*), 'open', count(*) FILTER (WHERE status <> 'Resolved'),
              'in_progress', count(*) FILTER (WHERE status = 'In Progress'),
              'resolved', count(*) FILTER (WHERE status = 'Resolved'),
              'critical_open', count(*) FILTER (WHERE status <> 'Resolved' AND priority_score >= 65),
              'high_open', count(*) FILTER (WHERE status <> 'Resolved' AND priority_score >= 48 AND priority_score < 65),
              'new_24h', count(*) FILTER (WHERE created_at > now() - interval '24 hours')) FROM s) AS totals,
          (SELECT coalesce(json_agg(json_build_object('id', category_id, 'total', total, 'open', open)), '[]') FROM
              (SELECT category_id, count(*) AS total, count(*) FILTER (WHERE status <> 'Resolved') AS open FROM s GROUP BY category_id) x) AS per_category,
          (SELECT coalesce(json_agg(json_build_object('id', ward_id, 'total', total, 'open', open)), '[]') FROM
              (SELECT ward_id, count(*) AS total, count(*) FILTER (WHERE status <> 'Resolved') AS open FROM s GROUP BY ward_id) y) AS per_ward
    """))).one()
    by_cat = {c["id"]: c for c in row.per_category}
    by_ward = {w["id"]: w for w in row.per_ward}
    return {
        **row.totals,
        "per_category": [{"category": c.name, "total": by_cat.get(c.id, {}).get("total", 0), "open": by_cat.get(c.id, {}).get("open", 0)} for c in sorted(ref.categories.values(), key=lambda c: c.id)],
        "per_ward": [{"area": name, "total": by_ward.get(wid, {}).get("total", 0), "open": by_ward.get(wid, {}).get("open", 0)} for wid, name in sorted(ref.wards.items())]
        + ([{"area": None, **{k: by_ward[None][k] for k in ("total", "open")}}] if None in by_ward else []),
    }


@router.get("/hotspots")
async def hotspots(_: Authority, db: Db, limit: int = Query(5, ge=1, le=20)):
    """Areas ranked by open-incident impact (see incidents.hotspots for the formula)."""
    return {"items": await svc.hotspots(db, limit)}


async def build_detail(db, incident_id: uuid.UUID, viewer_id: uuid.UUID, include_phone: bool = False) -> dict:
    """Full incident detail: priority reasons (computed on read), reporters' names, the message thread and
    signed photo URLs. Shared by the authority and (read-only) admin routes. Phones only when requested."""
    row = (await db.execute(text(f"""
        WITH page AS (SELECT * FROM incidents WHERE id = :id)
        {svc.ROW_SELECT.format(extra=", ST_Y(i.location::geometry) AS lat, ST_X(i.location::geometry) AS lng")}"""), {"id": incident_id})).first()
    if not row:
        raise not_found("Incident")
    reporters = (await db.execute(text("""
        SELECT r.id, u.name, u.phone, r.problem_type, r.description, r.created_at, r.user_corrected,
               ac.name AS ai_category, r.ai_confidence, r.ai_source, r.ai_disagreement, r.nlp, r.citizen_message, r.location_source
        FROM reports r JOIN users u ON u.id = r.user_id LEFT JOIN categories ac ON ac.id = r.ai_category_id
        WHERE r.incident_id = :id ORDER BY r.created_at"""), {"id": incident_id})).all()
    media = (await db.execute(text("""
        SELECT m.storage_key, m.thumb_key, m.width, m.height FROM media m JOIN reports r ON r.id = m.report_id
        WHERE r.incident_id = :id ORDER BY r.created_at, m.created_at"""), {"id": incident_id})).all()
    storage = get_storage()
    d = svc.authority_row(row)
    d.update(
        reporters=[{
            "name": r.name, "phone": r.phone if include_phone else None, "problem_type": r.problem_type,
            "description": r.description, "reported_at": r.created_at,
            "ai_category": r.ai_category, "ai_confidence": r.ai_confidence, "user_corrected": r.user_corrected,
            "ai_source": r.ai_source, "ai_disagreement": r.ai_disagreement, "nlp": r.nlp, "citizen_message": r.citizen_message,
            "location_source": r.location_source,
        } for r in reporters],
        images=[{"url": storage.signed_url(m.storage_key), "thumb_url": storage.signed_url(m.thumb_key), "width": m.width, "height": m.height} for m in media],
        history=(await svc.history(db, [incident_id]))[incident_id],
        messages=(await svc.thread(db, [incident_id], viewer_id, as_authority=True))[incident_id],
    )
    return d


@router.get("/map")
async def map_view(_: Authority, db: Db):
    """Map dashboard data: every incident with coordinates, per-area totals and DBSCAN clusters."""
    return await svc.map_data(db)


@router.get("/incidents/{incident_id}")
async def incident_detail(incident_id: uuid.UUID, authority: Authority, db: Db, include_phone: bool = False):
    d = await build_detail(db, incident_id, authority.id, include_phone)
    await db.execute(text("""UPDATE messages m SET read_at = now() FROM users u
                             WHERE u.id = m.sender_id AND u.role = 'citizen' AND m.incident_id = :id AND m.read_at IS NULL"""), {"id": incident_id})
    await db.commit()
    return d


@router.post("/incidents/{incident_id}/update")
async def update_incident(incident_id: uuid.UUID, body: AuthorityUpdate, authority: Authority, db: Db):
    if body.status is None and not (body.message or "").strip() and body.flags is None:
        raise ApiError(422, "validation_error", "Nothing to update.")
    found = await svc.apply_update(db, authority.id, [incident_id], body.status, body.message, body.flags)
    if not found:
        raise not_found("Incident")
    row = (await db.execute(text("SELECT status::text AS status, priority_score, flags, updated_at FROM incidents WHERE id = :i"), {"i": incident_id})).one()
    await db.commit()
    return {"id": incident_id, "status": row.status, "priority_score": row.priority_score, "level": level_of(row.priority_score), "flags": list(row.flags), "updated_at": row.updated_at}


@router.post("/incidents/bulk")
async def bulk_update(body: BulkUpdate, authority: Authority, db: Db):
    if body.status is None and not (body.message or "").strip():
        raise ApiError(422, "validation_error", "Choose a status or write a message.")
    found = await svc.apply_update(db, authority.id, list(dict.fromkeys(body.ids)), body.status, body.message)
    await db.commit()
    return {"updated": len(found), "ids": found}
