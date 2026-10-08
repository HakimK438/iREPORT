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
| AI prediction | **Text model** `txt-1.0` classifies the description into a category. **Image model**: not currently trained/deployed (see below). | `backend/app/ai/` |
| Confidence | Shown only when a model produced it. Text-only: the percentage is labelled as coming from the description. No model: "Confidence unavailable". If photo and text models both run and disagree, the citizen is asked to confirm the category. | `ai/pipeline.py`, review screen in `ReportFlow.tsx` |
| Priority | Deterministic points: severity + flags + affected citizens + age. Same formula in SQL (`ireport_priority()`) and Python (`priority.py`); the reasons shown to authorities are computed from it. Not an ML score. | `priority.py` |
| GIS | The incident point is chosen in the report flow (device GPS, photo GPS, searched place or area centre) and stored as PostGIS `geography`. The profile area is never used. Area is `ST_Covers` on ward polygons if loaded, else the nearest seeded area centre. | `incidents.py` (`resolve_ward`) |
| Clustering | Map: `ST_ClusterDBSCAN` over open incidents (eps 300 m, min 2 points). Hotspots: open incidents grouped by area; impact = area's summed priority relative to the busiest area (top = 100). Individual incidents are never merged by this. | `incidents.py` |
| Authority decision | Dashboard shows location (area, lat/lng, Open in Map), photo, description, AI/NLP, priority reasons, hotspot reasons; authority sets status and sends a message the citizen sees. | `AuthorityDashboard.tsx`, `IncidentDetail.tsx` |

## Models and data

- **Text model `txt-1.0`**: trained on `ml/data/text/complaints.csv` (280 sentences, English/Hindi/Marathi). Held-out test (70 sentences): accuracy 0.743, macro-F1 0.731 (`ml/reports/txt-1.0.json`). Weak classes: Garbage recall 0.56, Other 0.22. The dataset is small; treat the number as indicative only.
- **Image model**: not currently trained/deployed. `img-1.0` (EfficientNet-Lite0 ONNX) in the repo has an untrained head and was used only for size/latency tests (`ml/reports/img-1.0-benchmark.json`: "No accuracy is claimed"). The app reports "Image model unavailable" and keeps the photo as evidence; the category comes from the text model and the citizen.
- Photo quality (blurry / dark / low resolution) is a rule on pixel statistics, not ML.

## Honesty rules in the UI

- No confidence number is shown unless a model produced it.
- "Photo evidence: attached" never implies the photo was analysed.
- Hotspot and priority explanations list only counts that are in the data.
