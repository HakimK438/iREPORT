import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from .config import get_settings

# Library defaults (RFC 9106 low-memory profile) in every environment except the test suite.
_hasher = PasswordHasher(time_cost=1, memory_cost=1024, parallelism=1) if get_settings().env == "test" else PasswordHasher()
# Verified against when the email is unknown, so a missing account takes as long as a wrong password.
_DUMMY_HASH = _hasher.hash("not-a-real-password")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def create_access_token(user_id: uuid.UUID, role: str) -> str:
    s = get_settings()
    now = datetime.now(UTC)
    payload = {"sub": str(user_id), "role": role, "iat": now, "exp": now + timedelta(minutes=s.access_token_minutes), "typ": "access"}
    return jwt.encode(payload, s.jwt_secret, algorithm="HS256")


def decode_access_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    return payload if payload.get("typ") == "access" else None


def new_refresh_token() -> tuple[str, str]:
    """Returns (raw token for the cookie, sha256 hash for the database)."""
    raw = secrets.token_urlsafe(32)
    return raw, hash_token(raw)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()
