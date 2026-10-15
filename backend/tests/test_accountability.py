"""Accountability (migration 0018): proof of work when an officer resolves a complaint, abuse checks on citizen reports, the admin audit.
The rest of the suite runs with the proof rule and the photo-reuse rule off (conftest); the `strict` fixture switches them on here."""

import io

import numpy as np
import pytest
from PIL import Image
from sqlalchemy import text

from conftest import admin_headers, make_authority, register_citizen

SPOT = (19.1364, 72.8296)


def north(metres: float, base=SPOT) -> tuple[float, float]:
    return base[0] + metres / 111_320, base[1]


def textured(seed: int, size=(900, 700), quality=90, exif=None) -> bytes:
    """A smooth random picture: unlike a flat image it has a perceptual hash, and the same seed re-saved at another size or quality stays close to itself."""
    base = (np.random.default_rng(seed).random((8, 9, 3)) * 255).astype("uint8")
    buf = io.BytesIO()
    Image.fromarray(base).resize(size, Image.Resampling.BICUBIC).save(buf, "JPEG", quality=quality, **({"exif": exif} if exif else {}))
    return buf.getvalue()


def report(point=SPOT, category="Pothole", **extra) -> dict:
    return {"category": category, "problem_type": "Large", "lat": point[0], "lng": point[1], "address_text": "Link Road", "location_source": "manual", **extra}


async def complaint(client, point=SPOT, user=None, **extra):
    user = user or await register_citizen(client)
    created = (await client.post("/reports", json=report(point, **extra), headers=user["headers"])).json()
    return user, created["incident_id"]


async def proof(client, officer, iid, img, point=SPOT, accuracy=12):
    return await client.post(f"/authority/incidents/{iid}/proof", files=[("photo", ("proof.jpg", img, "image/jpeg"))],
                             data={"lat": str(point[0]), "lng": str(point[1]), "accuracy_m": str(accuracy)}, headers=officer["headers"])


async def resolve(client, officer, iid):
    return await client.post(f"/authority/incidents/{iid}/update", json={"status": "Resolved", "reason": "Pothole filled and levelled."}, headers=officer["headers"])


async def fetch(sql: str, **params):
    from app.db import engine

    async with engine.connect() as conn:
        return (await conn.execute(text(sql), params)).all()


@pytest.fixture
def strict(monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "require_resolution_proof", True)
    monkeypatch.setattr(get_settings(), "photo_reuse_block", True)


# ------------------------------------------------------------------------------------------ resolving needs a site photo


async def test_resolved_needs_a_photo_taken_at_the_site(client, strict):
    officer = await make_authority(client)
    _, iid = await complaint(client)
    r = await resolve(client, officer, iid)
    assert r.status_code == 422 and r.json()["error"]["code"] == "proof_required"

    far = await proof(client, officer, iid, textured(1), point=north(900))  # 900 m away
    assert far.status_code == 422 and far.json()["error"]["code"] == "proof_too_far" and far.json()["error"]["distance_m"] > 800
    vague = await proof(client, officer, iid, textured(1), accuracy=500)
    assert vague.status_code == 422 and vague.json()["error"]["code"] == "proof_inaccurate"
    assert (await resolve(client, officer, iid)).status_code == 422  # failed uploads leave nothing behind
    assert await fetch("SELECT count(*) AS n FROM resolution_proofs") == [(0,)]

    ok = await proof(client, officer, iid, textured(1))
    assert ok.status_code == 201 and ok.json()["distance_m"] < 5 and ok.json()["thumb_url"]
    r = await resolve(client, officer, iid)
    assert r.status_code == 200 and r.json()["status"] == "Resolved"

    # a proof is used up by the Resolved action: after rework a new photo is needed
    assert (await client.post(f"/authority/incidents/{iid}/update", json={"status": "In Progress"}, headers=officer["headers"])).status_code == 200
    assert (await resolve(client, officer, iid)).json()["error"]["code"] == "proof_required"


async def test_the_proof_is_shown_to_officers_and_to_the_reporting_citizen(client, strict):
    officer = await make_authority(client)
    citizen, iid = await complaint(client)
    assert (await proof(client, officer, iid, textured(2))).status_code == 201
    assert (await resolve(client, officer, iid)).status_code == 200
    brief = (await client.get(f"/authority/incidents/{iid}", headers=officer["headers"])).json()
    assert brief["resolution_proof"]["distance_m"] < 5 and brief["resolution_proof"]["url"] and brief["resolution_proof"]["officer"]
    mine = (await client.get("/reports/mine", headers=citizen["headers"])).json()["items"][0]
    assert mine["resolution_proof"]["thumb_url"] and mine["resolution_proof"]["distance_m"] < 5


