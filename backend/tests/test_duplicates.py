"""Item 1 of authority-v2: one citizen is one reporter. A repeat report is refused before anything is inserted."""

import importlib.util
import io
from pathlib import Path

from PIL import Image
from sqlalchemy import text

from conftest import ROOT, make_authority, register_citizen, resolve_complaint

SPOT = (19.1364, 72.8296)


def north(metres: float) -> tuple[float, float]:
    return SPOT[0] + metres / 111_320, SPOT[1]


def report(point=SPOT, category="Pothole", **extra) -> dict:
    return {"category": category, "problem_type": "Large", "lat": point[0], "lng": point[1], "address_text": "Link Road", "location_source": "manual", **extra}


def jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (900, 700), (200, 30, 30)).save(buf, "JPEG", quality=90)
    return buf.getvalue()


async def count(sql: str, **params) -> int:
    from app.db import engine

    async with engine.connect() as conn:
        return await conn.scalar(text(sql), params)


async def test_same_user_same_spot_is_409_and_inserts_nothing(client):
    a = await register_citizen(client)
    first = (await client.post("/reports", json=report(), headers=a["headers"])).json()
    r = await client.post("/reports", json=report(), headers=a["headers"])
    assert r.status_code == 409
    err = r.json()["error"]
    assert err["code"] == "already_reported" and err["public_id"] == first["incident_public_id"] and err["id"] == str(first["incident_id"])
    assert await count("SELECT count(*) FROM reports") == 1 and await count("SELECT count(*) FROM incidents") == 1


async def test_different_category_at_the_same_spot_is_409_too(client):
    a = await register_citizen(client)
    first = (await client.post("/reports", json=report(), headers=a["headers"])).json()
    r = await client.post("/reports", json=report(category="Garbage"), headers=a["headers"])
    assert r.status_code == 409 and r.json()["error"]["public_id"] == first["incident_public_id"]
    assert await count("SELECT count(*) FROM incidents") == 1


async def test_49_m_is_the_same_spot_and_51_m_is_not(client):
    a = await register_citizen(client)
    first = (await client.post("/reports", json=report(), headers=a["headers"])).json()
    assert (await client.post("/reports", json=report(north(49), category="Garbage"), headers=a["headers"])).status_code == 409
    far = await client.post("/reports", json=report(north(51), category="Garbage"), headers=a["headers"])
    assert far.status_code == 201 and far.json()["merged"] is False and far.json()["incident_id"] != first["incident_id"]


async def test_a_different_user_at_the_same_spot_merges_and_counts_one_more(client):
    a, b = await register_citizen(client), await register_citizen(client)
    first = (await client.post("/reports", json=report(), headers=a["headers"])).json()
    second = (await client.post("/reports", json=report(north(20)), headers=b["headers"])).json()
    assert second["merged"] is True and second["incident_id"] == first["incident_id"] and second["affected_count"] == 2


async def test_a_resolved_complaint_does_not_block_a_new_report(client):
    officer = await make_authority(client)
    a = await register_citizen(client)
    first = (await client.post("/reports", json=report(), headers=a["headers"])).json()
    assert (await resolve_complaint(client, officer, first["incident_id"])).status_code == 200
    again = await client.post("/reports", json=report(), headers=a["headers"])
    assert again.status_code == 201 and again.json()["merged"] is False  # the first complaint is no longer open


async def test_an_old_report_does_not_block(client):
    from app.db import engine

    a = await register_citizen(client)
    first = (await client.post("/reports", json=report(), headers=a["headers"])).json()
    async with engine.begin() as conn:
        await conn.execute(text("UPDATE reports SET created_at = now() - interval '15 days' WHERE id = :r"), {"r": first["report_id"]})
        await conn.execute(text("UPDATE incidents SET created_at = now() - interval '15 days' WHERE id = :i"), {"i": first["incident_id"]})
    assert (await client.post("/reports", json=report(), headers=a["headers"])).status_code == 201


async def test_ten_reports_an_hour_per_user(client):
    a = await register_citizen(client)
    for k in range(10):  # 120 m apart: ten separate complaints
        r = await client.post("/reports", json=report((SPOT[0] + k * 0.0011, SPOT[1])), headers=a["headers"])
        assert r.status_code == 201, (k, r.text)
    over = await client.post("/reports", json=report((SPOT[0] + 0.05, SPOT[1])), headers=a["headers"])
    assert over.status_code == 429 and over.json()["error"]["code"] == "rate_limited" and "Retry-After" in over.headers
    other = await register_citizen(client)  # the limit is per user
    assert (await client.post("/reports", json=report((SPOT[0] + 0.05, SPOT[1])), headers=other["headers"])).status_code == 201


