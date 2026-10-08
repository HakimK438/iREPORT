from sqlalchemy import text

from conftest import make_authority, register_citizen

LINK_ROAD = (19.1364, 72.8296)


def offset(lat: float, lng: float, metres_north: float) -> tuple[float, float]:
    return lat + metres_north / 111_320, lng


def report(lat=LINK_ROAD[0], lng=LINK_ROAD[1], category="Pothole", **extra) -> dict:
    return {"category": category, "problem_type": "Large", "lat": lat, "lng": lng, "address_text": "Link Road", "location_source": "manual", **extra}


async def test_report_creates_incident_with_timeline(client):
    c = await register_citizen(client)
    r = await client.post("/reports", json=report(description="Huge pothole near the school gate"), headers=c["headers"])
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["merged"] is False and body["affected_count"] == 1 and body["status"] == "Reported"
    assert body["incident_public_id"].startswith("IR-") and body["incident_public_id"].endswith("-00001")
    assert body["severity"] == "High"  # "Large" + school cue

    mine = (await client.get("/reports/mine", headers=c["headers"])).json()["items"]
    assert len(mine) == 1
    item = mine[0]
    assert item["title"] == "Large pothole at Link Road" and item["area"] == "Andheri West"
    assert [h["status"] for h in item["history"]] == ["Reported"] and item["messages"] == []


async def test_neighbours_reports_merge_within_50m(client):
    a, b, far, other = [await register_citizen(client) for _ in range(4)]
    first = (await client.post("/reports", json=report(), headers=a["headers"])).json()
    near = offset(*LINK_ROAD, 30)
    second = (await client.post("/reports", json=report(*near, description="live wire hanging"), headers=b["headers"])).json()
    assert second["merged"] is True and second["incident_public_id"] == first["incident_public_id"] and second["affected_count"] == 2
    # merged incident keeps the stronger severity and the union of flags
    assert second["severity"] == "Critical"

    away = (await client.post("/reports", json=report(*offset(*LINK_ROAD, 80)), headers=far["headers"])).json()
    assert away["merged"] is False
    diff_cat = (await client.post("/reports", json=report(category="Garbage"), headers=other["headers"])).json()
    assert diff_cat["merged"] is False

    # the same citizen reporting again is not counted twice
    again = (await client.post("/reports", json=report(), headers=a["headers"])).json()
    assert again["merged"] is True and again["affected_count"] == 2


async def test_no_merge_into_resolved_or_old_incidents(client):
    from app.db import engine

    officer = await make_authority(client)
    a, b, c = [await register_citizen(client) for _ in range(3)]
    first = (await client.post("/reports", json=report(), headers=a["headers"])).json()
    await client.post(f"/authority/incidents/{first['incident_id']}/update", json={"status": "Resolved"}, headers=officer["headers"])
    second = (await client.post("/reports", json=report(), headers=b["headers"])).json()
    assert second["merged"] is False

    async with engine.begin() as conn:
        await conn.execute(text("UPDATE incidents SET created_at = now() - interval '15 days' WHERE id = :i"), {"i": second["incident_id"]})
    third = (await client.post("/reports", json=report(), headers=c["headers"])).json()
    assert third["merged"] is False


