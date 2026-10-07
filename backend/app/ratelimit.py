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
    window = int(time.time() // 60)
    start, count = _hits[(bucket, key)]
    if start != window:
        start, count = window, 0
    count += 1
    _hits[(bucket, key)] = (start, count)
    if count > per_minute:
        retry = 60 - int(time.time() % 60)
        raise ApiError(429, "rate_limited", "Too many attempts. Please wait a minute and try again.", {"Retry-After": str(retry)})
    if len(_hits) > 50_000:  # keep memory bounded
        for k in [k for k, (w, _) in _hits.items() if w != window]:
            _hits.pop(k, None)


def reset() -> None:
    _hits.clear()
