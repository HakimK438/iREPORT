import uuid
from typing import Literal

from fastapi import APIRouter, Query
from sqlalchemy import text

from .. import incidents as svc
from .. import paging, workflow
from ..brief import build_brief
from ..deps import Authority, Db
from ..errors import ApiError, not_found
from ..refdata import ref
from ..schemas import AuthorityUpdate, BulkUpdate, ReviewDecision
from ..status import STATUSES, is_open, open_sql

router = APIRouter(prefix="/authority", tags=["authority"])

# Keyset paging: every column in a sort runs the same direction, so a row comparison works and the priority sort walks
# the incidents_priority_page_idx index. Complaints that are no longer open come last.
SORTS: dict[str, tuple[list[tuple[str, str]], str]] = {
    "priority": ([(open_sql("i"), "boolean"), ("i.priority_score", "int"), ("i.id", "uuid")], "DESC"),
    "newest": ([("i.created_at", "timestamptz"), ("i.id", "uuid")], "DESC"),
    "oldest": ([(f"(NOT {open_sql('i')})", "boolean"), ("i.created_at", "timestamptz"), ("i.id", "uuid")], "ASC"),
    "affected": ([("i.affected_count", "int"), ("i.id", "uuid")], "DESC"),
    "due": ([(f"(NOT {open_sql('i')})", "boolean"), ("i.due_at", "timestamptz"), ("i.id", "uuid")], "ASC"),
}


def _sort_values(sort: str, row) -> list:
    return {
        "priority": [is_open(row.status), row.priority_score, str(row.id)],
        "newest": [row.created_at.isoformat(), str(row.id)],
        "oldest": [not is_open(row.status), row.created_at.isoformat(), str(row.id)],
        "affected": [row.affected_count, str(row.id)],
        "due": [not is_open(row.status), row.due_at.isoformat() if row.due_at else "infinity", str(row.id)],
    }[sort]


# The count chips at the top of the list. The list filter (view=...) and the counts in /authority/stats use THESE
# predicates, so a chip's number always equals the list's `total` for the same filters.
CHIPS: dict[str, str | None] = {
    "all": None,
    "mine": "i.assigned_to = :me",  # "Assigned to me"
    "review": "(i.needs_review AND " + open_sql("i") + ")",  # "Potentially fake / needs review"
    "new": "i.status IN ('Reported', 'Reopened')",
    "acknowledged": "i.status = 'Acknowledged'",
    "scheduled": "i.status = 'Scheduled'",
    "in_progress": "i.status = 'In Progress'",
    "resolved": "i.status = 'Resolved'",  # waiting for the citizen
    "closed": "i.status = 'Closed'",
    "overdue": f"({open_sql('i')} AND i.due_at < now())",
    "unassigned": f"({open_sql('i')} AND i.assigned_to IS NULL)",
}
View = Literal["all", "mine", "review", "new", "acknowledged", "scheduled", "in_progress", "resolved", "closed", "overdue", "unassigned"]
RESPONSE_RISK = {"Emergency": "i.risk >= 12", "Urgent": "(i.risk >= 8 AND i.risk < 12)", "Routine": "(i.risk >= 4 AND i.risk < 8)", "Planned": "i.risk < 4"}


def _base_filters(ward: str | None, category: str | None, q: str | None) -> tuple[list[str], dict]:
    """Ward, category and search: shared by the list, the chip counts and the analytics endpoints."""
    where, params = [], {}
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
        where.append("i.category_id = ANY(CAST(:cats AS smallint[]))")
        params["cats"] = ref.merged_ids(cat.name)
    if q and q.strip():
        # Complaint no. and address use the pg_trgm indexes (migration 0003); category and area names are matched here
        # against the small reference lists, so the query stays index-friendly.
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


def _filters(ward: str | None, category: str | None, status: str | None, q: str | None, open_only: bool,
             response: str | None = None, view: str = "all") -> tuple[list[str], dict]:
    where, params = _base_filters(ward, category, q)
    if status:
        if status not in STATUSES:
            raise ApiError(422, "validation_error", "Unknown status.")
        where.append("i.status = CAST(:status AS issue_status)")
        params["status"] = status
    if open_only:
        where.append(open_sql("i"))
    if response:
        if response not in RESPONSE_RISK:
            raise ApiError(422, "validation_error", "Unknown response category.")
        where.append(RESPONSE_RISK[response])
    if view != "all":
        where.append(CHIPS[view])
    return where, params


GENERAL_DEPARTMENT = "General / Ward Office"


