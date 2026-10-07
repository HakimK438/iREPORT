"""Character n-gram TF-IDF + logistic regression, trained with scikit-learn in ml/train_text.py and
exported to a small .npz. Inference is re-implemented here with NumPy so the API image does not need
scikit-learn or SciPy. ml/tests check that this matches sklearn's predict_proba exactly."""

import json
import re
import unicodedata
from pathlib import Path

import numpy as np

_WS = re.compile(r"\s\s+")


def normalise(text: str) -> str:
    return unicodedata.normalize("NFC", text).lower()


def char_wb_ngrams(text: str, min_n: int, max_n: int) -> list[str]:
    """Same output as sklearn TfidfVectorizer(analyzer='char_wb')._char_wb_ngrams."""
    text = _WS.sub(" ", text)
    grams: list[str] = []
    for w in text.split():
        w = f" {w} "
        w_len = len(w)
        for n in range(min_n, max_n + 1):
            offset = 0
            grams.append(w[offset : offset + n])
            while offset + n < w_len:
                offset += 1
                grams.append(w[offset : offset + n])
            if offset == 0:  # a word shorter than n is counted once
                break
    return grams


class TextClassifier:
    def __init__(self, path: Path):
        data = np.load(path, allow_pickle=False)
        meta = json.loads(str(data["meta"]))
        self.version: str = meta["version"]
        self.classes: list[str] = meta["classes"]
        self.min_n, self.max_n = meta["ngram_range"]
        self.sublinear: bool = meta["sublinear_tf"]
        self.vocab = {g: i for i, g in enumerate(data["vocab"].tolist())}
        self.idf = data["idf"].astype(np.float32)
        self.coef = data["coef"].astype(np.float32)
        self.intercept = data["intercept"].astype(np.float32)

    def vectorise(self, text: str) -> np.ndarray:
        x = np.zeros(len(self.vocab), dtype=np.float32)
        for g in char_wb_ngrams(normalise(text), self.min_n, self.max_n):
            i = self.vocab.get(g)
            if i is not None:
                x[i] += 1
        nz = x > 0
        if self.sublinear:
            x[nz] = 1 + np.log(x[nz])
        x *= self.idf
        norm = np.linalg.norm(x)
        return x / norm if norm > 0 else x

    def predict(self, text: str) -> dict[str, float] | None:
        """Category probabilities, or None if no known n-gram appears in the text."""
        x = self.vectorise(text)
        if not x.any():
            return None
        logits = self.coef @ x + self.intercept
        logits -= logits.max()
        p = np.exp(logits)
        p /= p.sum()
        return dict(zip(self.classes, p.tolist(), strict=True))
