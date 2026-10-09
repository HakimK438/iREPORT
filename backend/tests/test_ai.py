import io

from PIL import Image
from sqlalchemy import text

from app.ai import pipeline, rules
from conftest import register_citizen


def photo(colour, size=(1600, 1200), fmt="JPEG") -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, colour).save(buf, fmt, quality=90)
    return buf.getvalue()


def files(*photos: bytes):
    return [("photos", (f"p{i}.jpg", p, "image/jpeg")) for i, p in enumerate(photos)]


async def test_analyze_photo_then_report_links_media(client):
    from app.db import engine
    from app.storage import get_storage

    c = await register_citizen(client)
    r = await client.post("/ai/analyze", files=files(photo((230, 20, 20))), data={"lang": "en", "problem_type": "Large"}, headers=c["headers"])
    assert r.status_code == 200, r.text
    a = r.json()
    assert a["category"] == "Pothole" and a["confidence"] > 0.9 and a["uncertain"] is False and a["not_civic"] is False
    assert [t["category"] for t in a["top3"]][0] == "Pothole" and len(a["top3"]) == 3
    # "Main road" is no longer assumed for a pothole: it is checked on the map (authority-v2, DECISIONS.md)
    assert a["severity"] == "High" and "Main road" not in a["flags"] and a["explanation"].startswith("The photo resembles a ")
    assert a["model_version"] == "img-1.0" and a["source"] == "image" and len(a["media_ids"]) == 1
    assert len(get_storage().objects) == 2  # main + thumbnail, nothing else
    assert all(k.startswith(("media/", "thumbs/")) and k.endswith(".webp") for k in get_storage().objects)

    async with engine.connect() as conn:
        assert await conn.scalar(text("SELECT count(*) FROM media WHERE report_id IS NULL")) == 1
    body = {"media_ids": a["media_ids"], "category": "Pothole", "problem_type": "Large", "lat": 19.1, "lng": 72.8, "location_source": "photo", "address_text": "Link Road",
            "ai": {"category": a["category"], "confidence": a["confidence"], "model_version": a["model_version"]}}
    created = (await client.post("/reports", json=body, headers=c["headers"])).json()
    async with engine.connect() as conn:
        assert await conn.scalar(text("SELECT count(*) FROM media WHERE report_id = :r"), {"r": created["report_id"]}) == 1
        assert await conn.scalar(text("SELECT user_corrected FROM reports WHERE id = :r"), {"r": created["report_id"]}) is False
    mine = (await client.get("/reports/mine", headers=c["headers"])).json()["items"][0]
    assert mine["image_url"].startswith("https://storage.test/media/") and mine["thumb_url"].startswith("https://storage.test/thumbs/")
    # the media cannot be reused for another report
    again = await client.post("/reports", json=body, headers=c["headers"])
    assert again.status_code == 422


async def test_not_civic_photo_is_uncertain(client):
    c = await register_citizen(client)
    a = (await client.post("/ai/analyze", files=files(photo((128, 128, 128))), headers=c["headers"])).json()
    assert a["not_civic"] is True and a["uncertain"] is True


async def test_text_only_multilingual(client):
    c = await register_citizen(client)
    a = (await client.post("/ai/analyze", data={"text": "live wire sparking near the school gate"}, headers=c["headers"])).json()
    assert a["category"] == "Electrical Hazard" and a["source"] == "text" and a["media_ids"] == []
    assert a["severity"] == "Critical" and {"Live wiring", "Near school"} <= set(a["flags"])
    hi = (await client.post("/ai/analyze", data={"text": "गली में कचरा कई दिनों से नहीं उठाया", "lang": "hi"}, headers=c["headers"])).json()
    assert hi["category"] == "Garbage"
    mr = (await client.post("/ai/analyze", data={"text": "रस्त्यावर खूप मोठा खड्डा पडला आहे", "lang": "mr"}, headers=c["headers"])).json()
    assert mr["category"] == "Pothole"


async def test_image_and_text_disagree(client):
    c = await register_citizen(client)
    a = (await client.post("/ai/analyze", files=files(photo((20, 20, 230))), data={"text": "exposed live wires sparking from the electric box"}, headers=c["headers"])).json()
    assert a["disagreement"] == {"image": "Water Leakage", "text": "Electrical Hazard"} and a["uncertain"] is True
    assert a["source"] == "image+text" and a["model_version"] == "img-1.0/txt-1.0"


