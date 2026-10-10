"""Authority analytics: every number is computed from incidents and status_events, filtered by date range, ward and category.

Definitions (also in README.md (Design decisions)):
- resolved_at  = the FIRST status event into Resolved. "Days to close", "within SLA" and "reopened" are about complaints that have one.
- done_at      = the first event into Resolved, Rejected or Duplicate: the moment the officers finished with it. The backlog chart and
                 "closed today" use it, so waiting for a citizen's confirmation is never counted against the team.
- within SLA   = resolved_at <= due_at.   reopened = reopen_count > 0.
- repeat spot  = a complaint of the same category within 50 m, reported again within 90 days after a closure (poor repair quality).
"""

import csv
import io
from datetime import date

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import text

from .. import risk_config as cfg
from ..deps import Authority, Db
from ..refdata import AREA_CENTRES
from ..status import open_sql
from .authority import View, _base_filters, _filters

router = APIRouter(prefix="/authority", tags=["analytics"])

IST_DAY = "date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'"
RES = """res AS (SELECT e.incident_id, min(e.created_at) AS resolved_at FROM status_events e WHERE e.to_status = 'Resolved' GROUP BY e.incident_id)"""
DONE = """done AS (SELECT e.incident_id, min(e.created_at) AS done_at FROM status_events e WHERE e.to_status IN ('Resolved', 'Rejected', 'Duplicate') GROUP BY e.incident_id)"""
DAYS = "extract(epoch FROM (r.resolved_at - i.created_at)) / 86400"
# legacy categories shown as their merged citizen-facing category (refdata.MERGED_CATEGORIES)
CAT = "CASE c.name WHEN 'Road Damage' THEN 'Pothole' WHEN 'Drainage' THEN 'Water Leakage' ELSE c.name END"


def scope(ward: str | None, category: str | None, date_from: date | None, date_to: date | None, dates: bool = True) -> tuple[str, dict]:
    """WHERE clause (alias i) for the shared filters. Dates are IST calendar days applied to created_at."""
    where, params = _base_filters(ward, category, None)
    if dates and date_from:
        where.append("i.created_at >= CAST(:d_from AS date)::timestamp AT TIME ZONE 'Asia/Kolkata'")
        params["d_from"] = date_from
    if dates and date_to:
        where.append("i.created_at < (CAST(:d_to AS date) + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'")
        params["d_to"] = date_to
    return ("WHERE " + " AND ".join(where)) if where else "", params


Filters = tuple[str | None, str | None, date | None, date | None]


@router.get("/analytics/overview")
async def overview(_: Authority, db: Db, ward: str | None = None, category: str | None = None, date_from: date | None = None, date_to: date | None = None):
    w, p = scope(ward, category, date_from, date_to)
    r = (await db.execute(text(f"""
        WITH {RES}
        SELECT count(*) FILTER (WHERE {open_sql('i')}) AS open,
               count(*) FILTER (WHERE {open_sql('i')} AND i.due_at < now()) AS overdue,
               count(*) FILTER (WHERE r.resolved_at > now() - interval '7 days') AS resolved_week,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY {DAYS}) FILTER (WHERE r.resolved_at IS NOT NULL) AS median_days,
               count(*) FILTER (WHERE r.resolved_at IS NOT NULL) AS resolved_total,
               count(*) FILTER (WHERE r.resolved_at IS NOT NULL AND r.resolved_at <= i.due_at) AS within_sla,
               count(*) FILTER (WHERE r.resolved_at IS NOT NULL AND i.reopen_count > 0) AS reopened,
               count(*) AS total
        FROM incidents i LEFT JOIN res r ON r.incident_id = i.id {w}"""), p)).one()
    pct = lambda n, d: round(100 * n / d) if d else None  # noqa: E731
    return {
        "open": r.open, "overdue": r.overdue, "resolved_week": r.resolved_week, "total": r.total, "resolved_total": r.resolved_total,
        "median_days_to_close": round(r.median_days, 1) if r.median_days is not None else None,
        "pct_within_sla": pct(r.within_sla, r.resolved_total), "pct_reopened": pct(r.reopened, r.resolved_total),
    }


