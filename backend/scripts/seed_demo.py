"""Development only: create the demo citizen and authority shown in the frontend's DEV box, plus a few
incidents so the control room is not empty. Refuses to run with ENV=production.

    cd backend && python -m scripts.seed_demo
"""

import asyncio
import random
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text

from app import refdata
from app.config import get_settings
from app.db import SessionLocal, engine
from app.incidents import create_report
from app.models import AuthorityProfile, User
from app.refdata import ref
from app.schemas import ReportIn
from app.security import hash_password

DEMO_USERS = [
    # role, name, email, password, area, (department, employee id)
    ("citizen", "Aarav Mehta", "aarav@example.com", "citizen123", "Andheri West", None),
    ("authority", "R. Kulkarni", "officer@bmc.demo", "bmc12345", "Fort", ("General / Ward Office", "BMC-10482")),
]
# problem, category, area, lat, lng, description, landmark, days ago, status, extra confirmations
DEMO_INCIDENTS = [
    ("Damaged", "Electrical Hazard", "Malad", 19.1874, 72.8484, "Open live wire near the school gate", "Malad school gate", 2, "Reported", 1),
    ("Large", "Pothole", "Andheri West", 19.1364, 72.8296, "Large pothole, bikes are skidding", "Link Road", 6, "In Progress", 22),
    ("Unsafe condition", "Drainage", "Bandra", 19.0596, 72.8295, "Manhole cover missing, dark at night", "Hill Road", 3, "Reported", 3),
    ("Not working", "Streetlight", "Andheri West", 19.1201, 72.8466, "Streetlight not working for a week", "Station Road", 9, "Under Review", 10),
    ("Overflowing", "Garbage", "Andheri West", 19.1300, 72.8350, "Overflowing waste point", "JP Road", 5, "Reported", 17),
    ("Damaged", "Water Leakage", "Dadar", 19.0178, 72.8478, "Water pipe burst flooding the lane, blocks footpath", "Dadar market lane", 1, "Reported", 30),
    ("Damaged", "Road Damage", "Borivali", 19.2307, 72.8567, "Road caved in after heavy rain on the main road", "SV Road", 2, "Under Review", 5),
    ("Illegal dumping", "Garbage", "Goregaon", 19.1663, 72.8526, "Garbage dumped on the footpath", "Aarey Road", 12, "Reported", 4),
    ("Small", "Pothole", "Dadar", 19.0200, 72.8440, "Pothole near the bus stop", "Dadar TT bus stop", 14, "Resolved", 18),
]


async def main() -> None:
    if get_settings().env == "production":
        raise SystemExit("seed_demo is for development only")
    async with SessionLocal() as db:
        await refdata.load(db)
        ids = {}
        for role, name, email, password, area, extra in DEMO_USERS:
            user = await db.scalar(select(User).where(User.email == email))
            if user is None:
                user = User(role=role, name=name, email=email, password_hash=hash_password(password), ward_id=ref.ward_id(area))
                db.add(user)
                await db.flush()
                if extra:
                    db.add(AuthorityProfile(user_id=user.id, employee_id=extra[1], department_id=ref.department_id(extra[0]), approval="approved", decided_at=datetime.now(UTC)))
            ids[email] = user.id
        await db.commit()
        if await db.scalar(text("SELECT count(*) FROM incidents")) > 0:
            print("demo users ready; incidents already exist, not adding more")
            return
        neighbours = []
        for k in range(30):
            email = f"neighbour{k}@example.com"
            u = await db.scalar(select(User).where(User.email == email))
            if u is None:
                u = User(role="citizen", name=f"Neighbour {k}", email=email, password_hash="!demo-no-login", ward_id=ref.ward_id(random.choice(list(ref.wards.values()))))
                db.add(u)
                await db.flush()
            neighbours.append(u.id)
        officer = ids["officer@bmc.demo"]
        for n, (problem, category, area, lat, lng, desc, address, days, status, confirms) in enumerate(DEMO_INCIDENTS):
            reporter = ids["aarav@example.com"] if area == "Andheri West" else neighbours[n]
            r = await create_report(db, reporter, None, ReportIn(category=category, problem_type=problem, description=desc, lat=lat, lng=lng, address_text=address, area=area))
            created = datetime.now(UTC) - timedelta(days=days)
            await db.execute(text("UPDATE incidents SET created_at = :c WHERE id = :i"), {"c": created, "i": r["incident_id"]})
            await db.execute(text("UPDATE status_events SET created_at = :c WHERE incident_id = :i"), {"c": created, "i": r["incident_id"]})
            await db.execute(text("UPDATE reports SET created_at = :c WHERE incident_id = :i"), {"c": created, "i": r["incident_id"]})
            for uid in neighbours[:confirms]:
                if uid != reporter:
                    await db.execute(text("INSERT INTO confirmations (incident_id, user_id) VALUES (:i, :u) ON CONFLICT DO NOTHING"), {"i": r["incident_id"], "u": uid})
            await db.execute(text("UPDATE incidents SET affected_count = 1 + (SELECT count(*) FROM confirmations WHERE incident_id = :i) WHERE id = :i"), {"i": r["incident_id"]})
            if status != "Reported":
                for st in ["Under Review", "In Progress", "Resolved"][: ["Under Review", "In Progress", "Resolved"].index(status) + 1]:
                    await db.execute(text("INSERT INTO status_events (incident_id, from_status, to_status, actor_id, created_at) SELECT id, status, CAST(:s AS issue_status), :a, :c FROM incidents WHERE id = :i"), {"s": st, "a": officer, "i": r["incident_id"], "c": created + timedelta(days=days * 0.6)})
                    await db.execute(text("UPDATE incidents SET status = CAST(:s AS issue_status), resolved_at = CASE WHEN :s = 'Resolved' THEN now() END WHERE id = :i"), {"s": st, "i": r["incident_id"]})
                body = "Work completed. Please verify the fix on site." if status == "Resolved" else "A repair crew has been assigned. Work is scheduled this week." if status == "In Progress" else "We are reviewing this report."
                await db.execute(text("INSERT INTO messages (incident_id, sender_id, body) VALUES (:i, :a, :b)"), {"i": r["incident_id"], "a": officer, "b": body})
        await db.execute(text("""UPDATE incidents i SET priority_score = ireport_priority(i.severity, c.hazard_points, i.flags, i.status, i.created_at, i.affected_count)
                                 FROM categories c WHERE c.id = i.category_id"""))
        await db.commit()
    await engine.dispose()
    print(f"demo users ready; {len(DEMO_INCIDENTS)} demo incidents created")


if __name__ == "__main__":
    asyncio.run(main())
