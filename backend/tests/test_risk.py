"""Item 3 of authority-v2: risk from checked facts. Map checks (PostGIS on osm_features) against citizen claims, due dates, overdue."""

import itertools
from datetime import timedelta

from sqlalchemy import text

from conftest import make_authority, register_citizen

SPOT = (19.1364, 72.8296)


def north(metres: float, base=SPOT) -> tuple[float, float]:
    return base[0] + metres / 111_320, base[1]


def report(point=SPOT, category="Pothole", **extra) -> dict:
    return {"category": category, "problem_type": "Small", "lat": point[0], "lng": point[1], "address_text": "Link Road", "location_source": "manual", **extra}


async def one(sql: str, **params):
    from app.db import engine

    async with engine.connect() as conn:
        return (await conn.execute(text(sql), params)).one()


_ids = itertools.count(1)


async def add_features(*features):
    """features: (kind, name, WKT in lng lat). Removed again by the autouse cleanup fixture below."""
    from app.db import engine

    async with engine.begin() as conn:
        for kind, name, wkt in features:
            i = next(_ids)
            await conn.execute(text("INSERT INTO osm_features (osm_id, kind, name, highway, geom) VALUES (:i, :k, :n, :h, ST_GeogFromText(:g))"),
                               {"i": i, "k": kind, "n": name, "h": "primary" if kind == "main_road" else None, "g": f"SRID=4326;{wkt}"})


import pytest  # noqa: E402


@pytest.fixture(autouse=True)
async def clean_osm(client):
    from app.db import engine

    yield
    async with engine.begin() as conn:
        await conn.execute(text("DELETE FROM osm_features"))


async def brief(client, officer, iid):
    return (await client.get(f"/authority/incidents/{iid}", headers=officer["headers"])).json()


async def test_without_map_data_the_citizens_flags_count_and_say_so(client):
    officer = await make_authority(client)
    c = await register_citizen(client)
    created = (await client.post("/reports", json=report(flags=["Near school", "Main road"]), headers=c["headers"])).json()
    d = await brief(client, officer, created["incident_id"])
    assert d["map_checked"] is False
    by_code = {r["code"]: r for r in d["reasons"]}
    assert by_code["main_road"]["source"] == "citizen" and by_code["near_sensitive"]["source"] == "citizen"
    assert d["risk"] == 3 * 3 and d["response"] == "Urgent"  # pothole 3 x (1 + main road + school)


async def test_map_checks_replace_the_claims_for_the_main_road(client):
    from app.incidents import refresh_geo_facts, recompute_priority
    from app.db import SessionLocal

    officer = await make_authority(client)
    c = await register_citizen(client)
    created = (await client.post("/reports", json=report(flags=["Main road"]), headers=c["headers"])).json()
    iid = created["incident_id"]
    # a main road is loaded, but 200 m away: the map says "not on a main road", the citizen's tick no longer counts
    await add_features(("main_road", "Western Express Highway", f"LINESTRING({SPOT[1] - 0.001} {north(200)[0]}, {SPOT[1] + 0.001} {north(200)[0]})"))
    async with SessionLocal() as db:
        await refresh_geo_facts(db, None)
        await recompute_priority(db, [iid])
        await db.commit()
    d = await brief(client, officer, iid)
    assert d["map_checked"] is True and not any(r["code"] == "main_road" for r in d["reasons"]) and d["risk"] == 3
    # now a road 15 m away: checked on the map, named
    await add_features(("main_road", "Link Road", f"LINESTRING({SPOT[1] - 0.001} {north(15)[0]}, {SPOT[1] + 0.001} {north(15)[0]})"))
    async with SessionLocal() as db:
        await refresh_geo_facts(db, None)
        await recompute_priority(db, [iid])
        await db.commit()
    d = await brief(client, officer, iid)
    road = next(r for r in d["reasons"] if r["code"] == "main_road")
    assert road["source"] == "map" and road["params"]["name"] == "Link Road" and d["risk"] == 6


