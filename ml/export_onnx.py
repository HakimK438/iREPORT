"""Export the trained image model to ONNX, quantise it (int8, static, with real calibration images),
compare accuracy before and after, and copy the chosen file into backend/models/.

    python ml/export_onnx.py --version img-1.0 --calib ml/data/images/val
    python ml/export_onnx.py --benchmark-only     # untrained head, ImageNet backbone: size and latency only

Rule from the spec: if int8 loses more than 2 accuracy points against fp32 on the test set, ship fp16
(or fp32) instead. The decision and both numbers are written to ml/reports/<version>-export.json.
"""

import argparse
import json
import random
import shutil
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
LABELS = ["Pothole", "Road Damage", "Streetlight", "Garbage", "Water Leakage", "Drainage", "Electrical Hazard", "Other", "not_civic"]
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp"}


def preprocess(path: Path, size: int, mean: list[float], std: list[float]) -> np.ndarray:
    """Same transform as the API (backend/app/ai/image_model.py)."""
    img = Image.open(path).convert("RGB")
    short = round(size / 0.875)
    scale = short / min(img.size)
    img = img.resize((max(size, round(img.width * scale)), max(size, round(img.height * scale))), Image.Resampling.BILINEAR)
    left, top = (img.width - size) // 2, (img.height - size) // 2
    x = np.asarray(img.crop((left, top, left + size, top + size)), dtype=np.float32).transpose(2, 0, 1) / 255.0
    return ((x - np.array(mean, dtype=np.float32).reshape(3, 1, 1)) / np.array(std, dtype=np.float32).reshape(3, 1, 1))[None]


def images_in(folder: Path, limit: int | None = None, seed: int = 0) -> list[Path]:
    files = [p for p in folder.rglob("*") if p.suffix.lower() in IMG_EXT]
    random.Random(seed).shuffle(files)
    return files[:limit] if limit else files


def export_fp32(model, path: Path, size: int) -> None:
    import torch

    model.eval()
    dummy = torch.randn(1, 3, size, size)
    torch.onnx.export(model, dummy, str(path), input_names=["input"], output_names=["logits"], opset_version=17, dynamo=False)


def quantise_int8(fp32: Path, out: Path, calib: list[Path], size: int, mean, std) -> None:
    from onnxruntime.quantization import CalibrationDataReader, QuantFormat, QuantType, quantize_static
    from onnxruntime.quantization.shape_inference import quant_pre_process

    class Reader(CalibrationDataReader):
        def __init__(self):
            self.items = iter(calib)

        def get_next(self):
            p = next(self.items, None)
            return None if p is None else {"input": preprocess(p, size, mean, std)}

    pre = out.with_suffix(".pre.onnx")
    quant_pre_process(str(fp32), str(pre))
    quantize_static(str(pre), str(out), Reader(), quant_format=QuantFormat.QDQ, per_channel=True, activation_type=QuantType.QUInt8, weight_type=QuantType.QInt8)
    pre.unlink(missing_ok=True)


def to_fp16(fp32: Path, out: Path) -> None:
    import onnx
    from onnxconverter_common import float16  # pip install onnxconverter-common (only if fp16 is needed)

    onnx.save(float16.convert_float_to_float16(onnx.load(str(fp32)), keep_io_types=True), str(out))


def accuracy(path: Path, test_dir: Path, size: int, mean, std, label_order: list[str]) -> float:
    import onnxruntime as ort

    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    correct = total = 0
    for cls in test_dir.iterdir():
        if not cls.is_dir():
            continue
        for p in images_in(cls):
            pred = label_order[int(sess.run(None, {"input": preprocess(p, size, mean, std)})[0][0].argmax())]
            correct += pred == cls.name
            total += 1
    return correct / max(total, 1)


def latency(path: Path, size: int, threads: int = 2, runs: int = 200) -> dict:
    import time

    import onnxruntime as ort

    opts = ort.SessionOptions()
    opts.intra_op_num_threads, opts.inter_op_num_threads = threads, 1
    sess = ort.InferenceSession(str(path), opts, providers=["CPUExecutionProvider"])
    x = np.random.default_rng(0).standard_normal((1, 3, size, size)).astype(np.float32)
    for _ in range(20):
        sess.run(None, {"input": x})
    times = []
    for _ in range(runs):
        t = time.perf_counter()
        sess.run(None, {"input": x})
        times.append((time.perf_counter() - t) * 1000)
    return {"threads": threads, "p50_ms": round(float(np.percentile(times, 50)), 1), "p95_ms": round(float(np.percentile(times, 95)), 1), "mb": round(path.stat().st_size / 1e6, 2)}


