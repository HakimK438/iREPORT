"""Item 7 of authority-v2: analytics computed from incidents and status_events, filtered by date range, ward and category."""

from datetime import date, timedelta

from sqlalchemy import text

from conftest import make_authority, register_citizen, resolve_complaint

SPOT = (19.1364, 72.8296)  # Andheri West
COLABA = (18.9067, 72.8147)


def north(metres: float, base=SPOT) -> tuple[float, float]:
    return base[0] + metres / 111_320, base[1]


def report(point, category="Pothole", address="Link Road") -> dict:
    return {"category": category, "problem_type": "Large", "lat": point[0], "lng": point[1], "address_text": address, "location_source": "manual"}


async def make(client, point, category, address="Link Road"):
    user = await register_citizen(client)
    created = (await client.post("/reports", json=report(point, category, address), headers=user["headers"])).json()
    return user, created["incident_id"], created["incident_public_id"]


async def scenario(client):
    """A: pothole, Andheri West, resolved in 2 days (due in 3)   B: garbage, Colaba, resolved in 6 days (due in 3), then reopened
       C: garbage, Colaba, open and overdue                        D: pothole 20 m from A, reported after A was resolved (a repeat spot)"""
    from app.db import engine

    officer = await make_authority(client)
    _, a, a_no = await make(client, SPOT, "Pothole")
    ub, b, _ = await make(client, COLABA, "Garbage")
    _, c, _ = await make(client, north(500, COLABA), "Garbage")
    for iid in (a, b):
        assert (await resolve_complaint(client, officer, iid)).status_code == 200
    async with engine.begin() as conn:
        for iid, created_days_ago, took_days in ((a, 4, 2), (b, 10, 6)):
            await conn.execute(text("UPDATE incidents SET created_at = now() - make_interval(days => :d), due_at = now() - make_interval(days => :d) + interval '3 days' WHERE id = :i"), {"d": created_days_ago, "i": iid})
            await conn.execute(text("UPDATE status_events SET created_at = (SELECT created_at FROM incidents WHERE id = :i) + make_interval(days => :t) WHERE incident_id = :i AND to_status = 'Resolved'"), {"i": iid, "t": took_days})
        await conn.execute(text("UPDATE incidents SET created_at = now() - interval '5 days', due_at = now() - interval '1 day' WHERE id = :i"), {"i": c})
    assert (await client.post(f"/incidents/{b}/resolution/reopen", json={"reason": "Garbage is back"}, headers=ub["headers"])).status_code == 200
    _, d, d_no = await make(client, north(20), "Pothole")
    return officer, {"a": a, "b": b, "c": c, "d": d, "a_no": a_no, "d_no": d_no}


async def get(client, officer, path, **params):
    r = await client.get(f"/authority/analytics/{path}", params=params, headers=officer["headers"])
    assert r.status_code == 200, r.text
    return r.json()


async def test_overview_numbers(client):
    officer, _ = await scenario(client)
    o = await get(client, officer, "overview")
    assert o["total"] == 4 and o["open"] == 3  # B is Reopened (open), C and D are open, A is Resolved
    assert o["overdue"] == 2  # B (due 7 days ago) and C
    assert o["resolved_total"] == 2 and o["median_days_to_close"] == 4.0  # median of 2 and 6 days
    assert o["pct_within_sla"] == 50  # A in time (2 <= 3 days), B late (6 > 3)
    assert o["pct_reopened"] == 50 and o["resolved_week"] == 2


async def test_filters_ward_category_and_date_range(client):
    officer, _ = await scenario(client)
    assert (await get(client, officer, "overview", ward="Colaba"))["total"] == 2
    assert (await get(client, officer, "overview", category="Pothole"))["total"] == 2
    assert (await get(client, officer, "overview", ward="Colaba", category="Pothole"))["total"] == 0
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    assert (await get(client, officer, "overview", date_from=tomorrow))["total"] == 0
    last_week = (date.today() - timedelta(days=7)).isoformat()
    assert (await get(client, officer, "overview", date_from=last_week))["total"] == 3  # A, C, D were created within the last 7 days
    bad = await client.get("/authority/analytics/overview", params={"ward": "Atlantis"}, headers=officer["headers"])
    assert bad.status_code == 422
    assert (await client.get("/authority/analytics/overview")).status_code == 401


