"""Loads the two small models once at startup and combines their outputs (section 7.4).
The AI only suggests: any failure degrades to "uncertain" and the citizen chooses."""

import logging
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image

from ..config import Settings
from . import rules
from .image_model import ImageClassifier
from .text_model import TextClassifier

log = logging.getLogger("ireport.ai")

CATEGORIES = ["Pothole", "Road Damage", "Streetlight", "Garbage", "Water Leakage", "Drainage", "Electrical Hazard", "Other"]
NOT_CIVIC = "not_civic"
IMAGE_WEIGHT, TEXT_WEIGHT = 0.7, 0.3
DISAGREE_AT = 0.60  # both models at least this sure of different categories


@dataclass
class Models:
    image: ImageClassifier | None = None
    text: TextClassifier | None = None
    status: dict[str, str] = field(default_factory=dict)


models = Models()


def load(s: Settings) -> Models:
    root = Path(s.models_dir)
    onnx_path, meta_path = root / f"{s.image_model_name}.onnx", root / f"{s.image_model_name}.json"
    try:
        if onnx_path.exists() and meta_path.exists():
            models.image = ImageClassifier(onnx_path, meta_path, s.ai_threads)
            models.image.warm_up()
            models.status["image"] = f"ok ({models.image.version}, {onnx_path.stat().st_size / 1e6:.1f} MB)"
        else:
            models.image = None
            models.status["image"] = f"missing ({onnx_path.name}); photos are stored, category is chosen manually"
    except Exception as exc:  # noqa: BLE001
        models.image = None
        models.status["image"] = f"error: {exc}"
        log.exception("image model failed to load")
    text_path = root / f"{s.text_model_name}.npz"
    try:
        if text_path.exists():
            models.text = TextClassifier(text_path)
            models.status["text"] = f"ok ({models.text.version}, {text_path.stat().st_size / 1e6:.1f} MB)"
        else:
            models.text = None
            models.status["text"] = f"missing ({text_path.name})"
    except Exception as exc:  # noqa: BLE001
        models.text = None
        models.status["text"] = f"error: {exc}"
        log.exception("text model failed to load")
    log.info("AI models: %s", models.status)
    return models


def _top_civic(p: dict[str, float]) -> tuple[str, float]:
    best = max(CATEGORIES, key=lambda c: p.get(c, 0.0))
    return best, p.get(best, 0.0)


def combine(p_img: dict[str, float] | None, p_txt: dict[str, float] | None, uncertain_below: float) -> dict:
    if p_img and p_txt:
        p = {k: IMAGE_WEIGHT * p_img.get(k, 0.0) + TEXT_WEIGHT * p_txt.get(k, 0.0) for k in [*CATEGORIES, NOT_CIVIC]}
    else:
        p = p_img or p_txt
    if not p:
        return {"category": None, "confidence": None, "top3": [], "uncertain": True, "not_civic": False, "disagreement": None, "agreement": None}
    ranked = sorted(CATEGORIES, key=lambda c: -p.get(c, 0.0))
    top1, conf = ranked[0], p.get(ranked[0], 0.0)
    not_civic = p.get(NOT_CIVIC, 0.0) > conf
    disagreement = None
    agreement = None  # "agree" / "disagree" only when both models produced a result
    if p_img and p_txt:
        (ic, ip), (tc, tp) = _top_civic(p_img), _top_civic(p_txt)
        if ic != tc and ip >= DISAGREE_AT and tp >= DISAGREE_AT and p_img.get(NOT_CIVIC, 0.0) < ip:
            disagreement = {"image": ic, "text": tc}
        agreement = "disagree" if disagreement else "agree" if ic == tc else None
    return {
        "category": top1, "confidence": round(conf, 4),
        "top3": [{"category": c, "confidence": round(p.get(c, 0.0), 4)} for c in ranked[:3]],
        "uncertain": bool(not_civic or disagreement or conf < uncertain_below),
        "not_civic": bool(not_civic), "disagreement": disagreement, "agreement": agreement,
    }


def analyze(images: list[Image.Image], text: str | None, problem_type: str | None, chosen_category: str | None, uncertain_below: float) -> dict:
    """images may be empty. A photo whose inference fails is skipped; the others are still averaged."""
    p_img = p_txt = None
    status = {"image": "no_photo" if not images else "unavailable", "text": "no_text"}
    photos_used = 0
    if images and models.image:
        per_photo = []
        for im in images:
            try:
                per_photo.append(models.image.predict(im))
            except Exception:  # noqa: BLE001
                log.exception("image inference failed for one photo")
        photos_used = len(per_photo)
        if per_photo:
            p_img = {k: sum(p[k] for p in per_photo) / len(per_photo) for k in per_photo[0]}
            status["image"] = "used" if photos_used == len(images) else f"used ({photos_used} of {len(images)} photos)"
        else:
            status["image"] = "error"
    if text and text.strip():
        if models.text:
            try:
                p_txt = models.text.predict(text)
                status["text"] = "used" if p_txt else "no_known_words"
            except Exception:  # noqa: BLE001
                log.exception("text inference failed")
                status["text"] = "error"
        else:
            status["text"] = "unavailable"
    result = combine(p_img, p_txt, uncertain_below)
    versions = [m.version for m in (models.image if p_img else None, models.text if p_txt else None) if m]
    # Severity uses the AI category when it is sure, otherwise the citizen's own choice.
    basis = result["category"] if result["category"] and not result["uncertain"] else (chosen_category or result["category"] or "Other")
    severity, flags = rules.assess(basis, problem_type, text)
    source = "+".join(s for s, p in (("image", p_img), ("text", p_txt)) if p) or "none"
    result.update(
        severity=severity, flags=flags,
        # The photo sentence is only produced when an image model really ran.
        explanation=rules.explanation(basis, from_image=p_img is not None, flags=flags) if result["category"] else None,
        model_version="/".join(versions) or None,
        source=source,
        ai_available=result["category"] is not None,
        models=status,
        inference_ms=round(models.image.last_ms, 1) if p_img and models.image else None,
        nlp=rules.extract_nlp(text, severity, flags),
    )
    if status["image"] == "error" or status["text"] == "error":
        result["uncertain"] = True
    return result
