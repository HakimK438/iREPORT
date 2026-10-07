import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_db
from .errors import ApiError, forbidden
from .models import AuthorityProfile, User
from .security import decode_access_token

Db = Annotated[AsyncSession, Depends(get_db)]


@dataclass
class Principal:
    user: User
    profile: AuthorityProfile | None

    @property
    def id(self) -> uuid.UUID:
        return self.user.id

    @property
    def role(self) -> str:
        return self.user.role


async def _load(request: Request, db: AsyncSession) -> Principal | None:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        return None
    payload = decode_access_token(header[7:].strip())
    if not payload:
        raise ApiError(401, "token_invalid", "Your session has expired. Please log in again.")
    row = (
        await db.execute(
            select(User, AuthorityProfile).outerjoin(AuthorityProfile, AuthorityProfile.user_id == User.id).where(User.id == uuid.UUID(payload["sub"]), User.deleted_at.is_(None))
        )
    ).first()
    if not row:
        raise ApiError(401, "token_invalid", "Your session has expired. Please log in again.")
    user, profile = row
    # Approval is checked on every request, so revoking an authority takes effect immediately.
    if user.role == "authority" and (profile is None or profile.approval != "approved"):
        raise ApiError(403, "approval_required", "This authority account is not approved.")
    return Principal(user, profile)


async def optional_user(request: Request, db: Db) -> Principal | None:
    return await _load(request, db)


async def current_user(request: Request, db: Db) -> Principal:
    principal = await _load(request, db)
    if principal is None:
        raise ApiError(401, "unauthorized", "Please log in.")
    return principal


def require(*roles: str):
    async def check(principal: Annotated[Principal, Depends(current_user)]) -> Principal:
        if principal.role not in roles:
            raise forbidden()
        return principal

    return check


CurrentUser = Annotated[Principal, Depends(current_user)]
OptionalUser = Annotated[Principal | None, Depends(optional_user)]
Citizen = Annotated[Principal, Depends(require("citizen"))]
Authority = Annotated[Principal, Depends(require("authority"))]
Admin = Annotated[Principal, Depends(require("admin"))]
