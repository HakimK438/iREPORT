"""Development helper: 6 more real road points per seeded area for the curated-photo complaints, at least 100 m from the points already in
road_points.json (so nothing merges with the older demo complaints). Writes backend/seed_data/road_points_extra.json. Needs internet once.

    cd backend && python -m scripts.make_extra_road_points
"""

import json
import random
import time
from pathlib import Path

from app.refdata import AREA_CENTRES, nearest_area
from scripts.make_road_points import metres, roads_near
from scripts.seed_area_problems import AREAS, IMAGES

OUT = IMAGES.parent / "road_points_extra.json"


def main() -> None:
    rng = random.Random(11)
    used = json.loads((IMAGES.parent / "road_points.json").read_text())
    result: dict[str, list[list[float]]] = json.loads(OUT.read_text()) if OUT.exists() else {}
    for area in AREAS:
        if len(result.get(area, [])) >= 6:
            continue
        centre, taken = AREA_CENTRES[area], [tuple(p) for p in used.get(area, [])]
        chosen: list[tuple[float, float]] = []
        for radius in (1200, 2000):
            nodes = [p for p in roads_near(*centre, radius) if nearest_area(*p) == area]
            rng.shuffle(nodes)
            for p in nodes:
                if all(metres(p, q) >= 110 for q in taken + chosen):
                    chosen.append(p)
                if len(chosen) == 6:
                    break
            if len(chosen) == 6:
                break
            time.sleep(3)
        result[area] = [[round(a, 6), round(b, 6)] for a, b in chosen]
        print(f"{area:14s} {len(chosen)} extra road points", flush=True)
        OUT.write_text(json.dumps(result, indent=1))
        time.sleep(1)


if __name__ == "__main__":
    main()