class OfficerScope:
    """What one officer may see and change: complaints in their own area (ward) and of their own department's categories.
    An officer with no area covers the whole city; the General / Ward Office department covers every category.
    Enforced on the server for every list, count, detail, update and bulk call."""

    def __init__(self, authority) -> None:
        self.user_id = authority.id
        self.ward_id = authority.user.ward_id
        dept_id = authority.profile.department_id if authority.profile else None
        dept = ref.departments.get(dept_id) if dept_id else None
        self.department = dept
        self.category_ids: list[int] | None = None if dept in (None, GENERAL_DEPARTMENT) else [c.id for c in ref.categories.values() if c.department_id == dept_id]
        self.area = ref.wards.get(self.ward_id) if self.ward_id else None

    def where(self) -> tuple[list[str], dict]:
        """SQL conditions on the incidents table (unaliased column names, so they work with or without an alias)."""
        where, params = [], {}
        if self.ward_id:
            where.append("ward_id = :scope_ward")
            params["scope_ward"] = self.ward_id
        if self.category_ids is not None:
            where.append("category_id = ANY(CAST(:scope_cats AS smallint[]))")
            params["scope_cats"] = self.category_ids
        return where, params

    def allows(self, ward_id: int | None, category_id: int) -> bool:
        return (not self.ward_id or ward_id == self.ward_id) and (self.category_ids is None or category_id in self.category_ids)


async def _guard(db, scope: OfficerScope, incident_id: uuid.UUID) -> None:
    """404 for a complaint that does not exist, 403 for one outside the officer's area or department."""
    row = (await db.execute(text("SELECT ward_id, category_id FROM incidents WHERE id = :i"), {"i": incident_id})).first()
    if not row:
        raise not_found("Incident")
    if not scope.allows(row.ward_id, row.category_id):
        raise ApiError(403, "out_of_scope", "This complaint belongs to another area or department. You can only view and update your own.")


@router.get("/incidents")
async def list_incidents(
    authority: Authority, db: Db,
    ward: str | None = None, category: str | None = None, status: str | None = None, q: str | None = Query(None, max_length=100),
    open_only: bool = False, response: str | None = Query(None, max_length=12), view: View = "all",
    sort: Literal["priority", "newest", "oldest", "affected", "due"] = "priority",
    cursor: str | None = None, limit: int = Query(50, ge=1, le=100),
):
    cols, direction = SORTS[sort]
    scope_where, scope_params = OfficerScope(authority).where()
    scope_params["me"] = authority.id
    where, params = _filters(ward, category, status, q, open_only, response, view)
    where, params = where + scope_where, {**params, **scope_params}
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
        count_where, count_params = _filters(ward, category, status, q, open_only, response, view)
        count_where, count_params = count_where + scope_where, {**count_params, **scope_params}
        total = await db.scalar(text(f"SELECT count(*) FROM incidents i {('WHERE ' + ' AND '.join(count_where)) if count_where else ''}"), count_params)
    return {
        "items": [svc.authority_row(r) for r in rows],
        "next_cursor": paging.encode(_sort_values(sort, rows[-1])) if more and rows else None,
        "total": total,
    }


