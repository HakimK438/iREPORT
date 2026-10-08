"""Builds ml/data/images/{train,val,test}/<class>/ from the raw third-party datasets in ml/data/raw/.

    python -I ml/prepare_data.py            # -I: the raw folders are untrusted data, never import from them

Sources (all unpacked by hand into ml/data/raw/, see ml/README.md):
  cleanliness/   "Public cleanliness + road issues" (folder = label)       -> Pothole, Road Damage, Garbage, Other
  civicsense/    YOLO-format civic dataset (image label = its box classes)  -> Pothole, Garbage, Other
  streetlight/   Chennai streetlight dataset (working / not working)        -> Streetlight
  notcivic/      generic photos that are not civic problems (folder tree)   -> not_civic

Leakage control: several sources contain the same photo (or augmented copies of it). Every image gets a
64-bit difference hash; images within HAMMING bits of each other form one group, and a whole group goes
to exactly one split. Groups whose images carry different labels are dropped.

Classes without data (Water Leakage, Drainage, Electrical Hazard) are simply absent: the model does not
predict them and the citizen picks those categories by hand.
"""

import hashlib
import json
import random
import shutil
import sys
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "ml/data/raw"
OUT = ROOT / "ml/data/images"
EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
HAMMING = 4  # near-duplicate threshold on the 64-bit dHash
CAP = {"train": 300, "val": 60, "test": 60}  # per class: a quick first model; raise for a better one
SPLIT_FRACTION = {"train": 0.8, "val": 0.1, "test": 0.1}
MAX_SIDE = 640
YOLO_NAMES = ["damaged_road_sign", "fallen_tree", "garbage", "pothole", "graffiti"]  # civicsense/data.yaml
YOLO_CLASS = {"damaged_road_sign": "Other", "fallen_tree": "Other", "graffiti": "Other", "garbage": "Garbage", "pothole": "Pothole"}
FOLDER_CLASS = {
    "Pothole Issues": "Pothole", "Damaged Road issues": "Road Damage", "Littering Garbage on Public Places Issues": "Garbage",
    "Vandalism Issues": "Other", "Broken Road Sign Issues": "Other",  # Illegal Parking and Mixed Issues are skipped (ambiguous)
}


def gather() -> list[tuple[Path, str, str]]:
    """(path, class, source) for every usable raw image."""
    items: list[tuple[Path, str, str]] = []
    for folder, cls in FOLDER_CLASS.items():
        for p in sorted((RAW / "cleanliness").rglob("*")):
            if p.suffix.lower() in EXTS and p.parent.name == folder:
                items.append((p, cls, "cleanliness"))
    base = RAW / "civicsense/civic_sense_images_dataset"
    for split in ("train", "valid", "test"):
        for lab in sorted((base / split / "labels").glob("*.txt")):
            ids = {int(line.split()[0]) for line in lab.read_text().splitlines() if line.strip()}
            classes = {YOLO_CLASS[YOLO_NAMES[i]] for i in ids}
            img = next((base / split / "images" / (lab.stem + e) for e in (".jpg", ".jpeg", ".png") if (base / split / "images" / (lab.stem + e)).exists()), None)
            if img and len(classes) == 1 and len(ids) == 1:  # one box class per image: unambiguous label
                items.append((img, classes.pop(), "civicsense"))
    for p in sorted((RAW / "streetlight").rglob("*")):
        if p.suffix.lower() in EXTS and ".git" not in p.parts:
            items.append((p, "Streetlight", "streetlight"))
    for p in sorted((RAW / "notcivic").rglob("*")):
        if p.suffix.lower() in EXTS:
            items.append((p, "not_civic", "notcivic"))
    return items


