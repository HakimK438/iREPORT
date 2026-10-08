"""Tests for the user-testing fixes: incident location vs profile, photo linking, AI honesty, NLP, hotspots."""

import io

import pytest
from PIL import Image
from sqlalchemy import text

from app.ai import pipeline, rules
from conftest import admin_headers, make_authority, register_citizen

ANDHERI = (19.1364, 72.8296)  # profile area A
COLABA = (18.9067, 72.8147)  # incident location B


def jpeg(colour, size=(1200, 900)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, colour).save(buf, "JPEG", quality=90)
    return buf.getvalue()


def files(*photos: bytes):
    return [("photos", (f"p{i}.jpg", p, "image/jpeg")) for i, p in enumerate(photos)]


def body(lat, lng, **extra) -> dict:
    return {"category": "Pothole", "problem_type": "Large", "lat": lat, "lng": lng, "location_source": "manual", "address_text": "Test Road", **extra}


# ---------- A1: incident location is never the profile location ----------


async def test_incident_location_is_b_profile_stays_a(client):
    from app.db import engine

    officer = await make_authority(client)
    c = await register_citizen(client, area="Andheri West")  # profile = A
    created = (await client.post("/reports", json=body(*COLABA), headers=c["headers"])).json()
    assert created["area"] == "Colaba"  # derived from the incident point, not from the profile

    async with engine.connect() as conn:
        lat, lng = (await conn.execute(text("SELECT ST_Y(location::geometry), ST_X(location::geometry) FROM incidents WHERE id = :i"), {"i": created["incident_id"]})).one()
        source = await conn.scalar(text("SELECT location_source FROM reports WHERE id = :r"), {"r": created["report_id"]})
    assert (round(lat, 4), round(lng, 4)) == COLABA and source == "manual"

    rows = (await client.get("/authority/incidents", headers=officer["headers"])).json()["items"]
    assert (round(rows[0]["lat"], 4), round(rows[0]["lng"], 4)) == COLABA and rows[0]["area"] == "Colaba"
    pub = (await client.get(f"/incidents/{created['incident_id']}")).json()
    assert (round(pub["lat"], 4), round(pub["lng"], 4)) == COLABA
    detail = (await client.get(f"/authority/incidents/{created['incident_id']}", headers=officer["headers"])).json()
    assert (round(detail["lat"], 4), round(detail["lng"], 4)) == COLABA
    me = (await client.get("/me", headers=c["headers"])).json()
    assert me["area"] == "Andheri West"  # profile unchanged


async def test_location_source_is_required(client):
    c = await register_citizen(client)
    payload = body(*COLABA)
    del payload["location_source"]
    assert (await client.post("/reports", json=payload, headers=c["headers"])).status_code == 422
    assert (await client.post("/reports", json=body(*COLABA, location_source="profile"), headers=c["headers"])).status_code == 422


async def test_ward_ignores_client_area_and_profile(client):
    c = await register_citizen(client, area="Borivali")
    created = (await client.post("/reports", json=body(*COLABA, area="Borivali"), headers=c["headers"])).json()
    assert created["area"] == "Colaba"


async def test_photo_gps_suggestion_is_returned_for_exif(client):
    img = Image.new("RGB", (800, 600), (200, 20, 20))
    exif = Image.Exif()
    exif[0x8825] = {1: "N", 2: (18.0, 54.0, 24.12), 3: "E", 4: (72.0, 48.0, 52.92)}
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif)
    c = await register_citizen(client)
    a = (await client.post("/ai/analyze", files=files(buf.getvalue()), headers=c["headers"])).json()
    assert a["gps_suggestion"] and abs(a["gps_suggestion"]["lat"] - 18.9067) < 0.001


# ---------- A2: image <-> report link ----------


