import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Query
from sqlalchemy import select, text, update

from .. import accountability as acc
from ..deps import Admin, Db
from ..errors import ApiError, not_found
from ..models import AuthorityProfile, RefreshToken, User
from ..refdata import ref
from ..schemas import AdminStats, AuthorityOut, DecisionIn
from ..status import open_sql

router = APIRouter(prefix="/admin", tags=["admin"])

_NEXT = {"approve": "approved", "reject": "rejected", "revoke": "rejected"}


def _out(user: User, profile: AuthorityProfile) -> AuthorityOut:
    return AuthorityOut(
        id=user.id, name=user.name, email=user.email, phone=user.phone,
        area=ref.wards.get(user.ward_id) if user.ward_id else None,
        department=ref.departments.get(profile.department_id) if profile.department_id else None,
        employee_id=profile.employee_id, approval=profile.approval, created_at=user.created_at, decided_at=profile.decided_at,
    )


@router.get("/authorities", response_model=list[AuthorityOut])
async def list_authorities(_: Admin, db: Db, approval: Literal["pending", "approved", "rejected"] | None = None):
    q = select(User, AuthorityProfile).join(AuthorityProfile, AuthorityProfile.user_id == User.id).where(User.deleted_at.is_(None)).order_by(User.created_at.desc()).limit(500)
    if approval:
        q = q.where(AuthorityProfile.approval == approval)
    return [_out(u, p) for u, p in (await db.execute(q)).all()]


@router.post("/authorities/{user_id}/decision", response_model=AuthorityOut)
async def decide(user_id: uuid.UUID, body: DecisionIn, admin: Admin, db: Db):
    row = (await db.execute(select(User, AuthorityProfile).join(AuthorityProfile, AuthorityProfile.user_id == User.id).where(User.id == user_id).with_for_update(of=AuthorityProfile))).first()
    if not row:
        raise not_found("Authority account")
    user, profile = row
    if body.decision == "revoke" and profile.approval != "approved":
        raise ApiError(409, "not_approved", "Only approved accounts can be revoked.")
    now = datetime.now(UTC)
    profile.approval, profile.decided_by, profile.decided_at = _NEXT[body.decision], admin.id, now
    if profile.approval != "approved":
        await db.execute(update(RefreshToken).where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None)).values(revoked_at=now))
    await db.commit()
    return _out(user, profile)


@router.get("/stats", response_model=AdminStats)
async def stats(_: Admin, db: Db):
    row = (await db.execute(text("""
        SELECT
          (SELECT count(*) FROM authority_profiles a JOIN users u ON u.id = a.user_id WHERE u.deleted_at IS NULL AND a.approval = 'pending') AS pending,
          (SELECT count(*) FROM authority_profiles a JOIN users u ON u.id = a.user_id WHERE u.deleted_at IS NULL AND a.approval = 'approved') AS approved,
          (SELECT count(*) FROM authority_profiles a JOIN users u ON u.id = a.user_id WHERE u.deleted_at IS NULL AND a.approval = 'rejected') AS rejected,
          (SELECT count(*) FROM users WHERE role = 'citizen' AND deleted_at IS NULL) AS citizens,
          (SELECT count(*) FROM incidents) AS incidents,
          (SELECT count(*) FROM reports WHERE duplicate_of_report_id IS NULL) AS reports"""))).mappings().one()
    return AdminStats(**row)


# Recommendation only: nothing is assigned or stored (the schema has no assignment field).
@router.get("/overview")
async def overview(_: Admin, db: Db):
    """Higher-authority view: unresolved critical count, per-department open workload, category concentration, top hotspots."""
    from .. import incidents as svc

    crit = await db.scalar(text(f"SELECT count(*) FROM incidents i WHERE {open_sql('i')} AND i.risk >= 12"))
    depts = (await db.execute(text(f"""
        SELECT d.name AS department, count(*) FILTER (WHERE {open_sql('i')}) AS open,
               count(*) FILTER (WHERE {open_sql('i')} AND i.risk >= 12) AS critical,
               count(*) FILTER (WHERE i.status IN ('Resolved', 'Closed')) AS resolved
        FROM departments d LEFT JOIN categories c ON c.department_id = d.id LEFT JOIN incidents i ON i.category_id = c.id
        GROUP BY d.id, d.name ORDER BY open DESC, d.name"""))).all()
    cats = (await db.execute(text(f"""
        SELECT c.name AS category, d.name AS department, count(*) AS open
        FROM incidents i JOIN categories c ON c.id = i.category_id LEFT JOIN departments d ON d.id = c.department_id
        WHERE {open_sql('i')} GROUP BY c.name, d.name ORDER BY open DESC"""))).all()
    total_open = sum(c.open for c in cats) or 1
    return {
        "unresolved_critical": crit,
        "departments": [{"department": d.department, "open": d.open, "critical": d.critical, "resolved": d.resolved} for d in depts],
        "categories": [{"category": c.category, "open": c.open, "share_pct": round(100 * c.open / total_open), "recommended_department": c.department,
                        "recommendation": f"{c.category} → {c.department}"} for c in cats],
        "hotspots": await svc.hotspots(db, 5),
    }


