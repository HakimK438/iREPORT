"""Opaque cursors: base64url(JSON list of the last row's sort keys)."""

import base64
import json
import uuid
from datetime import datetime

from .errors import ApiError


def encode(values: list) -> str:
    return base64.urlsafe_b64encode(json.dumps(values, default=str, separators=(",", ":")).encode()).decode().rstrip("=")


def decode(cursor: str | None, length: int) -> list | None:
    if not cursor:
        return None
    try:
        values = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
    except ValueError:
        values = None
    if not isinstance(values, list) or len(values) != length:
        raise ApiError(400, "bad_cursor", "Invalid cursor.")
    return values


_TYPES = {"timestamptz": datetime.fromisoformat, "uuid": uuid.UUID, "int": int, "boolean": bool}


def typed(values: list, types: list[str]) -> list:
    """Convert decoded cursor values to the Python types asyncpg expects for each SQL type."""
    try:
        return [_TYPES[t](v) for v, t in zip(values, types, strict=True)]
    except (TypeError, ValueError):
        raise ApiError(400, "bad_cursor", "Invalid cursor.") from None
