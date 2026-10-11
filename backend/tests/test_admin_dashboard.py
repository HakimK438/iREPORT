"""The admin dashboard shows plain counts: they must equal what is in the tables."""

from conftest import admin_headers, make_authority, resolve_complaint
from test_workflow import fetch, new_complaint, north, update


async def test_admin_dashboard_numbers_are_real_counts(client):
    officer = await make_authority(client)
    ids = [(await new_complaint(client, north(300 * k, (19.1364, 72.8296))))[1] for k in range(4)]
    await update(client, officer, ids[0], status="Acknowledged")
    await resolve_complaint(client, officer, ids[1])
    admin = await admin_headers(client)
    d = (await client.get("/admin/performance", headers=admin)).json()
    s = d["summary"]
    assert s["total"] == 4 and s["open"] == 3 and s["resolved"] == 1 and s["awaiting_citizen"] == 1
    assert s["critical"] + s["high"] + s["moderate"] + s["routine"] == s["open"]
    assert s["unassigned"] == 2 and s["reports"] == 4 and s["officers"] == 1
    assert s["resolution_rate"] == 25 and s["new_7d"] == 4
    assert sum(a["total"] for a in d["areas"]) == 4 and sum(c["total"] for c in d["categories"]) == 4
    assert len(d["weeks"]) == 12 and d["weeks"][-1]["reported"] == 4 and d["weeks"][-1]["open_at_end"] == 3
    # the same totals straight from the table
    assert (await fetch("SELECT count(*) FROM incidents"))[0][0] == s["total"]
    assert (await client.get("/admin/performance", headers=officer["headers"])).status_code == 403


async def test_an_officer_who_works_a_complaint_owns_it(client):
    officer = await make_authority(client)
    _, iid, _ = await new_complaint(client)
    assert (await update(client, officer, iid, status="In Progress")).status_code == 200
    row = (await fetch("SELECT assigned_to::text FROM incidents WHERE id = CAST(:i AS uuid)", i=iid))[0]
    assert row[0] == officer["user"]["id"]
    detail = (await client.get(f"/authority/incidents/{iid}", headers=officer["headers"])).json()
    assert detail["assignee"]["id"] == officer["user"]["id"]
    assert any(t["note"] and "took ownership" in t["reason"] for t in detail["timeline"])
