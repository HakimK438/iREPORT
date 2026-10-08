# IREPORT_FINAL_TASK.md — Fix & improve the existing iREPORT app (time-boxed)

Read `PROJECT_EXPLAINED.md` first: it describes how this app already works (AI pipeline, priority, merge rule, storage, API). The app is **already built and far more complete than a typical prototype**. This is a repair + visibility job, not a rebuild. Verify every statement in PROJECT_EXPLAINED.md against the code as you go and correct the file if something is wrong.

## RULES
- **HARD TOTAL BUDGET: 2 HOURS MAXIMUM.** Tier A is the priority and must be completed first; use remaining time for Tier B in order. Do not extend the task beyond 2 hours.
- Execute continuously. **Do not stop after a phase and ask for approval.** If a task overruns its time box, implement the smallest reliable fix, write one line to `TODO_LATER.md`, and immediately continue.
- Spend max 5 min reading, print a 5-line plan, then start Task 1 without waiting.
- Spend max 5 min reading, print a 5-line plan, then start Task 1 without waiting.
- No rebuilds, no PyTorch in the API (ONNX Runtime only), no new heavy libs, no duplicate APIs, no new algorithms. Reuse existing routers, schemas, react-query, design system, i18n, PostGIS, MinIO, Alembic (add a migration only if a column is truly required).
- **ML honesty rules:** never fabricate a prediction, confidence or accuracy. Do not claim image accuracy: no trained image model is shipped (`backend/models/img-1.0.onnx` is absent by design, DECISIONS.md #22). The text model is a small char-n-gram TF-IDF + logistic regression trained on 280 hand-written demo sentences (held-out macro-F1 0.73). Say exactly that in the UI/docs. AI failure never blocks reporting (manual category + "AI unavailable").
- Image processing: do not break `backend/app/images.py` (magic bytes, size/pixel limits, EXIF orientation, GPS read, metadata strip, WebP + thumbnail). Check order of operations (client `compress.ts` → upload → server EXIF/GPS read → strip). Preprocessing in `ai/image_model.py` must stay identical to what the training script (`ml/train_image.py`/`export_onnx.py`) uses.
- After each task: run backend tests (`docker compose --profile test run --rm tests` or local pytest) and `pnpm build`; commit; print one line `TASK n: root cause → fix → verified by`.

---
# TIER A — MUST (≈ 2 hours)

### A1. Incident location ≠ profile location (20 min)
Find where the user's profile area/home location ends up as the incident location (frontend default payload, `gps_suggestion` handling, backend fallback in `routers/reports.py`/`incidents.py`, ward/area lookup). Incident lat/lng = photo EXIF GPS (`gps_suggestion` from `/ai/analyze`, if present and valid) → else the location chosen/detected in the report flow (device GPS or map pin). Profile location is never used. Authority dashboard, incident detail and map use the incident coordinates; ward/area derived from them via PostGIS.
Test (pytest): register user at A → report at B → DB geometry = B, `/authority/incidents` returns B, `/incidents/{id}` returns B, `/me` still A.

### A2. Image ↔ report link (15 min)
Trace FormData → `/ai/analyze` (draft photos, `media_ids`) → `POST /reports` (attaches media_ids) → storage key → `photos` row → signed URL (15 min expiry) → frontend. Check: media_ids from a different draft/user attached to the wrong report, stale react-query cache keys, expired signed URLs shown after refresh, list vs detail returning different photos, thumbnail vs full mixed up. Fix root cause, no hardcoded images. Test with 2 reports/2 images.

### A3. Image AI + confidence, made visible and honest (25 min)
Root cause is almost certainly: no image model file → `p_img=None` → `combine()` uses text only (or returns `confidence=None`) and the UI shows N/A. Verify in `ai/pipeline.py`, `routers/ai.py`, `schemas.py`, `src/api.ts`, `ReportFlow.tsx`.
- API must always return: `category, confidence, source ("image"|"text"|"image+text"|"none"), model_version, uncertain, not_civic, severity, flags, explanation, top3, ai_available` (add `ai_available` / per-model status if missing).
- UI "AI Analysis" card shows only real fields: Detected problem, Confidence % **with its source** ("from photo" / "from your description" / "photo + description"), Visual/text evidence = the `flags` + `explanation` rules.py actually produced, Severity, Image quality (cheap deterministic checks only: resolution, blur via Laplacian variance, brightness — computed server-side in the existing image pipeline with Pillow/NumPy; show as "Photo quality: good / blurry / dark").
- If no image model: say "Photo stored — category chosen from your description/manual" and never display image-based evidence. If nothing available: "AI unavailable — choose category". Never "N/A" when a number exists.
- Multi-photo: confirm averaging in `analyze()` is correct and a failed photo doesn't discard the rest.
Tests: model present (use the existing tiny ONNX stand-in), model missing, corrupt image.

### A4. Image + text agreement (10 min)
`combine()` already computes `disagreement`. Surface it: agree → "AI evidence: high confidence"; disagree → "AI classification needs verification" + one-tap choice between the two categories (and manual) on the review screen; store AI category, final category, `user_corrected` (existing fields). Authority view shows the same flag.

### A5. Report flow: questions, Back, review, success (30 min)
- Questions: max 2–3 per category, using the existing category-specific logic in `ReportFlow.tsx` (pothole: size/traffic impact/people affected; garbage: blocking/duration; streetlight: fully dark/safety; water, electrical, other equivalent). Map answers into existing `problem_type`/flags/affected inputs.
- Back button at every step, state preserved (Problem → Questions → Photo → Location → Review → Submit).
- Review screen: problem, **incident location + detected area/ward**, AI card (A3/A4), affected, severity, correct photo, optional "message to authority" (store on the report; add a column/migration only if none exists; show in authority detail, separate from AI fields), editable fields, "Confirm & Submit".
- Success screen: CSS checkmark animation (<1 s), "Report Submitted Successfully", Report ID, "Track it from your dashboard".

### A6. Profile (10 min)
Fix loading/visibility: name, email, my reports with status and photo, status tracking. Contribution line from existing data: reports submitted / verified (resolved or confirmed by others) / community confirmations given. No levels beyond one plain label if data supports it (e.g. "Trusted contributor" only when verified ≥ 3 and corrected-category rate low); never by volume alone.

### A7. Home page + real category images (10 min)
- Rename "What can you report?" → "What civic problems can you report?" with 🕳️ Potholes & Road Damage · 🗑️ Garbage & Waste · 💡 Broken Streetlights · 💧 Water Leakage & Flooding · ⚡ Electrical Problems · 🚧 Other Civic Issues.
- Real images per category: look in `public/categories/` for `pothole.jpg, garbage.jpg, streetlight.jpg, water-leakage.jpg, electrical.jpg, other.jpg` (the user places 6 real photos there). Use them in the category cards (lazy-loaded, fixed aspect ratio, alt text, no layout shift). If a file is missing, show the emoji card — never a wrong/placeholder image. Do NOT download random stock images; if you add any, only from Wikimedia Commons / Unsplash with the license noted in `public/categories/CREDITS.md`.
- Remove unrelated/placeholder images (check `public/media/bmc-headquarters.jpg` and the video are actually relevant) and any visible Figma references in the UI. Don't touch `src/imports/` unless nothing imports it; tell me instead.

---
# TIER B — IMPROVEMENTS (≈ 1.5–2 hours, in this order)

### B1. NLP that is useful, not just a label (20 min)
Extend `ai/rules.py` (rule-based, already used for severity/flags) — no new model. Extract only from the citizen's text, in English/Hindi/Marathi/Hinglish keywords: **duration** ("4 days", "since last week", "चार दिन", "४ दिवस"), **obstruction** (road/footpath/entrance), **hazard** (bikes, vehicles, children, live wire, water), **context** (school/hospital/main road — already flags), **urgency** (derived from severity+flags+duration). Return as `nlp: {duration, obstruction, hazard, urgency, flags}`, null when not found (never guess). Show on the review screen and authority detail. Feed duration/obstruction into existing flags only where `priority.py` FLAG_POINTS already has them (e.g. "Blocks footpath"); don't change the priority formula. Tests for ≥ 8 sentences incl. Hindi/Marathi.

### B2. Hotspots from PostGIS (25 min)
Today the "merge rule" (50 m, same category, open, <14 days) only deduplicates the same problem. Add a hotspot view on top, without a new algorithm: group open incidents by **ward/area** (existing `load_wards.py` data + PostGIS `ST_Contains`) — optionally `ST_ClusterDBSCAN` with ~300 m radius if it is a few lines of SQL. Per hotspot return: area, open incidents, categories + counts, unique citizens (distinct reporter), confirmations, **impact score** (explain it: e.g. normalized sum of incident priority scores, documented in code + docs), main problems. Individual incidents stay separate. Endpoint added to the existing authority router (extend `/authority/stats` or one new GET).

### B3. Authority dashboard shows the intelligence (25 min)
Using existing `/authority/incidents` + stats + B2: counts of Critical/High, recent reports, per row: category, AI confidence + source + agreement flag, priority score with its `reasons`, affected, confirmations, incident location (mini-map or ward + coordinates), citizen message, status. Hotspot cards at the top. Live refresh: react-query `refetchInterval` ≈ 20 s + "Updated just now" (no WebSocket unless one already exists).

### B4. Area → responsible authority (10 min)
Only from existing data: area/ward → department(s) from the seeded `departments`/`categories`/`areas` (see migration 0002, `refdata.py`). Show "Responsible department" for the selected category in the review screen and on incident detail. Show an officer name/contact only if an approved authority user with public fields exists for that ward/department; otherwise show the department only. Never expose private data (email/phone of citizens or personal emails of officers unless marked official).

### B5. Admin / higher authority view (20 min)
Extend `routers/admin.py` stats + `AdminPanel.tsx` (currently authority approvals): top hotspots, unresolved Critical count, per-department open workload, category concentration. "Assign to department" only if an assignment field already exists on incidents; otherwise show recommendation text ("Road Damage → Roads team") without storing anything.

### B6. Languages (15 min)
Locate the existing translation mechanism and fix missing/wrong Hindi + Marathi strings on: home, report flow, review, AI card, success, profile, dashboards. One system only. Voice input: leave as is.

### B7. Docs (10 min)
Update `PROJECT_EXPLAINED.md` so it matches the final code (keep honest model/dataset statements). Copy the ML/GIS part to `docs/ML_AND_GIS.md` only if time remains.

---
# OPTIONAL TIER C — only if I explicitly say so
Training an image model. Needs a labelled dataset (RDD2022/Kaggle pothole, TACO for garbage; see `ml/README.md`). Only if data is available locally, train with `ml/train_image.py`, export with `ml/export_onnx.py`, evaluate with `ml/evaluate.py` on a held-out test split, and report the real numbers. If accuracy is poor, do not ship it as "working"; keep manual selection.

---
# FINISH
Print: (a) task checklist done/partial/skipped, (b) `pnpm build` + backend test results, (c) steps to demo the scenario A→B (register at A, report pothole at B with photo+description+answers+message; authority sees location B, AI card, priority reasons, hotspot; citizen sees status update), (d) `TODO_LATER.md`.


---

# 2-HOUR USER-TESTING PRIORITY OVERLAY

The following requirements are mandatory when they overlap with the task list above.

## 1. DO NOT POLISH — MAKE THE USER FLOW WORK

The target is a **working user-testing build**, not a visually perfect production redesign.

Do not spend time on:

- unnecessary animations
- redesigning the entire design system
- changing fonts/colors without a bug
- refactoring working components
- rebuilding existing APIs
- creating elaborate dashboards
- creating a full team/assignment system
- adding WebSockets
- training a new image model
- replacing working libraries

A simple, reliable implementation is better than a polished incomplete implementation.

## 2. THE MOST IMPORTANT DEMO FLOW

This exact flow must work:

```text
Citizen registers at Area A
        ↓
Citizen starts a report
        ↓
Selects civic problem
        ↓
Answers only 2–3 relevant questions
        ↓
Adds real photo
        ↓
Adds description / voice input
        ↓
Selects or detects actual incident location B
        ↓
AI + NLP analysis
        ↓
Citizen reviews:
  - category
  - photo
  - location B
  - area/ward
  - AI confidence/source
  - AI evidence
  - NLP
  - severity/priority
  - department
  - message
        ↓
Confirm & Submit
        ↓
Success + Report ID
        ↓
Authority dashboard
        ↓
Authority sees:
  - same real photo
  - location B
  - AI evidence
  - confidence/source
  - NLP
  - priority + reasons
  - hotspot/GIS context if implemented
  - citizen message
  - department
        ↓
Citizen dashboard sees status/update
```

The profile/home location **must remain A**. The incident location **must be B**.

## 3. LOCATION IS THE HIGHEST-RISK BUG

Do not accept code that does this:

```text
incident_location = user.area
incident_location = user.ward_id
incident_location = AREA_CENTRES[user.area]
```

unless it is only used to display a selectable starting point and is never silently submitted as the incident location.

The report must require a genuine incident location.

Location sources should be explicit:

```text
photo
gps
manual
```

If the existing application uses `area`, ensure that it does not mean "profile location silently became incident location."

## 4. GIS VALUE MUST BE VISIBLE

Do not merely claim GIS exists in documentation.

Make the user-testing value visible:

```text
Actual coordinates
→ PostGIS geometry
→ ward/area
→ responsible department
→ authority map/location
→ hotspot/cluster context
```

If hotspot clustering cannot safely fit inside the 2-hour limit, keep the existing GIS location/ward behavior correct and put the hotspot work in `TODO_LATER.md`.

## 5. ML/AI VALUE MUST BE VISIBLE WITHOUT FABRICATION

The application should visibly demonstrate the real intelligence already available:

```text
Photo
+
Description
+
Category
+
Question answers
+
Location
        ↓
AI/NLP
        ↓
Classification/evidence
        ↓
Severity/priority
        ↓
Authority decision support
```

The UI must clearly distinguish:

```text
ML output
Rule-based output
GIS-derived output
User-provided information
```

Never call a deterministic rule "machine learning."

Never show an image prediction when no image model is actually loaded.

## 6. CONFIDENCE BUG MUST BE INVESTIGATED, NOT MASKED

If confidence is missing:

1. Find where it disappears.
2. Check model output.
3. Check `combine()`.
4. Check API schema/serialization.
5. Check frontend API mapping.
6. Check React state/rendering.
7. Fix the real cause.

Only if the image model is genuinely absent should image confidence remain absent.

Text confidence can still be shown when produced by the real text model.

## 7. PHOTO + VOICE + DESCRIPTION

The system should preserve actual evidence:

- uploaded photos remain linked to the report
- voice input becomes the description text
- description is sent through the existing NLP/AI pipeline
- multiple images remain available
- one failed image does not remove the others

Do not replace photos with summaries or generated placeholders.

## 8. REPORT FLOW SHOULD BE SHORT

The report flow must feel like:

```text
Problem
→ 2–3 questions
→ Photo
→ Location
→ Review
→ Submit
```

Do not make the citizen complete a long form.

## 9. BACK NAVIGATION IS REQUIRED

Every step must have Back.

Going backward must not erase:

- selected problem
- answers
- description
- voice text
- photos
- location
- valid AI result

Fix the existing behavior where Escape or correction can lose the entire draft.

## 10. HOME PAGE MUST BE UNDERSTANDABLE

Use normal civic language.

Prefer:

> What civic problems can you report?

with:

- Potholes & Road Damage
- Garbage & Waste
- Broken Streetlights
- Water Leakage & Flooding
- Electrical Problems
- Other Civic Issues

Do not show misleading demo incident text or unrelated photos.

## 11. AUTHORITY PANEL MUST SHOW DECISION SUPPORT

The authority should not see only a raw incident table.

At minimum, make the following visible if already available:

```text
Problem
Photo
AI confidence + source
AI agreement/disagreement
NLP evidence
Severity
Priority score
Priority reasons
Affected/impact
Location
Ward/area
Department
Citizen message
Status
```

The goal is to demonstrate that the application helps an authority **prioritize and understand reports**, not merely store them.

## 12. ADMIN DOES NOT NEED A FULL ASSIGNMENT SYSTEM

The higher-authority/admin view should help identify:

- critical unresolved problems
- hotspots
- department workload
- category concentration

If actual assignment infrastructure exists, use it.

If not, show a recommendation such as:

```text
Road Damage → Roads Department
Garbage → Sanitation Department
Streetlight → Electrical Department
```

Do not build a complex assignment workflow just for this task.

## 13. PROFILE CONTRIBUTION MUST BE REAL

Show useful contribution information from actual data:

```text
Reports submitted
Reports resolved/confirmed
Community confirmations
```

Do not create fake reputation points.

If there is insufficient data, show the raw counts instead of inventing a score.

## 14. MULTILINGUAL FLOW

Fix the citizen-facing English/Hindi/Marathi flow.

At minimum, verify:

- home category labels
- report steps
- questions
- review
- AI card
- success
- profile/tracking

Keep the existing voice-input implementation.

Do not build a new i18n architecture.

---

# 2-HOUR HARD STOP

The original task may contain more work than can safely be completed in two hours.

Therefore:

### P0 always wins.

Complete in this order:

```text
1. Actual incident location
2. Correct image/report linking
3. AI/confidence visibility
4. Report flow + Back + review + success
5. Home/category correctness
6. Profile/tracking
7. NLP
8. Authority intelligence
9. GIS hotspots
10. Admin/language/documentation
```

If the 2-hour limit is reached:

- stop adding new features
- run the fastest meaningful verification
- record unfinished items in `TODO_LATER.md`
- report exactly what passed and what did not

Never pretend unfinished work is complete.

---

# FINAL CLAUDE CODE BEHAVIOR

Use this task file as the execution specification.

When started:

```text
Read this entire file.
Read PROJECT_EXPLAINED.md.
Inspect the actual repository.
Print a 5-line plan.
Immediately execute.
Do not ask for permission between tasks.
Do not stop for phase approval.
Do not rebuild.
Do not fabricate.
Prioritize the P0 user-testing journey.
Stop at the 2-hour hard limit.
Print the final verification report.
```

