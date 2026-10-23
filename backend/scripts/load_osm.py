"""Developer-run job (run once, not a user feature): download schools, hospitals and main roads from the OpenStreetMap
Overpass API for the bounding box of the seeded areas, save them as a GeoJSON fixture and load them into osm_features.
After loading, every incident's map facts (geo_facts) and priority are recomputed, so "near a school" and "on a main
road" are checked by PostGIS instead of taken from what a citizen ticked.

    cd backend && python -m scripts.load_osm                  # download -> data/osm_features.geojson -> database
    cd backend && python -m scripts.load_osm --from-fixture   # skip the download, load the saved fixture

Honesty rules: a feature kind is loaded only if EVERY tile of the box downloaded (a half-loaded road network would
read as "not on a main road"). If a download fails nothing is invented: the table stays as it was, priority keeps using
the citizen's own flags (labelled "citizen says"), and this script says so and exits with code 2.
Data: (c) OpenStreetMap contributors, ODbL.
"""

import argparse
import asyncio
import http.client
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from sqlalchemy import text

FIXTURE = Path(__file__).resolve().parent.parent / "data" / "osm_features.geojson"
# Bounding box of the seeded areas (app/refdata.py AREA_CENTRES: lat 18.9067-19.3919, lng 72.7985-73.1645) plus ~3 km.
BBOX = (18.88, 72.77, 19.42, 73.19)  # south, west, north, east
TILES_LAT, TILES_LNG = 3, 2
ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
USER_AGENT = "iREPORT-dev-loader/1.0 (civic complaint app; one-off developer download)"
KINDS = {
    "school": ('nwr["amenity"="school"]', "out center tags;"),
    "hospital": ('nwr["amenity"="hospital"]', "out center tags;"),
    "main_road": ('way["highway"~"^(trunk|primary|secondary)$"]', "out geom tags;"),
}


def tiles() -> list[tuple[float, float, float, float]]:
    s, w, n, e = BBOX
    out = []
    for i in range(TILES_LAT):
        for j in range(TILES_LNG):
            out.append((s + (n - s) * i / TILES_LAT, w + (e - w) * j / TILES_LNG, s + (n - s) * (i + 1) / TILES_LAT, w + (e - w) * (j + 1) / TILES_LNG))
    return out


def overpass(query: str, attempts: int = 3) -> dict:
    """POST one query, trying each endpoint in turn. Raises RuntimeError if every attempt fails."""
    last = ""
    for attempt in range(attempts):
        for url in ENDPOINTS:
            try:
                req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": query}).encode(), headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=240) as resp:
                    return json.load(resp)
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError, http.client.HTTPException) as e:
                last = f"{url}: {e}"
                print(f"    attempt failed ({last})", flush=True)
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(last)


def to_feature(kind: str, el: dict) -> dict | None:
    tags = el.get("tags", {})
    if kind == "main_road":
        pts = [[round(p["lon"], 5), round(p["lat"], 5)] for p in el.get("geometry", [])]
        if len(pts) < 2:
            return None
        geom = {"type": "LineString", "coordinates": pts}
    else:
        c = el.get("center") or ({"lat": el["lat"], "lon": el["lon"]} if "lat" in el else None)
        if not c:
            return None
        geom = {"type": "Point", "coordinates": [round(c["lon"], 5), round(c["lat"], 5)]}
    return {"type": "Feature", "geometry": geom, "properties": {"osm_id": el["id"], "kind": kind, "name": tags.get("name") or tags.get("name:en"), "highway": tags.get("highway")}}