def reorder_head(model, folder_classes: list[str]) -> None:
    """ImageFolder trains in alphabetical class order; reorder the classifier rows to LABELS order."""
    import torch

    head = model.get_classifier()
    idx = torch.tensor([folder_classes.index(lbl) for lbl in LABELS])
    with torch.no_grad():
        head.weight.copy_(head.weight[idx].clone())
        head.bias.copy_(head.bias[idx].clone())


def main() -> None:
    import timm
    import torch

    ap = argparse.ArgumentParser()
    ap.add_argument("--version", default="img-1.0")
    ap.add_argument("--calib", type=Path, default=ROOT / "ml/data/images/val")
    ap.add_argument("--test", type=Path, default=ROOT / "ml/data/images/test")
    ap.add_argument("--calib-count", type=int, default=300)
    ap.add_argument("--arch", default="tf_efficientnet_lite0")
    ap.add_argument("--benchmark-only", action="store_true", help="ImageNet backbone with an untrained 9-class head: measures size and speed only, no accuracy")
    args = ap.parse_args()

    work = ROOT / "ml/runs" / args.version
    work.mkdir(parents=True, exist_ok=True)
    if args.benchmark_only:
        meta = {"arch": args.arch, "temperature": 1.0, "input_size": 224, "mean": [0.5] * 3 if "lite" in args.arch else [0.485, 0.456, 0.406], "std": [0.5] * 3 if "lite" in args.arch else [0.229, 0.224, 0.225]}
        model = timm.create_model(args.arch, pretrained=True, num_classes=len(LABELS))
    else:
        meta = json.loads((work / "train.json").read_text())
        model = timm.create_model(meta["arch"], pretrained=False, num_classes=len(LABELS))
        model.load_state_dict(torch.load(work / "best.pt", map_location="cpu"))
        reorder_head(model, meta["folder_classes"])
    size, mean, std = meta["input_size"], meta["mean"], meta["std"]

    fp32, int8 = work / "model.fp32.onnx", work / "model.int8.onnx"
    export_fp32(model, fp32, size)
    report: dict = {"version": args.version, "arch": meta["arch"], "fp32": latency(fp32, size)}

    if args.benchmark_only:
        # Size and speed only: int8 is calibrated on whatever photos are in --calib (any real photos will do,
        # since accuracy is not measured here). Skipped if the folder does not exist.
        calib = images_in(args.calib, args.calib_count) if args.calib.exists() else []
        if calib:
            quantise_int8(fp32, int8, calib, size, mean, std)
            report["int8"] = latency(int8, size)
        report["note"] = "Untrained classifier head: size and latency only. No accuracy is claimed."
        print(json.dumps(report, indent=2))
        (ROOT / "ml/reports").mkdir(exist_ok=True)
        (ROOT / "ml/reports" / f"{args.version}-benchmark.json").write_text(json.dumps(report, indent=2))
        return

    quantise_int8(fp32, int8, images_in(args.calib, args.calib_count), size, mean, std)
    report["int8"] = latency(int8, size)
    acc32 = accuracy(fp32, args.test, size, mean, std, LABELS)
    acc8 = accuracy(int8, args.test, size, mean, std, LABELS)
    report.update(test_accuracy_fp32=round(acc32, 4), test_accuracy_int8=round(acc8, 4), drop_points=round((acc32 - acc8) * 100, 2))
    chosen = int8
    if acc32 - acc8 > 0.02:
        fp16 = work / "model.fp16.onnx"
        to_fp16(fp32, fp16)
        report["fp16"] = latency(fp16, size)
        report["test_accuracy_fp16"] = round(accuracy(fp16, args.test, size, mean, std, LABELS), 4)
        chosen = fp16
    report["shipped"] = chosen.name
    dest = ROOT / "backend/models"
    shutil.copy(chosen, dest / f"{args.version}.onnx")
    (dest / f"{args.version}.json").write_text(json.dumps({
        "version": args.version, "labels": LABELS, "input_size": size, "crop_pct": 0.875, "mean": mean, "std": std,
        "temperature": meta["temperature"], "arch": meta["arch"], "precision": chosen.stem.split(".")[-1],
    }, indent=2))
    (ROOT / "ml/reports").mkdir(exist_ok=True)
    (ROOT / "ml/reports" / f"{args.version}-export.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
