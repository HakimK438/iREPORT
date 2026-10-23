"""Fixed-window, in-process rate limiter. Version 1 runs one API process, so no Redis is needed.
With several workers or replicas, each keeps its own counters (limits become per process)."""

import time
from collections import defaultdict

from fastapi import Request

from .errors import ApiError

_hits: dict[tuple[str, str], tuple[int, int]] = defaultdict(lambda: (0, 0))


def client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def check(bucket: str, key: str, per_minute: int) -> None:
    check_window(bucket, key, per_minute, 60, "Too many attempts. Please wait a minute and try again.")


def check_window(bucket: str, key: str, limit: int, seconds: int, message: str) -> None:
    """At most `limit` hits per fixed window of `seconds` for (bucket, key)."""
    window = int(time.time() // seconds)
    start, count = _hits[(bucket, key)]
    if start != window:
        start, count = window, 0
    count += 1
    _hits[(bucket, key)] = (start, count)
    if count > limit:
        retry = seconds - int(time.time() % seconds)
        raise ApiError(429, "rate_limited", message, {"Retry-After": str(retry)})
    if len(_hits) > 50_000:  # keep memory bounded
        _hits.clear()  # windows differ per bucket; dropping everything only forgives some counters, never blocks anyone


def reset() -> None:
    _hits.clear()
