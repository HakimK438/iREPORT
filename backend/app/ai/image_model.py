"""EfficientNet-Lite0 (or MobileNetV3-Small) image classifier on ONNX Runtime, CPU only.
The model file and a small JSON sidecar (labels, preprocessing, temperature) ship in backend/models/."""

import json
import time
from pathlib import Path

import numpy as np
from PIL import Image


class ImageClassifier:
    def __init__(self, onnx_path: Path, meta_path: Path, threads: int = 2):
        import onnxruntime as ort

        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        self.version: str = meta["version"]
        self.labels: list[str] = meta["labels"]
        self.size: int = meta.get("input_size", 224)
        self.crop_pct: float = meta.get("crop_pct", 0.875)
        self.mean = np.array(meta.get("mean", [0.5, 0.5, 0.5]), dtype=np.float32).reshape(3, 1, 1)
        self.std = np.array(meta.get("std", [0.5, 0.5, 0.5]), dtype=np.float32).reshape(3, 1, 1)
        self.temperature: float = float(meta.get("temperature", 1.0))
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = threads
        opts.inter_op_num_threads = 1
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.session = ort.InferenceSession(str(onnx_path), opts, providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name
        self.last_ms = 0.0

    def preprocess(self, img: Image.Image) -> np.ndarray:
        """Resize the short side to size / crop_pct, centre-crop size x size, normalise (timm eval transform)."""
        short = round(self.size / self.crop_pct)
        w, h = img.size
        scale = short / min(w, h)
        img = img.convert("RGB").resize((max(self.size, round(w * scale)), max(self.size, round(h * scale))), Image.Resampling.BILINEAR)
        left, top = (img.width - self.size) // 2, (img.height - self.size) // 2
        img = img.crop((left, top, left + self.size, top + self.size))
        x = np.asarray(img, dtype=np.float32).transpose(2, 0, 1) / 255.0
        return ((x - self.mean) / self.std)[None]

    def predict(self, img: Image.Image) -> dict[str, float]:
        x = self.preprocess(img)
        t = time.perf_counter()
        logits = self.session.run(None, {self.input_name: x})[0][0].astype(np.float64)
        self.last_ms = (time.perf_counter() - t) * 1000
        logits = logits / self.temperature
        logits -= logits.max()
        p = np.exp(logits)
        p /= p.sum()
        return dict(zip(self.labels, p.tolist(), strict=True))

    def warm_up(self) -> None:
        self.predict(Image.new("RGB", (self.size, self.size), (128, 128, 128)))
