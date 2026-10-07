# iREPORT models (offline training)

Nothing in this folder runs in production or ships in the API image. Training produces small files that are copied into `backend/models/`:

| File | What | Budget |
|---|---|---|
| `backend/models/txt-1.0.npz` | char n-gram (2–5) TF-IDF + logistic regression, 8 categories | < 2 MB, < 5 ms |
| `backend/models/img-1.0.onnx` + `.json` | EfficientNet-Lite0, 8 categories + `not_civic`, int8 | ~5 MB (≤ 15 MB), < 150 ms |

```bash
py -3.12 -m venv ml/.venv            # or python3 -m venv
ml/.venv/Scripts/pip install -r ml/requirements.txt     # (bin/ on Linux/macOS)
```

## Text model: trained and shipped

```bash
ml/.venv/Scripts/python ml/train_text.py          # trains, evaluates, writes backend/models/txt-1.0.npz and ml/reports/txt-1.0.json
ml/.venv/Scripts/python -m pytest ml/tests        # the API's NumPy runtime equals sklearn predict_proba
```

**Data.** `data/text/complaints.csv` has 280 short complaints written for this project: 35 per category, in English, Hindi, Marathi, Hinglish and some Latin-script Marathi. It is a seed set, not real citizen data.

**Evaluation.** The test split is by source sentence (25 %, stratified), so augmented copies of a test sentence are never trained on. Augmentation (prefix and suffix phrases, word drop) is applied to the training split only. 5-fold CV is also reported. The shipped model is then refitted on all 280 sentences.

**Measured results** (`ml/reports/txt-1.0.json`, run on 2026-10-07):

| Metric | Value |
|---|---|
| Held-out test (70 sentences): accuracy | 0.743 |
| Held-out test: macro-F1 | 0.731 |
| 5-fold CV macro-F1 | 0.715 ± 0.084 |
| Per-class recall (test) | Pothole 0.89 · Road Damage 0.88 · Streetlight 0.89 · Garbage 0.56 · Water Leakage 0.89 · Drainage 0.78 · Electrical Hazard 0.88 · **Other 0.22** |
| Accuracy by language (test) | en 0.72 (32) · hi 0.64 (14) · mr 0.92 (12) · Hinglish 0.82 (11) · Latin Marathi 0/1 |
| Model file | 0.14 MB, 9,621 features |
| Latency (NumPy runtime, dev laptop) | p50 0.6 ms, p95 1.6 ms |

How to read this:
- The test set is small (70 sentences), so each number has a wide error bar (about ±0.1).
- "Other" is weak, which is expected for a catch-all class with 35 varied examples.
- The text model only ever suggests. Below 0.60 confidence the app asks the citizen to choose.
- Real complaints will be noisier than these hand-written sentences, so expect lower numbers until it is retrained on real, citizen-confirmed reports.

## Image model: pipeline ready, **not trained here**

No trained image model is in this repository. The public datasets could not be downloaded in the build environment, and **no accuracy number is claimed**. Until a model is present, the API stores photos normally and returns `uncertain: true`, and the citizen picks the category.

### 1. Collect data → `data/images/{train,val,test}/<class>/`
Class folders: `Pothole`, `Road Damage`, `Streetlight`, `Garbage`, `Water Leakage`, `Drainage`, `Electrical Hazard`, `Other`, `not_civic`.

| Class | Starting sources |
|---|---|
| Pothole, Road Damage | RDD2022 (includes India; crop the D40 pothole and D00/D10/D20 crack boxes), Kaggle pothole datasets |
| Garbage | TACO (crops and full scenes), TrashNet (product shots: use sparingly, they are unlike street photos) |
| Streetlight, Drainage, Water Leakage, Electrical Hazard, Other | Scarce publicly: collect Mumbai street photos (with permission), pre-label offline with MobileCLIP zero-shot, **then check every label by hand** |
| not_civic | Selfies, indoor scenes, screenshots, food, documents |

Use MobileCLIP only offline, as a labelling helper. It must never run in the API. Keep the test split separate from the start, ideally photos from different days and places than train, and never tune on it.

### 2. Train
```bash
ml/.venv/Scripts/python ml/train_image.py --epochs 25                         # tf_efficientnet_lite0 (~4.7 M params)
ml/.venv/Scripts/python ml/train_image.py --arch mobilenetv3_small_100        # ~2.5 M params if a smaller file is needed
```
Training uses class-balanced sampling, light augmentation, label smoothing and AdamW with one-cycle. The best epoch on val is kept. **Temperature scaling** is fitted on val, so the 0.60 "uncertain" threshold means something.

### 3. Export, quantise, compare
```bash
ml/.venv/Scripts/python ml/export_onnx.py --version img-1.0 --calib ml/data/images/val --calib-count 300
```
This exports fp32 ONNX, then applies int8 static quantisation (QDQ, per-channel) calibrated on 200–500 real val images. It measures test accuracy for both. **If int8 loses more than 2 points, fp16 is shipped instead.** The chosen file plus a `.json` sidecar (labels, preprocessing, temperature) are copied to `backend/models/`. The decision and both accuracies go to `ml/reports/img-1.0-export.json`.

### 4. Evaluate exactly as the API runs it
```bash
ml/.venv/Scripts/python ml/evaluate.py --model backend/models/img-1.0.onnx --test ml/data/images/test --threads 2
```
This reports macro-F1, per-class recall, the confusion matrix, the share of predictions below 0.60, accuracy on the confident ones, and latency including preprocessing. **Run it on the 2 vCPU target server** for the latency that counts.

### Size and speed check without training
```bash
ml/.venv/Scripts/python ml/export_onnx.py --benchmark-only --calib public/media
```
This loads the ImageNet-pretrained EfficientNet-Lite0 backbone with an untrained 9-class head. It exports and quantises it and reports file size and CPU latency only (`ml/reports/img-1.0-benchmark.json`). It says nothing about accuracy.

## Retraining after launch
Every report stores `ai_category_id`, `ai_confidence`, `model_version` and `user_corrected`. The citizen's final category is `incidents.category_id`. Every few months:
1. Export confirmed and corrected reports with their photos and final category.
2. Add them to train and val. Keep a fresh, untouched test set from the most recent month.
3. Retrain, and bump the version (`img-1.1`, `txt-1.1`). The API writes the version into every new report.
