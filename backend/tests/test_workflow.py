"""Item 2 and 6 of authority-v2: the new lifecycle, one definition of open, the rules enforced on the backend, chip counts."""

from sqlalchemy import text

from conftest import make_authority, register_citizen, resolve_complaint

SPOT = (19.1364, 72.8296)


def north(metres: float, base=SPOT) -> tuple[float, float]:
    return base[0] + metres / 111_320, base[1]


def report(point=SPOT, category="Pothole", **extra) -> dict:
    return {"category": category, "problem_type": "Large", "lat": point[0], "lng": point[1], "address_text": "Link Road", "location_source": "manual", **extra}


async def new_complaint(client, point=SPOT, category="Pothole", user=None, **extra):
    user = user or await register_citizen(client)
    created = (await client.post("/reports", json=report(point, category, **extra), headers=user["headers"])).json()
    return user, created["incident_id"], created


async def update(client, officer, iid, **body):
    return await client.post(f"/authority/incidents/{iid}/update", json=body, headers=officer["headers"])


async def fetch(sql: str, **params):
    from app.db import engine

    async with engine.connect() as conn:
        return (await conn.execute(text(sql), params)).all()


# ---------- statuses ----------


async def test_under_review_is_gone_and_the_new_statuses_exist(client):
    officer = await make_authority(client)
    _, iid, _ = await new_complaint(client)
    assert (await update(client, officer, iid, status="Under Review")).status_code == 422
    assert (await update(client, officer, iid, status="Acknowledged")).json()["status"] == "Acknowledged"
    assert (await update(client, officer, iid, status="Scheduled", scheduled_for="2026-10-20")).json()["status"] == "Scheduled"
    assert (await update(client, officer, iid, status="In Progress")).json()["status"] == "In Progress"
    events = await fetch("SELECT from_status::text, to_status::text, actor_id IS NOT NULL AS has_actor FROM status_events WHERE incident_id = :i ORDER BY id", i=iid)
    assert [(e.from_status, e.to_status) for e in events] == [(None, "Reported"), ("Reported", "Reported"), ("Reported", "Acknowledged"), ("Acknowledged", "Scheduled"), ("Scheduled", "In Progress")]  # the first officer action also records "took ownership"
    assert all(e.has_actor for e in events)


async def test_scheduled_needs_a_date_and_invalid_moves_are_refused(client):
    officer = await make_authority(client)
    _, iid, _ = await new_complaint(client)
    r = await update(client, officer, iid, status="Scheduled")
    assert r.status_code == 422 and r.json()["error"]["code"] == "date_required"
    assert (await update(client, officer, iid, status="Closed")).json()["error"]["code"] == "citizen_only"
    assert (await update(client, officer, iid, status="Reopened")).json()["error"]["code"] == "citizen_only"
    assert (await update(client, officer, iid, status="Transferred", reason="x")).json()["error"]["code"] == "category_required"
    await resolve_complaint(client, officer, iid)
    r = await update(client, officer, iid, status="Scheduled", scheduled_for="2026-10-20")  # Resolved can only go back to In Progress
    assert r.status_code == 409 and r.json()["error"]["code"] == "invalid_transition"
    assert (await update(client, officer, iid, status="In Progress")).json()["status"] == "In Progress"


# ---------- Resolved needs a note, one complaint at a time ----------


async def test_resolved_needs_a_note_and_bulk_cannot_resolve(client):
    officer = await make_authority(client)
    _, iid, _ = await new_complaint(client)
    r = await update(client, officer, iid, status="Resolved")
    assert r.status_code == 422 and r.json()["error"]["code"] == "reason_required"
    r = await update(client, officer, iid, status="Resolved", reason="Pothole filled and levelled.")
    assert r.status_code == 200 and r.json()["status"] == "Resolved"
    ids = [(await new_complaint(client, north(300 + k * 150)))[1] for k in range(2)]
    r = await client.post("/authority/incidents/bulk", json={"ids": ids, "status": "Resolved"}, headers=officer["headers"])
    assert r.status_code == 422


