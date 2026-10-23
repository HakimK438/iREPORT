"""Evaluate the shipped image model on the held-out test set, exactly as the API runs it.

    python ml/evaluate.py --model backend/models/img-1.0.onnx --test ml/data/images/test

Reports macro-F1, per-class recall, the confusion matrix, the share of predictions the API would mark
"uncertain" (confidence < 0.60), accuracy on the confident ones, and inference latency on this machine.
Run it on the 2 vCPU target server for the latency numbers that count.
"""

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image
from sklearn.metrics import confusion_matrix, f1_score, recall_score

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.ai.image_model import ImageClassifier  # noqa: E402  (the API's own code)

IMG_EXT = {".jpg", ".jpeg", ".png", ".webp"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", type=Path, default=ROOT / "backend/models/img-1.0.onnx")
    ap.add_argument("--test", type=Path, default=ROOT / "ml/data/images/test")
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--uncertain-below", type=float, default=0.60)
    args = ap.parse_args()

    clf = ImageClassifier(args.model, args.model.with_suffix(".json"), args.threads)
    clf.warm_up()
    y_true, y_pred, conf, times = [], [], [], []
    for cls_dir in sorted(p for p in args.test.iterdir() if p.is_dir()):
        for path in sorted(p for p in cls_dir.rglob("*") if p.suffix.lower() in IMG_EXT):
            img = Image.open(path).convert("RGB")
            t = time.perf_counter()
            probs = clf.predict(img)
            times.append((time.perf_counter() - t) * 1000)
            label = max(probs, key=probs.get)
            y_true.append(cls_dir.name)
            y_pred.append(label)
            conf.append(probs[label])
    labels = clf.labels
    conf_a = np.array(conf)
    sure = conf_a >= args.uncertain_below
    correct = np.array(y_true) == np.array(y_pred)
    report = {
        "model": str(args.model.relative_to(ROOT)), "model_mb": round(args.model.stat().st_size / 1e6, 2), "n_test": len(y_true),
        "accuracy": round(float(correct.mean()), 4),
        "macro_f1": round(float(f1_score(y_true, y_pred, labels=labels, average="macro", zero_division=0)), 4),
        "per_class_recall": dict(zip(labels, [round(float(r), 4) for r in recall_score(y_true, y_pred, labels=labels, average=None, zero_division=0)], strict=True)),
        "confusion_matrix": {"labels": labels, "rows_true_cols_pred": confusion_matrix(y_true, y_pred, labels=labels).tolist()},
        "uncertain_share": round(float((~sure).mean()), 4),
        "accuracy_when_confident": round(float(correct[sure].mean()), 4) if sure.any() else None,
        "latency_ms_incl_preprocess": {"p50": round(float(np.percentile(times, 50)), 1), "p95": round(float(np.percentile(times, 95)), 1), "threads": args.threads},
    }
    out = ROOT / "ml/reports" / f"{clf.version}-eval.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
