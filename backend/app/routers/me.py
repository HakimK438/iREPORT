from datetime import UTC, datetime

from fastapi import APIRouter, Response
from sqlalchemy import text, update

from ..deps import CurrentUser, Db
from ..errors import ApiError, forbidden
from ..models import AuthorityProfile, RefreshToken, User
from ..refdata import ref
from ..schemas import MePatch, UserOut
from .auth import COOKIE, COOKIE_PATH, user_out

router = APIRouter(tags=["me"])


@router.get("/me", response_model=UserOut)
async def me(principal: CurrentUser):
    return user_out(principal.user, principal.profile)


@router.patch("/me", response_model=UserOut)
async def patch_me(body: MePatch, principal: CurrentUser, db: Db):
    user = await db.get(User, principal.id)
    fields = body.model_fields_set
    if "name" in fields and body.name:
        user.name = body.name
    if "phone" in fields:
        user.phone = body.phone
    if "area" in fields:
        ward_id = ref.ward_id(body.area)
        if body.area and ward_id is None:
            raise ApiError(422, "validation_error", "Unknown area.")
        user.ward_id = ward_id
    if "lang" in fields and body.lang:
        user.lang = body.lang
    await db.commit()
    return user_out(user, principal.profile)


@router.get("/me/export")
async def export_me(principal: CurrentUser, db: Db):
    """Everything iREPORT holds about the signed-in user (DPDP Act access request)."""
    uid = {"u": principal.id}
    reports = (await db.execute(text("""
        SELECT r.created_at, i.public_id, c.name AS category, r.problem_type, r.description, i.address_text,
               ST_Y(i.location::geometry) AS lat, ST_X(i.location::geometry) AS lng, i.status::text AS status,
               (SELECT count(*) FROM media m WHERE m.report_id = r.id) AS photos
        FROM reports r JOIN incidents i ON i.id = r.incident_id JOIN categories c ON c.id = i.category_id
        WHERE r.user_id = :u ORDER BY r.created_at"""), uid)).mappings().all()
    messages = (await db.execute(text("""
        SELECT m.created_at, i.public_id, m.body FROM messages m JOIN incidents i ON i.id = m.incident_id
        WHERE m.sender_id = :u ORDER BY m.created_at"""), uid)).mappings().all()
    confirmations = (await db.execute(text("""
        SELECT c.created_at, i.public_id FROM confirmations c JOIN incidents i ON i.id = c.incident_id
        WHERE c.user_id = :u ORDER BY c.created_at"""), uid)).mappings().all()
    return {
        "exported_at": datetime.now(UTC),
        "profile": user_out(principal.user, principal.profile).model_dump(),
        "reports": [dict(r) for r in reports],
        "messages_sent": [dict(m) for m in messages],
        "confirmations": [dict(c) for c in confirmations],
    }


@router.delete("/me", status_code=204)
async def delete_me(principal: CurrentUser, db: Db):
    """Anonymise personal fields. Reports stay (the problem is still real) but point to an anonymous identity."""
    if principal.role == "admin":
        raise forbidden("Admin accounts cannot be deleted from the app.")
    now = datetime.now(UTC)
    await db.execute(
        update(User).where(User.id == principal.id).values(
            name="Deleted user", email=f"deleted-{principal.id}@deleted.invalid", phone=None,
            password_hash="!deleted", ward_id=None, deleted_at=now,
        )
    )
    if principal.role == "authority":
        await db.execute(update(AuthorityProfile).where(AuthorityProfile.user_id == principal.id).values(employee_id="deleted", approval="rejected", decided_at=now))
    await db.execute(update(RefreshToken).where(RefreshToken.user_id == principal.id, RefreshToken.revoked_at.is_(None)).values(revoked_at=now))
    await db.commit()
    response = Response(status_code=204)
    response.delete_cookie(COOKIE, path=COOKIE_PATH)
    return response


@router.get("/me/contribution")
async def contribution(principal: CurrentUser, db: Db):
    """Real counts only: reports submitted, reports verified (resolved, or backed by another citizen's
    report or confirmation) and confirmations given. The one plain label needs verified >= 3 and a
    low category-correction rate; it is never earned by volume alone."""
    row = (await db.execute(text("""
        SELECT
          (SELECT count(*) FROM reports WHERE user_id = :u AND duplicate_of_report_id IS NULL) AS submitted,
          (SELECT count(*) FROM reports r JOIN incidents i ON i.id = r.incident_id WHERE r.user_id = :u AND r.duplicate_of_report_id IS NULL AND (
              i.status IN ('Resolved', 'Closed')
              OR EXISTS (SELECT 1 FROM confirmations f WHERE f.incident_id = i.id AND f.user_id <> :u)
              OR EXISTS (SELECT 1 FROM reports r2 WHERE r2.incident_id = i.id AND r2.user_id <> :u AND r2.duplicate_of_report_id IS NULL))) AS verified,
          (SELECT count(*) FROM confirmations WHERE user_id = :u) AS confirmations_given,
          (SELECT count(*) FROM reports WHERE user_id = :u AND user_corrected AND duplicate_of_report_id IS NULL) AS corrected"""), {"u": principal.id})).one()
    corrected_rate = row.corrected / row.submitted if row.submitted else 0.0
    trusted = row.verified >= 3 and corrected_rate <= 0.25
    return {
        "reports_submitted": row.submitted, "reports_verified": row.verified, "confirmations_given": row.confirmations_given,
        "category_corrected": row.corrected, "label": "Trusted contributor" if trusted else None,
    }


@router.get("/me/summary")
async def summary(principal: CurrentUser, db: Db):
    """Three real numbers and a level. incidents_resolved = my reports whose incident is Resolved or Closed;
    confirmations_received = sum of (affected_count - 1) over incidents I started (my report is the earliest).
    Level: Contributor >= 1 resolved; Trusted contributor >= 5 resolved and >= 10 submitted. Never from volume alone."""
    row = (await db.execute(text("""
        SELECT
          (SELECT count(*) FROM reports WHERE user_id = :u AND duplicate_of_report_id IS NULL)::int AS submitted,
          (SELECT count(*) FROM reports r JOIN incidents i ON i.id = r.incident_id WHERE r.user_id = :u AND r.duplicate_of_report_id IS NULL AND i.status IN ('Resolved', 'Closed'))::int AS resolved,
          (SELECT COALESCE(sum(i.affected_count - 1), 0) FROM incidents i WHERE i.affected_count > 1 AND
              (SELECT r.user_id FROM reports r WHERE r.incident_id = i.id AND r.duplicate_of_report_id IS NULL ORDER BY r.created_at, r.id LIMIT 1) = :u)::int AS received"""), {"u": principal.id})).one()
    level = "trusted" if row.resolved >= 5 and row.submitted >= 10 else "contributor" if row.resolved >= 1 else None
    return {"reports_submitted": row.submitted, "incidents_resolved": row.resolved, "confirmations_received": row.received, "level": level}