async def test_bulk_cannot_resolve_but_can_acknowledge_assign_schedule_and_message(client):
    officer = await make_authority(client)
    ids = [(await new_complaint(client, north(k * 150)))[1] for k in range(3)]
    assert (await client.post("/authority/incidents/bulk", json={"ids": ids, "status": "Closed"}, headers=officer["headers"])).status_code == 422
    me = (await client.get("/authority/officers", headers=officer["headers"])).json()["items"][0]["id"]
    r = (await client.post("/authority/incidents/bulk", json={"ids": ids, "status": "Acknowledged", "assigned_to": me, "message": "Team on the way"}, headers=officer["headers"])).json()
    assert r["updated"] == 3 and r["skipped"] == []
    r = (await client.post("/authority/incidents/bulk", json={"ids": ids, "status": "Scheduled", "scheduled_for": "2026-10-21"}, headers=officer["headers"])).json()
    assert r["updated"] == 3
    rows = await fetch("SELECT status::text, assigned_to::text, scheduled_for::text FROM incidents")
    assert {(x[0], x[1], x[2]) for x in rows} == {("Scheduled", me, "2026-10-21")}
    # scheduling without a date is skipped per complaint with the reason, not a half-applied change
    r = (await client.post("/authority/incidents/bulk", json={"ids": ids[:1], "status": "Acknowledged"}, headers=officer["headers"])).json()
    assert r["updated"] == 1  # Scheduled -> Acknowledged is allowed
    ids2 = [(await new_complaint(client, north(2000 + k * 150)))[1] for k in range(2)]
    r = (await client.post("/authority/incidents/bulk", json={"ids": ids2, "status": "Scheduled"}, headers=officer["headers"])).json()
    assert r["updated"] == 0 and {s["code"] for s in r["skipped"]} == {"date_required"}


# ---------- side states ----------


async def test_rejected_and_on_hold_need_a_reason_and_rejected_is_final(client):
    officer = await make_authority(client)
    _, a, _ = await new_complaint(client)
    _, b, _ = await new_complaint(client, north(300))
    assert (await update(client, officer, a, status="On Hold")).json()["error"]["code"] == "reason_required"
    assert (await update(client, officer, a, status="Rejected")).json()["error"]["code"] == "reason_required"
    assert (await update(client, officer, a, status="On Hold", reason="Waiting for the monsoon to end")).json()["status"] == "On Hold"
    assert (await update(client, officer, b, status="Rejected", reason="Private property")).json()["status"] == "Rejected"
    reasons = await fetch("SELECT to_status::text, reason FROM status_events WHERE reason IS NOT NULL ORDER BY id")
    assert [(r[0], r[1]) for r in reasons] == [("On Hold", "Waiting for the monsoon to end"), ("Rejected", "Private property")]
    locked = await update(client, officer, b, status="Acknowledged")
    assert locked.status_code == 409 and locked.json()["error"]["code"] == "status_locked"
    assert (await update(client, officer, a, status="In Progress")).json()["status"] == "In Progress"  # On Hold can resume