async def test_nearby_check_mine_and_others(client):
    a, b = await register_citizen(client), await register_citizen(client)
    first = (await client.post("/reports", json=report(), headers=a["headers"])).json()
    mine = (await client.get("/reports/nearby-check", params={"lat": SPOT[0], "lng": SPOT[1]}, headers=a["headers"])).json()
    assert mine["mine"]["public_id"] == first["incident_public_id"] and mine["others"] == []
    near = north(30)
    theirs = (await client.get("/reports/nearby-check", params={"lat": near[0], "lng": near[1]}, headers=b["headers"])).json()
    assert theirs["mine"] is None and [o["public_id"] for o in theirs["others"]] == [first["incident_public_id"]] and theirs["others"][0]["confirmed_by_me"] is False
    await client.post(f"/incidents/{first['incident_id']}/confirm", headers=b["headers"])
    assert (await client.get("/reports/nearby-check", params={"lat": near[0], "lng": near[1]}, headers=b["headers"])).json()["others"][0]["confirmed_by_me"] is True
    far = north(60)
    assert (await client.get("/reports/nearby-check", params={"lat": far[0], "lng": far[1]}, headers=b["headers"])).json() == {"radius_m": 50.0, "mine": None, "others": []}
    assert (await client.get("/reports/nearby-check", params={"lat": near[0], "lng": near[1]})).status_code == 401


async def test_add_photos_to_my_own_report_with_the_usual_limit(client):
    a, b = await register_citizen(client), await register_citizen(client)
    first = (await client.post("/reports", json=report(), headers=a["headers"])).json()
    iid = first["incident_id"]
    ok = await client.post(f"/reports/{iid}/photos", files=[("photos", ("a.jpg", jpeg(), "image/jpeg"))], headers=a["headers"])
    assert ok.status_code == 201 and ok.json()["added"] == 1 and ok.json()["photos_total"] == 1
    assert await count("SELECT count(*) FROM media WHERE report_id = :r", r=first["report_id"]) == 1
    too_many = await client.post(f"/reports/{iid}/photos", files=[("photos", (f"{k}.jpg", jpeg(), "image/jpeg")) for k in range(3)], headers=a["headers"])
    assert too_many.status_code == 422 and too_many.json()["error"]["code"] == "too_many_photos"
    # only the original reporter can add photos
    assert (await client.post(f"/reports/{iid}/photos", files=[("photos", ("a.jpg", jpeg(), "image/jpeg"))], headers=b["headers"])).status_code == 404
    mine = (await client.get("/reports/mine", headers=a["headers"])).json()["items"][0]
    assert mine["photo_count"] == 1 and mine["max_photos"] == 3


async def test_legacy_repeat_reports_are_marked_hidden_and_nothing_is_deleted(client):
    """The old merge rule inserted a reports row (and photos) for every repeat. Migration 0009 flags them; all counts skip them."""
    from app.db import engine

    spec = importlib.util.spec_from_file_location("m0009", Path(ROOT) / "alembic" / "versions" / "0009_duplicate_reports.py")
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    a, b = await register_citizen(client), await register_citizen(client)
    officer = await make_authority(client)
    first = (await client.post("/reports", json=report(), headers=a["headers"])).json()
    await client.post("/reports", json=report(north(10)), headers=b["headers"])  # b also reports: 2 citizens
    async with engine.begin() as conn:  # make a look like the bug: 8 more rows and 8 photos for the same person
        uid = await conn.scalar(text("SELECT user_id FROM reports WHERE id = :r"), {"r": first["report_id"]})
        for _ in range(8):
            rid = await conn.scalar(text("INSERT INTO reports (incident_id, user_id, problem_type, created_at) VALUES (:i, :u, 'Large', now() + interval '1 minute') RETURNING id"), {"i": first["incident_id"], "u": uid})
            await conn.execute(text("INSERT INTO media (report_id, uploader_id, storage_key, thumb_key) VALUES (:r, :u, 'media/x.webp', 'thumbs/x.webp')"), {"r": rid, "u": uid})
        await conn.execute(text(migration.MARK_DUPLICATES))
    assert await count("SELECT count(*) FROM reports WHERE duplicate_of_report_id IS NOT NULL") == 8
    assert await count("SELECT count(*) FROM reports") == 10 and await count("SELECT count(*) FROM media") == 8  # nothing deleted
    assert await count("SELECT count(*) FROM reports WHERE id = :r AND duplicate_of_report_id IS NULL", r=first["report_id"]) == 1  # the earliest is kept

    mine = (await client.get("/reports/mine", headers=a["headers"])).json()["items"]
    assert len(mine) == 1
    detail = (await client.get(f"/authority/incidents/{first['incident_id']}", headers=officer["headers"])).json()
    assert len(detail["evidence"]) == 2 and sum(len(e["photos"]) for e in detail["evidence"]) == 0 and detail["citizens"] == 2
    row = (await client.get("/authority/incidents", headers=officer["headers"])).json()["items"][0]
    assert row["citizens"] == 2 and row["thumb_url"] is None
    assert (await client.get("/me/summary", headers=a["headers"])).json()["reports_submitted"] == 1
    assert (await client.get("/admin/stats", headers=(await _admin(client)))).json()["reports"] == 2


async def _admin(client):
    from conftest import admin_headers

    return await admin_headers(client)