async def test_two_reports_two_images_stay_linked(client):
    from app.db import engine

    c = await register_citizen(client)
    red = (await client.post("/ai/analyze", files=files(jpeg((230, 20, 20))), headers=c["headers"])).json()
    green = (await client.post("/ai/analyze", files=files(jpeg((20, 200, 20))), headers=c["headers"])).json()
    r1 = (await client.post("/reports", json=body(*COLABA, media_ids=red["media_ids"]), headers=c["headers"])).json()
    r2 = (await client.post("/reports", json=body(19.2, 72.85, category="Garbage", media_ids=green["media_ids"]), headers=c["headers"])).json()
    async with engine.connect() as conn:
        rows = dict((await conn.execute(text("SELECT report_id::text, id::text FROM media"))).all())
    assert rows[str(r1["report_id"])] == red["media_ids"][0] and rows[str(r2["report_id"])] == green["media_ids"][0]

    mine = {i["report_id"]: i for i in (await client.get("/reports/mine", headers=c["headers"])).json()["items"]}
    assert mine[r1["report_id"]]["image_url"] != mine[r2["report_id"]]["image_url"]
    # the public feed links each incident to its own photo too
    feed = {i["id"]: i for i in (await client.get("/incidents/nearby", params={"lat": COLABA[0], "lng": COLABA[1], "radius": 50000, "limit": 50})).json()["items"]}
    assert feed[r1["incident_id"]]["thumb_url"] and feed[r1["incident_id"]]["thumb_url"] != feed[r2["incident_id"]]["thumb_url"]

    # another citizen cannot attach my draft photo to their report
    other = await register_citizen(client)
    extra = (await client.post("/ai/analyze", files=files(jpeg((20, 20, 200))), headers=c["headers"])).json()
    steal = await client.post("/reports", json=body(19.0, 72.8, media_ids=extra["media_ids"]), headers=other["headers"])
    assert steal.status_code == 422

    officer = await make_authority(client)
    d1 = (await client.get(f"/authority/incidents/{r1['incident_id']}", headers=officer["headers"])).json()
    lst = {i["id"]: i for i in (await client.get("/authority/incidents", headers=officer["headers"])).json()["items"]}
    assert len(d1["images"]) == 1 and lst[r1["incident_id"]]["thumb_url"] == d1["images"][0]["thumb_url"]


# ---------- A3 / A4: AI honesty ----------


async def test_analyze_contract_with_image_model(client):
    c = await register_citizen(client)
    a = (await client.post("/ai/analyze", files=files(jpeg((230, 20, 20))), data={"text": "big pothole for 4 days"}, headers=c["headers"])).json()
    for key in ("category", "confidence", "source", "model_version", "uncertain", "not_civic", "severity", "flags", "explanation", "top3", "ai_available", "models", "photo_quality", "nlp", "agreement"):
        assert key in a, key
    assert a["ai_available"] is True and a["source"] in ("image", "image+text") and a["confidence"] is not None
    assert a["models"]["image"] == "used" and a["photo_quality"][0]["label"] in ("good", "blurry", "dark", "low resolution")
    assert a["nlp"]["duration"]["days"] == 4
    # (c) image + text: both per-source confidences, the blend sits between them
    assert a["image_model_active"] is True and a["image_confidence"] is not None and a["text_confidence"] is not None
    assert a["department"]


async def test_analyze_without_image_model_is_text_only(client, monkeypatch):
    monkeypatch.setattr(pipeline.models, "image", None)
    c = await register_citizen(client)
    a = (await client.post("/ai/analyze", files=files(jpeg((230, 20, 20))), data={"text": "garbage pile not collected for a week"}, headers=c["headers"])).json()
    assert a["source"] == "text" and a["ai_available"] is True and a["confidence"] is not None
    assert a["models"]["image"] == "unavailable" and a["model_version"].startswith("txt")
    assert "photo resembles" not in (a["explanation"] or "")  # no photo sentence without an image model
    assert len(a["media_ids"]) == 1  # the photo is still stored
    # (b) text only
    assert a["image_confidence"] is None and a["text_confidence"] == a["confidence"] and a["image_model_active"] is False