async def test_duplicate_needs_a_target_and_moves_the_reporters(client):
    officer = await make_authority(client)
    a, x, _ = await new_complaint(client)
    b, y, _ = await new_complaint(client, north(80))  # 80 m away: its own complaint
    c = await register_citizen(client)
    await client.post("/reports", json=report(), headers=c["headers"])  # c on X ...
    await client.post("/reports", json=report(north(80)), headers=c["headers"])  # ... and on Y
    xpub = (await fetch("SELECT public_id FROM incidents WHERE id = :i", i=x))[0][0]
    assert (await update(client, officer, y, status="Duplicate")).json()["error"]["code"] == "duplicate_target_required"
    assert (await update(client, officer, y, status="Duplicate", duplicate_of="IR-NOPE")).json()["error"]["code"] == "unknown_complaint"
    ypub = (await fetch("SELECT public_id FROM incidents WHERE id = :i", i=y))[0][0]
    assert (await update(client, officer, y, status="Duplicate", duplicate_of=ypub)).json()["error"]["code"] == "same_complaint"
    assert (await update(client, officer, y, status="Duplicate", duplicate_of=xpub)).json()["status"] == "Duplicate"

    # the target now has the reporters of both; its count is the number of DISTINCT people (a, b, c)
    assert (await fetch("SELECT affected_count FROM incidents WHERE id = :i", i=x))[0][0] == 3
    for u in (a, b):
        items = (await client.get("/reports/mine", headers=u["headers"])).json()["items"]
        assert len(items) == 1 and items[0]["public_id"] == xpub
    assert len((await client.get("/reports/mine", headers=c["headers"])).json()["items"]) == 1  # c's two reports collapse to one
    detail = (await client.get(f"/authority/incidents/{x}", headers=officer["headers"])).json()
    assert len(detail["evidence"]) == 3 and detail["citizens"] == 3
    src = (await client.get(f"/authority/incidents/{y}", headers=officer["headers"])).json()
    assert src["duplicate_of"] == xpub and src["status"] == "Duplicate"
    assert (await update(client, officer, y, status="Acknowledged")).status_code == 409  # Duplicate is final


async def test_transfer_changes_category_and_the_department_follows(client):
    officer = await make_authority(client)
    _, iid, _ = await new_complaint(client)
    await update(client, officer, iid, status="In Progress")
    me = (await client.get("/authority/officers", headers=officer["headers"])).json()["items"][0]["id"]
    await update(client, officer, iid, assigned_to=me)
    assert (await update(client, officer, iid, status="Transferred", category="Garbage")).json()["error"]["code"] == "reason_required"
    assert (await update(client, officer, iid, status="Transferred", reason="Not a road problem", category="Pothole")).json()["error"]["code"] == "same_category"
    r = await update(client, officer, iid, status="Transferred", reason="It is a waste dump, not a road defect", category="Garbage")
    assert r.status_code == 200 and r.json()["status"] == "Reported"
    row = (await client.get(f"/authority/incidents/{iid}", headers=officer["headers"])).json()
    assert row["category"] == "Garbage" and row["department"] == "Solid Waste Management" and row["assignee"] is None
    events = await fetch("SELECT from_status::text, to_status::text, reason FROM status_events WHERE incident_id = :i ORDER BY id", i=iid)
    tos = [e[1] for e in events]
    assert tos[-2:] == ["Transferred", "Reported"] and "Roads & Traffic -> Solid Waste Management" in events[-2][2]


# ---------- the citizen answers a Resolved complaint ----------


