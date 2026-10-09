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
MISMATCH_AT = 0.60  # a single photo is flagged only when the image model is at least this sure it shows something else
MERGED = {"Road Damage": "Pothole", "Drainage": "Water Leakage"}  # legacy names count as their merged category


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


def photo_check(index: int, probs: dict[str, float], chosen: str | None) -> dict:
    """Does this ONE photo look like the category the citizen chose? Only a confident, different answer is a mismatch;
    "Other" is a catch-all, so it never mismatches. `looks_like` is the model's own top label (or "not_civic")."""
    top = max(probs, key=lambda k: probs[k])
    conf = probs[top]
    norm = lambda c: MERGED.get(c, c)  # noqa: E731
    mismatch = bool(chosen and chosen != "Other" and conf >= MISMATCH_AT and top != "Other" and norm(top) != norm(chosen))
    return {"index": index, "looks_like": norm(top), "confidence": round(conf, 4), "matches": not mismatch}


def analyze(images: list[Image.Image], text: str | None, problem_type: str | None, chosen_category: str | None, uncertain_below: float) -> dict:
    """images may be empty. A photo whose inference fails is skipped; the others are still averaged."""
    p_img = p_txt = None
    status = {"image": "no_photo" if not images else "unavailable", "text": "no_text"}
    photos_used = 0
    photo_checks: list[dict] = []  # one entry per photo the image model could judge
    # The image model only knows the classes it was trained on. If the citizen already chose a category it
    # has no data for (e.g. Drainage), its answer would be a guess among the wrong classes: skip it.
    covered = chosen_category is None or chosen_category in models.image.labels if models.image else False
    if images and models.image and not covered:
        status["image"] = "category_not_covered"
    if images and models.image and covered:
        per_photo = []
        for n, im in enumerate(images):
            try:
                probs = models.image.predict(im)
                per_photo.append(probs)
                photo_checks.append(photo_check(n, probs, chosen_category))
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
        explanation=rules.explanation(basis, from_image=p_img is not None, flags=flags, confidence=(p_img or {}).get(basis)) if result["category"] else None,
        model_version="/".join(versions) or None,
        source=source,
        ai_available=result["category"] is not None,
        models=status,
        inference_ms=round(models.image.last_ms, 1) if p_img and models.image else None,
        nlp=rules.extract_nlp(text, severity, flags),
        # Each model's own top-1 probability (None when that model did not run). `confidence` is the blend.
        image_confidence=round(_top_civic(p_img)[1], 4) if p_img else None,
        text_confidence=round(_top_civic(p_txt)[1], 4) if p_txt else None,
        image_model_active=models.image is not None,
        photo_checks=photo_checks,
    )
    if status["image"] == "error" or status["text"] == "error":
        result["uncertain"] = True
    return result