async def test_a_fix_right_after_the_last_action_is_flagged_for_the_admin(client, strict, monkeypatch):
    officer = await make_authority(client)
    _, fast = await complaint(client)
    await client.post(f"/authority/incidents/{fast}/update", json={"status": "Acknowledged"}, headers=officer["headers"])
    await proof(client, officer, fast, textured(3))
    await resolve(client, officer, fast)
    _, none = await complaint(client, north(300))  # resolved straight from Reported: no earlier action at all
    await proof(client, officer, none, textured(4), point=north(300))
    await resolve(client, officer, none)
    flags = {str(r.incident_id): list(r.flags) for r in await fetch("SELECT incident_id, flags FROM resolution_proofs")}
    assert flags[fast] == ["too_fast"] and flags[none] == ["no_prior_action"]

    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "min_work_minutes", 0)  # with no minimum, an acknowledged complaint resolved later is not "too fast"
    _, later = await complaint(client, north(600))
    await client.post(f"/authority/incidents/{later}/update", json={"status": "Acknowledged"}, headers=officer["headers"])
    await proof(client, officer, later, textured(5), point=north(600))
    await resolve(client, officer, later)
    assert list((await fetch("SELECT flags FROM resolution_proofs WHERE incident_id = :i", i=later))[0].flags) == []


async def test_a_proof_photo_cannot_be_an_old_photo_a_far_photo_or_a_reused_one(client, strict):
    officer = await make_authority(client)
    citizen, iid = await complaint(client)

    old = Image.Exif()
    old[306] = "2020:01:01 10:00:00"  # the camera says this was taken years ago
    r = await proof(client, officer, iid, textured(6, exif=old))
    assert r.status_code == 422 and r.json()["error"]["code"] == "proof_stale"

    elsewhere = Image.Exif()
    elsewhere[0x8825] = {1: "N", 2: (18.0, 54.0, 24.12), 3: "E", 4: (72.0, 48.0, 52.92)}  # Colaba, 20 km from the complaint, phone says it is at the complaint
    r = await proof(client, officer, iid, textured(7, exif=elsewhere))
    assert r.status_code == 422 and r.json()["error"]["code"] == "proof_gps_mismatch"

    # the citizen's own "before" photo (even re-saved smaller) is not an "after" photo
    before = textured(8)
    added = await client.post(f"/reports/{iid}/photos", files=[("photos", ("before.jpg", before, "image/jpeg"))], headers=citizen["headers"])
    assert added.status_code == 201
    r = await proof(client, officer, iid, textured(8, size=(500, 390), quality=60))
    assert r.status_code == 409 and r.json()["error"]["code"] == "photo_reused"
    assert (await proof(client, officer, iid, textured(9))).status_code == 201  # a genuinely new photo is fine


# -------------------------------------------------------------------------------------------------- citizen report checks


async def analyse(client, user, img) -> str:
    media = (await client.post("/ai/analyze", files=[("photos", ("p.jpg", img, "image/jpeg"))], data={"category": "Pothole"}, headers=user["headers"])).json()["media_ids"][0]
    from app.db import engine

    async with engine.begin() as conn:  # the stand-in image model's opinion is irrelevant here
        await conn.execute(text("UPDATE media SET ai_label = NULL, ai_conf = NULL WHERE id = :m"), {"m": media})
    return media


async def test_the_same_photo_cannot_back_two_reports(client, strict):
    a, b = await register_citizen(client), await register_citizen(client)
    photo = textured(11)
    first = await client.post("/reports", json=report(media_ids=[await analyse(client, a, photo)]), headers=a["headers"])
    assert first.status_code == 201
    # another citizen, another place, the same photo sent again as a smaller copy
    again = await client.post("/reports", json=report(north(500), category="Garbage", media_ids=[await analyse(client, b, textured(11, size=(640, 500), quality=55))]), headers=b["headers"])
    assert again.status_code == 409 and again.json()["error"]["code"] == "photo_reused"
    assert "IR-" in again.json()["error"]["message"]
    fresh = await client.post("/reports", json=report(north(500), category="Garbage", media_ids=[await analyse(client, b, textured(12))]), headers=b["headers"])
    assert fresh.status_code == 201