def download() -> tuple[dict[str, list[dict]], dict[str, str]]:
    """Returns (features per kind, failure message per kind). A kind with any failed tile is dropped completely."""
    got: dict[str, list[dict]] = {}
    failed: dict[str, str] = {}
    for kind, (selector, out) in KINDS.items():
        seen: dict[int, dict] = {}
        print(f"downloading {kind} ...", flush=True)
        try:
            for n, (s, w, nn, e) in enumerate(tiles(), 1):
                cached = Path(os.environ["OSM_CACHE_DIR"]) / f"{kind}-{n}.json" if os.environ.get("OSM_CACHE_DIR") else None  # optional: resume after a failed run
                if cached and cached.exists():
                    data = json.loads(cached.read_text(encoding="utf-8"))
                else:
                    data = overpass(f"[out:json][timeout:180];({selector}({s:.4f},{w:.4f},{nn:.4f},{e:.4f}););{out}")
                    if cached:
                        cached.write_text(json.dumps(data), encoding="utf-8")
                for el in data.get("elements", []):
                    f = to_feature(kind, el)
                    if f:
                        seen[el["id"]] = f
                print(f"  tile {n}/{TILES_LAT * TILES_LNG}: {len(seen)} so far", flush=True)
            got[kind] = list(seen.values())
        except RuntimeError as e:
            failed[kind] = str(e)
    return got, failed


async def load_into_database(features: list[dict]) -> dict:
    from app import refdata
    from app.db import SessionLocal, engine
    from app.incidents import recompute_priority, refresh_geo_facts

    kinds = sorted({f["properties"]["kind"] for f in features})
    async with SessionLocal() as db:
        await refdata.load(db)
        await db.execute(text("DELETE FROM osm_features WHERE kind = ANY(:k)"), {"k": kinds})
        rows = [{"id": f["properties"]["osm_id"], "k": f["properties"]["kind"], "n": f["properties"]["name"], "h": f["properties"]["highway"], "g": json.dumps(f["geometry"])} for f in features]
        for i in range(0, len(rows), 1000):
            await db.execute(text("""INSERT INTO osm_features (osm_id, kind, name, highway, geom)
                                     VALUES (:id, :k, :n, :h, ST_SetSRID(ST_GeomFromGeoJSON(:g), 4326)::geography) ON CONFLICT (kind, osm_id) DO NOTHING"""), rows[i:i + 1000])
        await db.commit()
        n_geo = await refresh_geo_facts(db, None)
        await db.commit()
        all_ids = list((await db.scalars(text("SELECT id FROM incidents"))).all())
        n_prio = await recompute_priority(db, all_ids)
        await db.commit()
        counts = {r[0]: r[1] for r in (await db.execute(text("SELECT kind, count(*) FROM osm_features GROUP BY kind"))).all()}
    await engine.dispose()
    return {"loaded": counts, "incidents_rechecked": n_geo, "priorities_changed": n_prio}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from-fixture", action="store_true", help="load data/osm_features.geojson instead of downloading")
    args = ap.parse_args()

    if args.from_fixture:
        if not FIXTURE.exists():
            print(f"no fixture at {FIXTURE}. Run without --from-fixture first.")
            return 2
        features = json.loads(FIXTURE.read_text(encoding="utf-8"))["features"]
        failed: dict[str, str] = {}
    else:
        got, failed = download()
        features = [f for fs in got.values() for f in fs]
        if features:
            FIXTURE.parent.mkdir(parents=True, exist_ok=True)
            FIXTURE.write_text(json.dumps({"type": "FeatureCollection", "attribution": "(c) OpenStreetMap contributors, ODbL", "bbox": list(BBOX),
                                           "features": features}, separators=(",", ":")), encoding="utf-8")
            print(f"saved {len(features)} features to {FIXTURE} ({FIXTURE.stat().st_size // 1024} KB)")
    if failed:
        print("\nDOWNLOAD FAILED for: " + ", ".join(failed) + ". Nothing was invented for these.")
        for k, why in failed.items():
            print(f"  {k}: {why}")
        print("Priority keeps using the citizen's own flags for these, labelled 'citizen says'. Run this script again later.")
    if not features:
        return 2
    result = asyncio.run(load_into_database(features))
    print("loaded into the database:", result)
    return 2 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