@router.get("/stats")
async def stats(authority: Authority, db: Db, ward: str | None = None, category: str | None = None, q: str | None = Query(None, max_length=100)):
    """Totals, a count per status, overdue / unassigned / due today, per-category and per-ward counts, and `chips`:
    the count behind each chip of the list, under the same ward / category / search filters as the list.
    Everything is limited to the officer's own area and department."""
    scope_where, scope_params = OfficerScope(authority).where()
    scope_sql = ("WHERE " + " AND ".join(scope_where)) if scope_where else ""
    row = (await db.execute(text(f"""
        WITH s AS MATERIALIZED (SELECT category_id, ward_id, status, risk, created_at, due_at, assigned_to FROM incidents {scope_sql})
        SELECT
          (SELECT json_build_object(
              'total', count(*), 'open', count(*) FILTER (WHERE ireport_is_open(status)),
              'overdue', count(*) FILTER (WHERE ireport_is_open(status) AND due_at < now()),
              'unassigned', count(*) FILTER (WHERE ireport_is_open(status) AND assigned_to IS NULL),
              'due_today', count(*) FILTER (WHERE ireport_is_open(status) AND (due_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date),
              'emergency_open', count(*) FILTER (WHERE ireport_is_open(status) AND risk >= 12),
              'urgent_open', count(*) FILTER (WHERE ireport_is_open(status) AND risk >= 8 AND risk < 12),
              'moderate_open', count(*) FILTER (WHERE ireport_is_open(status) AND risk >= 4 AND risk < 8),
              'routine_open', count(*) FILTER (WHERE ireport_is_open(status) AND risk < 4),
              'new_24h', count(*) FILTER (WHERE created_at > now() - interval '24 hours')) FROM s) AS totals,
          (SELECT coalesce(json_object_agg(status, n), '{{}}') FROM (SELECT status::text AS status, count(*) AS n FROM s GROUP BY status) b) AS by_status,
          (SELECT coalesce(json_agg(json_build_object('id', category_id, 'total', total, 'open', open)), '[]') FROM
              (SELECT category_id, count(*) AS total, count(*) FILTER (WHERE ireport_is_open(status)) AS open FROM s GROUP BY category_id) x) AS per_category,
          (SELECT coalesce(json_agg(json_build_object('id', ward_id, 'total', total, 'open', open)), '[]') FROM
              (SELECT ward_id, count(*) AS total, count(*) FILTER (WHERE ireport_is_open(status)) AS open FROM s GROUP BY ward_id) y) AS per_ward
    """), scope_params)).one()
    by_cat = {c["id"]: c for c in row.per_category}
    by_ward = {w["id"]: w for w in row.per_ward}

    where, params = _base_filters(ward, category, q)
    where, params = where + scope_where, {**params, **scope_params, "me": authority.id}
    chip_cols = ", ".join(f"count(*) FILTER (WHERE {sql if sql else 'true'}) AS {name}" for name, sql in CHIPS.items())
    chips = (await db.execute(text(f"SELECT {chip_cols} FROM incidents i {('WHERE ' + ' AND '.join(where)) if where else ''}"), params)).mappings().one()
    return {
        **row.totals,
        "by_status": {s: row.by_status.get(s, 0) for s in STATUSES},
        "chips": dict(chips),
        "per_category": [{"category": c.name, "total": by_cat.get(c.id, {}).get("total", 0), "open": by_cat.get(c.id, {}).get("open", 0)} for c in sorted(ref.categories.values(), key=lambda c: c.id)],
        "per_ward": [{"area": name, "total": by_ward.get(wid, {}).get("total", 0), "open": by_ward.get(wid, {}).get("open", 0)} for wid, name in sorted(ref.wards.items())]
        + ([{"area": None, **{k: by_ward[None][k] for k in ("total", "open")}}] if None in by_ward else []),
    }


@router.get("/officers")
async def officers(authority: Authority, db: Db):
    """Approved officers who can be assigned a complaint: colleagues of the same department who cover the same area (or the whole city)."""
    scope = OfficerScope(authority)
    rows = (await db.execute(text("""
        SELECT u.id, u.name, d.name AS department, w.name AS ward, u.ward_id, a.department_id
        FROM users u JOIN authority_profiles a ON a.user_id = u.id LEFT JOIN departments d ON d.id = a.department_id LEFT JOIN wards w ON w.id = u.ward_id
        WHERE u.role = 'authority' AND a.approval = 'approved' AND u.deleted_at IS NULL ORDER BY u.name"""))).all()
    mine = authority.profile.department_id if authority.profile else None
    keep = [r for r in rows if r.id == authority.id or (
        (scope.department in (None, GENERAL_DEPARTMENT) or r.department_id == mine) and (not scope.ward_id or r.ward_id in (None, scope.ward_id)))]
    return {"items": [{"id": r.id, "name": r.name, "department": r.department, "ward": r.ward, "is_me": r.id == authority.id} for r in keep]}


@router.get("/areas")
async def area_authorities(authority: Authority, db: Db):
    """The areas that have an approved ward authority, for the area tabs at the top of the panel. Names only: opening another
    area means signing in as that area's authority."""
    rows = (await db.execute(text("""
        SELECT w.name AS area, count(*)::int AS officers FROM users u JOIN authority_profiles a ON a.user_id = u.id JOIN wards w ON w.id = u.ward_id
        WHERE u.role = 'authority' AND a.approval = 'approved' AND u.deleted_at IS NULL GROUP BY w.name ORDER BY w.name"""))).all()
    return {"items": [{"area": r.area, "officers": r.officers, "is_mine": r.area == OfficerScope(authority).area} for r in rows]}


@router.get("/hotspots")
async def hotspots(authority: Authority, db: Db, limit: int = Query(5, ge=1, le=20)):
    """Areas ranked by open-incident impact (see incidents.hotspots for the formula). An officer sees their own area's only."""
    items = await svc.hotspots(db, 20 if OfficerScope(authority).area else limit)
    area = OfficerScope(authority).area
    return {"items": [h for h in items if h["area"] == area][:limit] if area else items}


async def build_detail(db, incident_id: uuid.UUID, viewer_id: uuid.UUID, include_phone: bool = False) -> dict:
    """The incident brief (see brief.py). Shared by the authority and (read-only) admin routes. Phones only when requested."""
    return await build_brief(db, incident_id, viewer_id, include_phone)