@router.get("/analytics/backlog")
async def backlog(_: Authority, db: Db, ward: str | None = None, category: str | None = None):
    """Last 12 weeks (Monday to Sunday, IST): complaints reported, complaints the officers finished, and how many were still open at week end."""
    w, p = scope(ward, category, None, None, dates=False)
    rows = (await db.execute(text(f"""
        WITH {DONE},
        weeks AS (SELECT generate_series(date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata') - interval '11 weeks', date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata'), interval '1 week') AS wk),
        s AS (SELECT i.created_at AT TIME ZONE 'Asia/Kolkata' AS c, d.done_at AT TIME ZONE 'Asia/Kolkata' AS d FROM incidents i LEFT JOIN done d ON d.incident_id = i.id {w})
        SELECT wk::date AS week,
               count(*) FILTER (WHERE s.c >= wk AND s.c < wk + interval '1 week') AS reported,
               count(*) FILTER (WHERE s.d >= wk AND s.d < wk + interval '1 week') AS closed,
               count(*) FILTER (WHERE s.c < wk + interval '1 week' AND (s.d IS NULL OR s.d >= wk + interval '1 week')) AS open_at_end
        FROM weeks LEFT JOIN s ON true GROUP BY wk ORDER BY wk"""), p)).all()
    return {"weeks": [{"week": r.week, "reported": r.reported, "closed": r.closed, "open_at_end": r.open_at_end} for r in rows]}


@router.get("/analytics/by-ward")
async def by_ward(_: Authority, db: Db, ward: str | None = None, category: str | None = None, date_from: date | None = None, date_to: date | None = None):
    w, p = scope(None, category, date_from, date_to)  # a ward filter would leave one row: the table is the ward comparison
    rows = (await db.execute(text(f"""
        WITH {RES}
        SELECT wd.name AS ward, count(*) AS total, count(*) FILTER (WHERE {open_sql('i')}) AS open,
               count(*) FILTER (WHERE {open_sql('i')} AND i.due_at < now()) AS overdue,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY {DAYS}) FILTER (WHERE r.resolved_at IS NOT NULL) AS median_days
        FROM incidents i JOIN wards wd ON wd.id = i.ward_id LEFT JOIN res r ON r.incident_id = i.id {w}
        GROUP BY wd.name ORDER BY overdue DESC, open DESC, wd.name"""), p)).all()
    return {"items": [{"ward": r.ward, "total": r.total, "open": r.open, "overdue": r.overdue, "median_days_to_close": round(r.median_days, 1) if r.median_days is not None else None,
                       "lat": AREA_CENTRES[r.ward][0] if r.ward in AREA_CENTRES else None, "lng": AREA_CENTRES[r.ward][1] if r.ward in AREA_CENTRES else None} for r in rows]}


