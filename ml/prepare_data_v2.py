"""Build ml/data/images_v2: at most 20 TRAINING images per class, mixing the older folders with the CivicFix dataset.

    python ml/prepare_data_v2.py --civic "C:/Users/<you>/Downloads/civivcDataset"

Classes (8): Drainage, Electrical Hazard, Garbage, Other, Pothole, Road Damage, Streetlight, not_civic.
Where a class exists in both sources it gets 10 + 10 training images; otherwise 20 from the one source.

    CivicFix folder                              -> class
    waterlogging                                 -> Drainage
    infrastructure_damaged_electric_wire_pole    -> Electrical Hazard
    cleanliness_garbage                          -> Garbage
    cleanliness_fallen_tree, traffic_broken_road_sign (half each) -> Other
    road_potholes_and_road_cracks                -> Pothole
    infrastructure_damaged_concrete              -> Road Damage

Splits never overlap: training and validation images come from the CivicFix `train` folder (or the older train/val), and the
test images from the CivicFix `test` folder (or the older test). Validation has up to 20 per class, test up to 60.
Writes manifest.json with the exact counts. Then: python ml/train_probe.py --data ml/data/images_v2 --version img-2.0
"""

import argparse
import json
import random
import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
EXT = {".jpg", ".jpeg", ".png", ".webp"}
TRAIN_CAP = 20
CIVIC = {  # class -> [(CivicFix folder, share of that class's images from the CivicFix dataset)]
    "Drainage": [("waterlogging", 1.0)],
    "Electrical Hazard": [("infrastructure_damaged_electric_wire_pole", 1.0)],
    "Garbage": [("cleanliness_garbage", 1.0)],
    "Other": [("cleanliness_fallen_tree", 0.5), ("traffic_broken_road_sign", 0.5)],
    "Pothole": [("road_potholes_and_road_cracks", 1.0)],
    "Road Damage": [("infrastructure_damaged_concrete", 1.0)],
}
OLD = ["Garbage", "Other", "Pothole", "Road Damage", "Streetlight", "not_civic"]  # classes the older folders have
CLASSES = sorted(set(CIVIC) | set(OLD))


def usable(p: Path) -> bool:
    if p.suffix.lower() not in EXT:
        return False
    try:
        with Image.open(p) as im:
            return min(im.size) >= 160
    except Exception:  # noqa: BLE001
        return False


def pick(files: list[Path], n: int, rng: random.Random) -> list[Path]:
    files = sorted(files)
    rng.shuffle(files)
    out = []
    for p in files:
        if usable(p):
            out.append(p)
            if len(out) == n:
                break
    return out


def put(files: list[Path], dest: Path, prefix: str) -> int:
    dest.mkdir(parents=True, exist_ok=True)
    for i, p in enumerate(files):
        shutil.copyfile(p, dest / f"{prefix}{i:03d}{p.suffix.lower()}")
    return len(files)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--civic", type=Path, required=True)
    ap.add_argument("--old", type=Path, default=ROOT / "ml/data/images")
    ap.add_argument("--out", type=Path, default=ROOT / "ml/data/images_v2")
    args = ap.parse_args()
    rng = random.Random(42)
    if args.out.exists():
        shutil.rmtree(args.out)
    manifest: dict = {"train_cap_per_class": TRAIN_CAP, "classes": CLASSES, "counts": {}}
    for cls in CLASSES:
        has_civic, has_old = cls in CIVIC, cls in OLD
        n_civic = TRAIN_CAP // 2 if (has_civic and has_old) else (TRAIN_CAP if has_civic else 0)
        n_old = TRAIN_CAP - n_civic if has_old else 0
        counts = {"train": 0, "val": 0, "test": 0}
        # ---- CivicFix images
        if has_civic:
            for folder, share in CIVIC[cls]:
                train_pool = list((args.civic / "train" / folder).glob("*"))
                test_pool = list((args.civic / "test" / folder).glob("*"))
                tr = pick(train_pool, round(n_civic * share), rng)
                va = pick([p for p in train_pool if p not in set(tr)], round(10 * share) or 1, rng)
                te = pick(test_pool, round(60 * share), rng)
                counts["train"] += put(tr, args.out / "train" / cls, f"civic_{folder[:6]}_")
                counts["val"] += put(va, args.out / "val" / cls, f"civic_{folder[:6]}_")
                counts["test"] += put(te, args.out / "test" / cls, f"civic_{folder[:6]}_")
        # ---- older folders
        if has_old:
            counts["train"] += put(pick(list((args.old / "train" / cls).glob("*")), n_old, rng), args.out / "train" / cls, "old_")
            counts["val"] += put(pick(list((args.old / "val" / cls).glob("*")), 10 if has_civic else 20, rng), args.out / "val" / cls, "old_")
            counts["test"] += put(pick(list((args.old / "test" / cls).glob("*")), 60, rng), args.out / "test" / cls, "old_")
        manifest["counts"][cls] = counts
        assert counts["train"] <= TRAIN_CAP, (cls, counts)
        print(f"{cls:18s} train {counts['train']:2d}  val {counts['val']:2d}  test {counts['test']:2d}")
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