async def test_analyze_nothing_available(client, monkeypatch):
    monkeypatch.setattr(pipeline.models, "image", None)
    monkeypatch.setattr(pipeline.models, "text", None)
    c = await register_citizen(client)
    a = (await client.post("/ai/analyze", files=files(jpeg((230, 20, 20))), headers=c["headers"])).json()
    assert a["ai_available"] is False and a["source"] == "none" and a["confidence"] is None and a["category"] is None
    # (a) nothing available: no per-source numbers, and the response is still 200
    assert a["image_confidence"] is None and a["text_confidence"] is None and a["image_model_active"] is False


async def test_corrupt_photo_does_not_discard_the_others(client):
    c = await register_citizen(client)
    r = await client.post("/ai/analyze", files=[("photos", ("bad.jpg", b"\xff\xd8\xff not an image", "image/jpeg")), *files(jpeg((230, 20, 20)))[:1]], headers=c["headers"])
    assert r.status_code == 200, r.text
    a = r.json()
    assert len(a["media_ids"]) == 1 and a["photo_errors"][0]["index"] == 0 and a["category"] == "Pothole"
    only_bad = await client.post("/ai/analyze", files=[("photos", ("bad.jpg", b"\xff\xd8\xff not an image", "image/jpeg"))], headers=c["headers"])
    assert only_bad.status_code == 415


async def test_multi_photo_is_averaged(client):
    c = await register_citizen(client)
    a = (await client.post("/ai/analyze", files=files(jpeg((230, 20, 20)), jpeg((230, 20, 20))), headers=c["headers"])).json()
    assert a["category"] == "Pothole" and len(a["media_ids"]) == 2 and len(a["photo_quality"]) == 2


async def test_photo_quality_labels():
    from app.images import photo_quality

    assert photo_quality(Image.new("RGB", (1000, 800), (10, 10, 10)))["label"] == "dark"
    assert photo_quality(Image.new("RGB", (1000, 800), (128, 128, 128)))["label"] == "blurry"  # flat image has no edges
    noisy = Image.effect_noise((1000, 800), 80).convert("RGB")
    assert photo_quality(noisy)["label"] == "good"
    assert photo_quality(Image.effect_noise((300, 300), 80).convert("RGB"))["label"] == "low resolution"


async def test_agreement_is_reported_when_both_models_run(client):
    c = await register_citizen(client)
    a = (await client.post("/ai/analyze", files=files(jpeg((230, 20, 20))), data={"text": "big pothole on the road"}, headers=c["headers"])).json()
    assert a["agreement"] == "agree" and a["disagreement"] is None
    d = (await client.post("/ai/analyze", files=files(jpeg((230, 20, 20))), data={"text": "garbage is overflowing from the bin, uncollected waste"}, headers=c["headers"])).json()
    assert d["agreement"] in ("disagree", None)
    # (d) per-source numbers are reported separately even when the models disagree
    assert d["image_confidence"] is not None and d["text_confidence"] is not None


async def test_report_stores_ai_agreement_and_message_for_authority(client):
    officer = await make_authority(client)
    c = await register_citizen(client)
    payload = body(*COLABA, citizen_message="Please come before the school opens", description="pothole near the school gate for 4 days",
                   ai={"category": "Pothole", "confidence": 0.8, "model_version": "img-1.0/txt-1.0", "source": "image+text", "disagreement": {"image": "Pothole", "text": "Garbage"}})
    created = (await client.post("/reports", json=payload, headers=c["headers"])).json()
    assert created["department"] == "Roads & Traffic"
    row = (await client.get("/authority/incidents", headers=officer["headers"])).json()["items"][0]
    assert row["ai"]["agreement"] == "disagree" and row["ai"]["source"] == "image+text" and row["citizen_message"].startswith("Please come")
    assert row["department"] == "Roads & Traffic" and row["nlp"]["duration"]["days"] == 4 and row["reasons"]
    detail = (await client.get(f"/authority/incidents/{created['incident_id']}", headers=officer["headers"])).json()
    assert detail["reporters"][0]["citizen_message"].startswith("Please come") and detail["reporters"][0]["nlp"]["flags"] == ["Near school"]


