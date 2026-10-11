"""Development only: 10 realistic complaints in each of 16 Mumbai areas, with relevant photos picked from the CivicFix dataset
(backend/seed_data/images/<Category>/, 10 clear photos per category), one ward officer per area, and a mix of statuses.
No model is trained and nothing is sent anywhere. Refuses to run with ENV=production. Areas that already have their ward officer are skipped,
so it can be run again to add newly listed areas.

    cd backend && python -m scripts.seed_area_problems
"""

import asyncio
import math
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import select, text

from app import images, refdata
from app.config import get_settings
from app.db import SessionLocal, engine
from app.incidents import create_report, recompute_priority
from app.models import AuthorityProfile, Media, User
from app.refdata import AREA_CENTRES, ref
from app.schemas import ReportIn
from app.security import hash_password
from app.storage import get_storage, new_keys

AREAS = ["Andheri West", "Bandra", "Colaba", "Fort", "Dadar", "Goregaon", "Malad", "Borivali",
         "Sion", "Kurla", "Ghatkopar", "Powai", "Juhu", "Mahim", "Worli", "Vile Parle"]
IMAGES = Path(__file__).resolve().parent.parent / "seed_data" / "images"
# (category, problem type, description, landmark). Ten per area; the photo comes from the category's own folder.
PROBLEMS = [
    ("Pothole", "Large", "Large pothole on the main road, two-wheelers are swerving to avoid it", "Main road"),
    ("Garbage", "Overflowing", "Garbage not collected for days, the bin is overflowing onto the footpath", "Market lane"),
    ("Electrical Hazard", "Damaged", "Electric pole is leaning and the wires are hanging low", "Station road"),
    ("Drainage", "Overflowing", "Water is logged on the road after rain and is not draining", "Junction"),
    ("Road Damage", "Damaged", "Concrete is cracked and breaking near the building wall", "Lane near the school"),
    ("Other", "Damaged", "A tree has fallen and is blocking half of the road", "Park road"),
    ("Pothole", "Small", "Small pothole near the bus stop", "Bus stop"),
    ("Garbage", "Illegal dumping", "Waste dumped on the roadside by the compound wall", "Compound wall"),
    ("Drainage", "Unsafe condition", "Water logging near the drain, the road is slippery", "Drain lane"),
    ("Electrical Hazard", "Damaged", "Damaged electric pole near the playground, children play here", "Playground"),
]
# Status of the n-th complaint of each area; the first two Reported ones are left unassigned on purpose.
STATUSES = ["Reported", "Reported", "Reported", "Reported", "Acknowledged", "Acknowledged", "In Progress", "In Progress", "Resolved", "Closed"]
STEPS = ["Acknowledged", "Scheduled", "In Progress", "Resolved", "Closed"]


def spot(centre: tuple[float, float], n: int) -> tuple[float, float]:
    """Ten points on a spiral around the area centre, 150 m or more apart so nothing merges and the map stays readable."""
    r = 160 + 70 * n                    # metres from the centre
    a = n * 2.4                         # golden-angle-ish turn
    return centre[0] + r * math.sin(a) / 111_320, centre[1] + r * math.cos(a) / (111_320 * math.cos(math.radians(centre[0])))


async def main() -> None:
    if get_settings().env == "production":
        raise SystemExit("seed_area_problems is for development only")
    storage = get_storage()
    await storage.ensure_bucket()
    async with SessionLocal() as db:
        await refdata.load(db)
        citizens = []
        for k in range(60):
            u = await db.scalar(select(User).where(User.email == f"seed-citizen-{k}@example.com"))
            if u is None:
                u = User(role="citizen", name=f"Resident {k + 1}", email=f"seed-citizen-{k}@example.com", password_hash=hash_password("!seed-no-login"), ward_id=None)
                db.add(u)
            citizens.append(u)
        await db.flush()
        officers = {}
        fresh = []   # areas seeded by this run
        for area in AREAS:
            email = f"ward.{area.lower().replace(' ', '')}@bmc.demo"
            o = await db.scalar(select(User).where(User.email == email))
            if o is None:
                fresh.append(area)
                o = User(role="authority", name=f"{area} Ward Officer", email=email, password_hash=hash_password("ward12345"), ward_id=ref.ward_id(area))
                db.add(o)
                await db.flush()
                db.add(AuthorityProfile(user_id=o.id, employee_id=f"BMC-W{len(officers) + 21:03d}", department_id=ref.department_id("General / Ward Office"), approval="approved", decided_at=datetime.now(UTC)))
            officers[area] = o
        await db.flush()

        new_ids: list = []
        for a_idx, area in enumerate(AREAS):
            if area not in fresh:
                continue
            for n, (category, problem, desc, landmark) in enumerate(PROBLEMS):
                lat, lng = spot(AREA_CENTRES[area], n)
                photos = sorted((IMAGES / category).glob("*.jpg"))
                reporter = citizens[(a_idx * 10 + n) % len(citizens)]
                media_ids = []
                if photos:
                    proc = images.process(photos[(a_idx + n) % len(photos)].read_bytes())
                    key, thumb_key = new_keys()
                    await storage.put(key, proc.main, "image/webp")
                    await storage.put(thumb_key, proc.thumb, "image/webp")
                    m = Media(uploader_id=reporter.id, storage_key=key, thumb_key=thumb_key, width=proc.width, height=proc.height, bytes=len(proc.main), ai_label=category, ai_conf=0.9)
                    db.add(m)
                    await db.flush()
                    media_ids = [m.id]
                r = await create_report(db, reporter.id, ReportIn(
                    media_ids=media_ids, category=category, problem_type=problem, description=desc, lat=lat, lng=lng,
                    address_text=f"{landmark}, {area}", location_source="manual", area=area))
                iid = r["incident_id"]
                new_ids.append(iid)
                status, officer = STATUSES[n], officers[area]
                created = datetime.now(UTC) - timedelta(days=1 + (n * 3 + a_idx) % 13)
                for table in ("incidents", "reports"):
                    await db.execute(text(f"UPDATE {table} SET created_at = :c WHERE {'id' if table == 'incidents' else 'incident_id'} = :i"), {"c": created, "i": iid})
                await db.execute(text("UPDATE status_events SET created_at = :c WHERE incident_id = :i"), {"c": created, "i": iid})
                if n == 1:  # a second complaint waits for an officer; the first stays totally untouched
                    await db.execute(text("UPDATE incidents SET assigned_to = :a WHERE id = :i"), {"a": officer.id, "i": iid})
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
                if a_idx in (1, 4, 6, 9, 12) and n == 3:  # a few doubtful reports so the review queue is not empty in the demo
                    await db.execute(text("UPDATE incidents SET needs_review = true, review_reason = 'The photo may not match the chosen problem.' WHERE id = :i"), {"i": iid})
        await db.execute(text("UPDATE incidents SET due_at = NULL WHERE id = ANY(CAST(:ids AS uuid[]))"), {"ids": [str(i) for i in new_ids]})
        await recompute_priority(db, new_ids)
        await db.commit()
    await engine.dispose()
    print(f"added {len(fresh) * len(PROBLEMS)} complaints in {len(fresh)} new areas: {fresh}")


if __name__ == "__main__":
    asyncio.run(main())