async def test_citizen_confirms_closed_or_reopens_with_a_reason(client):
    officer = await make_authority(client)
    a, iid, _ = await new_complaint(client)
    stranger = await register_citizen(client)
    assert (await client.post(f"/incidents/{iid}/resolution/confirm", headers=a["headers"])).status_code == 409  # not resolved yet
    await resolve_complaint(client, officer, iid)
    before = (await fetch("SELECT due_at FROM incidents WHERE id = :i", i=iid))[0][0]
    assert (await client.post(f"/incidents/{iid}/resolution/confirm", headers=stranger["headers"])).status_code == 404
    mine = (await client.get("/reports/mine", headers=a["headers"])).json()["items"][0]
    assert mine["status"] == "Resolved" and mine["can_respond"] is True and mine["closes_at"]

    assert (await client.post(f"/incidents/{iid}/resolution/reopen", json={}, headers=a["headers"])).status_code == 422  # a reason is required
    r = await client.post(f"/incidents/{iid}/resolution/reopen", json={"reason": "The pothole is open again after one rain"}, headers=a["headers"])
    assert r.status_code == 200 and r.json()["status"] == "Reopened"
    row = (await fetch("SELECT status::text, reopen_count, resolved_at, due_at, status_reason FROM incidents WHERE id = :i", i=iid))[0]
    assert (row.status, row.reopen_count, row.resolved_at) == ("Reopened", 1, None) and row.due_at == before  # the SLA clock keeps running
    assert row.status_reason.startswith("The pothole")
    ev = (await fetch("SELECT reason, actor_id IS NOT NULL AS a FROM status_events WHERE incident_id = :i AND to_status = 'Reopened'", i=iid))[0]
    assert ev.a and ev.reason.startswith("The pothole")
    assert [m["text"] for m in (await client.get(f"/authority/incidents/{iid}", headers=officer["headers"])).json()["messages"]][-1].startswith("Reopened:")
    # Reopened is open: it can be worked and resolved again, then confirmed
    assert (await resolve_complaint(client, officer, iid)).status_code == 200
    assert (await client.post(f"/incidents/{iid}/resolution/confirm", headers=a["headers"])).json()["status"] == "Closed"
    assert (await update(client, officer, iid, status="In Progress")).status_code == 409  # Closed is final for officers


async def test_no_answer_for_72_hours_closes_it_automatically(client):
    from app import jobs
    from app.db import engine

    officer = await make_authority(client)
    _, fresh, _ = await new_complaint(client)
    _, stale, _ = await new_complaint(client, north(400))
    await resolve_complaint(client, officer, fresh)
    await resolve_complaint(client, officer, stale)
    async with engine.begin() as conn:
        await conn.execute(text("UPDATE incidents SET resolved_at = now() - interval '73 hours' WHERE id = :i"), {"i": stale})
        await conn.execute(text("UPDATE incidents SET resolved_at = now() - interval '71 hours' WHERE id = :i"), {"i": fresh})
    assert await jobs.auto_close() == 1
    statuses = dict((await fetch("SELECT id::text, status::text FROM incidents")))
    assert statuses[str(stale)] == "Closed" and statuses[str(fresh)] == "Resolved"
    ev = (await fetch("SELECT actor_id, reason FROM status_events WHERE incident_id = :i AND to_status = 'Closed'", i=stale))[0]
    assert ev.actor_id is None and "72 hours" in ev.reason


# ---------- one definition of open ----------


async def test_every_query_uses_the_same_definition_of_open(client):
    from app.db import engine

    officer = await make_authority(client)
    a, closed, _ = await new_complaint(client)
    _, rejected, _ = await new_complaint(client, north(300))
    await new_complaint(client, north(600))  # stays Reported: the only open one
    await resolve_complaint(client, officer, closed)
    await client.post(f"/incidents/{closed}/resolution/confirm", headers=a["headers"])
    await update(client, officer, rejected, status="Rejected", reason="Not ours")

    stats = (await client.get("/authority/stats", headers=officer["headers"])).json()
    assert stats["open"] == 1 and stats["by_status"]["Closed"] == 1 and stats["by_status"]["Rejected"] == 1
    assert (await client.get("/authority/incidents", params={"open_only": True}, headers=officer["headers"])).json()["total"] == 1
    m = (await client.get("/authority/map", headers=officer["headers"])).json()
    assert sum(1 for i in m["incidents"] if i["status"] in ("Reported",)) == 1 and sum(x["open"] for x in m["areas"]) == 1
    # a new neighbour is NOT merged into a Closed or Rejected complaint
    b = await register_citizen(client)
    assert (await client.post("/reports", json=report(), headers=b["headers"])).json()["merged"] is False
    c = await register_citizen(client)
    assert (await client.post("/reports", json=report(north(300)), headers=c["headers"])).json()["merged"] is False
    # and cannot "me too" a complaint that is no longer open
    assert (await client.post(f"/incidents/{closed}/confirm", headers=c["headers"])).status_code == 409


