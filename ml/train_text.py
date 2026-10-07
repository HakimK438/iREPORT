"""Train the text classifier: character n-gram (2-5) TF-IDF + logistic regression.

    python ml/train_text.py                      # train, evaluate, export backend/models/txt-1.0.npz
    python ml/train_text.py --data more.csv ...  # add more labelled CSVs (category,lang,text)

Evaluation is honest by construction:
  * the held-out test set is split by *source sentence*, so augmented copies of a test sentence
    never appear in training;
  * augmentation is applied to the training split only;
  * 5-fold cross-validation (also grouped by sentence) is reported next to the single split.
The shipped model is then refitted on all data; the reported numbers are for the held-out models.
"""

import argparse
import csv
import json
import random
import sys
import time
import unicodedata
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import StratifiedKFold, train_test_split
from sklearn.pipeline import make_pipeline

ROOT = Path(__file__).resolve().parents[1]
CATEGORIES = ["Pothole", "Road Damage", "Streetlight", "Garbage", "Water Leakage", "Drainage", "Electrical Hazard", "Other"]
VERSION = "txt-1.0"
NGRAMS = (2, 5)
MAX_FEATURES = 30000

# Training-only augmentation: the kind of extra words people add around a complaint.
PREFIX = {
    "latin": ["", "", "please help, ", "sir ", "urgent: ", "bmc please check, ", "kripya dhyan de "],
    "deva": ["", "", "कृपया ध्यान दें, ", "सर ", "तातडीने: ", "कृपया लक्ष द्या, "],
}
SUFFIX = {
    "latin": ["", "", " near andheri station", " at link road", " in our area", " please fix", " since last week", " plz", " bandra west", " jaldi theek karo"],
    "deva": ["", "", " अंधेरी स्टेशन के पास", " लिंक रोड पर", " आमच्या भागात", " कृपया ठीक करें", " लवकर दुरुस्त करा", " पिछले हफ्ते से", " दादर मध्ये"],
}


def normalise(text: str) -> str:
    return unicodedata.normalize("NFC", text).lower()


def load(paths: list[Path]) -> list[dict]:
    rows = []
    for p in paths:
        with p.open(encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r["category"] not in CATEGORIES:
                    raise SystemExit(f"{p}: unknown category {r['category']!r}")
                rows.append({"text": normalise(r["text"]), "lang": r["lang"], "category": r["category"]})
    return rows


def augment(rows: list[dict], copies: int, seed: int) -> list[dict]:
    rng = random.Random(seed)
    out = list(rows)
    for r in rows:
        script = "latin" if r["text"].isascii() else "deva"
        for _ in range(copies):
            text = r["text"]
            if rng.random() < 0.3 and len(text.split()) > 3:  # drop one word
                words = text.split()
                words.pop(rng.randrange(len(words)))
                text = " ".join(words)
            out.append({**r, "text": normalise(rng.choice(PREFIX[script]) + text + rng.choice(SUFFIX[script]))})
    return out


def build():
    vec = TfidfVectorizer(analyzer="char_wb", ngram_range=NGRAMS, sublinear_tf=True, min_df=2, max_features=MAX_FEATURES, lowercase=False, dtype=np.float32)
    clf = LogisticRegression(C=10.0, max_iter=3000)
    return make_pipeline(vec, clf)


def fit(rows: list[dict], seed: int):
    data = augment(rows, copies=3, seed=seed)
    model = build()
    model.fit([r["text"] for r in data], [r["category"] for r in data])
    return model


def export(model, path: Path) -> None:
    vec, clf = model.steps[0][1], model.steps[1][1]
    vocab = sorted(vec.vocabulary_, key=vec.vocabulary_.get)
    meta = {"version": VERSION, "classes": list(clf.classes_), "ngram_range": list(NGRAMS), "sublinear_tf": True, "analyzer": "char_wb", "normalise": "NFC+lower"}
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        path, vocab=np.array(vocab), idf=vec.idf_.astype(np.float32), coef=clf.coef_.astype(np.float32),
        intercept=clf.intercept_.astype(np.float32), meta=np.array(json.dumps(meta)),
    )


def evaluate(model, rows: list[dict]) -> dict:
    y = [r["category"] for r in rows]
    pred = model.predict([r["text"] for r in rows])
    per_lang = {}
    for lang in sorted({r["lang"] for r in rows}):
        idx = [i for i, r in enumerate(rows) if r["lang"] == lang]
        per_lang[lang] = {"n": len(idx), "accuracy": round(accuracy_score([y[i] for i in idx], [pred[i] for i in idx]), 3)}
    report = classification_report(y, pred, labels=CATEGORIES, output_dict=True, zero_division=0)
    return {
        "n": len(rows), "accuracy": round(accuracy_score(y, pred), 3), "macro_f1": round(f1_score(y, pred, average="macro"), 3),
        "per_class_recall": {c: round(report[c]["recall"], 3) for c in CATEGORIES},
        "per_language_accuracy": per_lang,
        "confusion_matrix": {"labels": CATEGORIES, "rows_true_cols_pred": confusion_matrix(y, pred, labels=CATEGORIES).tolist()},
    }


def runtime_latency(path: Path, texts: list[str]) -> dict:
    sys.path.insert(0, str(ROOT / "backend"))
    from app.ai.text_model import TextClassifier  # the exact code the API runs

    m = TextClassifier(path)
    for t in texts[:20]:
        m.predict(t)
    times = []
    for t in texts * 5:
        s = time.perf_counter()
        m.predict(t)
        times.append((time.perf_counter() - s) * 1000)
    return {"p50_ms": round(float(np.percentile(times, 50)), 3), "p95_ms": round(float(np.percentile(times, 95)), 3), "runs": len(times)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", nargs="*", type=Path, default=[ROOT / "ml/data/text/complaints.csv"])
    ap.add_argument("--out", type=Path, default=ROOT / "backend/models" / f"{VERSION}.npz")
    ap.add_argument("--report", type=Path, default=ROOT / "ml/reports" / f"{VERSION}.json")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    rows = load(args.data)
    labels = [r["category"] for r in rows]
    train, test = train_test_split(rows, test_size=0.25, stratify=labels, random_state=args.seed)
    held_out = evaluate(fit(train, args.seed), test)

    cv_f1, cv_acc = [], []
    for k, (tr, te) in enumerate(StratifiedKFold(5, shuffle=True, random_state=args.seed).split(rows, labels)):
        m = fit([rows[i] for i in tr], args.seed + k)
        e = evaluate(m, [rows[i] for i in te])
        cv_f1.append(e["macro_f1"])
        cv_acc.append(e["accuracy"])

    final = fit(rows, args.seed)
    export(final, args.out)
    size_mb = args.out.stat().st_size / 1e6
    report = {
        "version": VERSION, "data": [str(p.relative_to(ROOT)) for p in args.data], "sentences": len(rows),
        "held_out_test": held_out,
        "cv5": {"macro_f1_mean": round(float(np.mean(cv_f1)), 3), "macro_f1_std": round(float(np.std(cv_f1)), 3), "accuracy_mean": round(float(np.mean(cv_acc)), 3)},
        "model_file": str(args.out.relative_to(ROOT)), "model_mb": round(size_mb, 2),
        "runtime_latency_this_machine": runtime_latency(args.out, [r["text"] for r in test]),
        "features": len(final.steps[0][1].vocabulary_),
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "held_out_test"}, indent=2, ensure_ascii=False))
    print("held-out:", {k: held_out[k] for k in ("n", "accuracy", "macro_f1", "per_class_recall", "per_language_accuracy")})


if __name__ == "__main__":
    main()