# ---------- B1: NLP ----------


@pytest.mark.parametrize("sentence,duration_days,obstruction,hazard", [
    ("Big pothole for 4 days, bikes are slipping", 4, None, "two-wheelers"),
    ("garbage blocking the road since last week", 7, "road", None),
    ("pothole is there for two weeks near main road", 14, None, None),
    ("चार दिन से गड्ढा है, बच्चे गिरते हैं", 4, None, "children"),
    ("४ दिवस झाले खड्डा आहे, दुचाकी घसरतात", 4, None, "two-wheelers"),
    ("char din se paani bhar gaya hai, gadi nikalti nahi", 4, None, "vehicles"),
    ("2 mahine se footpath par kachra", 60, "footpath", None),
    ("garbage blocking the gate of my building", None, "entrance", None),
    ("live wire hanging near hospital", None, None, "live wire"),
    ("पाणी साचले आहे दोन आठवडे", 14, None, "water"),
    ("The pothole has been lying here for four days and is blocking the footpath", 4, "footpath", None),
    ("for a week now the drain is blocked", 7, None, None),
    ("pichle 3 din se light band hai", 3, None, None),
    ("एक हफ्ते से फुटपाथ पर कचरा", 7, "footpath", None),
    ("blocking the road for 5 days", 5, "road", None),
    ("फुटपाथवर कचरा दोन महिन्यांपासून", 60, "footpath", None),
    ("it has been 10 days", 10, None, None),
    ("3 din se road par paani", 3, None, "water"),
    # negatives: nothing stated -> None, never a guess
    ("garbage here", None, None, None),
    ("the road is bad", None, None, None),
    ("कई दिनों से कचरा पड़ा है", None, None, None),
    ("खड्डा आहे", None, None, None),
    ("there is a hole", None, None, None),
])
def test_nlp_extraction(sentence, duration_days, obstruction, hazard):
    n = rules.extract_nlp(sentence, "Medium", [])
    assert (n["duration"] or {}).get("days") == duration_days
    assert n["obstruction"] == obstruction
    assert (hazard in (n["hazard"] or [])) if hazard else True


def test_nlp_returns_none_when_not_stated():
    n = rules.extract_nlp("the road is bad", "Medium", [])
    assert n["duration"] is None and n["obstruction"] is None and n["hazard"] is None
    assert rules.extract_nlp("", "Medium", []) is None and rules.extract_nlp(None, "Low", []) is None
    assert rules.extract_nlp("live wire sparking", "Medium", [])["urgency"] == "High"


# ---------- A6 / B2 / B5 ----------


async def test_contribution_counts_are_real(client):
    a, b = await register_citizen(client), await register_citizen(client)
    iid = (await client.post("/reports", json=body(*COLABA), headers=a["headers"])).json()["incident_id"]
    c0 = (await client.get("/me/contribution", headers=a["headers"])).json()
    assert c0["reports_submitted"] == 1 and c0["reports_verified"] == 0 and c0["label"] is None
    await client.post(f"/incidents/{iid}/confirm", headers=b["headers"])
    assert (await client.get("/me/contribution", headers=a["headers"])).json()["reports_verified"] == 1
    assert (await client.get("/me/contribution", headers=b["headers"])).json()["confirmations_given"] == 1


