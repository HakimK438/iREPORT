"""Development only: 6 more complaints in each seeded area, using the additional dataset photos (the 11th photo onwards of each
category in backend/seed_data/images). Run after seed_area_problems. Areas already topped up are skipped, so it is safe to re-run.

    cd backend && python -m scripts.seed_extra_problems
"""

import asyncio
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text

from app import images, refdata
from app.config import get_settings
from app.db import SessionLocal, engine
from app.incidents import create_report, recompute_priority
from app.models import Media, User
from app.refdata import AREA_CENTRES, ref
from app.schemas import ReportIn
from app.security import hash_password
from app.storage import get_storage, new_keys
from scripts.seed_area_problems import AREAS, IMAGES, STEPS, spot

# (category, problem type, description, landmark, status)
EXTRA = [
    ("Pothole", "Medium", "Pothole damaging tyres near the junction", "Junction", "Reported"),
    ("Garbage", "Overflowing", "Waste has piled up beside the road near the market", "Market side", "Reported"),
    ("Electrical Hazard", "Damaged", "Wires are hanging low and a pole is tilted after the wind", "Lane entrance", "Acknowledged"),
    ("Drainage", "Overflowing", "Road is flooded after rain and vehicles are struggling to pass", "Low-lying stretch", "In Progress"),
    ("Road Damage", "Damaged", "Plaster and concrete are breaking off near the shops", "Shop row", "Reported"),
    ("Other", "Damaged", "Damaged signboard or fallen branch that could hurt someone", "Park gate", "Resolved"),
]


async def main() -> None:
    if get_settings().env == "production":
        raise SystemExit("seed_extra_problems is for development only")
    storage = get_storage()
    await storage.ensure_bucket()
    async with SessionLocal() as db:
        await refdata.load(db)
        citizens = []
        for k in range(60, 120):
            u = await db.scalar(select(User).where(User.email == f"seed-citizen-{k}@example.com"))
            if u is None:
                u = User(role="citizen", name=f"Resident {k + 1}", email=f"seed-citizen-{k}@example.com", password_hash=hash_password("!seed-no-login"), ward_id=None)
                db.add(u)
            citizens.append(u)
        await db.flush()
        new_ids, topped = [], []
        for a_idx, area in enumerate(AREAS):
            slug = area.lower().replace(" ", "")
            officer = await db.scalar(select(User).where(User.email == f"ward.{slug}@bmc.demo"))
            marker = f"seed-extra-{slug}@example.com"
            if officer is None or await db.scalar(select(User).where(User.email == marker)):
                continue
            db.add(User(role="citizen", name="Seed marker", email=marker, password_hash=hash_password("!seed-no-login"), ward_id=None))
            topped.append(area)
            for n, (category, problem, desc, landmark, status) in enumerate(EXTRA):
                lat, lng = spot(AREA_CENTRES[area], 10 + n, area)
                photos = sorted((IMAGES / category).glob("*.jpg"))
                fresh = photos[10:] or photos           # the additional photos first
                reporter = citizens[(a_idx * 6 + n) % len(citizens)]
                proc = images.process(fresh[(a_idx * 2 + n) % len(fresh)].read_bytes())
                key, thumb_key = new_keys()
                await storage.put(key, proc.main, "image/webp")
                await storage.put(thumb_key, proc.thumb, "image/webp")
                m = Media(uploader_id=reporter.id, storage_key=key, thumb_key=thumb_key, width=proc.width, height=proc.height, bytes=len(proc.main))
                db.add(m)
                await db.flush()
                r = await create_report(db, reporter.id, ReportIn(media_ids=[m.id], category=category, problem_type=problem, description=desc, lat=lat, lng=lng,
                                                                  address_text=f"{landmark}, {area}", location_source="manual", area=area))
                iid = r["incident_id"]
                new_ids.append(iid)
                created = datetime.now(UTC) - timedelta(days=1 + (n * 2 + a_idx) % 9)
                await db.execute(text("UPDATE incidents SET created_at = :c WHERE id = :i"), {"c": created, "i": iid})
                await db.execute(text("UPDATE reports SET created_at = :c WHERE incident_id = :i"), {"c": created, "i": iid})
                await db.execute(text("UPDATE status_events SET created_at = :c WHERE incident_id = :i"), {"c": created, "i": iid})
                if status != "Reported":
                    for st in STEPS[: STEPS.index(status) + 1]:
                        reason = "Repair completed and the site was checked." if st == "Resolved" else None
                        await db.execute(text("""INSERT INTO status_events (incident_id, from_status, to_status, actor_id, created_at, reason)
                                                 SELECT id, status, CAST(:s AS issue_status), :a, :c, :r FROM incidents WHERE id = :i"""),
                                         {"s": st, "a": officer.id, "i": iid, "c": created + timedelta(days=0.5), "r": reason})
                        await db.execute(text("""UPDATE incidents SET status = CAST(:s AS issue_status), assigned_to = :a,
                                                 resolved_at = CASE WHEN :s IN ('Resolved', 'Closed') THEN now() - interval '20 hours' ELSE resolved_at END,
                                                 status_reason = CASE WHEN :s = 'Resolved' THEN :r ELSE status_reason END WHERE id = :i"""),
                                         {"s": st, "a": officer.id, "i": iid, "r": reason})
        if new_ids:
            await db.execute(text("UPDATE incidents SET due_at = NULL WHERE id = ANY(CAST(:ids AS uuid[]))"), {"ids": [str(i) for i in new_ids]})
            await recompute_priority(db, new_ids)
        await db.commit()
    await engine.dispose()
    print(f"added {len(new_ids)} complaints in {len(topped)} areas")


if __name__ == "__main__":
    asyncio.run(main())
