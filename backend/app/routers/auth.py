from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Request, Response
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from .. import ratelimit
from ..config import get_settings
from ..deps import Db
from ..errors import ApiError
from ..models import AuthorityProfile, RefreshToken, User
from ..refdata import ref
from ..schemas import LoginIn, PendingOut, RegisterIn, SessionOut, UserOut
from ..security import create_access_token, hash_password, hash_token, new_refresh_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

COOKIE = "ireport_refresh"
COOKIE_PATH = "/api/v1/auth"
REUSE_GRACE = timedelta(seconds=60)
PENDING_MESSAGE = "Request sent. An admin will verify your details, then you can log in."
APPROVAL_MESSAGES = {
    "pending": ("approval_pending", "Your authority account is waiting for admin approval."),
    "rejected": ("approval_rejected", "This authority account was not approved. Contact the admin."),
}


def user_out(user: User, profile: AuthorityProfile | None) -> UserOut:
    return UserOut(
        id=user.id, role=user.role, name=user.name, email=user.email, phone=user.phone,
        area=ref.wards.get(user.ward_id) if user.ward_id else None, lang=user.lang.strip(),
        department=ref.departments.get(profile.department_id) if profile and profile.department_id else None,
        employee_id=profile.employee_id if profile else None,
        approval=profile.approval if profile else "approved", created_at=user.created_at,
    )


async def _issue_session(db: Db, response: Response, user: User, profile: AuthorityProfile | None) -> SessionOut:
    s = get_settings()
    raw, digest = new_refresh_token()
    db.add(RefreshToken(user_id=user.id, token_hash=digest, expires_at=datetime.now(UTC) + timedelta(days=s.refresh_token_days)))
    await db.commit()
    response.set_cookie(COOKIE, raw, max_age=s.refresh_token_days * 86400, httponly=True, secure=s.cookie_secure, samesite=s.cookie_samesite, path=COOKIE_PATH)
    return SessionOut(access_token=create_access_token(user.id, user.role), expires_in=s.access_token_minutes * 60, user=user_out(user, profile))


@router.post("/register", status_code=201, response_model=SessionOut | PendingOut)
async def register(body: RegisterIn, request: Request, response: Response, db: Db):
    ratelimit.check("register", ratelimit.client_key(request), get_settings().rate_register)
    if not body.consent:
        raise ApiError(422, "consent_required", "Please accept the data use notice to create an account.")
    ward_id = ref.ward_id(body.area)
    if body.area and ward_id is None:
        raise ApiError(422, "validation_error", "Unknown area.")
    if body.role == "authority":
        if not body.employee_id:
            raise ApiError(422, "validation_error", "Enter your official employee ID.")
        dept = ref.department_id(body.department)
        if dept is None:
            raise ApiError(422, "validation_error", "Choose a department.")
    user = User(role=body.role, name=body.name, email=str(body.email).lower(), phone=body.phone, password_hash=hash_password(body.password), ward_id=ward_id, lang=body.lang)
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise ApiError(409, "email_taken", "An account with this email already exists.") from None
    profile = None
    if body.role == "authority":
        profile = AuthorityProfile(user_id=user.id, employee_id=body.employee_id, department_id=dept, approval="pending")
        db.add(profile)
        await db.commit()
        return PendingOut(message=PENDING_MESSAGE)
    await db.refresh(user)
    return await _issue_session(db, response, user, profile)


@router.post("/login", response_model=SessionOut)
async def login(body: LoginIn, request: Request, response: Response, db: Db):
    s = get_settings()
    ratelimit.check("login", ratelimit.client_key(request), s.rate_login)
    ratelimit.check("login-email", str(body.email).lower(), s.rate_login)
    row = (
        await db.execute(
            select(User, AuthorityProfile).outerjoin(AuthorityProfile, AuthorityProfile.user_id == User.id).where(User.email == str(body.email).lower(), User.deleted_at.is_(None))
        )
    ).first()
    user, profile = row if row else (None, None)
    ok = verify_password(user.password_hash if user else None, body.password)
    if not ok or user is None or user.role != body.role:
        raise ApiError(401, "invalid_credentials", "Email or password is incorrect for this account type.")
    if user.role == "authority":
        approval = profile.approval if profile else "pending"
        if approval != "approved":
            code, message = APPROVAL_MESSAGES[approval]
            raise ApiError(403, code, message)
    return await _issue_session(db, response, user, profile)


@router.post("/refresh", response_model=SessionOut)
async def refresh(request: Request, response: Response, db: Db):
    raw = request.cookies.get(COOKIE)
    if not raw:
        raise ApiError(401, "no_session", "Please log in.")
    now = datetime.now(UTC)
    token = await db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw)).with_for_update())
    if token is None or token.expires_at < now:
        raise ApiError(401, "no_session", "Please log in.")
    if token.revoked_at is not None:
        if now - token.revoked_at < REUSE_GRACE:
            # Two tabs refreshed with the same cookie at once. The other tab already received the new
            # cookie (cookies are shared), so the client simply retries; this is not theft.
            raise ApiError(401, "refresh_race", "Session was just refreshed. Please retry.")
        # A rotated token was used again later: treat it as stolen and end every session of this user.
        await db.execute(update(RefreshToken).where(RefreshToken.user_id == token.user_id, RefreshToken.revoked_at.is_(None)).values(revoked_at=now))
        await db.commit()
        response.delete_cookie(COOKIE, path=COOKIE_PATH)
        raise ApiError(401, "no_session", "Please log in.")
    token.revoked_at = now
    row = (await db.execute(select(User, AuthorityProfile).outerjoin(AuthorityProfile, AuthorityProfile.user_id == User.id).where(User.id == token.user_id, User.deleted_at.is_(None)))).first()
    if not row or (row[0].role == "authority" and (row[1] is None or row[1].approval != "approved")):
        await db.commit()
        raise ApiError(401, "no_session", "Please log in.")
    return await _issue_session(db, response, row[0], row[1])


@router.post("/logout", status_code=204)
async def logout(request: Request, db: Db):
    raw = request.cookies.get(COOKIE)
    if raw:
        await db.execute(update(RefreshToken).where(RefreshToken.token_hash == hash_token(raw), RefreshToken.revoked_at.is_(None)).values(revoked_at=datetime.now(UTC)))
        await db.commit()
    response = Response(status_code=204)
    response.delete_cookie(COOKIE, path=COOKIE_PATH)
    return response
