"""Fast image model: frozen ImageNet EfficientNet-Lite0 features + a logistic-regression head (a "linear probe").

    python ml/train_probe.py            # a few minutes on CPU; then: python ml/evaluate.py

Why: fine-tuning the whole network needs hours and a GPU. A linear probe trains in minutes and is a good
first model. It is weaker than full fine-tuning (ml/train_image.py) on hard classes, so read the per-class
recall in ml/reports/img-1.0-eval.json before trusting a class.

Classes are whatever folders exist under ml/data/images/train (see ml/prepare_data.py). Classes without data
are not predicted; the app lets the citizen choose them by hand.

Steps: features (same preprocessing as the API) -> sklearn LogisticRegression (C chosen on val macro-F1)
-> temperature scaling on val -> copy the weights into the timm classifier -> ONNX fp32 -> int8 (kept only if
test accuracy drops by <= 2 points) -> backend/models/img-1.0.onnx + .json.
"""

import argparse
import json
import shutil
import time
from pathlib import Path

import numpy as np
import timm
import torch
from export_onnx import accuracy, export_fp32, images_in, latency, preprocess, quantise_int8
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score

ROOT = Path(__file__).resolve().parents[1]
ARCH = "tf_efficientnet_lite0"
MEAN = STD = [0.5, 0.5, 0.5]  # EfficientNet-Lite (TF port)
SIZE = 224


def features(backbone, folder: Path, classes: list[str]) -> tuple[np.ndarray, np.ndarray]:
    xs, ys = [], []
    for k, cls in enumerate(classes):
        files = sorted(images_in(folder / cls))
        for i in range(0, len(files), 32):
            batch = np.concatenate([preprocess(p, SIZE, MEAN, STD) for p in files[i:i + 32]])
            with torch.no_grad():
                xs.append(backbone(torch.from_numpy(batch)).numpy())
        ys += [k] * len(files)
    return np.concatenate(xs), np.array(ys)


def fit_temperature(logits: np.ndarray, y: np.ndarray) -> float:
    """Temperature scaling: the T that minimises validation log-loss, so 'confidence' means something."""
    best_t, best = 1.0, 1e9
    for t in np.arange(0.3, 6.01, 0.05):
        z = logits / t
        z = z - z.max(1, keepdims=True)
        logp = z - np.log(np.exp(z).sum(1, keepdims=True))
        nll = -logp[np.arange(len(y)), y].mean()
        if nll < best:
            best_t, best = float(t), float(nll)
    return round(best_t, 2)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=ROOT / "ml/data/images")
    ap.add_argument("--version", default="img-1.0")
    args = ap.parse_args()
    torch.set_num_threads(12)

    classes = sorted(p.name for p in (args.data / "train").iterdir() if p.is_dir())
    print("classes:", classes)
    t0 = time.time()
    model = timm.create_model(ARCH, pretrained=True, num_classes=len(classes))
    model.eval()
    backbone = timm.create_model(ARCH, pretrained=True, num_classes=0)
    backbone.eval()
    data = {s: features(backbone, args.data / s, classes) for s in ("train", "val", "test")}
    print(f"features in {time.time() - t0:.0f}s", {s: len(v[1]) for s, v in data.items()})

    (xtr, ytr), (xva, yva), (xte, yte) = data["train"], data["val"], data["test"]
    best = None
    for c in (0.05, 0.2, 1.0, 5.0):
        lr = LogisticRegression(C=c, max_iter=3000, class_weight="balanced").fit(xtr, ytr)
        f1 = f1_score(yva, lr.predict(xva), average="macro")
        print(f"C={c}: val macro-F1 {f1:.3f}")
        if best is None or f1 > best[0]:
            best = (f1, c, lr)
    f1_val, c_best, lr = best
    temperature = fit_temperature(lr.decision_function(xva), yva)
    test_f1 = f1_score(yte, lr.predict(xte), average="macro")
    print(f"chosen C={c_best}, T={temperature}, val macro-F1 {f1_val:.3f}, test macro-F1 {test_f1:.3f}")

    with torch.no_grad():  # copy the fitted head into the timm classifier
        model.get_classifier().weight.copy_(torch.from_numpy(lr.coef_.astype(np.float32)))
        model.get_classifier().bias.copy_(torch.from_numpy(lr.intercept_.astype(np.float32)))
    work = ROOT / "ml/runs" / args.version
    work.mkdir(parents=True, exist_ok=True)
    fp32, int8 = work / "model.fp32.onnx", work / "model.int8.onnx"
    export_fp32(model, fp32, SIZE)
    quantise_int8(fp32, int8, images_in(args.data / "val", 300), SIZE, MEAN, STD)
    acc32 = accuracy(fp32, args.data / "test", SIZE, MEAN, STD, classes)
    acc8 = accuracy(int8, args.data / "test", SIZE, MEAN, STD, classes)
    chosen = int8 if acc32 - acc8 <= 0.02 else fp32
    print(f"test accuracy fp32 {acc32:.3f}, int8 {acc8:.3f} -> shipping {chosen.name}")

    dest = ROOT / "backend/models"
    shutil.copy(chosen, dest / f"{args.version}.onnx")
    (dest / f"{args.version}.json").write_text(json.dumps({
        "version": args.version, "labels": classes, "input_size": SIZE, "crop_pct": 0.875, "mean": MEAN, "std": STD,
        "temperature": temperature, "arch": ARCH, "precision": chosen.stem.split(".")[-1],
        "method": "frozen ImageNet backbone + logistic regression (linear probe)",
    }, indent=2))
    report = {
        "version": args.version, "method": "linear probe on frozen EfficientNet-Lite0 features", "classes": classes,
        "images": {s: int(len(v[1])) for s, v in data.items()}, "C": c_best, "temperature": temperature,
        "val_macro_f1": round(f1_val, 4), "test_macro_f1_sklearn": round(test_f1, 4),
        "test_accuracy_fp32": round(acc32, 4), "test_accuracy_int8": round(acc8, 4), "shipped": chosen.name, "latency": latency(chosen, SIZE),
        "data_manifest": json.loads((args.data / "manifest.json").read_text()),
        "caveat": "Small, third-party, non-Mumbai data. Water Leakage, Drainage and Electrical Hazard have no data and are not predicted.",
    }
    (ROOT / "ml/reports").mkdir(exist_ok=True)
    (ROOT / "ml/reports" / f"{args.version}.json").write_text(json.dumps(report, indent=2))
    print(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