async def test_assign_only_approved_officers(client):
    officer = await make_authority(client)
    pending = await make_authority(client, approve=False)
    _ = pending
    citizen = await register_citizen(client)
    _, iid, _ = await new_complaint(client)
    names = (await client.get("/authority/officers", headers=officer["headers"])).json()["items"]
    assert len(names) == 1 and names[0]["is_me"] is True
    assert (await update(client, officer, iid, assigned_to=citizen["user"]["id"])).json()["error"]["code"] == "unknown_officer"
    ok = await update(client, officer, iid, assigned_to=names[0]["id"])
    assert ok.status_code == 200 and ok.json()["assigned_to"] == names[0]["id"]
    row = (await client.get(f"/authority/incidents/{iid}", headers=officer["headers"])).json()
    assert row["assignee"]["name"] == "R. Kulkarni"
    assert any(t["note"] and t["reason"].startswith("Assigned to") for t in row["timeline"])
    # citizens never see internal notes in their timeline
    mine = (await client.get("/reports/mine", headers=(await _first_reporter(client, iid)))).json()["items"][0]
    assert [h["status"] for h in mine["history"]] == ["Reported"]


async def _first_reporter(client, iid):
    from app.db import engine

    async with engine.connect() as conn:
        email = await conn.scalar(text("SELECT u.email FROM reports r JOIN users u ON u.id = r.user_id WHERE r.incident_id = :i"), {"i": iid})
    r = await client.post("/auth/login", json={"email": str(email), "password": "citizen-pass-1", "role": "citizen"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ---------- item 6: chip counts ----------


async def test_chip_counts_equal_the_list_totals_for_the_same_filter(client):
    officer = await make_authority(client)
    me = (await client.get("/authority/officers", headers=officer["headers"])).json()["items"][0]["id"]
    spots = [(SPOT, "Pothole"), (north(300), "Garbage"), (north(600), "Streetlight"), (north(900), "Pothole"), (north(1200), "Garbage"), (north(1500), "Pothole"), (north(1800), "Pothole")]
    ids = [(await new_complaint(client, p, c))[1] for p, c in spots]
    await update(client, officer, ids[1], status="Acknowledged", assigned_to=me)
    await update(client, officer, ids[2], status="Scheduled", scheduled_for="2026-10-25")
    await update(client, officer, ids[3], status="In Progress")
    await resolve_complaint(client, officer, ids[4])
    await resolve_complaint(client, officer, ids[5])
    ca = await _first_reporter(client, ids[5])
    await client.post(f"/incidents/{ids[5]}/resolution/confirm", headers=ca)
    from app.db import engine

    async with engine.begin() as conn:
        await conn.execute(text("UPDATE incidents SET due_at = now() - interval '2 days' WHERE id = :i"), {"i": ids[0]})  # overdue

    views = ["all", "mine", "review", "new", "acknowledged", "scheduled", "in_progress", "resolved", "closed", "overdue", "unassigned"]
    for extra in ({}, {"category": "Pothole"}, {"ward": "Andheri West"}, {"q": "link"}, {"category": "Garbage", "ward": "Andheri West"}):
        chips = (await client.get("/authority/stats", params=extra, headers=officer["headers"])).json()["chips"]
        for v in views:
            total = (await client.get("/authority/incidents", params={**extra, "view": v}, headers=officer["headers"])).json()["total"]
            assert chips[v] == total, (extra, v, chips[v], total)
    chips = (await client.get("/authority/stats", headers=officer["headers"])).json()["chips"]
    assert chips == {"all": 7, "new": 2, "acknowledged": 1, "scheduled": 1, "in_progress": 1, "resolved": 1, "closed": 1, "overdue": 1, "unassigned": 2, "mine": 5, "review": 0}
    stats = (await client.get("/authority/stats", headers=officer["headers"])).json()
    assert stats["overdue"] == 1 and stats["unassigned"] == 2 and sum(stats["by_status"].values()) == 7
