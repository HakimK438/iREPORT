"""Builds a tiny stand-in image model for tests, so the real ONNX Runtime code path is exercised
without shipping a trained network. It looks only at average colour:
red -> Pothole, green -> Garbage, blue -> Water Leakage, grey -> not_civic."""

import json
import shutil
from pathlib import Path

import numpy as np

LABELS = ["Pothole", "Road Damage", "Streetlight", "Garbage", "Water Leakage", "Drainage", "Electrical Hazard", "Other", "not_civic"]


def build_image_model(out_dir: Path, version: str = "img-1.0") -> None:
    import onnx
    from onnx import TensorProto, helper, numpy_helper

    w = np.zeros((len(LABELS), 3), dtype=np.float32)
    w[LABELS.index("Pothole")] = [4, -2, -2]
    w[LABELS.index("Garbage")] = [-2, 4, -2]
    w[LABELS.index("Water Leakage")] = [-2, -2, 4]
    b = np.zeros(len(LABELS), dtype=np.float32)
    b[LABELS.index("not_civic")] = 1.0
    graph = helper.make_graph(
        [
            helper.make_node("GlobalAveragePool", ["input"], ["pooled"]),
            helper.make_node("Flatten", ["pooled"], ["flat"]),
            helper.make_node("Gemm", ["flat", "W", "B"], ["logits"], transB=1),
        ],
        "colour_classifier",
        [helper.make_tensor_value_info("input", TensorProto.FLOAT, [1, 3, 224, 224])],
        [helper.make_tensor_value_info("logits", TensorProto.FLOAT, [1, len(LABELS)])],
        [numpy_helper.from_array(w, "W"), numpy_helper.from_array(b, "B")],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)])
    model.ir_version = 8
    onnx.checker.check_model(model)
    out_dir.mkdir(parents=True, exist_ok=True)
    onnx.save(model, out_dir / f"{version}.onnx")
    (out_dir / f"{version}.json").write_text(json.dumps({
        "version": version, "labels": LABELS, "input_size": 224, "crop_pct": 0.875,
        "mean": [0.5, 0.5, 0.5], "std": [0.5, 0.5, 0.5], "temperature": 1.0, "note": "test fixture, not a trained model",
    }))


def prepare(out_dir: Path, real_models: Path) -> None:
    if out_dir.exists():
        shutil.rmtree(out_dir)
    build_image_model(out_dir)
    for f in real_models.glob("txt-*.npz"):
        shutil.copy(f, out_dir / f.name)