async def test_hotspots_and_admin_overview(client):
    officer = await make_authority(client)
    citizens = [await register_citizen(client) for _ in range(6)]
    # three open incidents ~220 m apart in Colaba -> one DBSCAN hotspot (eps 400 m, min 3)
    await client.post("/reports", json=body(*COLABA), headers=citizens[0]["headers"])
    await client.post("/reports", json=body(COLABA[0] + 0.002, COLABA[1], category="Garbage"), headers=citizens[1]["headers"])
    await client.post("/reports", json=body(COLABA[0] + 0.004, COLABA[1], category="Garbage"), headers=citizens[3]["headers"])
    # one far away (not clustered) and one in Colaba that gets resolved (excluded)
    await client.post("/reports", json=body(*ANDHERI, category="Electrical Hazard", description="live wire sparking"), headers=citizens[2]["headers"])
    done = (await client.post("/reports", json=body(COLABA[0] + 0.003, COLABA[1] + 0.002, category="Streetlight"), headers=citizens[4]["headers"])).json()
    await client.post(f"/authority/incidents/{done['incident_id']}/update", json={"status": "Resolved"}, headers=officer["headers"])
    hs = (await client.get("/authority/hotspots", headers=officer["headers"])).json()["items"]
    assert len(hs) == 1
    h = hs[0]
    assert h["area"] == "Colaba" and h["incident_count"] == 3 and h["unique_citizens"] == 3 and h["confirmations"] == 0
    assert {c["category"]: c["count"] for c in h["categories"]} == {"Pothole": 1, "Garbage": 2} and len(h["incident_ids"]) == 3
    assert done["incident_id"] not in h["incident_ids"] and 0 <= h["impact_score"] <= 100
    assert (await client.get("/authority/hotspots", headers=citizens[5]["headers"])).status_code == 403

    admin = await admin_headers(client)
    ov = (await client.get("/admin/overview", headers=admin)).json()
    assert ov["unresolved_critical"] >= 1 and ov["hotspots"] and any(c["recommendation"] == "Pothole → Roads & Traffic" for c in ov["categories"])
    assert next(d for d in ov["departments"] if d["department"] == "Roads & Traffic")["open"] == 1
    assert (await client.get("/admin/overview", headers=officer["headers"])).status_code == 403


def test_impact_score_formula():
    from app.incidents import impact_score

    assert impact_score(80, 3) == round(0.6 * 80 + 0.4 * 24)
    assert impact_score(100, 20) == 100  # count part is capped, total is capped
    assert impact_score(0, 3) == round(0.4 * 24)


async def test_geo_resolve_is_public_and_gis_derived(client):
    r = await client.get("/geo/resolve", params={"lat": COLABA[0], "lng": COLABA[1]})
    assert r.status_code == 200
    j = r.json()
    assert j["area"] == "Colaba" and j["departments"]["Pothole"] == "Roads & Traffic" and j["method"] == "nearest_area_centre"
    far = (await client.get("/geo/resolve", params={"lat": 28.6, "lng": 77.2})).json()  # Delhi: outside the seeded areas
    assert far["area"] is None


async def test_map_data_areas_and_dbscan_clusters(client):
    officer = await make_authority(client)
    cits = [await register_citizen(client) for _ in range(4)]
    # two problems ~220 m apart in Colaba -> one cluster; one alone in Andheri -> no cluster
    await client.post("/reports", json=body(*COLABA), headers=cits[0]["headers"])
    await client.post("/reports", json=body(COLABA[0] + 0.002, COLABA[1], category="Garbage"), headers=cits[1]["headers"])
    await client.post("/reports", json=body(*ANDHERI, category="Streetlight"), headers=cits[2]["headers"])
    m = (await client.get("/authority/map", headers=officer["headers"])).json()
    assert len(m["incidents"]) == 3 and all(i["lat"] and i["lng"] for i in m["incidents"])
    assert len(m["clusters"]) == 1 and m["clusters"][0]["size"] == 2 and m["clusters"][0]["areas"] == ["Colaba"]
    in_cluster = [i for i in m["incidents"] if i["cluster"] is not None]
    assert {i["area"] for i in in_cluster} == {"Colaba"} and next(i for i in m["incidents"] if i["area"] == "Andheri West")["cluster"] is None
    assert {a["area"]: a["open"] for a in m["areas"]} == {"Colaba": 2, "Andheri West": 1}
    assert m["method"]["eps_m"] == 300
    # admin gets the same map and a read-only detail without phone numbers
    admin = await admin_headers(client)
    assert len((await client.get("/admin/map", headers=admin)).json()["incidents"]) == 3
    d = (await client.get(f"/admin/incidents/{m['incidents'][0]['id']}", headers=admin)).json()
    assert d["lat"] and all(r["phone"] is None for r in d["reporters"])
    assert (await client.get("/admin/map", headers=officer["headers"])).status_code == 403
    assert (await client.get("/authority/map", headers=admin)).status_code == 403


