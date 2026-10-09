# iREPORT: complete project workflow

A civic-problem reporting platform for Metropolitan Mumbai. Citizens report potholes, garbage, broken streetlights, water leaks, electrical hazards and other problems with photos, short answers, a description and an exact map pin. The system analyses each report, ranks it, and gives the responsible authority a prioritised control room. An admin approves the officers who may use it.

This file explains the whole project end to end: what exists, how data moves, how each decision is made, and what is real versus a demonstration. Where another file is more detailed, it is named.

> Independent civic platform. It is not an official BMC website.

---

## Contents

1. [The idea in one page](#1-the-idea-in-one-page)
2. [Architecture](#2-architecture)
3. [Repository map](#3-repository-map)
4. [Running it](#4-running-it)
5. [The three users and what each can do](#5-the-three-users-and-what-each-can-do)
6. [Citizen workflow, step by step](#6-citizen-workflow-step-by-step)
7. [What happens on the server when a report is submitted](#7-what-happens-on-the-server-when-a-report-is-submitted)
8. [The AI pipeline](#8-the-ai-pipeline)
9. [Rule-based parts (not machine learning)](#9-rule-based-parts-not-machine-learning)
10. [Priority score](#10-priority-score)
11. [GIS: location, areas, merging, hotspots](#11-gis-location-areas-merging-hotspots)
12. [Photo handling and storage](#12-photo-handling-and-storage)
13. [Authority workflow](#13-authority-workflow)
14. [Admin workflow](#14-admin-workflow)
15. [Community and My Reports (citizen side after submit)](#15-community-and-my-reports-citizen-side-after-submit)
16. [Database](#16-database)
17. [API reference](#17-api-reference)
18. [Security and privacy](#18-security-and-privacy)
19. [Background jobs](#19-background-jobs)
20. [Languages](#20-languages)
21. [Frontend structure](#21-frontend-structure)
22. [Example photos from the training dataset](#22-example-photos-from-the-training-dataset)
23. [Testing and measured performance](#23-testing-and-measured-performance)
24. [Honesty section: what is real, what is a demo](#24-honesty-section-what-is-real-what-is-a-demo)
25. [Known limits and what to do next](#25-known-limits-and-what-to-do-next)
26. [Demo script](#26-demo-script)
27. [Change history of this build](#27-change-history-of-this-build)

---

## 1. The idea in one page

```
Citizen sees a problem
        |
        v
  chooses problem(s) -> answers 2-3 taps -> (optional) describes by typing or voice
        |
        v
  uploads photos -> taps the exact spot on the map
        |
        v
  AI + rules analyse the photo and words  ->  citizen reviews everything  ->  Confirm & Submit
        |
        v
  server saves the report, links photos, finds the area (PostGIS), merges with a nearby identical report if any,
  computes a priority score
        |
        v
  Authority control room: list sorted by priority, map, hotspots, AI + rule evidence, status updates, messages
        |
        v
  Citizen sees status changes and messages in My Reports; neighbours can confirm the same problem in Community
```

Design principles used throughout:

- **The exact place of the problem is what is stored.** The citizen's home area is never used as the incident location.
- **The AI only suggests.** If it fails or is unsure, the citizen chooses the category and reporting continues.
- **Every score has visible reasons.** Nothing about priority is hidden.
- **Every output says where it came from:** ML model, fixed rule, GIS, or the citizen.
- **No fabricated accuracy.** Model limits are stated in the app and in the docs.

---

## 2. Architecture

```
 Browser (React 19 + Vite + Tailwind 4, Leaflet maps, TanStack Query)
    |  JSON over HTTPS, access token in memory, refresh token in an httpOnly cookie
    v
 FastAPI backend (Python 3.12, one uvicorn worker)
    |-- routers: auth, me, admin, ai, reports, incidents, authority, health
    |-- ai/: ONNX Runtime image model + numpy text model + rules (no PyTorch)
    |-- images.py: validation, EXIF read, metadata strip, WebP + thumbnail
    |-- incidents.py: report creation, merge rule, hotspots, map clusters
    |-- priority.py: priority score (mirrors a SQL function)
    |-- jobs.py: APScheduler jobs inside the API process
    |
    +--> PostgreSQL 16 + PostGIS 3.4   (users, incidents, reports, media rows, wards, messages, ...)
    +--> S3-compatible object storage  (MinIO locally; R2 or S3 in production). Only object keys live in the DB.
```

Runtime facts:

- Frontend dev server: port 8443 or 5173 (both allowed by CORS in `.env.example`).
- API: `http://localhost:8000/api/v1`, interactive docs at `/api/docs` (disabled when `ENV=production`).
- Postgres: host port **5434** (5432 and 5433 were taken on the dev machine).
- MinIO: ports 9000 (S3) and 9001 (console).
- Migrations run automatically when the API container starts. Reference data (wards, departments, categories) is loaded into memory at startup.

---

## 3. Repository map

```
iREPORT_Copy/
|-- src/                      Frontend (see section 21)
|-- public/categories/        Photos for the six home-page category cards (+ CREDITS.md)
|-- public/media/             BMC headquarters photo, flow poster/video
|-- backend/
|   |-- app/
|   |   |-- main.py           App factory, lifespan (load refdata, seed admin, load models, start scheduler)
|   |   |-- config.py         All settings from environment variables
|   |   |-- models.py         SQLAlchemy models
|   |   |-- schemas.py        Pydantic request/response models (ReportIn, AiIn, ...)
|   |   |-- incidents.py      create_report, merge rule, hotspots, map data, history, messages, priority refresh
|   |   |-- priority.py       Priority formula in Python (identical to SQL ireport_priority())
|   |   |-- refdata.py        In-memory wards/departments/categories + AREA_CENTRES (29 areas)
|   |   |-- images.py         Image validation and processing
|   |   |-- storage.py        S3Storage (MinIO/R2/S3) and MemoryStorage (tests)
|   |   |-- answers.py        Whitelist of quick-answer ids -> risk flags
|   |   |-- jobs.py           Scheduled jobs
|   |   |-- security.py, deps.py, errors.py, ratelimit.py, paging.py, db.py
|   |   |-- ai/               pipeline.py, image_model.py, text_model.py, rules.py
|   |   `-- routers/          auth, me, admin, ai, reports, incidents, authority, health
|   |-- alembic/versions/     0001 schema, 0002 seed, 0003 list indexes, 0004 report evidence,
|   |                         0005 report answers, 0006 more areas + sample_confidence
|   |-- models/               txt-1.0.npz (text model), img-1.0.onnx + img-1.0.json (image model)
|   |-- scripts/              seed_demo, seed_dataset_photos, seed_load, bench, table_sizes, load_wards
|   `-- tests/                86 pytest tests
|-- ml/                       Offline training/evaluation only (never imported by the API)
|-- docs/                     AI_AND_GIS.md, I18N_REVIEW.md
|-- DECISIONS.md              56+ numbered design decisions with reasons
|-- PROJECT_EXPLAINED.md      Short how-it-works note for the user-testing build
|-- TODO_LATER.md             Known gaps
|-- docker-compose.yml, .env.example
`-- PROJECT_WORKFLOW.md       This file
```

---

## 4. Running it

Needs Docker and Node 22.

```bash
cp .env.example .env              # set JWT_SECRET and ADMIN_PASSWORD
docker compose up --build         # postgres+postgis (5434), minio (9000/9001), api (8000)
```

Frontend:

```bash
npx pnpm@10 install
npx pnpm@10 dev                   # reads VITE_API_URL (default http://localhost:8000/api/v1)
npx pnpm@10 build                 # production build into dist/
```

Development-only demo data (refuses to run with `ENV=production`):

```bash
docker compose exec api python -m scripts.seed_demo
```

Creates a demo citizen (`aarav@example.com` / `citizen123`), a demo officer (`officer@bmc.demo` / `bmc12345`), 30 neighbour accounts and 9 sample incidents with confirmations, status history and messages. The first admin comes from `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` and is created at startup only if no admin exists.

Tests:

```bash
docker compose --profile test run --rm tests     # 86 backend tests
ml/.venv/Scripts/python -m pytest ml/tests        # text runtime equals scikit-learn
```

Health: `GET /api/v1/health` (process is up), `GET /api/v1/ready` (database and models).

---

## 5. The three users and what each can do

| Role | How they get in | Can do |
|---|---|---|
| **Citizen** | Registers and is logged in immediately | Report problems, see own reports with status timeline and messages, reply to the authority, browse Community, confirm neighbours' problems, export or delete own data |
| **Authority** (BMC officer) | Registers with department, ward/area and employee ID; stays **pending** until an admin approves | See every problem sorted by priority, filter and search, open details (photos, AI and rule evidence, citizen text and message, location), change status, message citizens (one or many), use the map, hotspots and clusters |
| **Admin** | Created from environment variables at first start | Approve, reject or revoke authorities; see city overview (unresolved critical, workload per department, category concentration, top hotspots) and a read-only map and incident view without phone numbers |

Login takes the role, so a citizen account cannot sign in on the authority tab and vice versa. Staff users never see the "Report a problem" button; opening it sends them to their own dashboard.

---

## 6. Citizen workflow, step by step

The report flow is a lazy-loaded chunk (`ReportFlow.tsx`), so the home page loads no AI or photo-compression code. It has **five steps**. Back is available on every step and nothing is lost going back. Pressing Escape or the close button only hides the flow; the draft (answers, photos, location, AI result) stays in memory until "Start over".

### Step 0: home page and login

- Hero, then "What civic problems can you report?" with six category cards (photos from `public/categories/`; an icon card shows if a file is missing), then Help & FAQ with the BMC head-office card.
- Tapping a category (or "Start a report") opens the flow. If the person is not logged in they are sent to the login page first and the flow opens right after login.

### Step 1: Problem

- Six categories: Potholes & Road Damage, Garbage & Waste, Broken Streetlights, Water & Drainage, Electrical Hazards, Other Civic Issues.
- **Multi-select, up to 3.** The first selected is the **Main** problem; others show "+1", "+2". Each extra problem becomes its own report at the same place, with its own answers, photos, AI result and priority, so the right team receives it.
- Internal category names stay stable in the API: `Pothole`, `Garbage`, `Streetlight`, `Water Leakage`, `Electrical Hazard`, `Other`. Older reports using `Road Damage` and `Drainage` are shown under their merged citizen-facing names.

### Step 2: Questions (and optional description / voice)

- 2 to 3 tap-only questions per category from `questions.ts` (examples: pothole size, where it is, who is at risk; garbage blocking and duration; streetlight fully dark and safety; water amount and duration; electrical danger).
- Answers map into the fields the backend already understands: `problem_type` (English, because severity rules read it), risk **flags** from a fixed list (for example "Main road", "Near school", "Live wiring", "Blocks footpath", "Flood risk", "Night-time hazard", "Injury reported"), and a short sentence added to the description so the rule-based text reader can pick up duration and obstruction.
- With several problems selected, each gets its own question group. The first question of each group must be answered to continue.
- **Describe it (optional)** text box with a **voice button**. Voice uses the browser's Web Speech API in the chosen language (en-IN, hi-IN, mr-IN). Spoken words are written into the box live so they can be edited. Clear messages cover: unsupported browser, blocked microphone, no speech heard, other errors. The description is limited to 500 characters.

### Step 3: Photo & place (one combined step)

- **Upload only** (no separate camera button). Up to 3 photos; JPEG, PNG, WebP, HEIC/HEIF. Each photo is compressed in the browser first (`compress.ts`).
- With more than one problem selected, each photo has a dropdown "Which problem is in this photo?".
- As soon as photos are added, the app calls the analysis endpoint in the background so that, if a photo carries GPS, the pin can be pre-filled.
- **Location** (the highest-risk part, so it is explicit):
  - A Leaflet map. **Tap** to drop a pin, **drag** to adjust, or press "I am at the problem now (use GPS)".
  - If a photo has GPS, the app offers it and pre-selects it only when nothing was chosen yet.
  - There is no default pin and no locality search or area dropdown. The location source is always one of `photo`, `gps` or `manual`.
  - After a pin is placed, an OpenStreetMap reverse lookup suggests a short street/area label (for example "Hill Road, Bandra"). It fills the editable "Landmark / address" field. If the lookup fails, only coordinates are used.
- To continue: a pin must exist, and there must be a photo or a description.

### Step 4: Review

Everything the citizen is about to send, with a tag on each line saying where it came from (From you / Rule-based / GIS / ML model):

- Photos, **Problem** (editable, with a category picker), **Incident location** (landmark, exact coordinates, source, and the line "The authority will see this exact point"), **Area / ward** (from PostGIS), **Responsible department**, count of **similar open reports within 50 m** (yours will join them), **Severity** (rule-based preview) with flags.
- If extra problems were chosen: a box listing them as separate reports.
- **AI analysis card** (details in section 8): detected problem, confidence ring, source chips, photo-vs-text bars, evidence list, photo quality, agreement or "needs verification" with a one-tap choice between the two categories, and an "About this AI" note that states the model limits.
- **What we read in your description** (NLP card, section 9): duration, obstruction, hazard, urgency. Shown as "not stated" when the text does not say it.
- Editable description, optional **message to the authority**, a confirmation tick, and **Confirm & Submit**.

### Step 5: Success

- Animated check mark, "Report Submitted Successfully", one **Report ID** card per report created (format `IR-YYYYMMDD-NNNNN`, date in IST), the area and department, and a button to track in My Reports.
- If an extra problem failed to file, the others are not undone and the failure is listed by name.

---

## 7. What happens on the server when a report is submitted

Two calls are involved.

### 7.1 `POST /ai/analyze` (during step 3 / 4)

1. Rate-limited per citizen (20 per window).
2. Each photo goes through `images.process` (section 12). One unreadable photo is skipped and reported in `photo_errors`; the others continue. If nothing usable and no text exists, the first error is returned.
3. Good photos are stored as **draft media** (full WebP and thumbnail in object storage; a `media` row with `report_id = NULL`).
4. The AI pipeline runs (section 8). Any exception degrades to "AI unavailable" with HTTP 200.
5. The response includes the AI result, `media_ids`, signed `thumb_urls`, `photo_quality`, `photo_errors`, the NLP read, the department for the chosen category and `gps_suggestion` (first photo GPS found).
6. The browser upload progress is shown; the 8-second AI timeout starts only after the upload finishes.

### 7.2 `POST /reports`

`create_report` runs in one transaction:

1. **Validate** the category and that every `media_id` belongs to this citizen and is still unattached.
2. **Assess** severity and flags with the rule engine from category, problem type, description, the flags sent and flags derived from the quick answers.
3. **Serialise per category** with a Postgres advisory lock so two neighbours reporting at the same instant still merge.
4. **Merge rule** (section 11): find an open incident of the same category within 50 m and under 14 days old.
   - Found: the incident's `affected_count` goes up by one (not for a citizen already counted), severity is raised if needed, flags are merged. The response says `merged: true`.
   - Not found: resolve the ward from the pin (PostGIS polygon if loaded, otherwise nearest area centre), create the incident with a public id, a `Reported` status event.
5. **Insert the report**: problem type, description, AI category/confidence/model version/source/disagreement, `user_corrected` (true when the final category differs from the AI's), `location_source`, the citizen's message, the **NLP result computed on the server** (never trusted from the client), and the quick answers.
6. **Attach photos** to the report.
7. **Recompute priority** for the incident (section 10).

AI fields from the client are stored only as a training signal. The server recomputes severity and flags itself.

---

## 8. The AI pipeline

Code: `backend/app/ai/pipeline.py`. Models are loaded once at startup and warmed up. CPU only, ONNX Runtime, no PyTorch in the API.

### 8.1 Two small models

| Model | What it is | Honest status |
|---|---|---|
| **Image** `img-1.0` | Frozen ImageNet EfficientNet-Lite0 (int8 ONNX, 3.8 MB) with a logistic-regression head (a "linear probe"), temperature-scaled. Classes: Pothole, Road Damage, Streetlight, Garbage, Other, not_civic | Held-out accuracy 0.928, macro-F1 0.927 on 360 images from the **same public sources** as training (de-duplicated, but not independent). Real-world accuracy will be lower. No Mumbai photos. `not_civic` was trained on flowers and Caltech101 objects. **No data for Water Leakage, Drainage, Electrical Hazard**, so they are never predicted |
| **Text** `txt-1.0` | Character n-gram TF-IDF + logistic regression, exported to `.npz` and run with numpy only | Trained on 280 **hand-written demo sentences** (English, Hindi, Marathi, Hinglish). Held-out macro-F1 0.73. A demonstration, not a production classifier |

### 8.2 How the result is built (`analyze` and `combine`)

1. **Photos:** each photo is classified; probabilities are **averaged over the photos that worked**. A failed photo never discards the others.
2. **Skip rule:** if the citizen already chose a category the image model has no data for (for example Water Leakage), the image result is ignored, because it would be a guess among the wrong classes. The review card then says the photo is attached as evidence but not analysed.
3. **Text:** classified if a description exists (the quick-answer sentences are included).
4. **Blend:** when both ran, `0.7 x image + 0.3 x text`. When only one ran, that one is used.
5. **Output fields:** `category`, `confidence` (the blended top probability), `top3`, `uncertain` (true when not civic, models disagree, or confidence is below 0.60), `not_civic`, `source` (`image`, `text`, `image+text` or `none`), `image_confidence`, `text_confidence`, `model_version`, `ai_available`, `models` (status of each), `image_model_active`.
6. **Agreement:** with both models present, same top category -> `agree`; different top categories each at least 0.60 -> `disagree` with `{image, text}` shown to the citizen as a one-tap choice.
7. **Severity, flags, explanation, NLP** come from the rule engine (section 9), using the AI category only when it is sure, otherwise the citizen's own choice.
8. **Explanation sentence:** the "photo resembles..." wording is produced **only if an image model actually ran**. It is never invented.

### 8.3 What the UI shows from this

- Confidence is shown **with its source** ("from photo", "from your description", "photo + description"), and both individual values when both exist. A real number is never displayed as "N/A".
- `AI evidence: high confidence` when both agree; `AI classification needs verification` when they disagree.
- If no model produced anything: "AI unavailable - choose the category".
- Stored per report: `ai_category`, `ai_confidence`, `ai_source`, `ai_disagreement`, final category, `user_corrected`. The authority sees the same flag.

### 8.4 Unsupervised ML elsewhere

DBSCAN clustering of incident coordinates (section 11.4) is the only other machine-learning component. It finds where problems pile up; it predicts nothing.

---

## 9. Rule-based parts (not machine learning)

Code: `backend/app/ai/rules.py`, `priority.py`, `answers.py`, `images.photo_quality`. The UI labels these **Rule-based** and never calls them machine learning.

- **Severity** (Low / Medium / High / Critical): from category, problem type and words. Electrical hazards start Critical; words like dangerous, large, flooding raise it.
- **Risk flags**: a fixed list (Live wiring, Injury reported, Near school, Near hospital, Flood risk, Main road, Night-time hazard, Blocks footpath). They come from quick answers and from keywords in English, Hindi, Marathi and Hinglish. Cue words match as word prefixes in Latin script and as substrings in Devanagari.
- **NLP read of the citizen's own text** (`extract_nlp`), returned as `nlp: {duration, obstruction, hazard, urgency, flags}` and shown in review and in the authority detail:
  - **duration** ("4 days", "since last week", Hindi and Marathi numerals and words) with the parsed days
  - **obstruction** (road, footpath, entrance)
  - **hazard** (bikes, vehicles, children, live wire, water)
  - **urgency** derived from severity + flags + duration
  - Each field is `null` when the text does not say it. Nothing is guessed.
- **Photo quality** (Pillow and NumPy): resolution, brightness, blur via Laplacian variance, giving "good / blurry / dark / low resolution". Heuristic thresholds.
- **Department**: category to department from the seeded reference tables (Roads & Traffic, Street Lighting, Solid Waste Management, Water Supply, Storm Water Drains, Electrical Safety, General / Ward Office). No officer names or contacts are shown because authority profiles have no "official/public" field.

---

## 10. Priority score

Code: `priority.py` (and the SQL function `ireport_priority()` created in migration 0001; a test checks both agree on 300 random incidents). The database stores and sorts by the score; the **reasons are computed on read and never stored**, so every row can explain itself.

Points:

| Part | Points |
|---|---|
| Severity | Critical 40, High 30, Medium 18, Low 8 |
| Hazard type of the category | `categories.hazard_points` (up to 25) |
| Risk flags (sum, capped at 28) | Live wiring 20, Injury reported 18, Near school 12, Near hospital 12, Flood risk 10, Main road 8, Night-time hazard 6, Blocks footpath 5 (other flags 4) |
| Time open | 1.5 per day, up to 15; zero once resolved |
| Citizens affected | `1.6 x log2(1 + n)`, up to 8 |

```
score = round( min(100, (severity + hazard + flags + age + votes) / 116 * 100) )
level: Critical >= 65, High >= 48, Medium >= 30, Low < 30
```

Why it works this way: votes are a **small** part, so a dangerous problem with 2 reports ranks above a harmless one with 30 confirmations. A test asserts exactly that. Resolved incidents lose the age points and sort to the end of the list. Scores are refreshed every hour because age changes with time.

---

## 11. GIS: location, areas, merging, hotspots

### 11.1 From coordinates to action

```
exact pin (lat, lng, source)  ->  PostGIS geography point on the incident
        ->  area (ward) via polygon if loaded, else nearest seeded area centre (<= 12 km)
        ->  responsible department (via category)
        ->  authority list, authority/admin map, hotspot and cluster context
```

- The incident location is the citizen's pin. The profile "home area" is used only as the starting filter of Community and is never submitted as a report location. `location_source` (`photo`, `gps`, `manual`) is **required** on `POST /reports`.
- The address text (landmark or street label) is stored on the incident and shown in the incident title and the authority "Where" line, together with area and coordinates.

### 11.2 Areas

- 29 seeded neighbourhoods: Andheri West, Andheri East, Bandra, Colaba, Fort, Dadar, Goregaon, Malad, Borivali (originals) plus Versova, Juhu, Vile Parle, Santacruz, Jogeshwari, Kandivali, Dahisar, Mahim, Sion, Worli, Lower Parel, Byculla, Malabar Hill, Kurla, Ghatkopar, Chembur, Powai, Vikhroli, Bhandup, Mulund (migration 0006).
- Real ward polygons are not shipped. Until `scripts/load_wards.py` loads an open-data GeoJSON, the area is the nearest centre. The review screen marks this as "(nearest area)". The exact coordinates are stored either way.

### 11.3 Merge rule (de-duplication)

A new report joins an existing incident if it is the **same category**, the incident is **open**, **under 14 days old**, and within **50 m** (`ST_DWithin` on geography). Result: one incident, `affected_count + 1` per new citizen, no double counting for the same person, and all reports kept. Settings: `MERGE_RADIUS_M`, `MERGE_MAX_AGE_DAYS`.

### 11.4 Hotspots and clusters (unsupervised ML on PostGIS points)

- **Hotspots** (`GET /authority/hotspots`, admin overview): `ST_ClusterDBSCAN` on open incidents from the last 30 days, projected to UTM 43N so the distance is in metres. Parameters: eps 400 m, at least 3 incidents. Each hotspot returns area, open count, critical count, people affected, unique citizens, confirmations, categories with counts, main problems, and an **impact score** = `0.6 x worst incident priority + 0.4 x min(100, 8 x incident count)`. The result is cached in the API process for 60 seconds.
- **Map clusters** (`GET /authority/map`, `/admin/map`): the same idea with eps 300 m and at least 2 open incidents, drawn as dashed rings with a name such as "Pothole cluster near Kurla (3 open problems)".
- Individual incidents always stay separate rows. Clusters only group them for attention.

---

## 12. Photo handling and storage

Client (`compress.ts`): photos over about 300 KB are re-encoded in the browser, which also removes EXIF. Very large files are refused with a clear message.

Server (`images.py`), in this order:

1. Check **magic bytes** (the file must really be an image), size (default 8 MB) and pixel count (default 25 MP).
2. Read **EXIF orientation** and apply it.
3. Read **GPS** from EXIF (used only as a suggestion).
4. **Strip all metadata.**
5. Produce a main **WebP** (longest side 1280, quality stepped down to stay under 500 KB) and a **thumbnail** (longest side 400, about 20 KB).
6. Compute photo-quality checks and keep a decoded copy in memory for the classifier only.
7. Storage keys are random: `media/YYYY/MM/<uuid>.webp` and `thumbs/YYYY/MM/<uuid>.webp`. The database stores only keys.
8. Browsers see photos only through **signed URLs that expire after 15 minutes**. Open detail views refresh every 10 minutes for that reason.

Lifecycle: draft photos that never joined a report are deleted after 60 minutes; for incidents resolved more than 365 days ago the full image is deleted and the thumbnail kept.

---

## 13. Authority workflow

Entry: log in on the Authority tab (after admin approval). The page is the **Control room**.

### 13.1 Top of the page

- Seven live counters: total, open, in progress, **critical and open**, **high and open**, new in 24 hours, resolved. Everything refreshes every 20 seconds, with "Updated just now / N s ago".
- **Map dashboard** (Leaflet, OpenStreetMap tiles): one circle per problem, colour and size by priority level (colour-blind-safe because size also encodes level), DBSCAN cluster rings, area chips that filter the map and the card list, click a point or card to open the full detail.
- **Hotspot cards** (GIS): area, open and critical counts, citizens, confirmations, categories, and a plain-language "Impact N/100 because..." line. Clicking a card filters the list to that area.
- **By category** buttons with totals, open and solved bars.

### 13.2 "How the priority recommendation works"

An open panel explains, in the current language, that each problem gets a 0 to 100 score from: (1) severity, (2) type of problem, (3) risk nearby, (4) time open and people affected, with votes being a small part. It states that **the AI only suggests the category** and that the score is a fixed rule visible on every row. It also explains the "Example" photos (section 22).

### 13.3 The list: "Problems, most urgent first"

Filters: search (title, area, report ID), area, status, "hide resolved", sort (priority [recommended], newest, longest open, most affected). Infinite scroll with keyset paging.

Each row shows: priority score and level, title, category, area, people affected, age, risk flags, then:

- **Where:** street/landmark, area, exact coordinates
- **AI chip:** category, confidence, source (photo / description / both), "photo and text agree" or "needs verification", and "citizen changed the category"
- department, text urgency (from the NLP read)
- **Why this priority:** the top three reasons with their points
- the citizen's message to the authority
- status pill
- an "Example photo from the training dataset" chip on example incidents

### 13.4 Detail (click a row)

- Same photo(s) the citizen uploaded, with thumbnails.
- Reporter names and the citizen's descriptions.
- **Location** (GIS): address, area, coordinates, point source, "Open in Map", and an embedded map.
- **AI classification** (ML) with any photo-vs-description disagreement.
- **Reading of the citizen's text** (Rule-based): duration, obstruction, hazard, urgency.
- Responsible department and the citizen message.
- Problem cluster explanation when part of a DBSCAN cluster.
- **Why this priority (N/100)** with all reasons.
- Message thread, a message box, and actions: **Send message**, **Under review**, **In progress**, **Mark resolved**.
- Phone numbers are returned only when explicitly requested by an authority (`include_phone=true`).

### 13.5 Bulk actions

Select up to 100 problems, type one message, then message all, mark in progress, or resolve all, in a single transaction. Every status change writes a `status_events` row; messages are stored in `messages`.

---

## 14. Admin workflow

- Counters: pending requests, approved authorities, citizens, total problems.
- Read-only **city map** and incident detail (no phone numbers).
- **City overview:** unresolved critical count, open workload per department (bars), category concentration with a **recommendation text** such as "Road Damage -> Roads team" (nothing is assigned or stored, because no assignment field exists), and top hotspots with their impact explanation.
- **Waiting for approval:** Approve / Reject. **Approved authorities:** Revoke access. A revoked or rejected authority cannot log in.

---

## 15. Community and My Reports (citizen side after submit)

**Community** (public feed, works for guests):
- Choose an area from the list, or use device location. Filters: Nearby, All, Potholes, Streetlights, Garbage, Water, Electrical, Pending, In Progress, Resolved. Sort: Nearest, Recent, Most affected, High severity.
- Cards show the real photo thumbnail, type, severity, title, area and distance, citizens affected, status. Logged-in citizens can **Like / Confirm** an incident (adds one to affected count; a reporter cannot double count their own). Share uses the browser share sheet or copies text.
- Example incidents show a purple "Example photo from the training dataset" badge and a note explaining it.

**My Reports** (citizen only, refreshes every 60 s):
- Each report: thumbnail, status pill, title, area and department, people affected, report ID, severity.
- A four-step timeline: Reported -> Under review -> In progress -> Resolved, with timestamps.
- The thread of authority messages (and the citizen's replies), plus a reply box once the authority has written.
- A note that "Resolved is not the final word": the citizen can verify the fix.

**Profile:** name, email, home area (labelled as used for Community only), a contribution block with raw counts (reports submitted, reports resolved, neighbour confirmations; a plain "Contributor" or "Trusted contributor" label only when the data supports it, never by volume alone), latest three reports, language switch, privacy tools (download my data as JSON, delete my account), FAQ, notifications (unread count).

---

## 16. Database

PostgreSQL 16 + PostGIS 3.4. All schema changes go through Alembic; existing migrations are never edited.

| Migration | Adds |
|---|---|
| 0001 | Schema, enums, `ireport_priority()` SQL function, indexes, `incident_public_seq` |
| 0002 | Seed: departments, categories (with hazard points), 8 starting areas |
| 0003 | List/paging indexes (including `pg_trgm` search) |
| 0004 | Report evidence: `location_source`, `citizen_message`, `ai_source`, `ai_disagreement`, `nlp` |
| 0005 | `reports.answers` jsonb (quick answers) |
| 0006 | 21 more areas and `reports.sample_confidence` |

Main tables:

- **users** (role, name, email, argon2 password hash, phone, ward/area, language, `messages_seen_at`), **authority_profiles** (department, employee id, approval state, decided_at)
- **wards** (name, optional polygon), **departments**, **categories** (code, name, department, hazard points)
- **incidents** (public id, category, PostGIS `location` geography point, ward, address text, severity, flags, status, affected_count, priority_score, created/updated/resolved timestamps)
- **reports** (incident, user, problem type, description, AI fields, `user_corrected`, `location_source`, `citizen_message`, `nlp`, `answers`, `sample_confidence`)
- **media** (report, uploader, storage key, thumbnail key, size)
- **confirmations**, **status_events** (history of status changes with actor), **messages** (authority to citizens and replies, with read tracking)

Relationship in words: one **incident** is a real-world problem; many **reports** (one per citizen) can attach to it through the merge rule; each report can have up to three **media**.

---

## 17. API reference

All under `/api/v1`. JSON. Errors are `{"error": {"code", "message"}}`.

| Area | Routes |
|---|---|
| Auth | `POST /auth/register` (citizen logs in at once; authority becomes pending), `POST /auth/login` (takes the role), `POST /auth/refresh` (cookie, rotated; reuse of an old token ends all sessions), `POST /auth/logout` |
| Me | `GET/PATCH /me`, `GET /me/export`, `DELETE /me`, `GET /me/contribution`, `GET /me/summary` |
| AI | `POST /ai/analyze` (multipart: up to 3 photos, text, lang, optional lat/lng, category, problem_type) |
| Citizen | `POST /reports`, `GET /reports/mine`, `GET /incidents/nearby`, `GET /incidents/{id}`, `POST/DELETE /incidents/{id}/confirm`, `POST /incidents/{id}/messages`, `GET /messages/unread-count`, `GET /geo/resolve?lat&lng` (area + department per category) |
| Authority | `GET /authority/incidents` (filters: ward, category, status, q, hide_resolved, sort, cursor, limit), `GET /authority/stats`, `GET /authority/hotspots`, `GET /authority/map`, `GET /authority/incidents/{id}`, `POST /authority/incidents/{id}/update`, `POST /authority/incidents/bulk` (up to 100) |
| Admin | `GET /admin/authorities`, `POST /admin/authorities/{id}/decision` (approve / reject / revoke), `GET /admin/stats`, `GET /admin/overview`, `GET /admin/map`, `GET /admin/incidents/{id}` |
| Ops | `GET /health`, `GET /ready` |

`/ai/analyze` response fields: `category, confidence, source, model_version, uncertain, not_civic, severity, flags, explanation, top3, ai_available, models{image,text}, agreement, disagreement, image_confidence, text_confidence, image_model_active, department, photo_quality[], photo_errors[], nlp, media_ids, thumb_urls, gps_suggestion`.

Incident rows returned to the frontend include `sample_confidence` (null except for example incidents).

---

## 18. Security and privacy

- **Passwords:** argon2. **Sessions:** short-lived access token (15 min) kept only in browser memory; refresh token (30 days) in an httpOnly cookie, rotated on every use; reusing an old refresh token ends all of that user's sessions.
- **Roles** are enforced on the server for every route. Authority access requires admin approval.
- **Rate limits** on login (by IP and by email), register and analyze. In-memory, per process.
- **Headers:** nosniff, frame deny, no-referrer, same-site resource policy, a locked-down Content-Security-Policy and `no-store` on API responses; HSTS when cookies are secure. CORS lists only the configured frontend origins.
- **Uploads:** magic-byte check, size and pixel caps, metadata stripped, random keys, private bucket, 15-minute signed URLs.
- **Privacy:** name, email, optional phone and area are collected with a consent line. Data export and account deletion exist; deletion anonymises the person while reports remain without identity. Phone numbers are shown to authorities only on explicit request and never to admins. Authority actions are logged in `status_events` and `messages`. A review under India's DPDP Act, 2023 is recommended before launch.

---

## 19. Background jobs

APScheduler runs inside the API process (disable with `ENABLE_SCHEDULER=false` on extra replicas):

| Job | Every | Does |
|---|---|---|
| `cleanup_drafts` | 10 min | Deletes photos uploaded by `/ai/analyze` that never joined a report (older than 60 min) |
| `refresh_priorities` | 1 hour | Recomputes priority scores because age points change |
| `expire_full_images` | 24 hours | Keeps only the thumbnail for incidents resolved more than 365 days ago |

---

## 20. Languages

English, Hindi (हिन्दी) and Marathi (मराठी), chosen in the header or profile and remembered in local storage and on the account.

- One simple system: tables keyed by language, no i18n library. `src/i18n.ts` (flow, review, AI card, success, profile, community, authority and admin headings), `src/questions.ts` (questions and options), and the `copy` table in `App.tsx` (home, navigation).
- Civic wording: Hindi uses **शिकायत** and Marathi **तक्रार** for "report/complaint"; "confidence" is भरोसा (Hindi) and खात्री (Marathi).
- All Hindi and Marathi text was written by an AI assistant and **has not been reviewed by a native speaker**. See `docs/I18N_REVIEW.md`. `scripts/check-i18n.mjs` checks for empty strings and key parity only.
- Still English: the authority detail panel body, the login/registration page and the FAQ.

---

## 21. Frontend structure

React 19, Vite 8, Tailwind 4, TanStack Query (all server data), Leaflet (maps). The access token lives in memory only.

| File | Role |
|---|---|
| `main.tsx` | Mounts the app with the query client |
| `App.tsx` | Header, pages (Home, Community, My Reports, Profile), mobile nav, session restore, language, opens the report flow |
| `ReportFlow.tsx` | The five-step report flow (section 6) |
| `LocationPicker.tsx` | Tap/drag pin map for the incident location |
| `questions.ts` | Per-category questions and the mapping from answers to problem type, flags and add-on sentences |
| `compress.ts` | In-browser photo compression |
| `api.ts` | Typed fetch wrapper, token refresh on 401, `analyze()` with upload progress, all endpoints and types |
| `i18n.ts` | Strings in three languages |
| `AuthPage.tsx` | Login and registration for the three roles |
| `AuthorityDashboard.tsx` | Control room (section 13) |
| `IncidentDetail.tsx` | Shared detail panel (authority; read-only for admin) |
| `AdminPanel.tsx` | Admin screen (section 14) |
| `MapDashboard.tsx`, `ProblemMap.tsx` | Authority/admin map with points, clusters and area chips |
| `brand.tsx`, `Icon.tsx`, `store.ts` | Brand mark, category lists and home cards, icons, shared types and area lists |
| `index.css` | All styling |
| `src/imports/` | Unused Figma export (safe to delete; left untouched) |

UI conventions: skeleton loaders, polling instead of WebSockets (20 s for the control room, 60 s for citizen pages), mobile-first layout with a bottom navigation bar, keyboard-focusable controls, aria labels on maps and the confidence ring.

---

## 22. Example photos from the training dataset

Script: `backend/scripts/seed_dataset_photos.py` (development only). No training happens.

1. Load the shipped image model.
2. Score the dataset images (`ml/data/images/test` and `val`).
3. Keep an image only if the model's predicted class **matches the folder label** and its confidence is at least 0.85.
4. Sort by confidence, take the top 5 with at most 2 per category.
5. For each, run the real photo pipeline, store it, and create a report through the normal `create_report` path at a distinct real Mumbai location, with the AI fields filled from the model's actual output.
6. Set `reports.sample_confidence` to the model's confidence.

Result in this build: 2 streetlights (Powai, Sion), 2 potholes (Versova, Kurla), 1 other (Worli), each about 99.99 percent confidence, each with its own street label and exact coordinates.

How they are shown: a purple **"Example photo from the training dataset - model confidence N%"** badge in Community, on authority rows and in authority detail, plus an explanation note. They are examples, **not citizen reports**, and the confidence is on data the model was trained on, so it says nothing about real-world accuracy. Water Leakage and Electrical have no dataset images.

Re-run: `docker compose exec api python -m scripts.seed_dataset_photos <images-dir>` (it refuses if examples already exist).

---

## 23. Testing and measured performance

**86 backend tests, all passing.** They cover auth (refresh rotation and reuse detection, rate limits, role checks, approval and revocation); the merge rule (50 m, same category, open, under 14 days, no double counting); keyset paging; priority (SQL equals Python on 300 random incidents; dangerous-with-2 beats safe-with-30); the image pipeline (magic bytes, limits, EXIF orientation and GPS, stripping, WebP sizes, HEIC); the AI (image only, multilingual text only, disagreement, failure still returning 200, draft cleanup, missing and corrupt model cases); incident location (profile area never becomes the incident location); retention and hourly refresh. Image tests use a tiny generated ONNX stand-in. 2 ML tests check the text runtime equals scikit-learn. The frontend builds with `pnpm build`.

Measured on a development laptop (2026-10-07; re-run on the real server before launch):

| Budget | Result |
|---|---|
| `/ai/analyze`, one 250 KB photo, 2 vCPU | p95 876 ms |
| Image inference | p95 51 ms |
| Model files | image 3.8 MB, text 0.14 MB; API image 509 MB, no PyTorch |
| Stored photo / thumbnail | about 173 KB / 19 KB (hard cap 500 KB) |
| `/authority/incidents` with 100,000 incidents | p95 76 ms |
| `/authority/hotspots` | p95 82 ms cached; about 1 s on a cache miss |

---

## 24. Honesty section: what is real, what is a demo

| Output | Kind | Notes |
|---|---|---|
| Image category and confidence | ML (linear probe on frozen EfficientNet) | Test set shares sources with training; no Mumbai photos; 3 civic categories never predicted |
| Text category and confidence | ML (small TF-IDF + logistic regression) | 280 hand-written sentences; demonstration only |
| Severity, flags, urgency, duration, obstruction, hazard | Fixed rules | Not machine learning |
| Priority score and reasons | Fixed formula | Visible on every row |
| Photo quality | Heuristic thresholds | Not ML |
| Area / ward | GIS | Nearest of 29 centres until polygons are loaded |
| Hotspots and map clusters | Unsupervised ML (DBSCAN) on PostGIS points | Shows where problems pile up; predicts nothing |
| Department | Reference table | Category to department |
| Example photos | Dataset images chosen by model confidence | Not citizen reports |

Rules the build follows: never fabricate a prediction, confidence or accuracy; never show an image prediction when no image model ran; AI failure never blocks reporting; every output is labelled with its origin.

---

## 25. Known limits and what to do next

- The new multi-problem flow, Photo & place step, map pin, voice box and redesigned review card were built and compile, and the API was verified, but they were **not clicked through in a real browser**. Voice needs Chrome and a microphone; maps need internet for OpenStreetMap tiles.
- Load real ward polygons (`scripts/load_wards.py`) for exact area names.
- Collect real Mumbai photos and data for Water Leakage, Drainage and Electrical Hazard; use an independent test set; improve the `not_civic` negatives; consider a full fine-tune (`ml/train_image.py`).
- Replace the 280-sentence text model with one trained on real reports.
- Native-speaker review of Hindi and Marathi; translate the remaining English screens.
- Officer name/contact per ward needs an "official/public" field on authority profiles.
- Nominatim reverse lookup is called from the browser; add a backend proxy if usage grows.
- One API process: rate limits are per replica and the scheduler should run on one replica only.
- Remove the unused `src/imports/` folder.
- Before launch: privacy review (DPDP Act), run the benchmarks on the real server, set `ENV=production`, a random `JWT_SECRET`, `COOKIE_SECURE=true`, private bucket credentials, and the frontend origin in `CORS_ORIGINS`.

---

## 26. Demo script

1. Start the stack (`docker compose up --build`), run `seed_demo` and, if wanted, `seed_dataset_photos`; start the frontend.
2. **Register a citizen** with home area Andheri West.
3. Start a report: select **Potholes** (and optionally **Garbage** as a second problem). Answer the questions. Type or speak a description such as "Large pothole near the school gate for 4 days, bikes are skidding".
4. In Photo & place, upload a pothole photo. Tap the map somewhere **far from Andheri** (for example Kurla). The street label appears; the home area is untouched.
5. Review: see the AI card (confidence with source), the evidence, the NLP read (duration 4 days, hazard bikes, school), area from GIS, department, and the similar-reports count. Add a message to the authority and submit. Note the report ID.
6. Log in as the officer (`officer@bmc.demo` / `bmc12345`). In the Control room open the new problem: same photo, the **Where** line with the exact pin, AI chip, "Why this priority" reasons, the citizen message, the department. Mark it **In progress** and send a message. Open the hotspots and map.
7. Back as the citizen, open **My Reports**: the status and the message appear in the timeline.
8. Log in as admin to approve a new authority and view the city overview.
9. Switch the language to Hindi and Marathi at any point to see the translated flow, authority and admin headings.

---

## 27. Change history of this build

**Earlier user-testing build** (see `PROJECT_EXPLAINED.md` and `DECISIONS.md`): incident location separated from profile area; image-to-report linking verified; AI confidence made visible with its source; agreement and disagreement handling; short report flow with Back and draft preservation; home categories and real images; profile contribution counts; rule-based NLP; DBSCAN hotspots and map; authority intelligence; department lookup; admin overview; Hindi and Marathi for the citizen flow; the `img-1.0` image model.

**This round (nine requested changes):**

1. Up to 3 problems per report, each filed separately at the same place with its own answers, photos and AI result.
2. Photo step is upload-only.
3. Description and voice moved into the questions step as optional, with live transcript and specific error messages.
4. Location merged into the photo step as a tap/drag map pin with GPS and photo-GPS; locality search and area dropdown removed; exact coordinates and a street label are stored and shown to the authority; 21 more areas (migration 0006).
5. Review page and AI analysis card redesigned (confidence ring, source chips, photo-vs-text bars, evidence list, quality, agreement actions).
6. Authority "How the priority recommendation works" panel.
7. Five high-confidence dataset photos added as labelled example incidents in Community and the authority dashboard (`reports.sample_confidence`, `seed_dataset_photos.py`).
8. Authority dashboard made clearer: translated labels, "Problems, most urgent first", a "Where" line and a "Why this priority" line on every row, example badges.
9. Hindi and Marathi wording replaced across citizen, authority and admin sections; authority and admin headings translated.

Verification for this round: `pnpm build` passes (one pre-existing type error remains in the unused `src/imports` folder); all 86 backend tests pass (one test expectation was updated because more areas change which area a point near Malad belongs to); the API returns the five example incidents with photos, areas and coordinates. Not verified: the new flow in a real browser.