async def test_unknown_category_and_foreign_media_rejected(client):
    c = await register_citizen(client)
    assert (await client.post("/reports", json=report(category="Volcano"), headers=c["headers"])).status_code == 422
    r = await client.post("/reports", json=report(media_ids=["6f1c1d8e-0000-4000-8000-000000000000"]), headers=c["headers"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_media"
    officer = await make_authority(client)
    assert (await client.post("/reports", json=report(), headers=officer["headers"])).status_code == 403


async def test_ai_correction_is_recorded(client):
    from app.db import engine

    c = await register_citizen(client)
    body = report(category="Road Damage", ai={"category": "Pothole", "confidence": 0.81, "model_version": "img-1.0/txt-1.0"})
    rid = (await client.post("/reports", json=body, headers=c["headers"])).json()["report_id"]
    async with engine.connect() as conn:
        row = (await conn.execute(text("SELECT c.name, r.ai_confidence, r.model_version, r.user_corrected FROM reports r JOIN categories c ON c.id = r.ai_category_id WHERE r.id = :r"), {"r": rid})).one()
    assert row.name == "Pothole" and abs(row.ai_confidence - 0.81) < 1e-6 and row.model_version == "img-1.0/txt-1.0" and row.user_corrected is True


async def test_messages_reply_and_unread(client):
    officer = await make_authority(client)
    c = await register_citizen(client, name="Neha Joshi")
    created = (await client.post("/reports", json=report(), headers=c["headers"])).json()
    iid = created["incident_id"]
    assert (await client.get("/messages/unread-count", headers=c["headers"])).json() == {"unread": 0}

    r = await client.post(f"/authority/incidents/{iid}/update", json={"status": "In Progress", "message": "A repair crew has been assigned."}, headers=officer["headers"])
    assert r.status_code == 200 and r.json()["status"] == "In Progress"
    assert (await client.get("/messages/unread-count", headers=c["headers"])).json() == {"unread": 1}

    item = (await client.get("/reports/mine", headers=c["headers"])).json()["items"][0]
    assert item["status"] == "In Progress"
    assert [h["status"] for h in item["history"]] == ["Reported", "In Progress"]
    assert item["messages"][0]["from"] == "authority" and item["messages"][0]["by"] == "R. Kulkarni · General / Ward Office"
    assert (await client.get("/messages/unread-count", headers=c["headers"])).json() == {"unread": 0}

    r = await client.post(f"/incidents/{iid}/messages", json={"body": "Thank you!"}, headers=c["headers"])
    assert r.status_code == 201
    stranger = await register_citizen(client)
    assert (await client.post(f"/incidents/{iid}/messages", json={"body": "hi"}, headers=stranger["headers"])).status_code == 404

    detail = (await client.get(f"/authority/incidents/{iid}", headers=officer["headers"])).json()
    assert [m["from"] for m in detail["messages"]] == ["authority", "citizen"]
    assert detail["messages"][1]["by"] == "Neha Joshi"
    assert detail["reporters"][0]["name"] == "Neha Joshi" and detail["reporters"][0]["phone"] is None


async def test_community_feed_is_public_and_confirm_counts(client):
    c = await register_citizen(client, name="Private Person")
    other = await register_citizen(client)
    iid = (await client.post("/reports", json=report(), headers=c["headers"])).json()["incident_id"]

    feed = (await client.get("/incidents/nearby", params={"lat": LINK_ROAD[0], "lng": LINK_ROAD[1], "radius": 1000})).json()
    assert len(feed["items"]) == 1
    assert "Private Person" not in str(feed) and "@" not in str(feed)
    assert feed["items"][0]["distance_m"] == 0

    r = await client.post(f"/incidents/{iid}/confirm", headers=other["headers"])
    assert r.json() == {"confirmed": True, "affected_count": 2}
    r = await client.post(f"/incidents/{iid}/confirm", headers=other["headers"])
    assert r.json()["affected_count"] == 2  # idempotent
    mine = (await client.get("/incidents/nearby", params={"lat": LINK_ROAD[0], "lng": LINK_ROAD[1]}, headers=other["headers"])).json()
    assert mine["items"][0]["confirmed_by_me"] is True
    r = await client.delete(f"/incidents/{iid}/confirm", headers=other["headers"])
    assert r.json() == {"confirmed": False, "affected_count": 1}
    # a reporter confirming does not double count
    assert (await client.post(f"/incidents/{iid}/confirm", headers=c["headers"])).json()["affected_count"] == 1
    # filters
    empty = (await client.get("/incidents/nearby", params={"lat": LINK_ROAD[0], "lng": LINK_ROAD[1], "category": "Garbage"})).json()
    assert empty["items"] == []
    st = (await client.get("/incidents/nearby", params={"lat": LINK_ROAD[0], "lng": LINK_ROAD[1], "status": "Reported,Under Review"})).json()
    assert len(st["items"]) == 1
    assert (await client.get(f"/incidents/{iid}")).json()["public_id"].startswith("IR-")


async def test_authority_list_sort_filter_page_and_stats(client):
    officer = await make_authority(client)
    citizens = [await register_citizen(client) for _ in range(32)]
    # a safe problem confirmed by 30 people, and a dangerous one with 2 reports
    safe = (await client.post("/reports", json=report(19.20, 72.85, category="Garbage", problem_type="Uncollected garbage"), headers=citizens[0]["headers"])).json()
    for c in citizens[1:30]:
        await client.post(f"/incidents/{safe['incident_id']}/confirm", headers=c["headers"])
    danger = (await client.post("/reports", json=report(19.18, 72.84, category="Electrical Hazard", problem_type="Damaged", description="sparking wire near school"), headers=citizens[30]["headers"])).json()
    await client.post("/reports", json=report(*offset(19.18, 72.84, 10), category="Electrical Hazard", problem_type="Damaged"), headers=citizens[31]["headers"])
    for k in range(5):
        await client.post("/reports", json=report(18.9067 + k * 0.002, 72.8147, category="Streetlight", problem_type="Not working"), headers=citizens[k]["headers"])

    page = (await client.get("/authority/incidents", headers=officer["headers"])).json()
    assert page["total"] == 7
    ids = [i["id"] for i in page["items"]]
    assert ids[0] == danger["incident_id"] and ids.index(danger["incident_id"]) < ids.index(safe["incident_id"])
    top = page["items"][0]
    assert top["affected_count"] == 2 and top["level"] == "Critical" and "Live wiring" in top["flags"]
    safe_row = next(i for i in page["items"] if i["id"] == safe["incident_id"])
    assert safe_row["affected_count"] == 30

    # keyset paging returns every row exactly once, in the same order
    seen, cursor = [], None
    while True:
        p = (await client.get("/authority/incidents", params={"limit": 2, **({"cursor": cursor} if cursor else {})}, headers=officer["headers"])).json()
        seen += [i["id"] for i in p["items"]]
        cursor = p["next_cursor"]
        if not cursor:
            break
    assert seen == ids

    # resolved go last
    await client.post(f"/authority/incidents/{danger['incident_id']}/update", json={"status": "Resolved"}, headers=officer["headers"])
    ids2 = [i["id"] for i in (await client.get("/authority/incidents", headers=officer["headers"])).json()["items"]]
    assert ids2[-1] == danger["incident_id"]

    f = (await client.get("/authority/incidents", params={"category": "Streetlight", "ward": "Colaba"}, headers=officer["headers"])).json()
    assert f["total"] == 5
    f = (await client.get("/authority/incidents", params={"hide_resolved": True}, headers=officer["headers"])).json()
    assert f["total"] == 6
    f = (await client.get("/authority/incidents", params={"q": "garbage"}, headers=officer["headers"])).json()
    assert [i["id"] for i in f["items"]] == [safe["incident_id"]]
    for sort in ("newest", "oldest", "affected"):
        r = await client.get("/authority/incidents", params={"sort": sort, "limit": 3}, headers=officer["headers"])
        assert r.status_code == 200 and len(r.json()["items"]) == 3
        r2 = await client.get("/authority/incidents", params={"sort": sort, "limit": 3, "cursor": r.json()["next_cursor"]}, headers=officer["headers"])
        assert r2.status_code == 200 and not set(i["id"] for i in r2.json()["items"]) & set(i["id"] for i in r.json()["items"])
    assert (await client.get("/authority/incidents", params={"sort": "affected"}, headers=officer["headers"])).json()["items"][0]["id"] == safe["incident_id"]

    s = (await client.get("/authority/stats", headers=officer["headers"])).json()
    assert (s["total"], s["open"], s["resolved"], s["in_progress"]) == (7, 6, 1, 0)
    assert next(c for c in s["per_category"] if c["category"] == "Streetlight") == {"category": "Streetlight", "total": 5, "open": 5}
    assert next(w for w in s["per_ward"] if w["area"] == "Malad")["total"] == 2

    detail = (await client.get(f"/authority/incidents/{danger['incident_id']}", headers=officer["headers"])).json()
    assert detail["reasons"][0]["label"] == "Critical severity" and len(detail["reporters"]) == 2
    assert [h["status"] for h in detail["history"]] == ["Reported", "Resolved"]


async def test_bulk_update_one_transaction(client):
    from app.db import engine

    officer = await make_authority(client)
    c = await register_citizen(client)
    ids = [(await client.post("/reports", json=report(19.0 + k * 0.01, 72.8), headers=c["headers"])).json()["incident_id"] for k in range(3)]
    r = await client.post("/authority/incidents/bulk", json={"ids": ids, "status": "In Progress", "message": "Crew assigned to all"}, headers=officer["headers"])
    assert r.json()["updated"] == 3
    async with engine.connect() as conn:
        events = await conn.scalar(text("SELECT count(*) FROM status_events WHERE to_status = 'In Progress' AND actor_id IS NOT NULL"))
        msgs = await conn.scalar(text("SELECT count(*) FROM messages"))
    assert (events, msgs) == (3, 3)
    # unchanged status does not write another event
    await client.post("/authority/incidents/bulk", json={"ids": ids, "status": "In Progress"}, headers=officer["headers"])
    async with engine.connect() as conn:
        assert await conn.scalar(text("SELECT count(*) FROM status_events WHERE to_status = 'In Progress'")) == 3
    assert (await client.post("/authority/incidents/bulk", json={"ids": ids}, headers=officer["headers"])).status_code == 422
    assert (await client.post("/authority/incidents/bulk", json={"ids": ids, "status": "Resolved"}, headers=c["headers"])).status_code == 403
    assert (await client.post("/authority/incidents/bulk", json={"ids": ["00000000-0000-4000-8000-000000000000"] * 101, "status": "Resolved"}, headers=officer["headers"])).status_code == 422


async def test_citizen_sees_only_own_reports(client):
    a, b = await register_citizen(client), await register_citizen(client)
    await client.post("/reports", json=report(), headers=a["headers"])
    assert (await client.get("/reports/mine", headers=b["headers"])).json()["items"] == []
    assert (await client.get("/authority/incidents", headers=a["headers"])).status_code == 403