async def test_by_ward_and_by_type_and_repeat_spots(client):
    officer, ids = await scenario(client)
    wards = {w["ward"]: w for w in (await get(client, officer, "by-ward"))["items"]}
    assert (wards["Andheri West"]["total"], wards["Andheri West"]["open"], wards["Andheri West"]["overdue"], wards["Andheri West"]["median_days_to_close"]) == (2, 1, 0, 2.0)
    assert (wards["Colaba"]["total"], wards["Colaba"]["open"], wards["Colaba"]["overdue"], wards["Colaba"]["median_days_to_close"]) == (2, 2, 2, 6.0)
    assert wards["Colaba"]["lat"] and wards["Colaba"]["lng"]

    t = await get(client, officer, "by-type")
    types = {x["category"]: x for x in t["items"]}
    assert (types["Pothole"]["total"], types["Pothole"]["open"], types["Pothole"]["median_days_to_close"], types["Pothole"]["repeat_spots"]) == (2, 1, 2.0, 1)
    assert (types["Garbage"]["total"], types["Garbage"]["repeat_spots"]) == (2, 0)
    rep = t["repeats"][0]
    assert rep["public_id"] == ids["d_no"] and rep["previous"] == ids["a_no"] and rep["category"] == "Pothole" and rep["days_after"] in (1, 2)
    month = {x["category"]: x for x in t["trend"]}
    assert month["Pothole"]["this_month"] + month["Pothole"]["last_month"] >= 1


async def test_performance_by_department_and_ward(client):
    officer, _ = await scenario(client)
    p = await get(client, officer, "performance")
    depts = {d["name"]: d for d in p["departments"]}
    assert depts["Roads & Traffic"] == {"name": "Roads & Traffic", "resolved": 1, "pct_within_sla": 100, "reopen_rate": 0}
    assert depts["Solid Waste Management"] == {"name": "Solid Waste Management", "resolved": 1, "pct_within_sla": 0, "reopen_rate": 100}
    assert {w["name"] for w in p["wards"]} == {"Andheri West", "Colaba"}


async def test_backlog_today_and_season(client):
    officer, _ = await scenario(client)
    b = (await get(client, officer, "backlog"))["weeks"]
    assert len(b) == 12 and sum(w["reported"] for w in b) == 4 and sum(w["closed"] for w in b) == 2
    # a reopened complaint stays counted as finished at its first completion (documented), so C and D are the open ones
    assert b[-1]["open_at_end"] == 2
    today = await get(client, officer, "today")
    assert today == {"new_today": 1, "closed_today": 0, "overdue": 2, "ward": None}
    assert (await get(client, officer, "today", ward="Colaba"))["overdue"] == 2 and (await get(client, officer, "today", ward="Colaba"))["new_today"] == 0
    s = (await get(client, officer, "season"))["items"]
    assert sum(x["n"] for x in s) == 4 and {x["category"] for x in s} == {"Pothole", "Garbage"}


async def test_csv_export_uses_the_list_filters_and_neutralises_formulas(client):
    officer, ids = await scenario(client)
    user = await register_citizen(client)
    await client.post("/reports", json=report(north(2000), "Streetlight", '=HYPERLINK("http://evil.example","x")'), headers=user["headers"])
    r = await client.get("/authority/analytics/export.csv", headers=officer["headers"])
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv") and "attachment" in r.headers["content-disposition"]
    rows = r.text.lstrip("﻿").splitlines()
    assert rows[0].startswith("complaint_no,category,department,ward") and len(rows) == 6
    assert "'=HYPERLINK" in r.text and ",=HYPERLINK" not in r.text and '"=HYPERLINK' not in r.text
    overdue = await client.get("/authority/analytics/export.csv", params={"view": "overdue"}, headers=officer["headers"])
    assert len(overdue.text.lstrip("﻿").splitlines()) == 3  # header + B + C
    colaba = await client.get("/authority/analytics/export.csv", params={"ward": "Colaba", "category": "Garbage"}, headers=officer["headers"])
    assert len(colaba.text.lstrip("﻿").splitlines()) == 3
    assert ids["a_no"] in r.text
