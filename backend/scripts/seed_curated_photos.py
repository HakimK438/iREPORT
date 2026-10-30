"""Development only: one complaint per curated photo in backend/seed_data/curated (manifest.json), spread over the seeded areas.

The photos were picked by eye from the added data set: sharp, in colour, and showing the problem the category names. The problem type and
description decide the severity (rules.assess), so a small pothole is Low, a deep one in the carriageway High, and only photos that show a real
danger (open manhole, exposed wiring, deep flood) reach High or Critical. Run after seed_area_problems and make_extra_road_points. It first
removes every complaint reported only by seed accounts (seed-citizen-*, neighbour*, dataset-sample*, loadtest*), so complaints from real accounts
stay. Re-running starts over.

    cd backend && python -m scripts.seed_curated_photos
"""

import asyncio
import json
import random
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text

from app import images, refdata
from app.config import get_settings
from app.db import SessionLocal, engine
from app.incidents import create_report, recompute_priority
from app.models import Media, User
from app.refdata import ref
from app.schemas import ReportIn
from app.security import hash_password
from app.storage import get_storage, new_keys
from scripts.seed_area_problems import AREAS, IMAGES

CURATED = IMAGES.parent / "curated"
LANDMARKS = ["Main road", "Market lane", "Station road", "Bus stop", "Junction", "Society gate", "Temple road", "Link road"]


SEED_ONLY = """SELECT i.id FROM incidents i WHERE NOT EXISTS (
    SELECT 1 FROM reports r JOIN users u ON u.id = r.user_id
    WHERE r.incident_id = i.id AND u.email !~ '^(seed-|neighbour|dataset-sample|loadtest)')"""
STATUSES = ["Reported"] * 10 + ["Acknowledged"] * 4 + ["In Progress"] * 3 + ["Resolved"] * 2 + ["Closed"]
STEPS = ["Acknowledged", "Scheduled", "In Progress", "Resolved", "Closed"]


async def remove_seed_complaints(db) -> None:
    """Delete the old demo complaints (and what hangs off them), keeping anything a real account reported."""
    ids = [str(r[0]) for r in (await db.execute(text(SEED_ONLY))).all()]
    p = {"ids": ids}
    for sql in ("DELETE FROM confirmations WHERE incident_id = ANY(CAST(:ids AS uuid[]))", "DELETE FROM status_events WHERE incident_id = ANY(CAST(:ids AS uuid[]))",
                "DELETE FROM messages WHERE incident_id = ANY(CAST(:ids AS uuid[]))", "DELETE FROM resolution_proofs WHERE incident_id = ANY(CAST(:ids AS uuid[]))",
                "DELETE FROM report_strikes WHERE incident_id = ANY(CAST(:ids AS uuid[]))",
                "DELETE FROM media WHERE incident_id = ANY(CAST(:ids AS uuid[])) OR report_id IN (SELECT id FROM reports WHERE incident_id = ANY(CAST(:ids AS uuid[])))",
                "DELETE FROM reports WHERE incident_id = ANY(CAST(:ids AS uuid[]))", "DELETE FROM incidents WHERE id = ANY(CAST(:ids AS uuid[]))"):
        await db.execute(text(sql), p)
    print(f"removed {len(ids)} old demo complaints")


async def main() -> None:
    if get_settings().env == "production":
        raise SystemExit("seed_curated_photos is for development only")
    manifest = json.loads((CURATED / "manifest.json").read_text())
    base = json.loads((IMAGES.parent / "road_points.json").read_text())
    extra = json.loads((IMAGES.parent / "road_points_extra.json").read_text())
    spots = {a: [*base.get(a, []), *extra.get(a, [])] for a in AREAS}
    storage = get_storage()
    await storage.ensure_bucket()
    rng = random.Random(3)
    rng.shuffle(manifest)
    async with SessionLocal() as db:
        await refdata.load(db)
        await remove_seed_complaints(db)
        citizens = []
        for k in range(120, 220):
            u = await db.scalar(select(User).where(User.email == f"seed-citizen-{k}@example.com"))
            if u is None:
                u = User(role="citizen", name=f"Resident {k + 1}", email=f"seed-citizen-{k}@example.com", password_hash=hash_password("!seed-no-login"), ward_id=None)
                db.add(u)
            citizens.append(u)
        await db.flush()
        areas = [a for a in AREAS if len(spots.get(a, [])) >= 5]
        officers = {a: await db.scalar(select(User).where(User.email == f"ward.{a.lower().replace(' ', '')}@bmc.demo")) for a in areas}
        used = {a: 0 for a in areas}
        new_ids = []
        for n, e in enumerate(manifest):
            area = areas[n % len(areas)]
            if used[area] >= len(spots[area]):
                continue
            lat, lng = spots[area][used[area]]
            used[area] += 1
            reporter = citizens[n % len(citizens)]
            proc = images.process((CURATED / e["file"]).read_bytes())
            key, thumb_key = new_keys()
            await storage.put(key, proc.main, "image/webp")
            await storage.put(thumb_key, proc.thumb, "image/webp")
            m = Media(uploader_id=reporter.id, storage_key=key, thumb_key=thumb_key, width=proc.width, height=proc.height, bytes=len(proc.main))
            db.add(m)
            await db.flush()
            r = await create_report(db, reporter.id, ReportIn(
                media_ids=[m.id], category=e["category"], problem_type=e["problem_type"], description=e["description"], lat=lat, lng=lng,
                address_text=f"{LANDMARKS[n % len(LANDMARKS)]}, {area}", location_source="manual", area=area))
            iid = r["incident_id"]
            new_ids.append(iid)
            created = datetime.now(UTC) - timedelta(days=1 + n % 9, hours=n % 7)
            for table, col in (("incidents", "id"), ("reports", "incident_id"), ("status_events", "incident_id")):
                await db.execute(text(f"UPDATE {table} SET created_at = :c WHERE {col} = :i"), {"c": created, "i": iid})
            status, officer = STATUSES[n % len(STATUSES)], officers[area]
            if status != "Reported" and officer is not None:
                for st in STEPS[: STEPS.index(status) + 1]:
                    reason = "Repair completed and the site was checked." if st == "Resolved" else None
                    await db.execute(text("""INSERT INTO status_events (incident_id, from_status, to_status, actor_id, created_at, reason)
                                             SELECT id, status, CAST(:s AS issue_status), :a, :c, :r FROM incidents WHERE id = :i"""),
                                     {"s": st, "a": officer.id, "i": iid, "c": created + timedelta(days=0.5), "r": reason})
                    await db.execute(text("""UPDATE incidents SET status = CAST(:s AS issue_status), assigned_to = :a,
                                             resolved_at = CASE WHEN :s IN ('Resolved', 'Closed') THEN now() - interval '20 hours' ELSE resolved_at END,
                                             status_reason = CASE WHEN :s = 'Resolved' THEN :r ELSE status_reason END WHERE id = :i"""),
                                     {"s": st, "a": officer.id, "i": iid, "r": reason})
        await db.execute(text("UPDATE incidents SET due_at = NULL WHERE id = ANY(CAST(:ids AS uuid[]))"), {"ids": [str(i) for i in new_ids]})
        await recompute_priority(db, new_ids)
        await db.commit()
        print(f"{len(new_ids)} complaints created")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
