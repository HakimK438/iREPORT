# AI and GIS in iREPORT

What actually exists, and what does not.

```
Problem -> Image input -> NLP -> AI prediction -> Confidence -> Priority -> GIS -> Clustering -> Authority decision
```

| Step | What runs | Where |
|---|---|---|
| Problem | Citizen picks a category and answers 2-3 questions | `src/questions.ts` |
| Image input | Up to 3 photos, compressed in the browser, stored in S3/MinIO, linked to the report by `media.report_id`. Photo GPS (EXIF) is offered as a location suggestion only. | `backend/app/images.py`, `storage.py` |
| NLP | Rule-based extraction from the description: duration ("4 days"), obstruction (footpath/road), hazard, urgency, flags (near school, blocks footpath, ...). Nothing is extracted unless it is in the text. | `backend/app/ai/rules.py` |
| AI prediction | **Text model** `txt-1.0` classifies the description into a category. **Image model** `img-1.0` classifies photos into 6 classes (see below). | `backend/app/ai/` |
| Confidence | Shown only when a model produced it. Text-only: the percentage is labelled as coming from the description. No model: "Confidence unavailable". If photo and text models both run and disagree, the citizen is asked to confirm the category. | `ai/pipeline.py`, review screen in `ReportFlow.tsx` |
| Priority | Deterministic points: severity + flags + affected citizens + age. Same formula in SQL (`ireport_priority()`) and Python (`priority.py`); the reasons shown to authorities are computed from it. Not an ML score. | `priority.py` |
| GIS | The incident point is chosen in the report flow (device GPS, photo GPS, searched place or area centre) and stored as PostGIS `geography`. The profile area is never used. Area is `ST_Covers` on ward polygons if loaded, else the nearest seeded area centre. | `incidents.py` (`resolve_ward`) |
| Clustering | Map: `ST_ClusterDBSCAN` over open incidents (eps 300 m, min 2 points). Hotspots: `ST_ClusterDBSCAN` over open incidents of the last 30 days (eps 400 m, min 3 points); impact score = `min(100, round(0.6 * max priority + 0.4 * min(100, 8 * incident_count)))`, a plain formula, not an AI output. Individual incidents are never merged by this. | `incidents.py` |
| Authority decision | Dashboard shows location (area, lat/lng, Open in Map), photo, description, AI/NLP, priority reasons, hotspot reasons; authority sets status and sends a message the citizen sees. | `AuthorityDashboard.tsx`, `IncidentDetail.tsx` |

## Models and data

- **Text model `txt-1.0`**: trained on `ml/data/text/complaints.csv` (280 sentences, English/Hindi/Marathi). Held-out test (70 sentences): accuracy 0.743, macro-F1 0.731 (`ml/reports/txt-1.0.json`). Weak classes: Garbage recall 0.56, Other 0.22. The dataset is small; treat the number as indicative only.
- **Image model**: `img-1.0` is a **linear probe**: a frozen ImageNet EfficientNet-Lite0 (int8 ONNX, 3.83 MB) with a logistic-regression head, trained in about 3 minutes on CPU on 1,800 images from public datasets. It predicts 6 classes: Pothole, Road Damage, Streetlight, Garbage, Other, not_civic. Held-out test (360 images): accuracy 0.928, macro-F1 0.927; recall Garbage 0.90, Other 0.92, Pothole 0.88, Road Damage 0.97, Streetlight 0.97, not_civic 0.93. Limits: the test images come from the same public sources as the training images (de-duplicated, but not independent), so real-world accuracy will be lower; `not_civic` was trained on flowers and Caltech101 objects only; there are no Mumbai photos; Water Leakage, Drainage and Electrical Hazard have no data and are never predicted (the image result is ignored when the citizen has chosen one of those). Numbers: `ml/reports/img-1.0.json`.
- Photo quality (blurry / dark / low resolution) is a rule on pixel statistics, not ML.

## Honesty rules in the UI

- No confidence number is shown unless a model produced it.
- "Photo evidence: attached" never implies the photo was analysed.
- Hotspot and priority explanations list only counts that are in the data.
