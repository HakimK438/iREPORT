# Features and behaviour

# Contents

1. [What it provides](#what-it-provides)
2. [Hazard categories](#hazard-categories)
3. [Complaint lifecycle](#complaint-lifecycle)
4. [Architecture](#architecture)
5. [Repository map](#repository-map)
6. [Run it](#run-it)
7. [Tests](#tests)
8. [API](#api)
9. [Data and AI honesty](#data-and-ai-honesty)
10. [Known gaps](FEATURES.md#known-gaps)
11. [Detailed documentation](#detailed-documentation)

---

## What it provides

### Citizens

| Feature | What it does |
|---|---|
| Guided report flow | Pick the problem, answer a few quick questions (typed or spoken), add up to 3 photos, pin the exact spot (device GPS, photo GPS or tap on the map), review, submit. |
| Several problems at one place | A citizen can choose up to **3 problems** in step 1. The first is the **Main problem**; the rest are shown as "Other problems at this place" (each can be made main or removed). Each problem becomes its own complaint with its own answers, photos, priority and department. The officer sees which one was the main problem and what else was reported there. |
| One report per spot | If you already reported the same spot within 50 m (any category) the server refuses a repeat and offers to **add a photo** to your report instead. The only exception is a batch of up to three problems filed together in one submission (`also_of`, see decision 87). |
| Confirm instead of duplicating | If someone else already reported a problem within 50 m, you can **confirm** it. The affected count goes up without a second report. |
| Photo and text assistance | Two small CPU models suggest a category from the photo and the description. The suggestion is **marked as unverified** and the citizen's choice always wins. A photo the image model is sure shows something else (or no civic problem) is **refused**: the citizen sees "Remove photo and upload another", and the server also rejects it on submit (`photo_mismatch`), so wrong images never fill the database. A weaker mismatch keeps the report but flags it for review. |
| My Reports | A six-step timeline (Reported, Seen, Scheduled, Work started, Fixed, Closed), side states (On hold, Not accepted, Merged, Sent to the right department), and messages from the ward office. |
| Confirm or reopen | When a complaint is marked fixed the reporter confirms it (it closes) or reopens it with a reason. With no answer in 72 hours it closes automatically. |
| Community feed | Nearby open problems, sortable, with a one-tap confirm. |
| Privacy tools | Download your data, delete your account (reports stay, anonymised). |
| How it works | A visual step guide, tips, an emergency call-out (call 112 first for live wires or injuries) and an FAQ. |

### Officers (authority control room)

| Feature | What it does |
|---|---|
| Area authority tabs | One tab per area authority ("Dadar Authority"). Your own area is highlighted. Another area needs that authority's own sign-in (in development the demo login is pre-filled). |
| Count chips | All, New, Acknowledged, Scheduled, In progress, Awaiting verification, Closed, Overdue. Each number equals the list total for the same filters. A second row filters by priority: All priorities, Critical, High risk, Moderate risk, Routine. |
| Hazard categories | CRITICAL, HIGH RISK, MODERATE RISK, ROUTINE, each with a symbol, a colour, a one-line reason and a recommended action. The internal score is never shown as the decision. |
| Complaint list | The complaint's own photo (or a plain "No photo" box, never category art), what and where, hazard chip, due date or "Overdue", status, assignee. Search, area, category and sort filters. |
| Incident brief | One complaint read top to bottom like a work order: what, why it is urgent (at most 3 reasons, each with its source), where (area picture, small map, Navigate, Copy location), evidence per reporter, history at this spot, nearby open work, timeline, messages. |
| Image check (one line) | Each complaint states what the image model saw in the photo and whether it fits the reported problem, for example "the photo looks like Electrical Hazard (96% sure), which matches the reported problem". It also prints on the work order. It shows only the model's real result. |
| Why this deadline | Each complaint explains its deadline: when it was reported, how long that priority allows (24 hours, 3 days, 14 days or 30 days), the deadline, how late it is, the officer's first action (or "nobody has acknowledged it yet") and who owns it. |
| One next action | A single primary button that matches the status (Acknowledge, Start work, Mark resolved). Everything else is under **More**: schedule a visit, hold, reject, mark duplicate, transfer to another category. **Mark resolved** opens a box for a completion note (required, shown to the citizen). |
| Potentially fake / needs review | A report whose photo only weakly matches, or whose photo and description disagree, is flagged. The officer opens it and chooses "It is genuine" or "Reject as fake". |
| Bulk actions | Acknowledge, assign, schedule or message many complaints at once. **Resolving is never bulk.** Skipped items (including ones outside the officer's area or department) are reported. |
| Map | Open complaints in the officer's own area, coloured by hazard category, problem clusters, area cards, cards showing each problem's own photo. |
| Print work order | An A4 sheet per complaint: hazard box, details, reasons, reporters and photos, history, nearby work, timeline, blank fields for work done, material, crew, and signature lines. |
| Analysis tab | A "What this means for you" block first (busiest area, most common problem with a suggested action, overdue count, on-time share, backlog trend, open complaints by priority), then today card, overview KPIs, 12-week backlog chart, area-wise bars (overdue vs open), hazard mix donut, on-time performance by department and ward, repeat spots (poor repair quality), season chart, a map with Critical / Overdue / Unassigned / All open layers, CSV export, and a printable report with an area-wise summary. Every chart title is a sentence computed from the data and every chart has a text summary and a data table. |

### Administrators

The page opens with the map of every complaint in Mumbai, then a dashboard in which **every number is a count over the complaint, report and user tables** (nothing estimated or modelled), using the same rules as the officers' analysis:

- Eight summary cards, each with its definition: open complaints, critical and high risk, overdue, not assigned, resolved share, fixed on time (with the typical fix time), new in 7 days against the week before, waiting for citizen confirmation. Plus citizen reports, citizens registered, officers approved, approvals pending, reports to review.
- A 12-week line chart (reported, finished, still open), priority bars, a problem-type donut, area-wise stacked bars (overdue, open on schedule, resolved), a department table, ranked hotspots with impact bars, an officer workload table, and a collapsed "How these numbers are counted" box.
- Approve, reject or revoke officer accounts, the read-only complaint view, and a printable city report.

Endpoint: `GET /admin/performance`.

### Who sees what

- **Citizen:** reports problems, confirms or reopens a fix. Never assigns work.
- **Area authority (officer):** sees and changes only complaints in their own **area (ward) and department**. The server enforces this on the list, the counts, the map, the detail, every update, bulk actions and assigning. Another area's complaint returns 403 `out_of_scope`. An officer can only assign to colleagues of the same department and area. An officer with no area covers the whole city, and the General / Ward Office department covers every category.
- **Admin:** reads every complaint in Mumbai, approves officers, and sees the city dashboard.

A **How it works** tab (after "Control room", for officers and admins, in English, Hindi and Marathi) shows the journey of a complaint, the four priority levels, screenshots of the main screens, what every button means, the statuses and the categories.

---

## Hazard categories

The decision shown to officers is one of four categories, computed from a risk value (**impact x likelihood**, 1 to 16), the risk-matrix method used in road maintenance practice (the UK "Well-managed Highway Infrastructure" risk-based approach and IRC:82 maintenance categories).

| Category | Risk | Recommended action shown |
|---|---|---|
| CRITICAL | 12 to 16 | Make the site safe first, then repair. |
| HIGH RISK | 8 to 11 | Send a team to inspect and schedule the repair. |
| MODERATE RISK | 4 to 7 | Schedule the repair in normal work. |
| ROUTINE | 1 to 3 | Add to planned maintenance. |

- **Impact (1 to 4)** comes from the category: electrical hazard 4; pothole, road damage, drainage, water leakage 3; garbage and streetlight 2; other 1. A reporter who describes it as dangerous can raise impact by one level, never lower it.
- **Likelihood (1 to 4)** starts at 1 and gains one point for each of: on a main road; within 100 m of a school or hospital; 3 or more different citizens reported or confirmed; monsoon months (June to September) for road and water problems; a night-time hazard or an open streetlight complaint within 100 m.
- Every reason shows where it came from: **checked on map**, **citizen says**, **complaint records**, **calendar** or **category**.
- A due date is stored for each complaint (24 hours, 3 days, 14 days or 30 days from the report time, by risk). It only ever moves earlier on re-scoring, so a promise already made is never extended. Overdue means open and past the due date.
- A numeric `priority_score` (risk scaled to 0 to 100) is kept **only as a sort key**.
- All numbers live in one file, [backend/app/risk_config.py](backend/app/risk_config.py). The same formula exists in Python and in SQL, and a test compares them on 1,024 input combinations.

Design notes and the reasons behind each choice are in [DECISIONS.md](DECISIONS.md) (entries 57 onward).

---

## Complaint lifecycle

```
Reported -> Acknowledged -> Scheduled -> In Progress -> Resolved -> Closed
Side states: Reopened, On Hold, Rejected, Duplicate, Transferred
```

- **Open** means Reported, Acknowledged, Scheduled, In Progress, Reopened or On Hold. This is defined once in `backend/app/status.py` and once as the SQL function `ireport_is_open()`; a test proves they agree.
- Rules enforced on the server: On Hold and Rejected need a reason; Duplicate needs the original complaint number and moves its reporters across (the count is recomputed from distinct people); Transfer needs the correct category (the department follows it) and a reason and puts the complaint back in the new department's queue as Reported; Closed and Reopened belong to the citizen.
- **Resolved needs a completion note** (at least 5 characters, shown to the citizen) and is always one complaint at a time: bulk resolve is refused.
- **The officer who works a complaint owns it.** Acknowledging, scheduling, starting or resolving a complaint that has no owner assigns it to the acting officer (the timeline records "took ownership"), so a complaint is never In progress with nobody responsible.
- Every transition is written to `status_events` with the actor and the reason.

---

## Architecture

```
Browser (React 19 + Vite + Tailwind 4, Leaflet maps, TanStack Query)
        |  JSON over HTTPS, access token in memory, refresh token in an httpOnly cookie
        v
FastAPI (one process): routers -> services (incidents, workflow, brief, analytics) -> SQL
        |                         |                         |
        v                         v                         v
PostgreSQL 16 + PostGIS      S3-compatible storage      ONNX Runtime (CPU)
(incidents, reports, events, (photos as WebP + thumbs,  text model + image model,
 messages, osm_features)      signed URLs)               no PyTorch
        ^
        |  APScheduler jobs inside the API process: draft photo cleanup, hourly
        |  re-scoring, 72-hour auto-close, full-image retention
```

- The backend is the source of truth. The browser never decides urgency, "open", or overdue.
- Spatial work (distance, merge radius, clusters, nearby work) is done by PostGIS, not in the browser.
- Stack: Python 3.12, FastAPI, SQLAlchemy 2 (async), Alembic, PostgreSQL 16 + PostGIS 3.4, MinIO or S3/R2, ONNX Runtime, APScheduler; React 19, Vite 8, Tailwind 4, TanStack Query 5, Leaflet 1.9; Docker Compose.

---

## Repository map

```
src/                  React app: App.tsx (citizen pages), AuthorityDashboard.tsx, AreaTabs.tsx, IncidentDetail.tsx (the brief),
                      AnalysisTab.tsx, AdminPanel.tsx, AdminPerformance.tsx (admin dashboard), StaffGuide.tsx (How it works),
                      MapDashboard.tsx, ProblemMap.tsx, ReportFlow.tsx, i18n.ts / i18nStaff.ts
public/areas/         location pictures per area      public/symbols/   hazard category symbols
public/guide/         screenshots and example photos used by the How it works page
backend/app/          FastAPI app
  routers/            auth, me, reports, incidents, authority, analytics, admin, ai, health
  incidents.py        report creation, merge and duplicate rules, risk inputs, map data
  workflow.py         status transitions and their rules, citizen confirm/reopen, 72 h auto-close
  priority.py         risk formula, response categories, reasons    risk_config.py   every tunable number
  status.py           the one definition of "open"                  brief.py         the complaint brief
  ai/                 text model, image model, rules (flags, severity, NLP)
backend/alembic/      migrations 0001 to 0016
backend/scripts/      seed_demo, seed_load, seed_area_problems, seed_extra_problems, backfill_image_check, load_osm, load_wards, bench, table_sizes
ml/                   prepare_data_v2.py builds the 20-per-class training set; train_probe.py trains and exports the model
backend/seed_data/     110 dataset photos (Pothole, Road Damage, Garbage, Electrical Hazard, Drainage, Other) used by the seed scripts
backend/tests/        pytest suite (133 tests)
ml/                   offline training and evaluation of the two models
docs/                 AI_AND_GIS.md, I18N_REVIEW.md, screenshots/
DECISIONS.md          every choice the brief left open, numbered
REVIEW_AUTHORITY_V2.md  review notes and manual test script for the authority v2 work
```

Migrations, in order: 0001 schema, 0002 seed (departments, categories, areas), 0003 list indexes, 0004 report evidence, 0005 report answers, 0006 more areas, 0007 Mumbai region areas, 0008 area fix, 0009 duplicate reports, 0010 status values, 0011 workflow, 0012 map features, 0013 risk priority, 0014 photo checks and the needs-review flag, 0015 owner backfill (every worked complaint has an owner), 0016 `reports.reported_with` (problems reported together).

---

## Run it

Needs Docker and Node 22.

```bash
cp .env.example .env              # set JWT_SECRET and ADMIN_PASSWORD
docker compose up --build         # postgres+postgis (host port 5434), minio (9000/9001), api (8000)
```

- API: http://localhost:8000/api/v1. Interactive docs: http://localhost:8000/api/docs (not served in production).
- Health: `GET /api/v1/health` (process up) and `GET /api/v1/ready` (database and models).
- Migrations run when the API container starts. The first admin comes from `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
- Demo citizen, officer and complaints for development: `docker compose exec api python -m scripts.seed_demo` (refuses to run when `ENV=production`).
- More demo data, with relevant photos from the CivicFix dataset: `python -m scripts.seed_area_problems` (10 complaints in each of 16 Mumbai areas and one ward officer per area), then `python -m scripts.seed_extra_problems` (6 more per area using the additional photos). Both skip areas that are already seeded. Afterwards run `python -m scripts.backfill_image_check` so each stored photo carries the model's real result (the officer's one-line "Image check" never shows an invented value). The dataset photos are in `backend/seed_data/images/`; no model is trained.

Frontend:

```bash
npx pnpm@10 install
$env:PORT=5173; npx pnpm@10 dev    # PowerShell; reads VITE_API_URL (default http://localhost:8000/api/v1)
```

Open http://localhost:5173. Add the frontend's origin to `CORS_ORIGINS`. If the frontend and API are on different sites in production, set `COOKIE_SAMESITE=none` and `COOKIE_SECURE=true`.

Demo accounts (development only): citizen `aarav@example.com` / `citizen123`, officer `officer@bmc.demo` / `bmc12345`, area authorities `ward.<area>@bmc.demo` / `ward12345` (for example `ward.dadar@bmc.demo`). The admin account uses `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`.

Optional, run once by a developer: `python -m scripts.load_osm` downloads schools, hospitals and main roads from OpenStreetMap so "near a school" and "on a main road" are checked by PostGIS instead of taken from what the citizen ticked. If the download fails nothing is invented; the citizen's flags are used and labelled "citizen says".

More detail: [HOW_TO_RUN.md](WINDOWS_SETUP.md) (Windows).

---

## Tests

```bash
docker compose --profile test run --rm tests        # in the Python 3.12 image (uses the ireport_test database)
```

**133 backend tests** pass, plus 2 ML tests. They cover:

- authentication, refresh-token rotation and reuse detection, rate limits, role checks, authority approval
- one report per spot (409 at 49 m versus 51 m, any category), the merge rule, the hourly report limit, add-photo, the nearby check, and the migration that flags old repeat reports
- every workflow rule: reasons, duplicates moving reporters, transfers, citizen confirm and reopen, the 72-hour auto-close, one definition of "open"
- the risk formula: Python equals SQL on 1,024 combinations, map facts versus citizen claims, due dates that only move earlier, overdue
- chip counts equal the list totals under ward, category and search filters
- analytics: median days to close, within-due-date share, repeat spots, backlog, today card, CSV export that neutralises spreadsheet formulas
- area and department access: an officer sees, counts, maps and changes only their own scope, bulk skips what is outside it, and assigning is limited to colleagues in scope
- the photo check at submit (a wrong photo is refused, a doubtful one is flagged) and the review decisions
- resolving needs a note, bulk resolve is refused, and an officer who works a complaint owns it
- the admin dashboard totals equal the table counts
- several problems at one place: extras are filed with the main complaint, a batch link must be the citizen's own recent report at that spot
- the image pipeline, the AI endpoints, retention jobs

Frontend: `npx tsc --noEmit` (one old error remains in `src/imports/vite.config.ts`, a missing `.figma` file) and `npx vite build`.

---

## API

All routes are under `/api/v1`, JSON, errors as `{"error": {"code", "message"}}`.

| Area | Routes |
|---|---|
| Auth | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` |
| Me | `GET/PATCH/DELETE /me`, `GET /me/export`, `/me/summary`, `/me/contribution` |
| Reports | `POST /reports`, `GET /reports/mine`, `GET /reports/nearby-check`, `POST /reports/{incident_id}/photos` |
| Citizen | `GET /incidents/nearby`, `GET /incidents/{id}`, `POST/DELETE /incidents/{id}/confirm`, `POST /incidents/{id}/messages`, `POST /incidents/{id}/resolution/confirm`, `/resolution/reopen`, `GET /messages/unread-count`, `GET /geo/resolve` |
| AI | `POST /ai/analyze` (photos, text, language, category hints; returns a suggestion marked as such) |
| Officer | `GET /authority/incidents` (filters, sort, view chips, cursor paging), `GET /authority/stats`, `GET /authority/incidents/{id}` (the brief), `POST /authority/incidents/{id}/update`, `POST /authority/incidents/bulk`, `POST /authority/incidents/{id}/review`, `GET /authority/officers`, `GET /authority/areas`, `GET /authority/map`, `GET /authority/hotspots` |
| Analytics | `GET /authority/analytics/overview`, `/backlog`, `/by-ward`, `/by-type`, `/performance`, `/season`, `/today`, `/export.csv` |
| Admin | `GET /admin/authorities`, `POST /admin/authorities/{id}/decision`, `GET /admin/stats`, `/admin/overview`, `/admin/performance` (the dashboard), `/admin/map`, `/admin/incidents/{id}` |
| Ops | `GET /health`, `GET /ready` |

Rate limits: login, registration, photo analysis, 10 new reports per citizen per hour, 30 photo uploads per hour.

---

## Data and AI honesty

- **Image model v2 (`img-2.0`).** A frozen EfficientNet-Lite0 with a logistic-regression head, trained on **at most 20 images per class** (8 classes: Drainage, Electrical Hazard, Garbage, Other, Pothole, Road Damage, Streetlight, not_civic), mixing the older training folders with the CivicFix dataset (`ml/prepare_data_v2.py`, then `python ml/train_probe.py --data ml/data/images_v2 --version img-2.0 --augment 10`). Measured on photos it never trained on (708 test images): overall accuracy 75.7% (the previous model scored 63.6% on the same set, and 0% on electrical and drainage, which it had no class for). Recall: Electrical Hazard 93%, Drainage 92%, Road Damage 79%, Streetlight 83%, Garbage 71%, Other 68%, Pothole 58% (the dataset's pothole class is mostly wide road scenes). With the app's refuse and flag rules, a correct photo is wrongly refused 3.7% of the time (17.7% before; electrical 72% before, 2% now), but a non-civic photo sent as a report is refused 35 of 51 times (49 of 51 before): the rest are flagged or pass. The full-data model `img-1.0` is still in `backend/models/` and can be selected with `IMAGE_MODEL_NAME`.
- The two models are small and run on CPU: a text model (character n-gram TF-IDF with logistic regression, held-out macro-F1 0.73 on a small hand-written set) and an image model (a frozen EfficientNet-Lite0 with a logistic-regression head, int8 ONNX, 3.8 MB). Details and limits: [MODEL_TRAINING.md](MODEL_TRAINING.md) and [docs/AI_AND_GIS.md](AI_AND_GIS.md).
- Model output is a **suggestion**. It is labelled "AI suggestion, not verified" wherever it appears to an officer, it never changes the citizen's chosen category, and it is never used to set the hazard category or a due date.
- No confidence value is invented. A number is shown only when a model produced it.
- Hazard categories, due dates and counts come from fixed, documented rules and from the data, not from the models.
- Photos are re-encoded to WebP with all metadata removed. Reporter phone numbers are not shown on printed work orders.
- Before a public launch the data handling should be reviewed under India's DPDP Act, 2023: the app collects name, email, an optional phone number and area, with a consent line at registration, data export and account deletion.

---

## Known gaps

- **The seeded complaints are demo data.** Their dates, statuses and fix times were set by the seed scripts, so figures such as "fixed on time" and "typical fix time" on the admin dashboard are not meaningful until real complaints are resolved. The dashboard counts honestly what is in the database.
- The image model is trained on at most 20 images per class, so it is weaker than the earlier full-data model on Pothole, Garbage and Other (see "Data and AI honesty"). Electrical Hazard and Drainage are now covered; Water Leakage from a burst pipe is not a separate class. The CivicFix dataset has no streetlight photos, so none are seeded. Its pothole class is mostly wide road scenes, and its garbage class includes ocean waste; only clear street-level photos were used.
- The new admin dashboard text is English only; the How it works page and the officer panel are translated.
- The OpenStreetMap download for map checks failed during the last build, so "near a school" and "on a main road" currently use the citizen's flags.
- Location pictures are the project's own files; there is no automated fetch script and no licence check on them. One symbol image carries a stock-site watermark.
- Several officer actions (assign, schedule, hold, reject, duplicate, transfer, bulk, citizen confirm and reopen) are covered by API tests but were not clicked through in a browser.
- Hindi and Marathi texts have not been reviewed by native speakers.
- Performance figures from an earlier build (photo analysis, 100,000-incident list) were not re-measured after the authority v2 work.
- A lone live-wire report with nothing else known scores 4 x 1, which is MODERATE RISK. This follows the specified method; see DECISIONS.md entry 69.

---

