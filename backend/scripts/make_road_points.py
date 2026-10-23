"""Development helper: find real road locations for each seeded area, so demo complaints sit on land and on streets, never in the sea.

Asks OpenStreetMap (Overpass) for roads around each area centre and keeps well-spaced points that belong to that area.
Writes backend/seed_data/road_points.json ({area: [[lat, lng], ...]}). Needs internet once; the result is committed.

    cd backend && python -m scripts.make_road_points
"""

import json
import math
import os
import random
import time
import urllib.parse
import urllib.request
from pathlib import Path

from app.refdata import AREA_CENTRES, nearest_area
from scripts.seed_area_problems import AREAS

OUT = Path(os.environ.get("ROAD_POINTS_OUT", Path(__file__).resolve().parent.parent / "seed_data" / "road_points.json"))
SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]


def metres(a: tuple[float, float], b: tuple[float, float]) -> float:
    dy, dx = (b[0] - a[0]) * 111_320, (b[1] - a[1]) * 111_320 * math.cos(math.radians(a[0]))
    return math.hypot(dx, dy)


def roads_near(lat: float, lng: float, radius: int) -> list[tuple[float, float]]:
    """Public Overpass servers are often busy: try each mirror a few times, waiting longer after every failure."""
    query = f'[out:json][timeout:40];way(around:{radius},{lat},{lng})["highway"~"^(primary|secondary|tertiary|unclassified|residential)$"];out geom;'
    body = urllib.parse.urlencode({"data": query}).encode()
    last: Exception | None = None
    for attempt in range(4):
        for url in SERVERS:
            try:
                req = urllib.request.Request(url, data=body, headers={"User-Agent": "iREPORT-dev/1.0 (student project)", "Accept": "*/*"})
                with urllib.request.urlopen(req, timeout=90) as r:
                    data = json.load(r)
                return [(p["lat"], p["lon"]) for e in data.get("elements", []) for p in e.get("geometry", [])]
            except Exception as exc:  # noqa: BLE001 - busy server, bad answer, timeout: try the next one
                last = exc
        time.sleep(10 * (attempt + 1))
    raise SystemExit(f"OpenStreetMap servers are not answering ({last}). Try again in a few minutes; finished areas are kept.")


def main() -> None:
    rng = random.Random(5)
    result: dict[str, list[list[float]]] = json.loads(OUT.read_text()) if OUT.exists() else {}  # resume: areas already found are kept
    wanted = [a for a in os.environ.get("ROAD_AREAS", "").split(",") if a] or AREAS  # optional: only these areas (lets several workers share the job)
    for area in wanted:
        if len(result.get(area, [])) >= 16:
            continue
        centre = AREA_CENTRES[area]
        chosen: list[tuple[float, float]] = []
        for radius, spacing in ((900, 150), (1400, 120), (2000, 100)):
            nodes = [p for p in roads_near(*centre, radius) if nearest_area(*p) == area and metres(centre, p) <= radius]
            rng.shuffle(nodes)
            chosen = []
            for p in nodes:
                if all(metres(p, q) >= spacing for q in chosen):
                    chosen.append(p)
                if len(chosen) == 18:
                    break
            if len(chosen) >= 16:
                break
            time.sleep(3)
        result[area] = [[round(a, 6), round(b, 6)] for a, b in chosen]
        print(f"{area:14s} {len(chosen)} road points", flush=True)
        OUT.parent.mkdir(exist_ok=True)
        OUT.write_text(json.dumps(result, indent=1))
        time.sleep(1)
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(result, indent=1))


if __name__ == "__main__":
    main()
