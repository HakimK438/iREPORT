"""Latency benchmarks against a running API.

    python -m scripts.bench analyze   --base http://localhost:8000/api/v1 --n 50
    python -m scripts.bench authority --base http://localhost:8000/api/v1 --n 200   # after scripts.seed_load

analyze:   one ~250 KB photo per request, as the spec's acceptance test describes (needs a citizen account;
           one is registered automatically). Reports end-to-end p50/p95 and the server's inference time.
authority: GET /authority/incidents with the default sort and with filters, first pages and cursor pages.
"""

import argparse
import io
import random
import statistics
import time
import uuid

import httpx
import numpy as np
from PIL import Image


def pct(xs: list[float], p: float) -> float:
    return float(np.percentile(xs, p))


def photo_250kb() -> bytes:
    rng = np.random.default_rng(1)
    base = np.linspace(0, 255, 1280, dtype=np.float32)[None, :, None] * np.ones((960, 1, 3), dtype=np.float32)
    noise = rng.normal(0, 28, (960, 1280, 3)).astype(np.float32)
    img = Image.fromarray(np.clip(base * 0.6 + noise + 60, 0, 255).astype(np.uint8))
    for q in (85, 75, 65, 55, 45, 35):
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=q)
        if buf.tell() <= 270_000:
            return buf.getvalue()
    return buf.getvalue()


def bench_analyze(base: str, n: int) -> None:
    with httpx.Client(base_url=base, timeout=30) as c:
        email = f"bench-{uuid.uuid4().hex[:8]}@example.com"
        r = c.post("/auth/register", json={"role": "citizen", "name": "Bench", "email": email, "password": "bench-pass-1", "consent": True})
        r.raise_for_status()
        headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
        data = photo_250kb()
        print(f"photo: {len(data) / 1024:.0f} KB JPEG 1280x960")
        t = time.perf_counter()  # the first request after start-up pays for lazy imports and connections
        c.post("/ai/analyze", files=[("photos", ("p.jpg", data, "image/jpeg"))], headers=headers).raise_for_status()
        print(f"first (cold) request: {(time.perf_counter() - t) * 1000:.0f} ms, not counted below")
        total, server, infer = [], [], []
        for k in range(n):
            if (k + 1) % 18 == 0:  # stay under the per-user analyze rate limit (20/min)
                time.sleep(61)
            t = time.perf_counter()
            r = c.post("/ai/analyze", files=[("photos", ("p.jpg", data, "image/jpeg"))], data={"text": "big pothole near the bus stop"}, headers=headers)
            r.raise_for_status()
            total.append((time.perf_counter() - t) * 1000)
            body = r.json()
            server.append(body["total_ms"])
            if body.get("inference_ms") is not None:
                infer.append(body["inference_ms"])
        print(f"end-to-end ms   p50={pct(total, 50):.0f} p95={pct(total, 95):.0f} max={max(total):.0f} (n={n})")
        print(f"server total ms p50={pct(server, 50):.0f} p95={pct(server, 95):.0f}")
        if infer:
            print(f"model inference p50={pct(infer, 50):.1f} p95={pct(infer, 95):.1f} ms ({body['model_version']})")
        else:
            print("model inference: no image model loaded (text-only)")


def bench_authority(base: str, n: int) -> None:
    with httpx.Client(base_url=base, timeout=30) as c:
        r = c.post("/auth/login", json={"email": "loadtest-officer@example.com", "password": "loadtest-pass-1", "role": "authority"})
        r.raise_for_status()
        headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
        variants = [{}, {"sort": "newest"}, {"sort": "oldest"}, {"sort": "affected"}, {"hide_resolved": "true"},
                    {"category": "Pothole"}, {"ward": "Bandra", "status": "Reported"}, {"q": "street 123"}, {"category": "Drainage", "hide_resolved": "true"}]
        times: dict[str, list[float]] = {}
        cursors: dict[str, str] = {}
        for k in range(n):
            v = random.Random(k).choice(variants)
            key = "&".join(f"{a}={b}" for a, b in v.items()) or "default"
            params = dict(v, limit=50)
            if k % 3 == 2 and key in cursors:
                params["cursor"] = cursors[key]
                key += " (next page)"
            t = time.perf_counter()
            r = c.get("/authority/incidents", params=params, headers=headers)
            r.raise_for_status()
            times.setdefault(key, []).append((time.perf_counter() - t) * 1000)
            if r.json()["next_cursor"]:
                cursors[key.replace(" (next page)", "")] = r.json()["next_cursor"]
        everything = [x for xs in times.values() for x in xs]
        t = time.perf_counter()
        c.get("/authority/stats", headers=headers).raise_for_status()
        stats_ms = (time.perf_counter() - t) * 1000
        print(f"/authority/incidents  p50={pct(everything, 50):.0f} ms  p95={pct(everything, 95):.0f} ms  max={max(everything):.0f} ms  (n={len(everything)})")
        for key, xs in sorted(times.items()):
            print(f"  {key:<45} n={len(xs):>3} median={statistics.median(xs):>6.0f} ms  max={max(xs):>6.0f} ms")
        print(f"/authority/stats      {stats_ms:.0f} ms")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["analyze", "authority"])
    ap.add_argument("--base", default="http://localhost:8000/api/v1")
    ap.add_argument("--n", type=int, default=50)
    args = ap.parse_args()
    (bench_analyze if args.what == "analyze" else bench_authority)(args.base, args.n)


if __name__ == "__main__":
    main()
