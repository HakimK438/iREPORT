import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter
from sqlalchemy import select, text, update

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