async def test_a_photo_taken_far_from_the_pin_goes_to_review(client, strict):
    officer = await make_authority(client)
    c = await register_citizen(client)
    exif = Image.Exif()
    exif[0x8825] = {1: "N", 2: (18.0, 54.0, 24.12), 3: "E", 4: (72.0, 48.0, 52.92)}  # photo GPS: Colaba; the pin: Andheri
    created = (await client.post("/reports", json=report(media_ids=[await analyse(client, c, textured(13, exif=exif))]), headers=c["headers"])).json()
    brief = (await client.get(f"/authority/incidents/{created['incident_id']}", headers=officer["headers"])).json()
    assert brief["needs_review"] is True and "km from the spot" in brief["review_reason"]


async def test_fake_decisions_are_strikes_that_end_in_a_pause(client):
    officer = await make_authority(client)
    c = await register_citizen(client)
    for k in range(3):
        created = (await client.post("/reports", json=report(north(200 * k)), headers=c["headers"])).json()
        r = await client.post(f"/authority/incidents/{created['incident_id']}/review", json={"decision": "fake"}, headers=officer["headers"])
        assert r.status_code == 200, r.text  # three identical "fake" decisions in a day are normal and not a copy-pasted reason
    assert await fetch("SELECT count(*) AS n FROM report_strikes") == [(3,)]

    flagged = (await client.post("/reports", json=report(north(1000)), headers=c["headers"])).json()  # 3 strikes: still allowed, but goes to review
    brief = (await client.get(f"/authority/incidents/{flagged['incident_id']}", headers=officer["headers"])).json()
    assert brief["needs_review"] is True and "fake" in brief["review_reason"]
    for k in range(2):
        created = (await client.post("/reports", json=report(north(1200 + 200 * k)), headers=c["headers"])).json()
        await client.post(f"/authority/incidents/{created['incident_id']}/review", json={"decision": "fake"}, headers=officer["headers"])
    blocked = await client.post("/reports", json=report(north(3000)), headers=c["headers"])
    assert blocked.status_code == 403 and blocked.json()["error"]["code"] == "account_restricted"
    other = await register_citizen(client)  # another citizen is not affected
    assert (await client.post("/reports", json=report(north(3000)), headers=other["headers"])).status_code == 201


async def test_a_citizen_has_a_daily_report_limit(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "rate_reports_per_day", 2)
    c = await register_citizen(client)
    assert (await client.post("/reports", json=report(north(0)), headers=c["headers"])).status_code == 201
    assert (await client.post("/reports", json=report(north(200)), headers=c["headers"])).status_code == 201
    third = await client.post("/reports", json=report(north(400)), headers=c["headers"])
    assert third.status_code == 429


# ------------------------------------------------------------------------------------------------- holds and the audit


async def test_the_same_hold_reason_cannot_be_pasted_onto_many_complaints(client):
    officer = await make_authority(client)
    for k in range(3):
        _, iid = await complaint(client, north(200 * k))
        r = await client.post(f"/authority/incidents/{iid}/update", json={"status": "On Hold", "reason": "Waiting for budget"}, headers=officer["headers"])
        assert r.status_code == 200
    _, iid = await complaint(client, north(1000))
    r = await client.post(f"/authority/incidents/{iid}/update", json={"status": "On Hold", "reason": "waiting for budget "}, headers=officer["headers"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "reason_repeated"
    r = await client.post(f"/authority/incidents/{iid}/update", json={"status": "On Hold", "reason": "Road is under the metro contractor until March"}, headers=officer["headers"])
    assert r.status_code == 200


async def test_admin_audit_shows_who_fixed_what_and_how(client, strict):
    officer = await make_authority(client)
    _, good = await complaint(client)
    await client.post(f"/authority/incidents/{good}/update", json={"status": "Acknowledged"}, headers=officer["headers"])
    await proof(client, officer, good, textured(21))
    await resolve(client, officer, good)

    assert (await client.get("/admin/audit", headers=officer["headers"])).status_code == 403
    audit = (await client.get("/admin/audit", headers=await admin_headers(client))).json()
    me = audit["officers"][0]  # the only approved officer
    assert me["resolved"] == 1 and me["with_proof"] == 1 and me["too_fast"] == 1
    assert any("right after the last action" in a for a in me["attention"])
    assert audit["proof_required"] is True and audit["proof_radius_m"] == 150
    assert audit["flagged"] and audit["flagged"][0]["public_id"] and "too_fast" in audit["flagged"][0]["flags"]
    assert audit["totals"]["resolved"] == 1 and audit["reporters"]["paused"] == 0
