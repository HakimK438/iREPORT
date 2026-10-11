"""Area-wise and department-wise access for officers, the review of doubtful reports, and the photo check at submit."""

from conftest import make_authority, register_citizen
from test_workflow import SPOT, fetch, new_complaint, report, update

ROADS = "Roads & Traffic"


async def test_officer_sees_and_changes_only_their_own_area_and_department(client):
    _, iid, _ = await new_complaint(client)  # a pothole in Andheri West (Roads & Traffic)
    mine = await make_authority(client, area="Andheri West", department=ROADS)
    other_area = await make_authority(client, area="Fort", department=ROADS)
    other_dept = await make_authority(client, area="Andheri West", department="Solid Waste Management")
    city_wide = await make_authority(client)  # no area, General / Ward Office: covers everything

    for who, sees in ((mine, 1), (other_area, 0), (other_dept, 0), (city_wide, 1)):
        listed = (await client.get("/authority/incidents", headers=who["headers"])).json()
        assert listed["total"] == sees and len(listed["items"]) == sees
        assert (await client.get("/authority/stats", headers=who["headers"])).json()["total"] == sees
        detail = await client.get(f"/authority/incidents/{iid}", headers=who["headers"])
        assert detail.status_code == (200 if sees else 403)
    for who in (other_area, other_dept):
        r = await update(client, who, iid, status="Acknowledged")
        assert r.status_code == 403 and r.json()["error"]["code"] == "out_of_scope"
    assert (await update(client, mine, iid, status="Acknowledged")).status_code == 200
    # bulk skips what is outside the officer's scope
    r = (await client.post("/authority/incidents/bulk", json={"ids": [iid], "status": "Acknowledged", "message": "Hello"}, headers=other_area["headers"])).json()
    assert r["updated"] == 0 and r["skipped"][0]["code"] == "out_of_scope"
    # the map only shows the officer's own area
    assert len((await client.get("/authority/map", headers=other_area["headers"])).json()["incidents"]) == 0
    assert len((await client.get("/authority/map", headers=mine["headers"])).json()["incidents"]) == 1


async def test_assign_only_to_colleagues_in_scope(client):
    _, iid, _ = await new_complaint(client)
    mine = await make_authority(client, area="Andheri West", department=ROADS)
    colleague = await make_authority(client, area="Andheri West", department=ROADS)
    stranger = await make_authority(client, area="Fort", department=ROADS)
    names = {o["id"] for o in (await client.get("/authority/officers", headers=mine["headers"])).json()["items"]}
    assert colleague["user"]["id"] in names and stranger["user"]["id"] not in names
    r = await update(client, mine, iid, assigned_to=stranger["user"]["id"])
    assert r.status_code == 403
    r = await update(client, mine, iid, assigned_to=colleague["user"]["id"])
    assert r.status_code == 200 and r.json()["assigned_to"] == colleague["user"]["id"]
    chips = (await client.get("/authority/stats", headers=colleague["headers"])).json()["chips"]
    assert chips["mine"] == 1 and chips["unassigned"] == 0


async def _photo(user: dict, label: str | None, conf: float | None) -> str:
    from sqlalchemy import text

    from app.db import engine

    async with engine.begin() as conn:
        return str(await conn.scalar(text("""INSERT INTO media (uploader_id, storage_key, thumb_key, ai_label, ai_conf)
                                             VALUES (CAST(:u AS uuid), 'k', 't', :l, :c) RETURNING id"""), {"u": user["user"]["id"], "l": label, "c": conf}))


async def test_wrong_photo_is_refused_and_doubtful_photo_is_flagged(client):
    wrong = await register_citizen(client)
    mid = await _photo(wrong, "Garbage", 0.93)  # the model is sure this is garbage, not a pothole
    r = await client.post("/reports", json=report(SPOT, "Pothole", media_ids=[mid]), headers=wrong["headers"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "photo_mismatch"
    not_civic = await _photo(wrong, "not_civic", 0.9)
    assert (await client.post("/reports", json=report(SPOT, "Pothole", media_ids=[not_civic]), headers=wrong["headers"])).status_code == 422

    doubtful = await register_citizen(client)
    mid = await _photo(doubtful, "Garbage", 0.45)
    r = await client.post("/reports", json=report(SPOT, "Pothole", media_ids=[mid]), headers=doubtful["headers"])
    assert r.status_code == 201, r.text
    iid = r.json()["incident_id"]
    assert (await fetch("SELECT needs_review FROM incidents WHERE id = CAST(:i AS uuid)", i=iid))[0][0] is True

    good = await register_citizen(client)
    mid = await _photo(good, "Pothole", 0.9)
    r = await client.post("/reports", json=report((19.14, 72.84), "Pothole", media_ids=[mid]), headers=good["headers"])
    assert r.status_code == 201
    assert (await fetch("SELECT needs_review FROM incidents WHERE id = CAST(:i AS uuid)", i=r.json()["incident_id"]))[0][0] is False


async def test_officer_reviews_a_doubtful_report(client):
    officer = await make_authority(client, area="Andheri West", department=ROADS)
    user = await register_citizen(client)
    mid = await _photo(user, "Garbage", 0.45)
    iid = (await client.post("/reports", json=report(SPOT, "Pothole", media_ids=[mid]), headers=user["headers"])).json()["incident_id"]
    assert (await client.get("/authority/stats", headers=officer["headers"])).json()["chips"]["review"] == 1
    assert (await client.get("/authority/incidents?view=review", headers=officer["headers"])).json()["items"][0]["needs_review"] is True
    r = await client.post(f"/authority/incidents/{iid}/review", json={"decision": "fake", "note": "Photo shows a shop."}, headers=officer["headers"])
    assert r.status_code == 200
    row = (await fetch("SELECT needs_review, status::text FROM incidents WHERE id = CAST(:i AS uuid)", i=iid))[0]
    assert row[0] is False and row[1] == "Rejected"
    outsider = await make_authority(client, area="Fort", department=ROADS)
    assert (await client.post(f"/authority/incidents/{iid}/review", json={"decision": "genuine"}, headers=outsider["headers"])).status_code == 403


async def test_area_tabs_and_problem_photos_on_the_map(client):
    _, iid, _ = await new_complaint(client)
    mine = await make_authority(client, area="Andheri West", department=ROADS)
    other = await make_authority(client, area="Fort", department=ROADS)
    areas = (await client.get("/authority/areas", headers=mine["headers"])).json()["items"]
    assert {a["area"]: a["is_mine"] for a in areas} == {"Andheri West": True, "Fort": False}
    point = (await client.get("/authority/map", headers=mine["headers"])).json()["incidents"][0]
    assert "thumb_url" in point and point["id"] == iid
    assert (await client.get("/authority/map", headers=other["headers"])).json()["incidents"] == []