@router.get("/analytics/by-type")
async def by_type(_: Authority, db: Db, ward: str | None = None, category: str | None = None, date_from: date | None = None, date_to: date | None = None):
    w, p = scope(ward, None, date_from, date_to)
    rows = (await db.execute(text(f"""
        WITH {RES}
        SELECT {CAT} AS category, count(*) AS total, count(*) FILTER (WHERE {open_sql('i')}) AS open,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY {DAYS}) FILTER (WHERE r.resolved_at IS NOT NULL) AS median_days
        FROM incidents i JOIN categories c ON c.id = i.category_id LEFT JOIN res r ON r.incident_id = i.id {w}
        GROUP BY 1 ORDER BY total DESC"""), p)).all()
    # this month against last month (calendar months, IST), for the one-line takeaway; the date range does not apply
    w2, p2 = scope(ward, None, None, None, dates=False)
    trend = (await db.execute(text(f"""
        SELECT {CAT} AS category,
               count(*) FILTER (WHERE (i.created_at AT TIME ZONE 'Asia/Kolkata') >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')) AS this_month,
               count(*) FILTER (WHERE (i.created_at AT TIME ZONE 'Asia/Kolkata') >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') - interval '1 month'
                                  AND (i.created_at AT TIME ZONE 'Asia/Kolkata') < date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')) AS last_month
        FROM incidents i JOIN categories c ON c.id = i.category_id {w2} GROUP BY 1"""), p2)).all()
    wr, pr = scope(ward, None, date_from, date_to)
    repeats = (await db.execute(text(f"""
        WITH {RES}
        SELECT DISTINCT ON (i.id) i.public_id, {CAT} AS category, wd.name AS ward, p1.public_id AS previous,
               floor(extract(epoch FROM (i.created_at - r1.resolved_at)) / 86400)::int AS days_after
        FROM incidents i JOIN categories c ON c.id = i.category_id LEFT JOIN wards wd ON wd.id = i.ward_id
        JOIN incidents p1 ON p1.category_id = ANY(SELECT x.id FROM categories x WHERE CASE x.name WHEN 'Road Damage' THEN 'Pothole' WHEN 'Drainage' THEN 'Water Leakage' ELSE x.name END = {CAT}) AND p1.id <> i.id AND ST_DWithin(p1.location, i.location, {cfg.HISTORY_RADIUS_M})
        JOIN res r1 ON r1.incident_id = p1.id AND i.created_at > r1.resolved_at AND i.created_at <= r1.resolved_at + interval '{cfg.REPEAT_SPOT_DAYS} days'
        {wr} ORDER BY i.id, r1.resolved_at DESC"""), pr)).all()
    per_cat: dict[str, int] = {}
    for rp in repeats:
        per_cat[rp.category] = per_cat.get(rp.category, 0) + 1
    return {
        "items": [{"category": r.category, "total": r.total, "open": r.open, "median_days_to_close": round(r.median_days, 1) if r.median_days is not None else None,
                   "repeat_spots": per_cat.get(r.category, 0)} for r in rows],
        "trend": [{"category": t.category, "this_month": t.this_month, "last_month": t.last_month} for t in trend],
        "repeat_days": cfg.REPEAT_SPOT_DAYS, "repeat_radius_m": cfg.HISTORY_RADIUS_M,
        "repeats": [{"public_id": r.public_id, "category": r.category, "ward": r.ward, "previous": r.previous, "days_after": r.days_after} for r in repeats[:10]],
    }


@router.get("/analytics/performance")
async def performance(_: Authority, db: Db, ward: str | None = None, category: str | None = None, date_from: date | None = None, date_to: date | None = None):
    """Share of resolved complaints closed within their due date, and the reopen rate, per department and per ward."""
    w, p = scope(ward, category, date_from, date_to)

    async def group(label_sql: str, joins: str) -> list[dict]:
        rows = (await db.execute(text(f"""
            WITH {RES}
            SELECT {label_sql} AS label, count(*) FILTER (WHERE r.resolved_at IS NOT NULL) AS resolved,
                   count(*) FILTER (WHERE r.resolved_at IS NOT NULL AND r.resolved_at <= i.due_at) AS within_sla,
                   count(*) FILTER (WHERE r.resolved_at IS NOT NULL AND i.reopen_count > 0) AS reopened
            FROM incidents i JOIN categories c ON c.id = i.category_id {joins} LEFT JOIN res r ON r.incident_id = i.id {w}
            GROUP BY 1 HAVING count(*) FILTER (WHERE r.resolved_at IS NOT NULL) > 0 ORDER BY 1"""), p)).all()
        return [{"name": r.label, "resolved": r.resolved, "pct_within_sla": round(100 * r.within_sla / r.resolved), "reopen_rate": round(100 * r.reopened / r.resolved)} for r in rows]

    return {"departments": await group("d.name", "JOIN departments d ON d.id = c.department_id"), "wards": await group("wd.name", "JOIN wards wd ON wd.id = i.ward_id")}


