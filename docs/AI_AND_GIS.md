# AI and GIS

What actually exists, and what does not.

```
Problem -> Image input -> NLP -> AI suggestion (unverified) -> Confidence -> Hazard category -> GIS -> Clustering -> Authority decision
```

| Step | What runs | Where |
|---|---|---|
| Problem | Citizen picks a category and answers 2-3 questions | `src/questions.ts` |
| Image input | Up to 3 photos, compressed in the browser, stored in S3/MinIO, linked to the report by `media.report_id`. Photo GPS (EXIF) is offered as a location suggestion only. | `backend/app/images.py`, `storage.py` |
| NLP | Rule-based extraction from the description: duration ("4 days"), obstruction (footpath/road), hazard, urgency, flags (near school, blocks footpath, ...). Nothing is extracted unless it is in the text. | `backend/app/ai/rules.py` |
| AI prediction | **Text model** `txt-1.0` classifies the description into a category. **Image model** `img-1.0` classifies photos into 6 classes (see below). | `backend/app/ai/` |
| Confidence | Shown only when a model produced it. Text-only: the percentage is labelled as coming from the description. No model: "Confidence unavailable". If photo and text models both run and disagree, the citizen is asked to confirm the category. | `ai/pipeline.py`, review screen in `ReportFlow.tsx` |
| Hazard category | Deterministic **risk = impact x likelihood** (1 to 16): impact from the category (1 to 4, raised by at most one level by the reporter's own severity), likelihood from main road, school or hospital within 100 m, 3 or more distinct citizens, monsoon months and night-time hazards. 12 and above CRITICAL, 8 to 11 HIGH RISK, 4 to 7 MODERATE RISK, below 4 ROUTINE. Same formula in SQL (`ireport_risk()`) and Python (`priority.py`), compared by a test; every number is in `risk_config.py`. The models take no part in it. A scaled `priority_score` is kept only as a sort key. | `priority.py`, `risk_config.py` |
| GIS | The incident point is chosen in the report flow (device GPS, photo GPS, searched place or area centre) and stored as PostGIS `geography`. The profile area is never used. Area is `ST_Covers` on ward polygons if loaded, else the nearest seeded area centre. | `incidents.py` (`resolve_ward`) |
| Clustering | Map: `ST_ClusterDBSCAN` over open incidents (eps 300 m, min 2 points). Hotspots: `ST_ClusterDBSCAN` over open incidents of the last 30 days (eps 400 m, min 3 points); impact score = `min(100, round(0.6 * max priority_score + 0.4 * min(100, 8 * incident_count)))`, a plain formula, not an AI output; the control room shows the open and critical counts, not this score. Individual incidents are never merged by this. | `incidents.py` |
| Authority decision | The control room shows the hazard category with its reason and recommended action, the complaint's location and map, photos per reporter, history at the spot, nearby open work and a timeline. A photo-model result is shown only when it disagrees with the chosen category, tagged "AI suggestion, not verified". The officer sets the status and messages the citizen. | `AuthorityDashboard.tsx`, `IncidentDetail.tsx` |
| Map checks | PostGIS looks for a school or hospital within 100 m and a main road within 30 m in `osm_features`, loaded once from OpenStreetMap by `scripts/load_osm.py`. Without that data the citizen's flag is used and labelled "citizen says". | `incidents.py` (`refresh_geo_facts`), `scripts/load_osm.py` |

### Models and data

- **Text model `txt-1.0`**: trained on `ml/data/text/complaints.csv` (280 sentences, English/Hindi/Marathi). Held-out test (70 sentences): accuracy 0.743, macro-F1 0.731 (`ml/reports/txt-1.0.json`). Weak classes: Garbage recall 0.56, Other 0.22. The dataset is small; treat the number as indicative only.
- **Image model**: `img-1.0` is a **linear probe**: a frozen ImageNet EfficientNet-Lite0 (int8 ONNX, 3.83 MB) with a logistic-regression head, trained in about 3 minutes on CPU on 1,800 images from public datasets. It predicts 6 classes: Pothole, Road Damage, Streetlight, Garbage, Other, not_civic. Held-out test (360 images): accuracy 0.928, macro-F1 0.927; recall Garbage 0.90, Other 0.92, Pothole 0.88, Road Damage 0.97, Streetlight 0.97, not_civic 0.93. Limits: the test images come from the same public sources as the training images (de-duplicated, but not independent), so real-world accuracy will be lower; `not_civic` was trained on flowers and Caltech101 objects only; there are no Mumbai photos; Water Leakage, Drainage and Electrical Hazard have no data and are never predicted (the image result is ignored when the citizen has chosen one of those). Numbers: `ml/reports/img-1.0.json`.
- Photo quality (blurry / dark / low resolution) is a rule on pixel statistics, not ML.

### Honesty rules in the UI

- No confidence number is shown unless a model produced it.
- "Photo evidence: attached" never implies the photo was analysed.
- Hotspot and hazard-category explanations list only facts that are in the data, each with its source.
- Model output is labelled "AI suggestion, not verified" for officers, never changes the citizen's category, and never sets the hazard category or a due date.

---

