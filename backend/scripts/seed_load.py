"""Seed a load-test dataset: N incidents (default 100,000), each with one report and one status event,
30 % with a photo row, plus an approved load-test authority. Development / staging only.

    cd backend && python -m scripts.seed_load --n 100000
    python -m scripts.seed_load --drop        # remove the load-test rows again
"""

import argparse
import asyncio
import time

from sqlalchemy import text

from app.config import get_settings
from app.db import engine
from app.security import hash_password

AUTH_EMAIL, AUTH_PASSWORD = "loadtest-officer@example.com", "loadtest-pass-1"
CIT_EMAIL = "loadtest-citizen@example.com"


async def drop(conn) -> None:
    await conn.execute(text("DELETE FROM media WHERE uploader_id IN (SELECT id FROM users WHERE email = :e)"), {"e": CIT_EMAIL})
    await conn.execute(text("DELETE FROM status_events WHERE incident_id IN (SELECT id FROM incidents WHERE public_id LIKE 'LT-%')"))
    await conn.execute(text("DELETE FROM messages WHERE incident_id IN (SELECT id FROM incidents WHERE public_id LIKE 'LT-%')"))
    await conn.execute(text("DELETE FROM confirmations WHERE incident_id IN (SELECT id FROM incidents WHERE public_id LIKE 'LT-%')"))
    await conn.execute(text("DELETE FROM reports WHERE incident_id IN (SELECT id FROM incidents WHERE public_id LIKE 'LT-%')"))
    await conn.execute(text("DELETE FROM incidents WHERE public_id LIKE 'LT-%'"))


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=100_000)
    ap.add_argument("--drop", action="store_true")
    args = ap.parse_args()
    if get_settings().env == "production":
        raise SystemExit("seed_load is not for production")
    start = time.perf_counter()
    async with engine.begin() as conn:
        await drop(conn)
        if args.drop:
            print("load-test rows removed")
            return
        for email, role in ((AUTH_EMAIL, "authority"), (CIT_EMAIL, "citizen")):
            await conn.execute(text("INSERT INTO users (role, name, email, password_hash) VALUES (CAST(:r AS user_role), :n, :e, :p) ON CONFLICT (email) DO NOTHING"), {"r": role, "n": f"Load test {role}", "e": email, "p": hash_password(AUTH_PASSWORD)})
        await conn.execute(text("""INSERT INTO authority_profiles (user_id, employee_id, department_id, approval)
                                   SELECT id, 'LT-1', 1, 'approved' FROM users WHERE email = :e ON CONFLICT (user_id) DO UPDATE SET approval = 'approved'"""), {"e": AUTH_EMAIL})
        await conn.execute(text("""
            INSERT INTO incidents (public_id, category_id, location, ward_id, address_text, severity, flags, status, affected_count, created_at, updated_at, resolved_at)
            SELECT 'LT-' || lpad(g::text, 7, '0'), 1 + (g % 8),
                   ST_SetSRID(ST_MakePoint(72.80 + random() * 0.12, 18.90 + random() * 0.35), 4326)::geography,
                   1 + (g % 8), 'Load test street ' || g,
                   (ARRAY['Low','Medium','High','Critical'])[1 + floor(random() * 4)::int]::severity_level,
                   CASE WHEN r < 0.04 THEN ARRAY['Live wiring','Near school'] WHEN r < 0.25 THEN ARRAY['Main road'] WHEN r < 0.35 THEN ARRAY['Flood risk'] ELSE '{}'::text[] END,
                   s::issue_status, 1 + floor(random() * 40)::int, c, c, CASE WHEN s = 'Resolved' THEN c + interval '3 days' END
            FROM (SELECT g, random() AS r, now() - random() * interval '90 days' AS c,
                         (ARRAY['Reported','Reported','Under Review','In Progress','Resolved'])[1 + floor(random() * 5)::int] AS s
                  FROM generate_series(1, :n) g) x"""), {"n": args.n})
        await conn.execute(text("""
            INSERT INTO reports (incident_id, user_id, problem_type, created_at)
            SELECT i.id, u.id, (ARRAY['Large','Small','Not working','Overflowing','Damaged'])[1 + floor(random() * 5)::int], i.created_at
            FROM incidents i, users u WHERE i.public_id LIKE 'LT-%' AND u.email = :e"""), {"e": CIT_EMAIL})
        await conn.execute(text("""
            INSERT INTO status_events (incident_id, from_status, to_status, created_at)
            SELECT id, NULL, 'Reported', created_at FROM incidents WHERE public_id LIKE 'LT-%'"""))
        await conn.execute(text("""
            INSERT INTO media (report_id, uploader_id, storage_key, thumb_key, width, height, bytes, created_at)
            SELECT r.id, r.user_id, 'media/lt/' || r.id || '.webp', 'thumbs/lt/' || r.id || '.webp', 1280, 960, 180000, r.created_at
            FROM reports r JOIN incidents i ON i.id = r.incident_id WHERE i.public_id LIKE 'LT-%' AND random() < 0.3"""))
        await conn.execute(text("""UPDATE incidents i SET priority_score = ireport_priority(i.severity, c.hazard_points, i.flags, i.status, i.created_at, i.affected_count)
                                   FROM categories c WHERE c.id = i.category_id AND i.public_id LIKE 'LT-%'"""))
    async with engine.connect() as conn:
        await conn.execution_options(isolation_level="AUTOCOMMIT")
        await conn.execute(text("ANALYZE"))
    await engine.dispose()
    print(f"seeded {args.n} incidents in {time.perf_counter() - start:.1f}s; authority login {AUTH_EMAIL} / {AUTH_PASSWORD}")


if __name__ == "__main__":
    asyncio.run(main())
