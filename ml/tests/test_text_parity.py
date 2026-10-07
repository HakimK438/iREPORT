"""The API re-implements TF-IDF + logistic regression in NumPy. This checks it gives the same
probabilities as scikit-learn.   Run: ml/.venv/Scripts/python -m pytest ml/tests"""

import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "ml"), str(ROOT / "backend")]

import train_text  # noqa: E402
from app.ai.text_model import TextClassifier, char_wb_ngrams  # noqa: E402


def test_ngrams_match_sklearn():
    vec = train_text.build().steps[0][1]
    analyzer = vec.build_analyzer()
    for text in ["road pe  bada gaddha", "गड्ढा  है", "a", "live wire!!", "  "]:
        t = train_text.normalise(text)
        assert char_wb_ngrams(t, 2, 5) == analyzer(t)


def test_probabilities_match_sklearn(tmp_path):
    rows = train_text.load([ROOT / "ml/data/text/complaints.csv"])
    model = train_text.fit(rows, seed=1)
    path = tmp_path / "txt.npz"
    train_text.export(model, path)
    runtime = TextClassifier(path)
    texts = [r["text"] for r in rows[::7]] + ["कचरा", "light band", "पाणी गळती होत आहे"]
    expected = model.predict_proba(texts)
    for text, exp in zip(texts, expected, strict=True):
        got = runtime.predict(text)
        assert got is not None
        assert np.allclose([got[c] for c in model.classes_], exp, atol=1e-5), text