# ---------- Quick answers ----------


async def test_answers_validated_stored_and_raise_flags(client):
    c = await register_citizen(client)
    officer = await make_authority(client)
    bad = await client.post("/reports", json=body(*COLABA, answers={"colour": "red"}), headers=c["headers"])
    assert bad.status_code == 422
    bad_value = await client.post("/reports", json=body(*COLABA, answers={"blocks": "maybe"}), headers=c["headers"])
    assert bad_value.status_code == 422
    r = await client.post("/reports", json=body(*COLABA, category="Garbage", answers={"blocks": "foot", "people": "many"}), headers=c["headers"])
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["affected_count"] == 1  # "people" is stored, never used as a count
    detail = (await client.get(f"/authority/incidents/{created['incident_id']}", headers=officer["headers"])).json()
    assert "Blocks footpath" in detail["flags"]
    stored = await _answers_of(created["report_id"])
    assert stored == {"blocks": "foot", "people": "many"}


async def test_report_without_answers_still_works(client):
    c = await register_citizen(client)
    r = await client.post("/reports", json=body(*COLABA), headers=c["headers"])
    assert r.status_code == 201 and (await _answers_of(r.json()["report_id"])) is None


async def _answers_of(report_id):
    from app.db import SessionLocal

    async with SessionLocal() as db:
        return await db.scalar(text("SELECT answers FROM reports WHERE id = :i"), {"i": report_id})


async def test_me_summary_counts_and_level(client):
    a, b = await register_citizen(client), await register_citizen(client)
    officer = await make_authority(client)
    s0 = (await client.get("/me/summary", headers=a["headers"])).json()
    assert s0 == {"reports_submitted": 0, "incidents_resolved": 0, "confirmations_received": 0, "level": None}
    iid = (await client.post("/reports", json=body(*COLABA), headers=a["headers"])).json()["incident_id"]
    await client.post(f"/incidents/{iid}/confirm", headers=b["headers"])
    s1 = (await client.get("/me/summary", headers=a["headers"])).json()
    assert s1["reports_submitted"] == 1 and s1["confirmations_received"] == 1 and s1["incidents_resolved"] == 0 and s1["level"] is None
    # the confirming neighbour did not start the incident, so receives nothing
    assert (await client.get("/me/summary", headers=b["headers"])).json()["confirmations_received"] == 0
    await client.post(f"/authority/incidents/{iid}/update", json={"status": "Resolved"}, headers=officer["headers"])
    s2 = (await client.get("/me/summary", headers=a["headers"])).json()
    assert s2["incidents_resolved"] == 1 and s2["level"] == "contributor"
    assert (await client.get("/me/summary")).status_code == 401


async def test_image_model_skipped_for_categories_it_was_not_trained_on(client, monkeypatch):
    """A model trained on a subset of classes must not override a category it has never seen."""
    monkeypatch.setattr(pipeline.models.image, "labels", ["Pothole", "Road Damage", "Streetlight", "Garbage", "Other", "not_civic"])
    c = await register_citizen(client)
    a = (await client.post("/ai/analyze", files=files(jpeg((230, 20, 20))), data={"category": "Drainage"}, headers=c["headers"])).json()
    assert a["models"]["image"] == "category_not_covered" and a["image_confidence"] is None and a["image_model_active"] is True
    assert len(a["media_ids"]) == 1  # the photo is still stored as evidence
