"""Development only: add example incidents whose photos are the training-dataset images the shipped image
model is MOST confident about (and whose predicted class matches the folder label). No training happens.

    python -m scripts.seed_dataset_photos /path/to/ml/data/images [--count 5] [--min-conf 0.85]

Each example report is marked with reports.sample_confidence so the app can say "example photo from the
training dataset". Water Leakage and Electrical have no dataset photos, so they get no example.
"""

import argparse
import asyncio
from pathlib import Path

from sqlalchemy import select, text

from app import images, refdata
from app.ai.image_model import ImageClassifier
from app.db import SessionLocal, engine
from app.incidents import create_report
from app.models import Media, User
from app.refdata import ref
from app.schemas import AiIn, ReportIn
from app.security import hash_password
from app.storage import get_storage, new_keys

FOLDER_TO_CATEGORY = {"Pothole": "Pothole", "Road Damage": "Pothole", "Garbage": "Garbage", "Streetlight": "Streetlight", "Other": "Other"}
# Distinct real Mumbai spots (more than 50 m apart, so the merge rule keeps them separate).
SPOTS = [
    ("Pothole", "Versova", 19.1311, 72.8148, "Versova Link Road", "Large pothole on the main road"),
    ("Pothole", "Kurla", 19.0728, 72.8790, "LBS Marg, Kurla", "Road surface broken near the bus stop"),
    ("Garbage", "Chembur", 19.0540, 72.8990, "Chembur Naka", "Garbage not collected for days"),
    ("Garbage", "Mulund", 19.1730, 72.9560, "Mulund station road", "Overflowing waste on the footpath"),
    ("Streetlight", "Powai", 19.1190, 72.9050, "Hiranandani Powai", "Street lights are off at night"),
    ("Streetlight", "Sion", 19.0420, 72.8640, "Sion circle", "Street light not working"),
    ("Other", "Worli", 19.0170, 72.8190, "Worli sea face", "Damaged public property"),
    ("Other", "Bhandup", 19.1450, 72.9400, "Bhandup station road", "Broken public fixture"),
    ("Pothole", "Ghatkopar", 19.0860, 72.9120, "Ghatkopar east", "Pothole near the junction"),
    ("Garbage", "Dahisar", 19.2510, 72.8600, "Dahisar check naka", "Illegal dumping at the roadside"),
]


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("images", type=Path)
    ap.add_argument("--count", type=int, default=5)
    ap.add_argument("--min-conf", type=float, default=0.85)
    args = ap.parse_args()
    models = Path(__file__).resolve().parent.parent / "models"
    clf = ImageClassifier(models / "img-1.0.onnx", models / "img-1.0.json")

    scored = []  # (confidence, category, path)
    for split in ("test", "val"):
        for folder, category in FOLDER_TO_CATEGORY.items():
            for p in (args.images / split / folder).glob("*.jpg"):
                try:
                    from PIL import Image
                    probs = clf.predict(Image.open(p))
                except Exception:  # noqa: BLE001 - skip unreadable files
                    continue
                best = max(probs, key=probs.get)
                if FOLDER_TO_CATEGORY.get(best) == category and probs[best] >= args.min_conf:
                    scored.append((probs[best], category, p))
    scored.sort(key=lambda t: -t[0])
    # Top confidence overall, at most 2 per category so the examples are not all potholes.
    picked, per = [], {}
    for conf, cat, p in scored:
        if per.get(cat, 0) < 2 and len(picked) < args.count:
            picked.append((conf, cat, p))
            per[cat] = per.get(cat, 0) + 1
    print("selected:", [(round(c, 3), k, p.name) for c, k, p in picked])

    storage = get_storage()
    await storage.ensure_bucket()
    async with SessionLocal() as db:
        await refdata.load(db)
        user = await db.scalar(select(User).where(User.email == "dataset-sample@example.com"))
        if user is None:
            user = User(role="citizen", name="Dataset example", email="dataset-sample@example.com", password_hash=hash_password("!no-login-sample"), ward_id=None)
            db.add(user)
            await db.flush()
        if await db.scalar(text("SELECT count(*) FROM reports WHERE sample_confidence IS NOT NULL")):
            print("example incidents already exist; nothing added")
            return
        used: dict[str, int] = {}
        for conf, cat, p in picked:
            spot = next(s for s in SPOTS if s[0] == cat and s not in used)
            used[spot] = 1
            proc = images.process(p.read_bytes())
            key, thumb_key = new_keys()
            await storage.put(key, proc.main, "image/webp")
            await storage.put(thumb_key, proc.thumb, "image/webp")
            m = Media(uploader_id=user.id, storage_key=key, thumb_key=thumb_key, width=proc.width, height=proc.height, bytes=len(proc.main))
            db.add(m)
            await db.flush()
            res = await create_report(db, user.id, ReportIn(
                media_ids=[m.id], category=cat, problem_type="Damaged", description=spot[5], lat=spot[2], lng=spot[3],
                address_text=spot[4], location_source="manual",
                ai=AiIn(category=cat, confidence=round(conf, 4), model_version=clf.version, source="image"),
            ))
            await db.execute(text("UPDATE reports SET sample_confidence = :c WHERE id = :r"), {"c": conf, "r": res["report_id"]})
        await db.commit()
    await engine.dispose()
    print(f"added {len(picked)} example incidents")


if __name__ == "__main__":
    asyncio.run(main())
