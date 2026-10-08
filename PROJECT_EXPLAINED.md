# iREPORT, how it works (verified against the code)

This file did not exist before this task; it was written from the code. It is the reference for the user-testing build.

## Flow
Citizen: Problem → 2–3 questions → Photo/voice/description → Location → Review → Submit → Success (Report ID).
Authority: control room (priority list, hotspots, AI/NLP evidence) → status/message. Admin: approvals + city overview.

## Incident location (GIS)
- `POST /reports` requires `lat`, `lng` and `location_source` (`photo` EXIF GPS | `gps` device | `manual` search/area pick). The profile area is never used.
- The report flow has no default pin. Photo GPS is pre-selected only when the photo has valid EXIF GPS; the citizen can change it.
- Ward/area: `ST_Covers` on `wards.geom` when polygons are loaded, else the nearest seeded area centre (`refdata.nearest_area`, within 12 km). No ward polygons ship with the repo (DECISIONS #1), so the fallback is what runs today.
- `GET /geo/resolve?lat&lng` returns the area and the department per category (review screen).
- Merge rule: same category, open, < 14 days, within 50 m → same incident, `affected_count` +1 per new citizen.

## AI (what is real)
- **Text model**: char n-gram TF-IDF + logistic regression, trained on 280 hand-written demo sentences, held-out macro-F1 0.73. Demonstration only.
- **Image model**: `backend/models/img-1.0.onnx` (linear probe on frozen EfficientNet-Lite0, 6 classes, DECISIONS #54). Tests use a tiny stand-in model. If the file is absent the API still works and the citizen picks the category.
- `/ai/analyze` always returns: `category, confidence, source (image|text|image+text|none), model_version, uncertain, not_civic, severity, flags, explanation, top3, ai_available, models{image,text}, agreement, disagreement, photo_quality[], photo_errors[], nlp, media_ids, gps_suggestion`.
- Multi-photo: probabilities are averaged over the photos that succeeded; an unreadable photo is skipped and reported in `photo_errors`.
- **Photo quality** (rule-based, Pillow/NumPy): resolution, brightness, blur (Laplacian variance). Heuristic thresholds, not ML.
- Agreement: both models ran and agree → "AI evidence: high confidence"; both ≥ 0.60 on different categories → "needs verification" with a one-tap choice. Stored per report: `ai_category`, `ai_confidence`, `ai_source`, `ai_disagreement`, final category, `user_corrected`.
- The confidence "N/A" bug was in the UI: it printed "?" / "Not available" whenever the result was *uncertain*, even with a real number. Fixed; the number is shown with its source.

## Rule-based (not ML)
Severity, risk flags, priority score (`priority.py`, mirrors SQL `ireport_priority`), photo quality, and NLP extraction (`ai/rules.py: extract_nlp`): duration, obstruction, hazard, urgency, from the citizen's own text in English/Hindi/Marathi/Hinglish. A field is `null` when the text does not say it. Urgency is derived from severity + flags + duration. The NLP result is computed server-side at submit and stored in `reports.nlp`.

## Hotspots
`GET /authority/hotspots` and `admin/overview.hotspots`: open incidents grouped by area. `impact_score = 100 × (area's summed priority scores) / (largest area's sum)`. Also returns open count, critical count, categories with counts, unique citizens, confirmations. Incidents stay separate. 
## Map dashboard (authority control room + admin)
`GET /authority/map` and `GET /admin/map` return every incident with its PostGIS coordinates, per-area totals and clusters. Leaflet + OpenStreetMap tiles draw one point per problem (colour and size = priority level); area chips filter the map and the card list; clicking a card or point opens the full detail (admin: `GET /admin/incidents/{id}`, read-only, no phone numbers).
**ML:** clusters are unsupervised DBSCAN (`ST_ClusterDBSCAN`, UTM 43N, eps 300 m, min 2 open incidents). It shows where problems pile up; it predicts nothing. The text-classifier output and agreement flag are shown in the same detail view; priority and NLP stay labelled rule-based.

## Data added by migration 0004 (`reports`)
`location_source`, `citizen_message`, `ai_source`, `ai_disagreement`, `nlp`.

## Endpoints added
`/geo/resolve`, `/me/contribution`, `/authority/hotspots`, `/admin/overview`; `/authority/stats` gains `high_open`, `new_24h`.

## Departments
Category → department from the seeded reference tables. No officer names or contacts are shown: authority profiles have no "official/public" flag.

## Profile contribution
Counts only: reports submitted; verified (resolved, or backed by another citizen's report/confirmation); confirmations given. "Trusted contributor" needs verified ≥ 3 and ≤ 25% category corrections.

## Languages
`src/i18n.ts` (flow, review, AI card, success, profile, home cards) and `src/questions.ts` (questions), same lang-keyed-table approach as `copy` in `App.tsx`. Voice input is unchanged (Web Speech API; the transcript becomes the description).