@router.get("/map")
async def map_view(_: Admin, db: Db):
    """Same map data as the authority control room (every incident, per-area totals, DBSCAN clusters)."""
    from .. import incidents as svc

    return await svc.map_data(db)


@router.get("/incidents/{incident_id}")
async def incident_detail(incident_id: uuid.UUID, admin: Admin, db: Db):
    """Read-only incident detail for the admin site. No phone numbers, and citizen messages are not marked read."""
    from .authority import build_detail

    return await build_detail(db, incident_id, admin.id)


@router.get("/audit")
async def audit(_: Admin, db: Db, days: int = Query(90, ge=1, le=365)):
    """Officer accountability: site-photo proof, citizen confirmation, reopens, holds and rejections per officer, the latest suspicious
    resolutions, and how many citizens have fake-report strikes. See accountability.py."""
    return await acc.audit_report(db, days)


@router.get("/performance")
async def performance(_: Admin, db: Db):
    """The admin dashboard: every figure is a count over the complaint, report and user tables (nothing estimated or modelled), using the
    same rules as the officers' analysis: "open" is status-based, "overdue" is open and past due_at, "on time" is resolved on or before due_at."""
    from .. import incidents as svc
    from .analytics import CAT, DONE, RES

    o = open_sql("i")
    t = (await db.execute(text(f"""
        WITH {RES}
        SELECT count(*) AS total, count(*) FILTER (WHERE {o}) AS open,
               count(*) FILTER (WHERE r.resolved_at IS NOT NULL) AS resolved,
               count(*) FILTER (WHERE i.status NOT IN ('Rejected', 'Duplicate')) AS valid,
               count(*) FILTER (WHERE {o} AND i.risk >= 12) AS critical, count(*) FILTER (WHERE {o} AND i.risk >= 8 AND i.risk < 12) AS high,
               count(*) FILTER (WHERE {o} AND i.risk >= 4 AND i.risk < 8) AS moderate, count(*) FILTER (WHERE {o} AND i.risk < 4) AS routine,
               count(*) FILTER (WHERE {o} AND i.due_at < now()) AS overdue, count(*) FILTER (WHERE {o} AND i.assigned_to IS NULL) AS unassigned,
               count(*) FILTER (WHERE i.status IN ('Reported', 'Reopened')) AS waiting, count(*) FILTER (WHERE i.status = 'Resolved') AS awaiting_citizen, count(*) FILTER (WHERE i.needs_review AND {o}) AS needs_review,
               count(*) FILTER (WHERE i.created_at > now() - interval '7 days') AS new_7d,
               count(*) FILTER (WHERE i.created_at <= now() - interval '7 days' AND i.created_at > now() - interval '14 days') AS prev_7d,
               count(*) FILTER (WHERE r.resolved_at IS NOT NULL AND r.resolved_at <= i.due_at) AS on_time,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (r.resolved_at - i.created_at)) / 86400) FILTER (WHERE r.resolved_at IS NOT NULL) AS median_days,
               count(*) FILTER (WHERE r.resolved_at IS NOT NULL AND i.reopen_count > 0) AS reopened,
               (SELECT count(*) FROM reports WHERE duplicate_of_report_id IS NULL) AS reports,
               (SELECT count(*) FROM users WHERE role = 'citizen' AND deleted_at IS NULL) AS citizens,
               (SELECT count(*) FROM authority_profiles a JOIN users u ON u.id = a.user_id WHERE u.deleted_at IS NULL AND a.approval = 'pending') AS pending_approvals,
               (SELECT count(*) FROM authority_profiles a JOIN users u ON u.id = a.user_id WHERE u.deleted_at IS NULL AND a.approval = 'approved') AS officers
        FROM incidents i LEFT JOIN res r ON r.incident_id = i.id"""))).mappings().one()
    pct = lambda n, d: round(100 * n / d) if d else None  # noqa: E731
    keys = ("total", "open", "resolved", "critical", "high", "moderate", "routine", "overdue", "unassigned", "waiting", "awaiting_citizen", "needs_review",
            "new_7d", "prev_7d", "reports", "citizens", "pending_approvals", "officers")
    summary = {k: t[k] for k in keys}
    summary.update(resolution_rate=pct(t["resolved"], t["valid"]), on_time_pct=pct(t["on_time"], t["resolved"]), reopen_pct=pct(t["reopened"], t["resolved"]),
                   median_days=round(t["median_days"], 1) if t["median_days"] is not None else None)

    weeks = (await db.execute(text(f"""
        WITH {DONE},
        weeks AS (SELECT generate_series(date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata') - interval '11 weeks', date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata'), interval '1 week') AS wk),
        s AS (SELECT i.created_at AT TIME ZONE 'Asia/Kolkata' AS c, d.done_at AT TIME ZONE 'Asia/Kolkata' AS d FROM incidents i LEFT JOIN done d ON d.incident_id = i.id)
        SELECT wk::date AS week, count(*) FILTER (WHERE s.c >= wk AND s.c < wk + interval '1 week') AS reported,
               count(*) FILTER (WHERE s.d >= wk AND s.d < wk + interval '1 week') AS closed,
               count(*) FILTER (WHERE s.c < wk + interval '1 week' AND (s.d IS NULL OR s.d >= wk + interval '1 week')) AS open_at_end
        FROM weeks LEFT JOIN s ON true GROUP BY wk ORDER BY wk"""))).all()
    categories = (await db.execute(text(f"""
        SELECT {CAT} AS category, count(*) AS total, count(*) FILTER (WHERE {o}) AS open, count(*) FILTER (WHERE {o} AND i.risk >= 8) AS high_risk
        FROM incidents i JOIN categories c ON c.id = i.category_id GROUP BY 1 ORDER BY open DESC, total DESC"""))).mappings().all()
    departments = (await db.execute(text(f"""
        WITH {RES}
        SELECT d.name AS department, count(*) AS total, count(*) FILTER (WHERE {o}) AS open, count(*) FILTER (WHERE {o} AND i.risk >= 8) AS high_risk,
               count(*) FILTER (WHERE {o} AND i.due_at < now()) AS overdue, count(*) FILTER (WHERE r.resolved_at IS NOT NULL) AS resolved,
               count(*) FILTER (WHERE r.resolved_at IS NOT NULL AND r.resolved_at <= i.due_at) AS on_time
        FROM incidents i JOIN categories c ON c.id = i.category_id JOIN departments d ON d.id = c.department_id LEFT JOIN res r ON r.incident_id = i.id
        GROUP BY d.name ORDER BY open DESC, d.name"""))).mappings().all()
    areas = (await db.execute(text(f"""
        WITH {RES}
        SELECT coalesce(w.name, 'Outside mapped areas') AS area, count(*) AS total, count(*) FILTER (WHERE {o}) AS open,
               count(*) FILTER (WHERE {o} AND i.risk >= 8) AS high_risk, count(*) FILTER (WHERE {o} AND i.due_at < now()) AS overdue,
               count(*) FILTER (WHERE r.resolved_at IS NOT NULL) AS resolved, count(*) FILTER (WHERE {o} AND i.assigned_to IS NULL) AS unassigned
        FROM incidents i LEFT JOIN wards w ON w.id = i.ward_id LEFT JOIN res r ON r.incident_id = i.id GROUP BY w.name ORDER BY open DESC, total DESC, area LIMIT 40"""))).mappings().all()
    officers = (await db.execute(text(f"""
        WITH {RES}
        SELECT u.id, u.name, d.name AS department, w.name AS area, count(i.id) FILTER (WHERE {o}) AS open,
               count(i.id) FILTER (WHERE {o} AND i.due_at < now()) AS overdue, count(i.id) FILTER (WHERE r.resolved_at IS NOT NULL) AS resolved,
               round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (r.resolved_at - i.created_at)) / 3600) FILTER (WHERE r.resolved_at IS NOT NULL))::int AS median_fix_hours
        FROM users u JOIN authority_profiles a ON a.user_id = u.id LEFT JOIN departments d ON d.id = a.department_id LEFT JOIN wards w ON w.id = u.ward_id
        LEFT JOIN incidents i ON i.assigned_to = u.id LEFT JOIN res r ON r.incident_id = i.id
        WHERE u.role = 'authority' AND a.approval = 'approved' AND u.deleted_at IS NULL GROUP BY u.id, u.name, d.name, w.name ORDER BY open DESC, u.name LIMIT 100"""))).mappings().all()
    return {
        "as_of": datetime.now(UTC), "summary": summary,
        "weeks": [{"week": r.week, "reported": r.reported, "closed": r.closed, "open_at_end": r.open_at_end} for r in weeks],
        "categories": [dict(c) for c in categories], "departments": [{**d, "on_time_pct": pct(d["on_time"], d["resolved"])} for d in departments],
        "areas": [{**a, "resolution_rate": pct(a["resolved"], a["total"]) or 0} for a in areas], "officers": [dict(r) for r in officers],
        "hotspots": await svc.hotspots(db, 6),
    }