@router.get("/map")
async def map_view(authority: Authority, db: Db):
    """Map dashboard data for the officer's own area and department: incidents with coordinates, per-area totals and DBSCAN clusters."""
    scope = OfficerScope(authority)
    cats = None if scope.category_ids is None else {c.name for c in ref.categories.values() if c.id in scope.category_ids}
    return await svc.map_data(db, scope.area, cats)


@router.get("/incidents/{incident_id}")
async def incident_detail(incident_id: uuid.UUID, authority: Authority, db: Db, include_phone: bool = False):
    await _guard(db, OfficerScope(authority), incident_id)
    d = await build_detail(db, incident_id, authority.id, include_phone)
    await db.execute(text("""UPDATE messages m SET read_at = now() FROM users u
                             WHERE u.id = m.sender_id AND u.role = 'citizen' AND m.incident_id = :id AND m.read_at IS NULL"""), {"id": incident_id})
    await db.commit()
    return d


async def _check_assignee(db, authority, scope: OfficerScope, assignee: uuid.UUID | None) -> None:
    """An officer can only hand work to a colleague of the same department who covers the same area."""
    if not assignee or assignee in {o["id"] for o in (await officers(authority, db))["items"]}:
        return
    # Not a colleague in scope. A real officer elsewhere is refused here; anyone else gets "unknown officer" from the workflow.
    if await db.scalar(text("SELECT EXISTS (SELECT 1 FROM authority_profiles WHERE user_id = :u AND approval = 'approved')"), {"u": assignee}):
        raise ApiError(403, "out_of_scope", "You can only assign complaints to officers of your own department and area.")


@router.post("/incidents/{incident_id}/update")
async def update_incident(incident_id: uuid.UUID, body: AuthorityUpdate, authority: Authority, db: Db):
    scope = OfficerScope(authority)
    await _guard(db, scope, incident_id)
    if not any([body.status, (body.message or "").strip(), body.flags is not None, body.assigned_to, body.scheduled_for]):
        raise ApiError(422, "validation_error", "Nothing to update.")
    await _check_assignee(db, authority, scope, body.assigned_to)
    result = await workflow.apply_officer_update(db, authority.id, incident_id, body)
    await db.commit()
    return result


@router.post("/incidents/bulk")
async def bulk_update(body: BulkUpdate, authority: Authority, db: Db):
    """Acknowledge, assign, schedule and message many complaints. Resolving is never bulk: each fix needs its own note."""
    scope = OfficerScope(authority)
    if not any([body.status, (body.message or "").strip(), body.assigned_to, body.scheduled_for]):
        raise ApiError(422, "validation_error", "Choose an action: acknowledge, assign, schedule or message.")
    await _check_assignee(db, authority, scope, body.assigned_to)
    ids = list(dict.fromkeys(body.ids))
    rows = (await db.execute(text("SELECT id, ward_id, category_id FROM incidents WHERE id = ANY(CAST(:ids AS uuid[]))"), {"ids": [str(i) for i in ids]})).all()
    allowed = {r.id for r in rows if scope.allows(r.ward_id, r.category_id)}
    outside = [{"id": i, "code": "out_of_scope", "message": "Another area or department."} for i in ids if i not in allowed]
    result = await workflow.apply_bulk(db, authority.id, body.model_copy(update={"ids": [i for i in ids if i in allowed]})) if allowed else {"updated": 0, "ids": [], "skipped": []}
    result["skipped"] = [*result["skipped"], *outside]
    await db.commit()
    return result


@router.post("/incidents/{incident_id}/review")
async def review_report(incident_id: uuid.UUID, body: ReviewDecision, authority: Authority, db: Db):
    """Potentially fake / needs review: the officer decides. "genuine" clears the flag; "fake" rejects the complaint with the reason."""
    await _guard(db, OfficerScope(authority), incident_id)
    cur = await db.scalar(text("SELECT status::text FROM incidents WHERE id = :i FOR UPDATE"), {"i": incident_id})
    note = (body.note or "").strip()
    if body.decision == "fake":
        await workflow.apply_officer_update(db, authority.id, incident_id, AuthorityUpdate(status="Rejected", reason=f"Fake or irrelevant report. {note}".strip()))
        await db.execute(text("UPDATE incidents SET needs_review = false WHERE id = :i"), {"i": incident_id})
    else:
        await db.execute(text("UPDATE incidents SET needs_review = false, updated_at = now() WHERE id = :i"), {"i": incident_id})
        await workflow._event(db, incident_id, cur, cur, authority.id, f"Reviewed: the report is genuine. {note}".strip())
    await db.commit()
    return {"id": incident_id, "decision": body.decision}