@router.get("/analytics/season")
async def season(_: Authority, db: Db, ward: str | None = None, category: str | None = None):
    """Complaints per month and category over the last 12 months (IST)."""
    w, p = scope(ward, category, None, None, dates=False)
    rows = (await db.execute(text(f"""
        SELECT to_char(date_trunc('month', i.created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') AS month, {CAT} AS category, count(*) AS n
        FROM incidents i JOIN categories c ON c.id = i.category_id {w + (' AND ' if w else 'WHERE ')} (i.created_at AT TIME ZONE 'Asia/Kolkata') >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') - interval '11 months'
        GROUP BY 1, 2 ORDER BY 1, 2"""), p)).all()
    return {"items": [{"month": r.month, "category": r.category, "n": r.n} for r in rows]}


@router.get("/analytics/today")
async def today(_: Authority, db: Db, ward: str | None = None, category: str | None = None):
    """The ward summary card: new today, closed today (officers finished), and complaints now overdue."""
    w, p = scope(ward, category, None, None, dates=False)
    r = (await db.execute(text(f"""
        WITH {DONE}
        SELECT count(*) FILTER (WHERE i.created_at >= {IST_DAY}) AS new_today,
               count(*) FILTER (WHERE d.done_at >= {IST_DAY}) AS closed_today,
               count(*) FILTER (WHERE {open_sql('i')} AND i.due_at < now()) AS overdue
        FROM incidents i LEFT JOIN done d ON d.incident_id = i.id {w}"""), p)).one()
    return {"new_today": r.new_today, "closed_today": r.closed_today, "overdue": r.overdue, "ward": ward or None}


def _safe(v) -> str:
    """CSV cells that start with = + - @ would run as formulas in a spreadsheet: prefix them with an apostrophe."""
    s = "" if v is None else str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s


@router.get("/analytics/export.csv")
async def export_csv(_: Authority, db: Db, ward: str | None = None, category: str | None = None, status: str | None = None, q: str | None = Query(None, max_length=100),
                     open_only: bool = False, response: str | None = Query(None, max_length=12), view: View = "all"):
    """The filtered complaint list as CSV (same filters as the list), at most 10,000 rows."""
    where, params = _filters(ward, category, status, q, open_only, response, view)
    rows = (await db.execute(text(f"""
        SELECT i.public_id, c.name AS category, d.name AS department, w.name AS ward, i.address_text, i.status::text AS status, i.risk, i.created_at, i.due_at, i.resolved_at,
               ({open_sql('i')} AND i.due_at < now()) AS overdue, i.reopen_count, u.name AS assignee,
               (SELECT count(*) FROM (SELECT user_id FROM reports WHERE incident_id = i.id AND duplicate_of_report_id IS NULL UNION SELECT user_id FROM confirmations WHERE incident_id = i.id) x) AS citizens
        FROM incidents i JOIN categories c ON c.id = i.category_id LEFT JOIN departments d ON d.id = c.department_id LEFT JOIN wards w ON w.id = i.ward_id LEFT JOIN users u ON u.id = i.assigned_to
        {('WHERE ' + ' AND '.join(where)) if where else ''} ORDER BY i.created_at DESC LIMIT 10000"""), params)).all()
    from ..priority import response_of

    out = io.StringIO()
    wr = csv.writer(out)
    wr.writerow(["complaint_no", "category", "department", "ward", "address", "status", "response_category", "due_at", "overdue", "reopened_times", "assigned_to", "citizens", "created_at", "resolved_at"])
    for r in rows:
        wr.writerow([_safe(x) for x in (r.public_id, r.category, r.department, r.ward, r.address_text, r.status, response_of(r.risk)[0], r.due_at and r.due_at.isoformat(), "yes" if r.overdue else "no",
                                       r.reopen_count, r.assignee, r.citizens, r.created_at.isoformat(), r.resolved_at and r.resolved_at.isoformat())])
    return StreamingResponse(iter(["﻿" + out.getvalue()]), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": 'attachment; filename="complaints.csv"'})