def dhash(path: Path) -> int | None:
    try:
        with Image.open(path) as im:
            im.draft("L", (128, 128))
            g = im.convert("L").resize((9, 8), Image.Resampling.BILINEAR)
        a = np.asarray(g, dtype=np.int16)
        bits = (a[:, 1:] > a[:, :-1]).flatten()
        return int("".join("1" if b else "0" for b in bits), 2)
    except Exception:  # noqa: BLE001 - unreadable file: skip it
        return None


def groups_of(hashes: np.ndarray) -> np.ndarray:
    """Union-find over pairs within HAMMING bits (chunked brute force; fine for ~25k images)."""
    n = len(hashes)
    parent = np.arange(n)

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for start in range(0, n, 512):
        chunk = hashes[start:start + 512]
        dist = np.bitwise_count(chunk[:, None] ^ hashes[None, :])
        for i, j in zip(*np.nonzero(dist <= HAMMING), strict=True):
            a, b = find(start + int(i)), find(int(j))
            if a != b:
                parent[max(a, b)] = min(a, b)
    return np.array([find(i) for i in range(n)])


def main() -> None:
    items = gather()
    print(f"{len(items)} candidate images", dict(Counter(c for _, c, _ in items)))
    with ProcessPoolExecutor() as pool:
        hashes = list(pool.map(dhash, [p for p, _, _ in items], chunksize=64))
    keep = [i for i, h in enumerate(hashes) if h is not None]
    items = [items[i] for i in keep]
    h = np.array([hashes[i] for i in keep], dtype=np.uint64)
    gid = groups_of(h)

    by_group: dict[int, list[int]] = defaultdict(list)
    for idx, g in enumerate(gid):
        by_group[int(g)].append(idx)
    mixed = [g for g, ix in by_group.items() if len({items[i][1] for i in ix}) > 1]
    for g in mixed:
        del by_group[g]
    print(f"{len(by_group)} groups after de-duplication, {len(mixed)} mixed-label groups dropped")

    rng = random.Random(7)
    plan: dict[str, list[tuple[Path, str, str]]] = defaultdict(list)  # split -> items
    per_class: dict[str, list[list[int]]] = defaultdict(list)
    for ix in by_group.values():
        per_class[items[ix[0]][1]].append(ix)
    for cls, groups in per_class.items():
        rng.shuffle(groups)
        total = sum(len(g) for g in groups)
        quota = {s: total * f for s, f in SPLIT_FRACTION.items()}
        got = Counter()
        for ix in groups:
            split = next((s for s in ("val", "test", "train") if got[s] < quota[s]), "train")
            got[split] += len(ix)
            # one representative per group: near-duplicates add no information, only leakage risk
            plan[split].append(items[ix[0]])
    if OUT.exists():
        shutil.rmtree(OUT)
    manifest: dict = {"hamming": HAMMING, "cap": CAP, "counts": {}}
    for split, rows in plan.items():
        by_cls: dict[str, list[tuple[Path, str, str]]] = defaultdict(list)
        for r in rows:
            by_cls[r[1]].append(r)
        for cls, crow in by_cls.items():
            rng.shuffle(crow)
            for path, _, source in crow[:CAP[split]]:
                dest = OUT / split / cls
                dest.mkdir(parents=True, exist_ok=True)
                name = hashlib.md5(str(path).encode()).hexdigest()[:12] + ".jpg"
                with Image.open(path) as im:
                    im = im.convert("RGB")
                    im.thumbnail((MAX_SIDE, MAX_SIDE))
                    im.save(dest / name, "JPEG", quality=90)
                manifest["counts"].setdefault(split, {}).setdefault(cls, Counter())[source] += 1
    manifest["counts"] = {s: {c: dict(v) for c, v in d.items()} for s, d in manifest["counts"].items()}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2))
    for split in ("train", "val", "test"):
        print(split, {c: sum(v.values()) for c, v in sorted(manifest["counts"].get(split, {}).items())})


if __name__ == "__main__":
    if sys.flags.isolated == 0:
        print("tip: run with python -I so nothing in the raw data folders can be imported")
    main()
