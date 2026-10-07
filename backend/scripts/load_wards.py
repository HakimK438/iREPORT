"""Load ward / area polygons from an open-data GeoJSON file into wards.geom.

    cd backend && python -m scripts.load_wards path/to/wards.geojson --name-field name

Each feature's name must match a ward row (the 8 seeded areas) unless --insert is given, which adds
missing names. Once polygons exist, new incidents get their ward from the map point (ST_Covers)
instead of the citizen's chosen area.
"""

import argparse
import asyncio
import json
from pathlib import Path

from sqlalchemy import text

from app.db import engine


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("geojson", type=Path)
    ap.add_argument("--name-field", default="name")
    ap.add_argument("--insert", action="store_true", help="insert wards that do not exist yet")
    args = ap.parse_args()
    features = json.loads(args.geojson.read_text(encoding="utf-8"))["features"]
    loaded = skipped = 0
    async with engine.begin() as conn:
        for f in features:
            name = str(f["properties"].get(args.name_field, "")).strip()
            if not name or f.get("geometry") is None:
                skipped += 1
                continue
            geom = json.dumps(f["geometry"])
            sql = ("INSERT INTO wards (name, geom) VALUES (:n, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(:g), 4326))::geography) "
                   "ON CONFLICT (name) DO UPDATE SET geom = EXCLUDED.geom") if args.insert else \
                  "UPDATE wards SET geom = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(:g), 4326))::geography WHERE lower(name) = lower(:n)"
            result = await conn.execute(text(sql), {"n": name, "g": geom})
            loaded += result.rowcount
            skipped += 1 - result.rowcount
    await engine.dispose()
    print(f"loaded {loaded} ward polygons, skipped {skipped} (restart the API to refresh its ward list)")


if __name__ == "__main__":
    asyncio.run(main())