async def test_school_within_100_m_is_checked_on_the_map_and_named(client):
    from app.db import SessionLocal
    from app.incidents import recompute_priority, refresh_geo_facts

    officer = await make_authority(client)
    c = await register_citizen(client)
    iid = (await client.post("/reports", json=report(category="Garbage"), headers=c["headers"])).json()["incident_id"]
    near, far = north(80), north(160)
    await add_features(("school", "St. Mary School", f"POINT({SPOT[1]} {near[0]})"), ("hospital", "Far Hospital", f"POINT({SPOT[1]} {far[0]})"))
    async with SessionLocal() as db:
        await refresh_geo_facts(db, None)
        await recompute_priority(db, [iid])
        await db.commit()
    d = await brief(client, officer, iid)
    assert d["what"]["near"]["kind"] == "school" and d["what"]["near"]["name"] == "St. Mary School" and 75 <= d["what"]["near"]["distance_m"] <= 85
    reason = next(r for r in d["reasons"] if r["code"] == "near_sensitive")
    assert reason["source"] == "map" and reason["params"]["name"] == "St. Mary School"  # the hospital at 160 m is not counted
    assert d["risk"] == 2 * 2  # garbage 2 x (1 + school)


async def test_due_date_follows_the_response_category_and_only_moves_earlier(client):
    from app.db import SessionLocal, engine
    from app.incidents import recompute_priority

    officer = await make_authority(client)
    cs = [await register_citizen(client) for _ in range(3)]
    created = (await client.post("/reports", json=report(category="Electrical Hazard", flags=["Near school", "Main road"]), headers=cs[0]["headers"])).json()
    iid = created["incident_id"]
    row = await one("SELECT risk, created_at, due_at FROM incidents WHERE id = :i", i=iid)
    assert row.risk == 12 and row.due_at - row.created_at == timedelta(hours=24)  # Emergency: make safe within 24 h
    d = await brief(client, officer, iid)
    assert d["response"] == "Emergency" and d["response_hours"] == 24 and d["overdue"] is False
    # risk falls (flags removed): the promise made is not extended
    async with engine.begin() as conn:
        await conn.execute(text("UPDATE incidents SET flags = '{}' WHERE id = :i"), {"i": iid})
    async with SessionLocal() as db:
        await recompute_priority(db, [iid])
        await db.commit()
    row2 = await one("SELECT risk, due_at FROM incidents WHERE id = :i", i=iid)
    assert row2.risk == 4 and row2.due_at == row.due_at
    # overdue = open and now > due_at; the officer sees how many days
    async with engine.begin() as conn:
        await conn.execute(text("UPDATE incidents SET due_at = now() - interval '2 days 3 hours' WHERE id = :i"), {"i": iid})
    d = await brief(client, officer, iid)
    assert d["overdue"] is True and d["overdue_days"] == 2
    row3 = (await client.get("/authority/incidents", headers=officer["headers"])).json()["items"][0]
    assert row3["overdue"] is True


async def test_three_distinct_citizens_raise_the_likelihood_but_one_citizen_twice_does_not(client):
    officer = await make_authority(client)
    a, b, c = [await register_citizen(client) for _ in range(3)]
    iid = (await client.post("/reports", json=report(category="Garbage"), headers=a["headers"])).json()["incident_id"]
    await client.post("/reports", json=report(north(10), category="Garbage"), headers=b["headers"])
    assert (await client.post("/reports", json=report(category="Garbage"), headers=a["headers"])).status_code == 409  # the same person again: refused
    assert (await brief(client, officer, iid))["risk"] == 2  # two distinct citizens: no extra point
    await client.post(f"/incidents/{iid}/confirm", headers=c["headers"])  # a confirmation counts as a citizen too
    d = await brief(client, officer, iid)
    assert d["risk"] == 4 and d["citizens"] == 3 and any(r["code"] == "many_citizens" and r["params"]["n"] == 3 for r in d["reasons"])
    assert d["reasons"][0]["code"] != "impact_4"  # garbage is impact 2: no impact reason is shown for it


async def test_transfer_restarts_the_due_date_from_the_new_category(client):
    officer = await make_authority(client)
    c = await register_citizen(client)
    iid = (await client.post("/reports", json=report(category="Garbage"), headers=c["headers"])).json()["incident_id"]
    before = await one("SELECT created_at, due_at FROM incidents WHERE id = :i", i=iid)
    assert before.due_at - before.created_at == timedelta(days=30) or before.due_at - before.created_at == timedelta(days=14)
    r = await client.post(f"/authority/incidents/{iid}/update", json={"status": "Transferred", "category": "Electrical Hazard", "reason": "Exposed wire, not waste"}, headers=officer["headers"])
    assert r.status_code == 200
    after = await one("SELECT risk, created_at, due_at FROM incidents WHERE id = :i", i=iid)
    assert after.risk == 4 and after.due_at - after.created_at == timedelta(days=14)
