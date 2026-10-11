"""Development only: move the seeded demo complaints onto real road points (seed_data/road_points.json), so none sits in the sea.

Only complaints reported by the seed citizens (seed-citizen-N@example.com) are touched. They keep their area and are placed in the
order they were created, the same order the seed scripts use. Run after scripts.make_road_points.

    cd backend && python -m scripts.relocate_seed_points
"""

import asyncio
import json
from pathlib import Path

from sqlalchemy import text

from app import refdata
from app.config import get_settings
from app.db import SessionLocal, engine
from app.incidents import recompute_priority, refresh_geo_facts, resolve_ward

POINTS = Path(__file__).resolve().parent.parent / "seed_data" / "road_points.json"


async def main() -> None:
    if get_settings().env == "production":
        raise SystemExit("relocate_seed_points is for development only")
    roads: dict[str, list[list[float]]] = json.loads(POINTS.read_text())
    async with SessionLocal() as db:
        await refdata.load(db)
        rows = (await db.execute(text("""
            SELECT i.id, i.public_id, trim(split_part(reverse(split_part(reverse(i.address_text), ',', 1)), ',', 1)) AS area
            FROM incidents i
            WHERE i.address_text LIKE '%, %' AND EXISTS (SELECT 1 FROM reports r JOIN users u ON u.id = r.user_id
                                                         WHERE r.incident_id = i.id AND u.email LIKE 'seed-citizen-%')
            ORDER BY i.public_id"""))).all()
        taken: dict[str, int] = {}
        moved, skipped, ids = 0, 0, []
        for r in rows:
            pts = roads.get(r.area)
            n = taken.get(r.area, 0)
            if not pts or n >= len(pts):
                skipped += 1
                continue
            taken[r.area] = n + 1
            lat, lng = pts[n]
            ward = await resolve_ward(db, lat, lng)
            await db.execute(text("UPDATE incidents SET location = ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, ward_id = :w, updated_at = now() WHERE id = :i"),
                             {"lat": lat, "lng": lng, "w": ward, "i": r.id})
            ids.append(r.id)
            moved += 1
        await refresh_geo_facts(db, ids)
        await recompute_priority(db, ids)
        await db.commit()
    await engine.dispose()
    print(f"moved {moved} seeded complaints onto road points ({skipped} left as they were)")


if __name__ == "__main__":
    asyncio.run(main())
