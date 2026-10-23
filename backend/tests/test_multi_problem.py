"""Up to three problems at one place: the extra ones are filed with the main complaint, not refused as repeat reports."""

from conftest import make_authority, register_citizen
from test_workflow import SPOT, report


async def test_extra_problems_are_filed_with_the_main_one(client):
    user = await register_citizen(client)
    main = (await client.post("/reports", json=report(SPOT, "Pothole"), headers=user["headers"])).json()
    # without the batch link a second report at the same spot is still refused (one report per spot)
    assert (await client.post("/reports", json=report(SPOT, "Garbage"), headers=user["headers"])).status_code == 409
    extra = await client.post("/reports", json={**report(SPOT, "Garbage"), "also_of": main["incident_id"]}, headers=user["headers"])
    assert extra.status_code == 201, extra.text
    third = await client.post("/reports", json={**report(SPOT, "Electrical Hazard"), "also_of": main["incident_id"]}, headers=user["headers"])
    assert third.status_code == 201, third.text
    assert len({main["incident_id"], extra.json()["incident_id"], third.json()["incident_id"]}) == 3

    officer = await make_authority(client)
    brief_main = (await client.get(f"/authority/incidents/{main['incident_id']}", headers=officer["headers"])).json()
    assert brief_main["batch"]["is_main"] is True and len(brief_main["batch"]["others"]) == 2
    brief_extra = (await client.get(f"/authority/incidents/{extra.json()['incident_id']}", headers=officer["headers"])).json()
    assert brief_extra["batch"]["main"]["public_id"] == main["incident_public_id"]
    assert [o["category"] for o in brief_extra["batch"]["others"]] == ["Electrical Hazard"]


async def test_a_batch_link_must_be_the_citizens_own_main_report(client):
    owner = await register_citizen(client)
    other = await register_citizen(client)
    main = (await client.post("/reports", json=report(SPOT, "Pothole"), headers=owner["headers"])).json()
    stolen = await client.post("/reports", json={**report(SPOT, "Garbage"), "also_of": main["incident_id"]}, headers=other["headers"])
    assert stolen.status_code == 422 and stolen.json()["error"]["code"] == "invalid_batch"
    far = await client.post("/reports", json={**report((SPOT[0] + 0.01, SPOT[1]), "Garbage"), "also_of": main["incident_id"]}, headers=owner["headers"])
    assert far.status_code == 422