async def test_ai_failure_never_blocks(client, monkeypatch):
    c = await register_citizen(client)

    def boom(_):
        raise RuntimeError("model crashed")

    monkeypatch.setattr(pipeline.models.image, "predict", boom)
    r = await client.post("/ai/analyze", files=files(photo((230, 20, 20))), headers=c["headers"])
    assert r.status_code == 200 and r.json()["uncertain"] is True and len(r.json()["media_ids"]) == 1

    monkeypatch.setattr(pipeline.models, "image", None)
    monkeypatch.setattr(pipeline.models, "text", None)
    r = await client.post("/ai/analyze", files=files(photo((230, 20, 20))), data={"text": "pothole"}, headers=c["headers"])
    a = r.json()
    assert r.status_code == 200 and a["uncertain"] is True and a["category"] is None and a["source"] == "none"


async def test_upload_limits(client):
    c = await register_citizen(client)
    r = await client.post("/ai/analyze", files=files(*(photo((1, 2, 3), (64, 64)) for _ in range(4))), headers=c["headers"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "too_many_photos"
    r = await client.post("/ai/analyze", files=[("photos", ("x.jpg", b"GIF89a....", "image/jpeg"))], headers=c["headers"])
    assert r.status_code == 415
    r = await client.post("/ai/analyze", files=files(photo((230, 20, 20))))
    assert r.status_code == 401


async def test_gps_suggestion_from_exif(client):
    from test_images import jpeg_with_exif

    c = await register_citizen(client)
    a = (await client.post("/ai/analyze", files=files(jpeg_with_exif((1200, 900))), headers=c["headers"])).json()
    assert a["gps_suggestion"] == {"lat": 19.1364, "lng": 72.8296}


async def test_cleanup_jobs_and_priority_refresh(client):
    from app import jobs
    from app.db import engine
    from app.storage import get_storage

    c = await register_citizen(client)
    a = (await client.post("/ai/analyze", files=files(photo((230, 20, 20)), photo((20, 230, 20))), headers=c["headers"])).json()
    assert len(get_storage().objects) == 4
    keep = (await client.post("/reports", json={"media_ids": a["media_ids"][:1], "category": "Pothole", "lat": 19.1, "lng": 72.8, "location_source": "gps"}, headers=c["headers"])).json()
    async with engine.begin() as conn:
        await conn.execute(text("UPDATE media SET created_at = now() - interval '2 hours'"))
    assert await jobs.cleanup_drafts() == 1
    assert len(get_storage().objects) == 2

    async with engine.begin() as conn:
        await conn.execute(text("UPDATE incidents SET status = 'Resolved', resolved_at = now() - interval '400 days'"))
    assert await jobs.expire_full_images() == 1
    async with engine.connect() as conn:
        row = (await conn.execute(text("SELECT storage_key, thumb_key FROM media"))).one()
    assert row.storage_key == row.thumb_key and list(get_storage().objects) == [row.thumb_key]

    async with engine.begin() as conn:
        # the hourly job re-scores open complaints: a stale score is corrected (age no longer matters, risk does)
        await conn.execute(text("UPDATE incidents SET status = 'Reported', priority_score = 0, risk = 1 WHERE id = :i"), {"i": keep["incident_id"]})
    assert await jobs.refresh_priorities() == 1
    async with engine.connect() as conn:
        after, risk = (await conn.execute(text("SELECT priority_score, risk FROM incidents WHERE id = :i"), {"i": keep["incident_id"]})).one()
    assert after > 0 and risk >= 3  # pothole: impact 3 x likelihood 1 at least


def test_rules_only_add_flags_and_raise_severity():
    flags, severe = rules.cue_flags("खुला मैनहोल, रात में अंधेरा, स्कूल के पास")
    assert {"Night-time hazard", "Near school"} <= set(flags) and severe
    flags, _ = rules.cue_flags("विजेची तार तुटून पडली, शॉक लागतो, शाळेजवळ")
    assert {"Live wiring", "Near school"} <= set(flags)
    assert rules.severity_for("Garbage", "Overflowing", []) == "High"
    assert rules.severity_for("Garbage", "Uncollected garbage", ["Injury reported"]) == "Critical"
    assert rules.severity_for("Pothole", "Small", []) == "Low"
    assert rules.severity_for("Pothole", "Small", ["Main road"]) == "Medium"
    sev, flags = rules.assess("Pothole", "Small", None, ["Near hospital"])
    assert sev == "High" and flags == ["Near hospital"]
    assert rules.cue_flags("the current status is pending")[0] == []
    assert rules.cue_flags("railing chhune pe current laga")[0] == ["Live wiring"]
    assert rules.cue_flags("") == ([], False)


async def test_text_model_is_small_and_fast(client):
    import time
    from pathlib import Path

    m = pipeline.models.text
    assert m is not None
    assert Path("models/txt-1.0.npz").stat().st_size < 2 * 1024 * 1024
    start = time.perf_counter()
    for _ in range(100):
        m.predict("garbage not collected near the market for a week")
    assert (time.perf_counter() - start) / 100 < 0.005  # under 5 ms per request
