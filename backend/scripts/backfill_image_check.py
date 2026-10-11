"""Run the image model over stored complaint photos and save what it sees (media.ai_label, media.ai_conf).

Photos uploaded through the app are checked when they are uploaded. This fills the same two columns for photos that were never
checked (older complaints, seeded demo data) so the officer's one-line "Image check" is always the model's real output and never a guess.

    cd backend && python -m scripts.backfill_image_check            # only photos with no result yet
    cd backend && python -m scripts.backfill_image_check --all      # redo every photo (after a new model version)
"""

import argparse
import asyncio
import io

from PIL import Image
from sqlalchemy import text

from app.ai import pipeline
from app.config import get_settings
from app.db import SessionLocal, engine
from app.storage import get_storage


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()
    s = get_settings()
    pipeline.load(s)
    clf = pipeline.models.image
    if clf is None:
        raise SystemExit("image model is not loaded: " + pipeline.models.status.get("image", "unknown"))
    storage = get_storage()
    done = failed = 0
    async with SessionLocal() as db:
        rows = (await db.execute(text(f"SELECT id, storage_key FROM media {'' if args.all else 'WHERE ai_label IS NULL'} ORDER BY created_at"))).all()
        for r in rows:
            try:
                probs = clf.predict(Image.open(io.BytesIO(await storage.get(r.storage_key))))
            except Exception:  # noqa: BLE001 - a missing or unreadable file must not stop the rest
                failed += 1
                continue
            top = max(probs, key=probs.get)
            await db.execute(text("UPDATE media SET ai_label = :l, ai_conf = :c WHERE id = :i"), {"l": top, "c": round(probs[top], 4), "i": r.id})
            done += 1
        await db.commit()
    await engine.dispose()
    print(f"image model {clf.version}: checked {done} photos, {failed} could not be read")


if __name__ == "__main__":
    asyncio.run(main())
