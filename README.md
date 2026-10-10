# iREPORT: civic problem reporting for Mumbai

iREPORT lets residents report broken roads, garbage, dead streetlights, water leaks and electrical hazards in a few taps, and gives ward offices a control room that shows **what the problem is, where it is, how serious it is, and who acts next**.

- **For citizens:** report with a photo and a pin, follow every step, then confirm the fix or reopen the complaint.
- **For officers:** one list sorted by hazard, a map, a work-order style complaint view, one primary action per complaint, and an analysis tab with a printable report.
- **For administrators:** approve officer accounts and see the city overview.

Languages: English, Hindi and Marathi (the Hindi and Marathi text is machine-written and needs a native reader).

> Status: working application with automated tests. It has not been deployed to real users, so this file describes what the software does, not measured outcomes. See [PROJECT_EXPLAINED.md](#purpose-and-impact) for the purpose and impact, and [PROJECT_WORKFLOW.md](#complete-workflow) for how it works end to end.

---

## Contents

1. [What it provides](#what-it-provides)
2. [Hazard categories](#hazard-categories)
3. [Complaint lifecycle](#complaint-lifecycle)
4. [Architecture](#architecture)
5. [Repository map](#repository-map)
6. [Run it](#run-it)
7. [Tests](#tests)
8. [API](#api)
9. [Data and AI honesty](#data-and-ai-honesty)
10. [Known gaps](#known-gaps)
11. [Detailed documentation](#detailed-documentation)

---

## What it provides

### Citizens

| Feature | What it does |
|---|---|
| Guided report flow | Pick the problem, answer a few quick questions (typed or spoken), add up to 3 photos, pin the exact spot (device GPS, photo GPS or tap on the map), review, submit. |
| One report per spot | If you already reported the same spot within 50 m (any category) the server refuses a repeat and offers to **add a photo** to your report instead. |
| Confirm instead of duplicating | If someone else already reported a problem within 50 m, you can **confirm** it. The affected count goes up without a second report. |
| Photo and text assistance | Two small CPU models suggest a category from the photo and the description. The suggestion is **marked as unverified** and the citizen's choice always wins. Photos that clearly show something else are left out unless the citizen keeps them. |
| My Reports | A six-step timeline (Reported, Seen, Scheduled, Work started, Fixed, Closed), side states (On hold, Not accepted, Merged, Sent to the right department), and messages from the ward office. |
| Confirm or reopen | When a complaint is marked fixed the reporter confirms it (it closes) or reopens it with a reason. With no answer in 72 hours it closes automatically. |
| Community feed | Nearby open problems, sortable, with a one-tap confirm. |
| Privacy tools | Download your data, delete your account (reports stay, anonymised). |
| How it works | A visual step guide, tips, an emergency call-out (call 112 first for live wires or injuries) and an FAQ. |

### Officers (authority control room)

| Feature | What it does |
|---|---|
| Count chips | All, New, Acknowledged, Scheduled, In progress, Resolved (awaiting citizen), Closed, Overdue, Unassigned. Each number equals the list total for the same filters. |
| Hazard categories | CRITICAL, HIGH RISK, MODERATE RISK, ROUTINE, each with a symbol, a colour, a one-line reason and a recommended action. The internal score is never shown as the decision. |
| Complaint list | Photo, what and where, hazard chip, due date or "Overdue", status, assignee. Filters: ward, category, hazard category, search, sort. |
| Incident brief | One complaint read top to bottom like a work order: what, why it is urgent (at most 3 reasons, each with its source), where (area picture, small map, Navigate, Copy location), evidence per reporter, history at this spot, nearby open work, timeline, messages. |
| One next action | A single primary button that matches the status (Acknowledge, Assign, Schedule, Start work, Mark resolved). Everything else is under **More**: hold, reject, mark duplicate, transfer to another category, reassign. |
| Bulk actions | Acknowledge, resolve, assign, schedule or message many complaints at once. Skipped items are reported. |
| Map | Open complaints coloured by hazard category, problem clusters, area cards with location pictures, area name labels. |
| Print work order | An A4 sheet per complaint: hazard box, details, reasons, reporters and photos, history, nearby work, timeline, blank fields for work done, material, crew, and signature lines. |
| Analysis tab | Today card, overview KPIs, 12-week backlog chart, area-wise bars (overdue vs open), hazard mix donut, on-time performance by department and ward, repeat spots (poor repair quality), season chart, a map with Critical / Overdue / Unassigned / All open layers, CSV export, and a printable report with an area-wise summary. Every chart title is a sentence computed from the data and every chart has a text summary and a data table. |

### Administrators

Approve, reject or revoke officer accounts, see per-department workload, hazard concentration and hotspots, and view the same map and read-only complaint view.

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

Design notes and the reasons behind each choice are in [DECISIONS.md](#design-decisions) (entries 57 onward).

---

## Complaint lifecycle

```
Reported -> Acknowledged -> Scheduled -> In Progress -> Resolved -> Closed
Side states: Reopened, On Hold, Rejected, Duplicate, Transferred
```

- **Open** means Reported, Acknowledged, Scheduled, In Progress, Reopened or On Hold. This is defined once in `backend/app/status.py` and once as the SQL function `ireport_is_open()`; a test proves they agree.
- Rules enforced on the server: On Hold and Rejected need a reason; Duplicate needs the original complaint number and moves its reporters across (the count is recomputed from distinct people); Transfer needs the correct category (the department follows it) and a reason and puts the complaint back in the new department's queue as Reported; Closed and Reopened belong to the citizen.
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
src/                  React app: App.tsx (citizen pages), AuthorityDashboard.tsx, IncidentDetail.tsx (the brief),
                      AnalysisTab.tsx, MapDashboard.tsx, ProblemMap.tsx, ReportFlow.tsx, i18n.ts / i18nStaff.ts
public/areas/         location pictures per area      public/symbols/   hazard category symbols
backend/app/          FastAPI app
  routers/            auth, me, reports, incidents, authority, analytics, admin, ai, health
  incidents.py        report creation, merge and duplicate rules, risk inputs, map data
  workflow.py         status transitions and their rules, citizen confirm/reopen, 72 h auto-close
  priority.py         risk formula, response categories, reasons    risk_config.py   every tunable number
  status.py           the one definition of "open"                  brief.py         the complaint brief
  ai/                 text model, image model, rules (flags, severity, NLP)
backend/alembic/      migrations 0001 to 0013
backend/scripts/      seed_demo, seed_load, load_osm, load_wards, bench, table_sizes
backend/tests/        pytest suite (124 tests)
ml/                   offline training and evaluation of the two models
docs/                 AI_AND_GIS.md, I18N_REVIEW.md, screenshots/
DECISIONS.md          every choice the brief left open, numbered
REVIEW_AUTHORITY_V2.md  review notes and manual test script for the authority v2 work
```

Migrations, in order: 0001 schema, 0002 seed (departments, categories, areas), 0003 list indexes, 0004 report evidence, 0005 report answers, 0006 more areas, 0007 Mumbai region areas, 0008 area fix, 0009 duplicate reports, 0010 status values, 0011 workflow, 0012 map features, 0013 risk priority.

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

Frontend:

```bash
npx pnpm@10 install
$env:PORT=5173; npx pnpm@10 dev    # PowerShell; reads VITE_API_URL (default http://localhost:8000/api/v1)
```

Open http://localhost:5173. Add the frontend's origin to `CORS_ORIGINS`. If the frontend and API are on different sites in production, set `COOKIE_SAMESITE=none` and `COOKIE_SECURE=true`.

Demo accounts (development only): citizen `aarav@example.com` / `citizen123`, officer `officer@bmc.demo` / `bmc12345`. The admin account uses `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`.

Optional, run once by a developer: `python -m scripts.load_osm` downloads schools, hospitals and main roads from OpenStreetMap so "near a school" and "on a main road" are checked by PostGIS instead of taken from what the citizen ticked. If the download fails nothing is invented; the citizen's flags are used and labelled "citizen says".

More detail: [HOW_TO_RUN.md](#windows-run-guide) (Windows).

---

## Tests

```bash
docker compose --profile test run --rm tests        # in the Python 3.12 image (uses the ireport_test database)
```

**124 backend tests** pass, plus 2 ML tests. They cover:

- authentication, refresh-token rotation and reuse detection, rate limits, role checks, authority approval
- one report per spot (409 at 49 m versus 51 m, any category), the merge rule, the hourly report limit, add-photo, the nearby check, and the migration that flags old repeat reports
- every workflow rule: reasons, duplicates moving reporters, transfers, citizen confirm and reopen, the 72-hour auto-close, one definition of "open"
- the risk formula: Python equals SQL on 1,024 combinations, map facts versus citizen claims, due dates that only move earlier, overdue
- chip counts equal the list totals under ward, category and search filters
- analytics: median days to close, within-due-date share, repeat spots, backlog, today card, CSV export that neutralises spreadsheet formulas
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
| Officer | `GET /authority/incidents` (filters, sort, view chips, cursor paging), `GET /authority/stats`, `GET /authority/incidents/{id}` (the brief), `POST /authority/incidents/{id}/update`, `POST /authority/incidents/bulk`, `GET /authority/officers`, `GET /authority/map`, `GET /authority/hotspots` |
| Analytics | `GET /authority/analytics/overview`, `/backlog`, `/by-ward`, `/by-type`, `/performance`, `/season`, `/today`, `/export.csv` |
| Admin | `GET /admin/authorities`, `POST /admin/authorities/{id}/decision`, `GET /admin/stats`, `/admin/overview`, `/admin/map`, `/admin/incidents/{id}` |
| Ops | `GET /health`, `GET /ready` |

Rate limits: login, registration, photo analysis, 10 new reports per citizen per hour, 30 photo uploads per hour.

---

## Data and AI honesty

- The two models are small and run on CPU: a text model (character n-gram TF-IDF with logistic regression, held-out macro-F1 0.73 on a small hand-written set) and an image model (a frozen EfficientNet-Lite0 with a logistic-regression head, int8 ONNX, 3.8 MB). Details and limits: [ml/README.md](#model-training) and [docs/AI_AND_GIS.md](#ai-and-gis).
- Model output is a **suggestion**. It is labelled "AI suggestion, not verified" wherever it appears to an officer, it never changes the citizen's chosen category, and it is never used to set the hazard category or a due date.
- No confidence value is invented. A number is shown only when a model produced it.
- Hazard categories, due dates and counts come from fixed, documented rules and from the data, not from the models.
- Photos are re-encoded to WebP with all metadata removed. Reporter phone numbers are not shown on printed work orders.
- Before a public launch the data handling should be reviewed under India's DPDP Act, 2023: the app collects name, email, an optional phone number and area, with a consent line at registration, data export and account deletion.

---

## Known gaps

- The OpenStreetMap download for map checks failed during the last build, so "near a school" and "on a main road" currently use the citizen's flags.
- Location pictures are the project's own files; there is no automated fetch script and no licence check on them. One symbol image carries a stock-site watermark.
- Several officer actions (assign, schedule, hold, reject, duplicate, transfer, bulk, citizen confirm and reopen) are covered by API tests but were not clicked through in a browser.
- Hindi and Marathi texts have not been reviewed by native speakers.
- Performance figures from an earlier build (photo analysis, 100,000-incident list) were not re-measured after the authority v2 work.
- A lone live-wire report with nothing else known scores 4 x 1, which is MODERATE RISK. This follows the specified method; see DECISIONS.md entry 69.

---

## Detailed documentation

Everything that used to live in separate files is below, in this one file.

- [Purpose and impact](#purpose-and-impact): Why the project exists, who it serves, and how its effect can be checked
- [Complete workflow](#complete-workflow): Every step from report to closure, the rules enforced, analytics definitions, data model
- [Windows run guide](#windows-run-guide): Step-by-step setup on Windows
- [AI and GIS](#ai-and-gis): What the models and the map logic really do, and what they do not
- [Model training](#model-training): Offline training and evaluation of the text and image models
- [Language review](#language-review): Status of the Hindi and Marathi translations
- [Design decisions](#design-decisions): Numbered decisions where the brief was open
- [Authority v2 review notes](#authority-v2-review-notes): What changed in the authority v2 work, with a manual test script
- [Open items](#open-items): What is not finished and why

---

## Purpose and impact

This is the plain-language description of the project. For the feature list and setup see [README.md](#ireport-civic-problem-reporting-for-mumbai); for every rule and data flow see [PROJECT_WORKFLOW.md](#complete-workflow).

### 1. The problem

In a large city, small civic problems (a pothole, a dead streetlight, a leaking pipe, a bare wire) are reported by phone calls, letters, social media posts and walk-ins. Ward offices then face four difficulties:

1. **Duplicates and noise.** The same problem arrives many times, from many people, in different words. One person can report it again and again.
2. **No shared sense of urgency.** A bare wire near a school and a litter pile look the same in a list sorted by date.
3. **Unclear ownership.** It is not obvious who is handling a complaint, whether it is late, or whether the fix was real.
4. **No view of the whole.** Officers cannot easily see where problems pile up, which repairs keep failing, or which ward is falling behind.

Citizens face the mirror image: they report, hear nothing, and cannot tell whether anything happened.

### 2. What iREPORT does about it

iREPORT is a reporting app for citizens and a control room for officers, joined by one shared record of each complaint.

| Problem | What iREPORT does |
|---|---|
| Duplicates | One report per person per spot. A second report from the same person within 50 m is refused, and they are offered to add a photo instead. Other people near an existing complaint are offered a one-tap **confirm**, so the count of affected people rises without a second complaint. |
| Unclear urgency | Every complaint gets one of four hazard categories (CRITICAL, HIGH RISK, MODERATE RISK, ROUTINE) from a documented risk method, with a symbol, a one-line reason and a recommended action. Each reason names its source: checked on map, citizen says, complaint records, calendar or category. |
| Unclear ownership and lateness | Each complaint has a status, an assigned officer, a due date, and an "overdue" flag that is computed in one place. Every change is recorded with who did it and why. |
| Fix not verified | When an officer marks a complaint resolved, the original reporter confirms it (it closes) or reopens it with a reason. The original due date keeps running after a reopen. Unanswered complaints close automatically after 72 hours. |
| No view of the whole | The Analysis tab shows backlog over 12 weeks, area-wise open and overdue work, the hazard mix, on-time performance by department and ward, repeat spots, and a map with Critical, Overdue and Unassigned layers. It can print a report and export a CSV. |
| Opaque AI | Two small models suggest a category from a photo and a description. The suggestion is labelled "AI suggestion, not verified", never overrides the citizen, and never decides urgency. |

### 3. Who uses it

**Citizens** report a problem in about two minutes: pick the problem, answer a few questions by tapping or speaking, add photos, pin the spot, review, send. They then follow a six-step timeline in My Reports and answer the "is it fixed?" question. The interface is in English, Hindi and Marathi.

**Officers** (ward officers, junior engineers, department heads) open the control room. The top of the list shows the most serious complaints. Each complaint opens as a work-order-style brief with one primary action. They can act on many complaints at once, print an A4 work order for the crew, and study trends in the Analysis tab.

**Administrators** approve or revoke officer accounts and see the whole city's workload.

### 4. How a complaint is judged

1. **Impact** (1 to 4) from what the problem is: an electrical hazard is a risk to life (4); a pothole, drainage or water problem can injure people or damage vehicles (3); garbage and a streetlight outage are health or safety nuisances (2); anything else is an inconvenience (1). A reporter who calls it dangerous can raise this by one level, never lower it.
2. **Likelihood** (1 to 4) starts at 1 and gains a point for each of: on a main road; within 100 m of a school or hospital; 3 or more different citizens reported or confirmed it; a monsoon month for road and water problems; a night-time hazard or an open streetlight complaint nearby.
3. **Risk = impact x likelihood** (1 to 16). 12 and above is CRITICAL, 8 to 11 HIGH RISK, 4 to 7 MODERATE RISK, below 4 ROUTINE.
4. The risk also sets a due date (24 hours, 3 days, 14 days or 30 days from the report). The date only ever moves earlier.

This is the risk-matrix approach used in road maintenance practice. Every number sits in one configuration file, and the same formula is tested in Python and SQL. A raw 0 to 100 score exists only to sort the list; officers are shown the category.

### 5. The impact it is designed to have

These are the changes the design aims for, and the figures the app itself computes so that anyone can check them. **No field results exist yet**, because the system has not been deployed to real users.

| Intended change | How it is delivered | How to check it (in the Analysis tab) |
|---|---|---|
| Fewer duplicate complaints for officers to sort | One report per spot, confirm instead of re-reporting, duplicates merged with reporters moved across | Reported by N distinct citizens per complaint; duplicate count in the history |
| The most dangerous problems are seen first | Hazard categories and a sorted list with source-labelled reasons | Critical open count; time to first action by category |
| Fewer late repairs | Due dates, overdue flag, assignee, bulk assign and schedule | Overdue count, closed within due date, backlog trend |
| Fewer repairs that fail | Reopen with a reason, "history at this spot", repeat-spot report | Reopen rate; repeat spots (same problem within 50 m and 90 days after a closure) |
| Better use of crews | "Nearby open work" within 300 m, the area-wise view, printed work orders | Open and overdue by area; clusters on the map |
| Trust from citizens | A visible timeline, messages, a confirm-or-reopen step | Share confirmed versus auto-closed; messages answered |
| Accountability | Every status change stores actor and reason; CSV and printable report | The timeline on each complaint; exported reports |

### 6. Principles the project follows

- **The server decides.** Urgency, "open", overdue and counts are computed by the backend from fixed rules, so every screen agrees.
- **Say where a fact came from.** Map checks, the citizen's claim, complaint records, the calendar and the category table are labelled differently.
- **Never invent confidence.** A percentage is shown only if a model produced it. The AI is an assistant and is marked unverified.
- **Never silently drop data.** Repeat reports are flagged and hidden, not deleted. Failed downloads are reported, not faked.
- **Respect privacy.** Photos are stripped of metadata, phone numbers are not printed, citizens can export or delete their data. Before a public launch, the data handling should be reviewed under India's DPDP Act, 2023.
- **Accessible by default.** Count chips and buttons are keyboard operable, charts have text summaries and data tables, motion respects "reduce motion", and colour is never the only signal (every category also has a symbol and a word).

### 7. What is not finished

- Map checks from OpenStreetMap (schools, hospitals, main roads) are built but not loaded; until then, those facts come from what the citizen ticked and are labelled "citizen says".
- Some officer actions were verified by automated tests but not clicked through by a person in a browser.
- Hindi and Marathi wording needs review by native speakers.
- The image model recognises six classes only and is a demonstration-level model; it needs real Mumbai photos before anyone relies on it.
- Real ward boundaries are not loaded; areas are assigned from the nearest of the seeded area centres.
- Performance was measured on an earlier build and should be re-measured on the real server.

Details of each gap and its reason: [README.md](#known-gaps) and [REVIEW_AUTHORITY_V2.md](#authority-v2-review-notes).

---

## Complete workflow

How a problem travels from a citizen's phone to a closed complaint, who can do what at each step, and which rule the server enforces. For the overview see [README.md](#ireport-civic-problem-reporting-for-mumbai); for purpose and impact see [PROJECT_EXPLAINED.md](#purpose-and-impact).

### Contents

1. [The three users](#1-the-three-users)
2. [The journey at a glance](#2-the-journey-at-a-glance)
3. [Citizen: reporting](#3-citizen-reporting)
4. [What the server does with a report](#4-what-the-server-does-with-a-report)
5. [Hazard category, due date and overdue](#5-hazard-category-due-date-and-overdue)
6. [Officer: the control room](#6-officer-the-control-room)
7. [Officer: acting on a complaint](#7-officer-acting-on-a-complaint)
8. [Citizen: following and closing](#8-citizen-following-and-closing)
9. [Analysis and reports](#9-analysis-and-reports)
10. [Administrator](#10-administrator)
11. [Map facts and the AI](#11-map-facts-and-the-ai)
12. [Background jobs](#12-background-jobs)
13. [Data model](#13-data-model)
14. [Security and privacy](#14-security-and-privacy)
15. [Tests that protect each rule](#15-tests-that-protect-each-rule)

---

### 1. The three users

| User | Signs up | Can |
|---|---|---|
| Citizen | Freely, with a consent line | Report, confirm, add photos to their own report, message the ward office, confirm or reopen a fix, export or delete their data |
| Officer | Requests access, an administrator approves (checked on every request, so revoking takes effect at once) | See all complaints, act on them, message reporters, see analytics |
| Administrator | Created from `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Approve or revoke officers, see city overview, read-only complaint and map views |

### 2. The journey at a glance

```
Citizen reports --> server checks duplicates --> complaint created or joined --> risk scored --> due date set
        |                                                                                      |
        |                                                                          Officer sees it, sorted by hazard
        v                                                                                      |
Citizen follows timeline <---- every change logged with actor and reason <---- Acknowledge, Assign, Schedule, Start work
        |                                                                                      |
        +---- confirms fix (Closed) or reopens with a reason <---------------- Mark resolved <-+
                     |
                     +---- no answer in 72 h: closed automatically
```

### 3. Citizen: reporting

Five steps in the report flow:

1. **Problem.** Tap the picture that matches: pothole, garbage, streetlight, water leak, electrical hazard or other. One category per report.
2. **Questions.** A few taps (how long, who is at risk, is it blocking the road, and so on) and an optional short description, typed or spoken in English, Hindi or Marathi. Some answers add flags such as "Blocks footpath" or "Night-time hazard".
3. **Photos and place.** Up to 3 photos (compressed in the browser). The browser analyses them with `POST /ai/analyze` while the citizen continues. The location is chosen by device GPS, by the photo's own GPS, or by tapping the map. **As soon as a location exists the app asks `GET /reports/nearby-check`:**
   - *You already reported this (IR-...). Add a photo instead?* The citizen can add photos to their own report; a second report is not allowed.
   - *Already reported here, confirm it instead.* Other people's open complaints within 50 m are listed with a Confirm button.
4. **Review.** The chosen category, problem, location, area and department are shown. Photos the model is confident show something else are listed with the choice to switch category, keep the photo, or leave it out.
5. **Done.** The complaint number (`IR-YYYYMMDD-NNNNN`) is shown and the citizen goes to My Reports.

The flow works in English, Hindi and Marathi. A hidden draft is kept if the citizen closes the window.

### 4. What the server does with a report

`POST /reports` runs in one transaction (`incidents.create_report`):

1. **Rate limit:** 10 reports per citizen per hour.
2. **Validate:** the category exists; any photos belong to this citizen and are not yet used.
3. **Severity from the citizen's own words** (`citizen_severity`): size of the problem, a live wire or injury cue, an open-manhole cue. School, hospital and flood flags are deliberately left out here because they are counted in likelihood.
4. **One report per spot:** a per-citizen lock, then a check for this citizen's own report on an OPEN complaint within 50 m, of any category, within the last 14 days. If found: **409 `already_reported`** with the complaint's `id` and `public_id`. Nothing is inserted.
5. **Merge or create:** another citizen's open complaint of the same category within 50 m and 14 days is joined (`affected_count` +1, unless that citizen already confirmed it); otherwise a new complaint is created with its area (PostGIS polygon if loaded, else the nearest seeded area centre), a `Reported` status event, and its map facts.
6. **Insert the report row**, attach the photos, **re-score** the complaint (risk, sort key, due date).

Repeat reports from before this rule existed were flagged by migration 0009 (`reports.duplicate_of_report_id`) and are hidden from every count and screen; nothing was deleted.

### 5. Hazard category, due date and overdue

`risk = impact x likelihood`, computed by the same formula in Python (`priority.py`) and SQL (`ireport_risk()`).

| Input | Rule |
|---|---|
| Impact | Electrical hazard 4; pothole, road damage, drainage, water leakage 3; garbage, streetlight 2; other 1. Citizen severity High or Critical adds 1 (maximum 4). |
| Likelihood | 1, plus 1 for each: main road; school or hospital within 100 m; 3 or more distinct citizens (reporters and confirmers); monsoon month for road and water categories; night-time hazard or open streetlight complaint within 100 m. Maximum 4. |

| Risk | Hazard category | Due date from report time |
|---|---|---|
| 12 to 16 | CRITICAL | 24 hours |
| 8 to 11 | HIGH RISK | 3 days |
| 4 to 7 | MODERATE RISK | 14 days |
| 1 to 3 | ROUTINE | 30 days |

- Re-scoring runs on every change that affects the inputs (new report, confirmation, status change, transfer) and hourly for open complaints.
- `due_at` only moves earlier (`LEAST`), except when a complaint is transferred to a new category, which restarts it.
- A reopened complaint keeps its original `due_at`.
- **Overdue** = open and now later than `due_at`; officers see "Overdue 2 days" or the due date.
- `priority_score` (risk x 100 / 16) exists only so the list can be paged with an index.
- Each complaint returns its reasons, e.g. "Within 80 m of St. Mary School (checked on map)" or "On a main road (citizen says)".

### 6. Officer: the control room

**Count chips** (All, New, Acknowledged, Scheduled, In progress, Resolved (awaiting citizen), Closed, Overdue, Unassigned) filter the list. The chip numbers and the list total use the same SQL predicates, under the same ward, category and search filters, and a test compares them.

**List card:** picture, what and where, complaint number, assignee (or Unassigned), hazard chip with symbol, due date or Overdue, status.

**Filters:** search, area, category, hazard category, sort (most urgent, due date, newest, oldest, most citizens). Paging is by keyset cursor so every row appears exactly once.

**Map:** open complaints coloured by hazard category, problem clusters (PostGIS DBSCAN, 300 m, at least 2 points), area cards with location pictures and open and critical counts, area name labels, a legend, and complaint cards that open the brief in a drawer.

**Hotspots:** groups of at least 3 open complaints from the last 30 days chained within 400 m of each other, with counts of open and critical complaints per area.

### 7. Officer: acting on a complaint

#### The brief (`GET /authority/incidents/{id}`)

Top to bottom: header (number, category, status, hazard chip, due), the hazard panel (reason and recommended action), what (one sentence naming the street and any school or hospital found on the map), reported by N citizens, assignee and site visit, why urgent (up to 3 reasons with sources), where (area picture, small map, Navigate, Copy location), evidence per reporter with time and photos, history at this spot (same category within 50 m in the last 180 days), nearby open work within 300 m, timeline, messages. If the photo model disagrees with the chosen category a line says so and is tagged "AI suggestion, not verified".

#### One primary action

| Status | Primary button |
|---|---|
| Reported | Acknowledge |
| Acknowledged (no assignee) | Assign |
| Acknowledged (assigned) | Schedule |
| Scheduled, or Reopened (assigned) | Start work |
| In Progress | Mark resolved |
| On Hold | Resume work |
| Resolved, Closed, Rejected, Duplicate | none (waiting for the citizen, or final) |

Everything else is under **More**: reassign, hold, reject, mark duplicate, transfer to another category, reopen for rework.

#### Rules enforced by `workflow.apply_officer_update`

| Action | Rule |
|---|---|
| Any change | Written to `status_events` with the actor and reason; locked statuses (Closed, Rejected, Duplicate) cannot be changed by an officer |
| Scheduled | A date is required |
| On Hold, Rejected | A reason is required |
| Duplicate | The original complaint number is required; its reporters, photos and confirmations move to it, repeat reporters are collapsed, and its count is recomputed from distinct people |
| Transferred | The correct category and a reason are required; the department follows the category; the complaint returns to the new department's queue as Reported, unassigned, with its due date restarted |
| Resolved | One click. The citizen then answers |
| Closed, Reopened | Set only by the citizen (or the 72-hour job); officers cannot set them |
| Assign | Only to approved officers |

**Bulk actions** (`POST /authority/incidents/bulk`, up to 100): acknowledge, resolve, assign, schedule, message. Complaints for which a move is not allowed are skipped and counted in the response.

#### Print work order

The button prints one A4 sheet: header and number, hazard box, details table, reasons with sources, reporters with photos, history, nearby work, timeline, messages, then blank fields (work done, material, crew, started, completed) and signature lines for the officer, the supervisor and the citizen.

### 8. Citizen: following and closing

My Reports shows each complaint with a six-step timeline: Reported, Seen by the ward office, Scheduled, Work started, Marked fixed, Closed. Side states appear as a note with the reason: On hold, Not accepted, Merged with another complaint, Sent to the right department, Reopened.

When a complaint is **Resolved**:

- **Yes, it is fixed** closes it.
- **Not fixed, reopen** requires a reason; the status becomes Reopened, `reopen_count` rises, the reason is posted to the thread, and the original due date is unchanged.
- No answer for 72 hours: the job `auto_close` closes it with no actor and the reason "No answer from the citizen within 72 hours."

Messages from the ward office appear in the thread and the citizen can reply while the complaint is theirs.

### 9. Analysis and reports

All endpoints accept ward, category and date range; every number is computed from `incidents` and `status_events`.

| Output | Definition |
|---|---|
| Open, overdue | open per the one definition; overdue per section 5 |
| Resolved this week | first Resolved event within 7 days |
| Median days to close | median of (first Resolved event minus report time) |
| Closed within due date | share of resolved complaints with first Resolved event at or before `due_at` |
| Reopened | share of resolved complaints with `reopen_count` above 0 |
| Backlog, 12 weeks | per week: reported, closed by officers (first event into Resolved, Rejected or Duplicate), open at week end |
| Area-wise | per area: total, open, overdue, median days |
| By problem type | per category, with this month versus last month for the headline |
| Repeat spots | same category within 50 m reported again within 90 days after a closure |
| Performance | within due date and reopen rate per department and per ward |
| Season | complaints per month and category, last 12 months |
| Today | new today, closed today, now overdue |

Road Damage and Drainage (older categories) are shown as Pothole and Water Leakage. Each chart's title is a sentence computed from the numbers, each has a text summary for screen readers, and each can be shown as a table. **Print report** produces a printable page with the KPIs and the area-wise, problem-type, performance and trend tables, the repeat-spot list and signature lines. **Export** gives the filtered complaint list as CSV (formula-like cells are neutralised).

### 10. Administrator

- Approve, reject or revoke officer accounts; revoked sessions end immediately.
- Overview: critical open complaints, per-department workload, hazard concentration by category, top hotspots.
- The same map and a read-only complaint brief (no phone numbers).

### 11. Map facts and the AI

**Map facts.** `osm_features` holds schools, hospitals and main roads loaded once from OpenStreetMap by `scripts/load_osm.py`. For each complaint PostGIS finds a school or hospital within 100 m and a main road within 30 m and stores the result in `geo_facts`. Where main-road data is loaded, the map decides "main road"; school and hospital use the map when it finds one and the citizen's flag otherwise, labelled "citizen says". A kind of feature is loaded only if every download tile succeeded; a failed download leaves the table as it was and the script says so.

**The AI.** `POST /ai/analyze` returns a suggestion from the photo and the description with a confidence value from the model, a flag when the two disagree, and a note when it is unsure or the photo is not a civic problem. It never blocks reporting and never fails the request. Its output is stored only as a training signal. It does not set the category, severity, hazard category or due date, and it is labelled "AI suggestion, not verified" for officers.

### 12. Background jobs

Run by APScheduler inside the API process (enable on one replica only):

| Job | Schedule | Does |
|---|---|---|
| `cleanup_drafts` | every 10 minutes | deletes photos uploaded for reports that were never submitted |
| `refresh_priorities` | hourly | re-scores open complaints (month, citizen counts and nearby complaints change over time) |
| `auto_close` | every 15 minutes | closes Resolved complaints unanswered for 72 hours |
| `expire_full_images` | daily | for complaints finished more than a year ago, keeps only the thumbnail |

### 13. Data model

| Table | Holds |
|---|---|
| `users`, `authority_profiles`, `refresh_tokens` | accounts, officer approval state, rotating refresh tokens |
| `wards`, `departments`, `categories` | reference data; `categories.impact` and `monsoon_sensitive` feed the risk |
| `incidents` | one row per real-world problem: location, status, severity, `citizen_severity`, flags, `risk`, `priority_score`, `due_at`, `assigned_to`, `scheduled_for`, `reopen_count`, `duplicate_of`, `geo_facts`, `affected_count` |
| `reports` | one row per citizen report of an incident, with answers, description, AI fields and `duplicate_of_report_id` |
| `media` | stored photos (full WebP and thumbnail keys) |
| `confirmations` | "me too" from other citizens |
| `status_events` | every transition with actor and reason; equal from and to statuses are internal notes (assignments, schedules, merges) |
| `messages` | thread between officers and reporters |
| `osm_features` | schools, hospitals and main roads (GiST index) |
| `resolution_proofs` | created by migration 0011 and currently unused (proof of resolution was removed in favour of a one-click resolve) |

Notable SQL functions: `ireport_is_open`, `ireport_risk`, `ireport_score`, `ireport_priority`, `ireport_sla_hours`.

### 14. Security and privacy

- Passwords hashed with Argon2; access tokens live in memory, refresh tokens are rotated httpOnly cookies and reuse ends all sessions.
- Rate limits on login, registration, photo analysis, new reports and photo uploads.
- Uploads: real file type from magic bytes, size and pixel limits, EXIF orientation applied, location read once as a suggestion, all metadata dropped, re-encoded to WebP; images are served by short-lived signed URLs.
- API responses are not cached by browsers; strict headers; CORS limited to the configured origins.
- Reporter phone numbers are shown only when explicitly requested and are never printed.
- Citizens can export all their data and delete their account (reports stay, anonymised).
- The CSV export prefixes cells beginning with `=`, `+`, `-` or `@`.

### 15. Tests that protect each rule

| Rule | Test file |
|---|---|
| One report per spot, add-photo, nearby check, hourly limit, repeat-report migration | `tests/test_duplicates.py` |
| Statuses, transitions, duplicate moves, transfer, confirm and reopen, 72-hour close, one definition of open, chip counts | `tests/test_workflow.py` |
| Risk formula, Python equals SQL, category table equals config, open definition | `tests/test_priority.py` |
| Map facts versus citizen claims, due dates, overdue, distinct citizens, transfer restart | `tests/test_risk.py` |
| Analytics numbers, filters, repeat spots, CSV | `tests/test_analytics.py` |
| Merge rule, messaging, list paging, bulk, authority and admin routes | `tests/test_reports.py`, `tests/test_task_fixes.py` |
| Authentication and roles | `tests/test_auth.py` |
| Photo pipeline and AI endpoints, retention jobs | `tests/test_images.py`, `tests/test_ai.py` |

---

## Windows run guide

Needs: Docker Desktop (running) and Node 22.
Run all commands from the `iREPORT_Copy` folder.

### 1. Backend (database + storage + API)

```powershell
docker compose up --build
```

Leave this terminal open. When it is ready:

- API: http://localhost:8000/api/v1 (health: `/api/v1/health`)
- API docs: http://localhost:8000/api/docs
- MinIO console: http://localhost:9001 (minioadmin / minioadmin)

`http://localhost:8000/` alone shows 404. That is normal; the API lives under `/api/v1`.

Optional demo data (citizen, officer, sample incidents), in a second terminal:

```powershell
docker compose exec api python -m scripts.seed_demo
```

### 2. Frontend

In another terminal:

```powershell
npx pnpm@10 install
$env:PORT=5173; npx pnpm@10 dev
```

Open **http://localhost:5173**.

Why `PORT=5173`: `vite.config.ts` defaults to port 8443. Some programs (for example the
AdBlock360 service) already use 8443 on Windows and answer with a JSON 404 instead of the app.
5173 is already allowed in `CORS_ORIGINS` in `.env`.

### 3. Admin login

Email and password come from `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`.

### Stop

- Frontend: Ctrl+C in its terminal.
- Backend: Ctrl+C, then `docker compose down` (add `-v` to also wipe the database).

### Tests

```powershell
docker compose --profile test run --rm tests
```

### Troubleshooting

| Problem | Fix |
|---|---|
| 404 JSON `{"code":404,"error":"Cannot GET /"}` in the browser | Wrong port. Use 5173 as above. |
| Page loads but data does not | Check the API is up (`/api/v1/health`) and `CORS_ORIGINS` in `.env` includes your frontend URL. |
| `port is already allocated` | Something else uses 5434, 8000, 9000 or 9001. Stop it or change the mapping in `docker-compose.yml`. |
| Docker errors on start | Make sure Docker Desktop is running. |

---

## AI and GIS

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

## Model training

Nothing in this folder runs in production or ships in the API image. Training produces small files that are copied into `backend/models/`:

| File | What | Budget |
|---|---|---|
| `backend/models/txt-1.0.npz` | char n-gram (2–5) TF-IDF + logistic regression, 8 categories | < 2 MB, < 5 ms |
| `backend/models/img-1.0.onnx` + `.json` | EfficientNet-Lite0, 8 categories + `not_civic`, int8 | ~5 MB (≤ 15 MB), < 150 ms |

```bash
py -3.12 -m venv ml/.venv            # or python3 -m venv
ml/.venv/Scripts/pip install -r ml/requirements.txt     # (bin/ on Linux/macOS)
```

### Text model: trained and shipped

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

### Image model: `img-1.0` shipped (linear probe), full fine-tune available

`img-1.0` is a **linear probe**: a frozen ImageNet EfficientNet-Lite0 (int8 ONNX, 3.83 MB) with a logistic-regression head, trained in about 3 minutes on CPU on 1,800 images from public datasets. It predicts 6 classes: Pothole, Road Damage, Streetlight, Garbage, Other, not_civic. Held-out test (360 images): accuracy 0.928, macro-F1 0.927; recall Garbage 0.90, Other 0.92, Pothole 0.88, Road Damage 0.97, Streetlight 0.97, not_civic 0.93. Limits: the test images come from the same public sources as the training images (de-duplicated, but not independent), so real-world accuracy will be lower; `not_civic` was trained on flowers and Caltech101 objects only; there are no Mumbai photos; Water Leakage, Drainage and Electrical Hazard have no data and are never predicted (the image result is ignored when the citizen has chosen one of those). Numbers: `ml/reports/img-1.0.json`.

#### Quick path (what produced `img-1.0`, about 5 minutes on CPU)
```bash
# 1. unpack the raw datasets into ml/data/raw/{cleanliness,civicsense,streetlight,notcivic}/  (untrusted data: never import from it)
ml/.venv/Scripts/python -I ml/prepare_data.py     # de-duplicates across sources, writes ml/data/images/{train,val,test}/<class>/
ml/.venv/Scripts/python ml/train_probe.py         # features -> logistic regression -> temperature -> ONNX int8 -> backend/models/
ml/.venv/Scripts/python ml/evaluate.py            # per-class recall, confusion matrix, latency
```
Restart the API; `/ready` and the startup log show `image: ok (img-1.0 ...)`.

#### Full path (better accuracy, needs more data and time)
#### 1. Collect data → `data/images/{train,val,test}/<class>/`
Class folders: `Pothole`, `Road Damage`, `Streetlight`, `Garbage`, `Water Leakage`, `Drainage`, `Electrical Hazard`, `Other`, `not_civic`.

| Class | Starting sources |
|---|---|
| Pothole, Road Damage | RDD2022 (includes India; crop the D40 pothole and D00/D10/D20 crack boxes), Kaggle pothole datasets |
| Garbage | TACO (crops and full scenes), TrashNet (product shots: use sparingly, they are unlike street photos) |
| Streetlight, Drainage, Water Leakage, Electrical Hazard, Other | Scarce publicly: collect Mumbai street photos (with permission), pre-label offline with MobileCLIP zero-shot, **then check every label by hand** |
| not_civic | Selfies, indoor scenes, screenshots, food, documents |

Use MobileCLIP only offline, as a labelling helper. It must never run in the API. Keep the test split separate from the start, ideally photos from different days and places than train, and never tune on it.

#### 2. Train
```bash
ml/.venv/Scripts/python ml/train_image.py --epochs 25                         # tf_efficientnet_lite0 (~4.7 M params)
ml/.venv/Scripts/python ml/train_image.py --arch mobilenetv3_small_100        # ~2.5 M params if a smaller file is needed
```
Training uses class-balanced sampling, light augmentation, label smoothing and AdamW with one-cycle. The best epoch on val is kept. **Temperature scaling** is fitted on val, so the 0.60 "uncertain" threshold means something.

#### 3. Export, quantise, compare
```bash
ml/.venv/Scripts/python ml/export_onnx.py --version img-1.0 --calib ml/data/images/val --calib-count 300
```
This exports fp32 ONNX, then applies int8 static quantisation (QDQ, per-channel) calibrated on 200–500 real val images. It measures test accuracy for both. **If int8 loses more than 2 points, fp16 is shipped instead.** The chosen file plus a `.json` sidecar (labels, preprocessing, temperature) are copied to `backend/models/`. The decision and both accuracies go to `ml/reports/img-1.0-export.json`.

#### 4. Evaluate exactly as the API runs it
```bash
ml/.venv/Scripts/python ml/evaluate.py --model backend/models/img-1.0.onnx --test ml/data/images/test --threads 2
```
This reports macro-F1, per-class recall, the confusion matrix, the share of predictions below 0.60, accuracy on the confident ones, and latency including preprocessing. **Run it on the 2 vCPU target server** for the latency that counts.

#### Size and speed check without training
```bash
ml/.venv/Scripts/python ml/export_onnx.py --benchmark-only --calib public/media
```
This loads the ImageNet-pretrained EfficientNet-Lite0 backbone with an untrained 9-class head. It exports and quantises it and reports file size and CPU latency only (`ml/reports/img-1.0-benchmark.json`). It says nothing about accuracy.

### Retraining after launch
Every report stores `ai_category_id`, `ai_confidence`, `model_version` and `user_corrected`. The citizen's final category is `incidents.category_id`. Every few months:
1. Export confirmed and corrected reports with their photos and final category.
2. Add them to train and val. Keep a fresh, untouched test set from the most recent month.
3. Retrain, and bump the version (`img-1.1`, `txt-1.1`). The API writes the version into every new report.

---

## Language review

All hi / mr strings in `src/i18n.ts`, `src/questions.ts` and the `copy` table in `src/App.tsx` were written by an AI assistant and have **not** been reviewed by a native speaker. Please check tone, spelling and terminology.

Newest drafts (this change), in `src/i18n.ts`:

- My reports: keys `rpOnlyYours` ... `rpLoading`
- Status and severity names: `st_Reported`, `st_UnderReview`, `st_InProgress`, `st_Resolved`, `sev_Low` ... `sev_Critical`
  (check "दर्ज / नोंदवले", "हल हुआ / निराकरण झाले")
- Community: keys `cmChoose` ... `cmNoLocation`

Not yet translated (English only): Auth page, Profile details, FAQ, reply box, authority and admin screens (officers, by decision).

Check: `node scripts/check-i18n.mjs` (empty strings and key parity only; it cannot judge translation quality).

Also drafted in this round: profile menu (`pf_*`), contribution labels (`resolvedCount`, `confirmsReceived`, `levelContributor`, `levelTrusted`), `pfEyebrow`, `pfIntro`, `photoNotAnalysed`, and the reworded `noImageModel`.

Landing category cards: `catd_pothole` ... `catd_other`, `catReport`, `catEyebrow`.

---

## Design decisions

Where the build spec was unclear or could not be followed exactly, this is the smallest reasonable choice that was made, and why. Anything that adds a table, column, dependency or endpoint not in the spec is marked **(addition)**.

### Data and schema

1. **Wards.** The frontend uses 8 neighbourhood names (Andheri West, Bandra, …), not BMC administrative wards. Migration `0002` seeds exactly those 8 names with `geom = NULL`. No ward polygons were available offline, so none were invented. `scripts/load_wards.py` loads real GeoJSON later. Until polygons exist, an incident's ward is the area the citizen chose, falling back to their profile area. Once polygons are loaded, `ST_Covers` on the map point decides.
2. **`users.messages_seen_at` (addition, one nullable column).** Messages to "all reporters" have `recipient_id = NULL`, so a single `read_at` cannot track which of several reporters has read them. The citizen unread count is "authority messages on my incidents newer than `messages_seen_at`". Opening `GET /reports/mine` sets it. `messages.read_at` is still used: it is set on citizen replies when an authority opens the incident.
3. **Extra indexes (additions):** `reports (incident_id, created_at)` and `media (report_id, created_at)` for the joins; a partial index on draft media for the cleanup job; `refresh_tokens (token_hash)` unique; `incidents ((status <> 'Resolved'), priority_score, id)` for keyset paging of the default authority sort; `incidents (created_at, id)`; `status_events (incident_id, created_at)`; `messages (incident_id, created_at)`; a GiST index on `wards.geom`. The spec's own indexes are all kept.
4. **`incident_public_seq` (addition).** A sequence produces `IR-YYYYMMDD-NNNNN` (date in IST).
5. **`reports.description` length** is enforced with a CHECK (500), matching the API limit.
6. **Priority as a SQL function.** `ireport_priority()` (migration 0001) implements the formula once in the database, so sorting and paging happen in SQL. `app/priority.py` is the same formula in Python, used to compute the "reasons" on read. A test compares the two on 300 random incidents. Both round with `floor(x + 0.5)`, because Postgres `round(double)` and Python `round()` both round half to even, while JavaScript `Math.round` rounds half up.
7. **No `citizen_verified_at`.** The frontend shows a note about verifying a fix, but has no verify button or step, so the column was not added (spec: "only if the frontend shows that step").
8. **No `places` table.** No OpenStreetMap extract of schools, hospitals and major roads was loaded, and the spec says to add the table only with real data. "Near school", "Near hospital" and "Main road" come from text cues and category defaults. Authorities can edit flags through `POST /authority/incidents/{id}/update`.
9. **Account deletion.** `reports.user_id` is NOT NULL, so reports are "detached from identity" by anonymising the user row: name becomes "Deleted user", email a unique placeholder, phone, area and password are cleared, and `deleted_at` is set. The email can then be registered again. Reports, photos and confirmations stay because the problem is still real. Admin accounts cannot be deleted from the app.

### API

10. **Login takes `role`.** The UI has Citizen, Authority and Admin tabs, and the old store refused "right password, wrong tab". The API keeps that behaviour and returns the same messages.
11. **Citizen registration logs in immediately** (returns a session), as the old UI did. Authority registration returns `{pending: true, message}`.
12. **`/ai/analyze` takes two optional extra fields (addition):** `category` (the citizen's step-1 choice) and `problem_type` (step 2). They are only used for the severity estimate when the AI is unsure, because severity depends on the step-2 choice (section 7.2). `lat`/`lng` are accepted as the spec lists them, but v1 does not use them, since there is no places table.
13. **`/ai/analyze` returns a few extra fields:** `disagreement` (image vs text, section 7.4), `source`, `model_version`, `thumb_urls`, `inference_ms`, `total_ms`. No probability vectors are stored. Only the top-1 label, confidence and model version reach the database, and only if the citizen submits.
14. **The AI fields in `POST /reports` come from the client.** The server never trusts them for anything that matters. It recomputes severity and flags itself, and `ai` is stored only as the training signal (`ai_category_id`, `ai_confidence`, `model_version`, `user_corrected`).
15. **`POST /reports` accepts optional `area` and `flags` (addition).** `area` is the neighbourhood shown in the flow, used for the ward until polygons exist. `flags` must come from the fixed list and are only ever added. The server adds its own cue and category flags too.
16. **`/incidents/nearby` takes `sort=nearest|recent|affected|severity` (addition)**, because the Community page has that sort menu. `status` accepts a comma list (`Reported,Under Review` for the "Pending" chip). Paging uses an offset cursor (feeds are short); the authority list uses keyset cursors.
17. **Confirmations.** A reporter is already counted in `affected_count`, so confirming their own incident is a no-op. Confirming a resolved incident returns 409. A citizen who confirmed and then reports the same incident is not counted twice.
18. **Phone numbers** are returned only with `GET /authority/incidents/{id}?include_phone=true`.
19. **`/authority/incidents` returns `total` on the first page only.** It is a count for the filter set. Later pages skip it to stay fast.
20. **Health routes** live at `/api/v1/health` and `/api/v1/ready`. `/ready` needs the database and the text model. The image model is reported but only required when `REQUIRE_IMAGE_MODEL=true`.
21. **Extra `/me` routes:** `GET /me/export` and `DELETE /me`. They are needed for the "support account deletion and data export" requirement in section 11, and they are wired to Profile → Privacy & Account.

21a. **Refresh-token reuse has a 60 s grace window.** Strict reuse detection would log a user out everywhere when two tabs refresh with the same cookie at the same moment. A token rotated less than 60 s ago returns `401 refresh_race`, and the client retries once with the new cookie the other tab already received. Reuse after 60 s still revokes every session of that user.

### AI

22. (superseded by #54) **No trained image model ships in this repository.** None of the public datasets (RDD2022, Kaggle potholes, TrashNet, TACO) are available offline, and fine-tuning needs a GPU-day of work and hand-checked labels for streetlight, drainage, leakage and electrical photos. The full pipeline is here (`ml/train_image.py`, `ml/export_onnx.py`, `ml/evaluate.py`). Until `backend/models/img-1.0.onnx` exists, the API stores photos, says `uncertain: true` for image-only reports, and the citizen picks the category. This is the spec's "never block on the AI" path. **No image accuracy is claimed anywhere.**
23. **The text model was trained on a small hand-written seed set** (`ml/data/text/complaints.csv`, 280 sentences: English, Hindi, Marathi, Hinglish, a few Latin-script Marathi). Its metrics (`ml/reports/txt-1.0.json`) come from a held-out split by sentence and 5-fold CV. They are real for this data but optimistic for real complaints, so retrain on real reports after launch (section 7.5).
24. **The text model runs without scikit-learn.** It is exported to `.npz` (vocabulary, idf, coefficients) and the char-n-gram TF-IDF + softmax is reimplemented in about 60 lines of NumPy (`app/ai/text_model.py`). This keeps scikit-learn and SciPy out of the API image. `ml/tests/test_text_parity.py` proves it matches `predict_proba` to 1e-5.
25. **Cue keywords** are matched as word prefixes for Latin script and as substrings for Devanagari, because Devanagari takes many suffixes and oblique forms like शाळे**जवळ**. Bare "current" was dropped from the electrical cues ("the current status…"); phrases like "current laga" and "electric current" are used instead.
26. **Severity rules** port the old `suggestSeverity` (Electrical Hazard is Critical; "dangerous / large / multiple / broken / damaged / overflowing / illegal" are High) and add "unsafe" to that High list. "Small" with no risk flag is Low. Live wiring or an injury raises severity to Critical; school, hospital, flood risk or an open manhole raises it to at least High. A merged incident keeps the higher severity and the union of flags.

### Images and storage

27. **MinIO image.** `minio/minio` is no longer published on Docker Hub (the pull fails), so compose uses `cgr.dev/chainguard/minio`, the same server binary. Any S3-compatible store works.
28. **S3 client: `minio` (Python) instead of boto3.** It is much smaller, works with S3 and R2, and signs URLs locally. A second client signs with the public host (`S3_PUBLIC_ENDPOINT`), so signed URLs work from the browser while the API talks to `minio:9000` inside Docker.
29. **`pillow-heif`** (addition) decodes HEIC, which the spec lists as an accepted type.
30. **Browser compression removes EXIF, including GPS.** Photos over 300 KB are re-encoded by canvas, so their GPS does not reach the server. Photos under 300 KB keep it, and the server suggests their location and then strips it. The main location sources are "Use my current location" (browser geolocation) and the landmark field.
31. **The 8 s AI timeout starts after the upload finishes.** A slow uplink should not be treated as a slow model. On timeout or error the flow goes to the manual category picker and offers Retry. The report can still be submitted, with or without photos.
32. **Retention.** For an incident resolved more than 12 months ago, the full image is deleted and `media.storage_key` is set to the thumbnail key, so the row stays valid.

### Runtime

33. **One API process.** The rate limiter (in-memory fixed window), APScheduler jobs and ONNX session live in one uvicorn worker, as the spec asks for no Redis or Celery in v1. With several replicas, rate limits become per-process and the scheduler should run in only one of them (`ENABLE_SCHEDULER=false` elsewhere).
34. **Merging is serialised per category** with `pg_advisory_xact_lock`, so two neighbours reporting the same pothole at the same moment still merge. `FOR UPDATE` is taken in a second query by id, because `FOR UPDATE` on a KNN (`<->`) index scan fails with "attempted to lock invisible tuple".
35. **Tests use cheap argon2 parameters** (`ENV=test` only); everywhere else uses the argon2-cffi defaults.
36. **Postgres listens on host port 5434** in compose, because 5432 and 5433 were taken on the development machine. Change `POSTGRES_HOST_PORT` if needed.

37a. **`pg_trgm` extension and migration 0003 (addition).** The 100,000-incident load test failed the 300 ms target (p95 799 ms). Search with `ILIKE '%q%'` scanned every row (median 833 ms), and the "Longest open" and "Most affected" sorts had no matching index. Migration 0003 adds trigram GIN indexes on `address_text` and `public_id`, plus keyset indexes for those two sorts. Afterwards p95 was 76 ms. `pg_trgm` ships with PostgreSQL (contrib); it is not a new service.
37b. **Control-room search scope.** `q` matches report ID, address or landmark, category name and area name. It no longer searches the step-2 problem type ("Large", "Overflowing"). That needed a per-row lookup into `reports` and was the main cost of the slow search.
37c. **WebP `method=2`** instead of Pillow's default 4. On a 1280 px photo it is about 4× faster (≈250 ms vs ≈1,000 ms) for files within about 3 % of the size. This alone halved `/ai/analyze` latency.

### Frontend

37. **Demo box** shows only in `import.meta.env.DEV`. The demo citizen and officer come from `python -m scripts.seed_demo` (dev only, refuses in production). The admin is always the `.env` one. No credentials remain in the frontend code paths that ship.
38. **The home page "incident" card** stays as a static illustration, because it is marketing content. Its button now opens Community instead of faking a confirmation.
39. **"Saved / Followed Issues"** in Profile showed a made-up "4 issues". There is no follow feature in the spec, so it now says "Coming soon". "Notifications" shows the real unread count.
40. **The report flow is a separate lazy chunk** (`ReportFlow.tsx` + `compress.ts`), so the home page loads no photo or AI code. `Brand`, categories and problem lists moved to `brand.tsx` so both chunks can use them.
41. **The map** is still the OpenStreetMap embed iframe. It now centres on the real pin (area centre, device location or photo location), but an embed cannot report a dragged pin back, so "move the map" is only visual. A draggable map would need a map library (not in the dependency list).

42. **Incident location (user-testing fixes).** `location_source` is required on `POST /reports`; ward comes from the incident point (PostGIS polygon, else nearest area centre), never the profile ward. Supersedes the "falling back to their profile area" wording in #1. The client `area` field is accepted but ignored.
43. **Report draft survives close/Escape.** The flow stays mounted while hidden; "Start over" discards it. AI analysis re-runs only when photos, text or category change.
44. **Hotspot impact score** (superseded by #45): was area-relative; now a plain formula on DBSCAN clusters.
45. **Hotspots are DBSCAN clusters** (addition, changes `GET /authority/hotspots`): `ST_ClusterDBSCAN` on UTM 43N, eps 400 m, min 3 open incidents created in the last 30 days. Per cluster: centroid, majority area, `incident_count`, categories, `unique_citizens`, `confirmations` (sum of `affected_count` minus incident count), `incident_ids`. `impact_score = min(100, round(0.6 * max priority + 0.4 * min(100, 8 * incident_count)))` in `incidents.impact_score` (unit-tested). The old keys (`area`, `open_incidents`, `critical`, `categories`, ...) are kept so existing clients work. The map's own clusters (eps 300 m, min 2) are unchanged.
46. **Hotspot result is cached in-process for 60 s** (addition, setting `HOTSPOT_CACHE_SECONDS`, 0 in tests). Measured with 100,000 incidents: uncached p95 1076 ms, cached p95 82 ms (first call after each expiry is still about 1 s). Single-process design, see #33.
47. **`/ai/analyze` additions**: `image_confidence`, `text_confidence` (each model's own top-1, null when it did not run), `image_model_active`, `department`. `confidence` stays the 0.7 image / 0.3 text blend.
48. **`reports.answers` jsonb** (addition, migration `0005_report_answers.py`; 0004 already existed): the quick answers `{question id: option id}`, validated against `app/answers.py` (mirrors `src/questions.ts`), unknown key or value returns 422. Answers raise only fixed flags (blocks road/footpath -> Blocks footpath, fully dark or unsafe -> Night-time hazard, main road -> Main road). "People affected" is stored but never changes `affected_count`.
49. **Area centres stay in code** (`refdata.AREA_CENTRES`), not a `wards.centre` column, and `location_source` keeps the values photo / gps / manual (a chosen area is `manual`). The brief's `area` source and column were not added: same behaviour, no migration needed.
50. (superseded by #54) A wrong category on a photo used to be the citizen's own choice because no image model ran.
51. **i18n**: `scripts/check-i18n.mjs` fails if any `T()/L()/o()` entry has an empty hi or mr string or the App.tsx `copy` keys differ. My Reports, Community and status/severity names are translated (`statusName`, `severityName`); Hindi and Marathi drafts are listed in `docs/I18N_REVIEW.md`. Not yet translated: Auth, Profile details, FAQ, reply box.
52. **`GET /me/summary`** (addition): `reports_submitted`, `incidents_resolved` (my reports whose incident is Resolved), `confirmations_received` (sum of affected_count - 1 over incidents I started), `level` (`contributor` >= 1 resolved; `trusted` >= 5 resolved and >= 10 submitted; else null). Profile now uses it, and the word "verified" is gone from the UI (#7). `/me/contribution` is kept for old clients.
53. **Frontend audit fixes**: My Reports timeline no longer overflows on phones (the mobile rule forced four 110 px columns into 308 px); Profile menu rows were unstyled because a wrapper div broke the `.profile-card>button` selector; small tap target on the mobile Log out button; Back button no longer shares a line with the step label. Checked at 390 px and 1440 px with a headless browser (no horizontal scroll, no overflowing elements on citizen pages, English, Hindi, Marathi).
54. **Image model `img-1.0` ships** (addition; decision gate D1 approved by the owner). Pretrained ImageNet EfficientNet-Lite0 kept frozen, logistic-regression head fitted on its features (`ml/train_probe.py`), temperature-scaled on val, int8 ONNX (3.8 MB, about 10 ms). Chosen over fine-tuning because training took minutes on CPU instead of hours. Data: the owner's `Public-cleanliness-dataset.zip` and `civic-sense-image-dataset.zip`, the Chennai streetlight dataset (GitHub Team16Project), and flowers (Oxford Flowers102) plus Caltech101 as `not_civic`. Near-duplicates across sources are grouped by dHash and kept in one split (`ml/prepare_data.py`). Classes: Pothole, Road Damage, Streetlight, Garbage, Other, not_civic. Honest limits are in `ml/reports/img-1.0.json`. Third-party licences were not checked by the code and must be confirmed before commercial use; the raw data is git-ignored.
55. **The image result is ignored when the citizen already chose a category the model has no data for** (Water Leakage, Drainage, Electrical Hazard): `models.image = "category_not_covered"`, the photo is still stored. Otherwise a drain photo could be called a pothole with high confidence.
56. **Photo explanation wording**: "The photo resembles a Pothole (84 %)." followed by a description of the category, never "The image shows ...", because the model outputs a class, not a description of the photo.

### Authority v2 (branch `feat/authority-v2`)

57. **One citizen, one report per spot.** `create_report` refuses (409 `already_reported`, with the complaint's `id` and `public_id`) when the same user already has a non-duplicate report on an OPEN incident within `merge_radius_m` (50 m, measured to the incident point), of ANY category, made within `merge_max_age_days`. Nothing is inserted. A confirmation does not count as a report, so a citizen who only confirmed may still report. Per-user advisory lock stops two quick taps passing the check together.
58. **Report flow takes one category per report** (`MAX_CATEGORIES = 1`). The old "several problems at one spot" feature always produces a 409 under #57. Another problem at the same spot needs another place (51 m away) or waiting until the first is no longer open.
59. **Existing repeat reports are flagged, never deleted.** Migration 0009 sets `reports.duplicate_of_report_id` on every report after the earliest of each (incident, user). Counts, evidence, photos, "my reports" and the brief skip them. Their photos stay in storage but are hidden. On the real dev data this flagged 9 of 39 reports.
60. **Rate limit 10 reports per user per hour**, in-process like the other limits (`ratelimit.check_window`), setting `RATE_REPORTS_PER_HOUR`. Photo uploads: 30 per hour.
61. **ONE definition of "open".** `app/status.py` `OPEN_STATUSES` (Reported, Acknowledged, Scheduled, In Progress, Reopened, On Hold) and the SQL function `ireport_is_open()` (migration 0011, IMMUTABLE so it is indexed). `test_priority.py` proves they agree for every enum value. Resolved (waiting for the citizen), Closed, Rejected, Duplicate, Transferred are not open. No query writes `status <> 'Resolved'` any more.
62. **Status migration in two steps.** 0010 only renames `Under Review` to `Acknowledged` and adds the new values, inside an `autocommit_block` (Alembic runs all pending migrations in ONE transaction and PostgreSQL cannot use a new enum value in the transaction that added it). 0011+ use the values.
63. **Transferred is a hand-over, not a resting state.** It would leave the complaint outside every open queue. The timeline records Transferred (with the reason and both departments), then the complaint re-enters the new department's queue as Reported, unassigned, with its due date restarted from the new category.
64. **Resolved needs proof, enforced on the server.** After-photo (uploaded to `POST /authority/incidents/{id}/photos`, kept in `media.incident_id`), work note (ATR), and the officer's device location within 50 m (`ST_Distance`). Farther: a reason is required and stored with the distance in `resolution_proofs`. Bulk can acknowledge, assign, schedule and message; Resolved/Closed/Reopened in bulk are 422. Closed and Reopened belong to the citizen (or the 72 h job). Rejected, Duplicate and Closed are final for officers.
65. **Duplicate moves the reporters.** Reports (and their photos) and confirmations move to the target; a citizen who had reported both ends up with the earliest report only; the target's `affected_count` is recomputed from DISTINCT users.
66. **Citizen answer to Resolved.** Confirm gives Closed. Reopen needs a reason, gives Reopened, `reopen_count + 1`, and does NOT touch `due_at` (the SLA clock keeps running). No answer for 72 h: `jobs.auto_close` (every 15 min) closes it with no actor.
67. **Priority is risk = impact x likelihood** (UK "Well-managed Highway Infrastructure" risk-based approach; IRC:82 maintenance categories). All numbers live in `app/risk_config.py`; `categories.impact` is a snapshot that a test compares with it. Impact: Electrical Hazard 4; Pothole, Road Damage, Drainage, Water Leakage 3 (the merged water category includes waterlogging); Streetlight and Garbage 2; Other 1. The citizen's severity can raise impact by one (High/Critical) and never lowers it; it is the severity from the citizen's own words only (`citizen_severity`), so school/hospital flags are not counted twice. Likelihood starts at 1, +1 each for: main road, school or hospital within 100 m, 3 or more DISTINCT citizens (reporters plus confirmers), monsoon month for road/water categories, night-time hazard or an open streetlight complaint within 100 m; capped at 4. Risk 12+ Emergency 24 h, 8-11 Urgent 3 d, 4-7 Routine 14 d, below 4 Planned 30 d.
68. **`priority_score` is kept as a sort key** (risk x 100 / 16, rounded half up) so `(ireport_is_open(status), priority_score, id)` still pages. The old point sum (severity, hazard, flags, age, votes) is gone from Python and from `ireport_priority()`. `test_priority.py` was rewritten on purpose. The UI no longer shows the number; it shows the response category and due date.
69. **Known consequence of the method as specified:** a single live-wire report with nothing else known is 4 x 1 = 4 = Routine (14 days). It becomes Emergency only with 2 more factors (for example school and main road). Recommended follow-up for the owner: a floor of Urgent for impact 4, or a base likelihood of 2 for life-safety categories. Not applied, because it changes the method that was asked for.
70. **due_at** = `created_at` + response time, set when the risk is computed. Automatic re-scoring only moves it EARLIER (`LEAST`), so a risk that falls later never extends a promise already made. A transfer clears it first. Overdue = open and now > due_at (one rule in `incidents.due_fields` and in SQL).
71. **Map checks.** `osm_features` (GiST) is filled by the developer-run `scripts/load_osm.py` from Overpass (schools, hospitals, trunk/primary/secondary roads in the bounding box of the seeded areas, 3 x 2 tiles). A kind is loaded only if every tile downloaded. `incidents.geo_facts` holds the PostGIS result (school or hospital within 100 m, main road within 30 m). Where the map has a main-road dataset it decides "main road" (a citizen tick no longer counts and the category default `Main road` for potholes was removed from `rules.DEFAULT_FLAGS`). Without it, the citizen's flag is used and labelled "citizen says". School and hospital: the map when it finds one, otherwise the citizen's flag, labelled as such. Every reason shows its source: checked on map, citizen says, complaint records, calendar, category.
72. **The Overpass download failed in this build** (500/504 from every public endpoint for the whole session). Nothing was invented; the table is empty and all priority uses the citizen's flags. Re-run `python -m scripts.load_osm` later; finished tiles can be cached with `OSM_CACHE_DIR`.
73. **Wording.** The officer sees the response category plus due date, "Reported by N citizens" (distinct users), "Assigned to: officer · department, ward ward office" (or Unassigned), and one Next action button. "What the system detected", ML and GIS tags, the severity chip, "Recommended action" and the stats tiles were removed. The photo-check line shows only when the photo model disagrees with the chosen category. The flow does not ask a head count, so only "a few people at risk" / "many commuters" is shown as the citizen estimate, never an invented range.
74. **Count chips** use the same predicates as the list filter (`CHIPS` in `routers/authority.py`), under the same ward/category/search filters; a test compares every chip with the list `total`. New = Reported plus Reopened.
75. **Analytics definitions** (`routers/analytics.py`): `resolved_at` is the first event into Resolved; "closed by officers" is the first event into Resolved, Rejected or Duplicate (waiting for a citizen is not counted against the team). Within SLA = `resolved_at <= due_at`. A reopened complaint stays counted as finished at its first completion (the reopen rate is shown separately). Repeat spot = same category within 50 m, reported again within 90 days after a closure. Road Damage and Drainage are shown as Pothole and Water Leakage, in the charts and in the category filter.
76. **No chart library.** The brief said to add recharts. `pnpm add recharts` failed (store location mismatch with the existing node_modules, and the package host ran at a few KB/s), and `package.json` was left untouched. The charts are small dependency-free SVG with a printed value, a screen-reader summary and a "show as a table" fallback. Swap in recharts later if wanted.
77. **Print work order** is CSS only (`@media print`, A4): the open brief alone, without buttons or the embedded map.
78. **CSV export** neutralises cells starting with `=`, `+`, `-`, `@` (spreadsheet formula injection) and is limited to 10,000 rows.
79. **ATR proof removed (owner decision after review).** "Mark resolved" is one click again, single or in bulk, as before v2; no after-photo, work note or device location is required. The citizen still confirms or reopens, and the 72 h auto-close stays. The `resolution_proofs` table and `media.incident_id` from migration 0011 are left in place unused (migrations are never edited); a later migration can drop them.

---

## Authority v2 review notes

Everything is uncommitted. Read `git diff`, then decide. Design decisions are numbered **57–78** in [DECISIONS.md](#design-decisions).

**Verified:** backend tests **124 passed** (baseline 86; one old test file was rewritten on purpose, see below). Frontend `tsc` is clean except the one old error in `src/imports/vite.config.ts` (missing `.figma` file), and `vite build` passes.
**Not verified:** several UI actions were never clicked in a browser. See section 5 before you trust the screens.

### 1. What changed and where

Your brief had 8 work items. Your timeline table numbers the "points" 1–10 from an earlier audit that I don't have, so I report by work item.

| # | Item | Backend | Frontend | Tests |
|---|---|---|---|---|
| 1 | Duplicate report bug (409, nearby check, add photos, 10/hour, cleanup) | [incidents.py](backend/app/incidents.py) `create_report`, `nearby_check`; [routers/reports.py](backend/app/routers/reports.py); [ratelimit.py](backend/app/ratelimit.py); [0009](backend/alembic/versions/0009_duplicate_reports.py) | [ReportFlow.tsx](src/ReportFlow.tsx) (nearby-check card, one category per report) | [test_duplicates.py](backend/tests/test_duplicates.py) |
| 2 | New statuses, one "open", ATR proof, confirm/reopen, 72 h auto-close | [status.py](backend/app/status.py); [workflow.py](backend/app/workflow.py); [uploads.py](backend/app/uploads.py); [jobs.py](backend/app/jobs.py); [0010](backend/alembic/versions/0010_status_enum.py), [0011](backend/alembic/versions/0011_workflow.py) | [IncidentDetail.tsx](src/IncidentDetail.tsx) (action bar, ATR form); [App.tsx](src/App.tsx) (citizen Confirm/Reopen, 6-step timeline) | [test_workflow.py](backend/tests/test_workflow.py), `test_priority.py` (open definition) |
| 3 | Risk-based priority, due dates, map checks | [priority.py](backend/app/priority.py); [risk_config.py](backend/app/risk_config.py); [0012](backend/alembic/versions/0012_osm_features.py), [0013](backend/alembic/versions/0013_risk_priority.py); [scripts/load_osm.py](backend/scripts/load_osm.py) | reasons with sources in the brief | [test_priority.py](backend/tests/test_priority.py) (Python vs SQL, 1024 cases), [test_risk.py](backend/tests/test_risk.py) |
| 4 | Incident brief | [brief.py](backend/app/brief.py) | [IncidentDetail.tsx](src/IncidentDetail.tsx) (what, why urgent, where, evidence, history, nearby, timeline, messages, next action, print CSS in [index.css](src/index.css)) | `test_reports.py`, `test_risk.py` |
| 5 | Wording and noise | n/a | [AuthorityDashboard.tsx](src/AuthorityDashboard.tsx), [IncidentDetail.tsx](src/IncidentDetail.tsx), [MapDashboard.tsx](src/MapDashboard.tsx), [i18nStaff.ts](src/i18nStaff.ts), [i18n.ts](src/i18n.ts) | (build only) |
| 6 | Counts and chips | [routers/authority.py](backend/app/routers/authority.py) `/stats` (`chips`, `by_status`, overdue, unassigned, due today) | chip bar in [AuthorityDashboard.tsx](src/AuthorityDashboard.tsx) | `test_workflow.py::test_chip_counts_equal_the_list_totals_for_the_same_filter` |
| 7 | Analysis tab | [routers/analytics.py](backend/app/routers/analytics.py) (overview, backlog, by-ward, by-type with repeat spots, performance, season, today, CSV) | [AnalysisTab.tsx](src/AnalysisTab.tsx), [WardMap.tsx](src/WardMap.tsx) | [test_analytics.py](backend/tests/test_analytics.py) |
| 8 | Area context | area name labels on the map: [ProblemMap.tsx](src/ProblemMap.tsx) | locality photo component in the brief (shows nothing when no file) | none |

**`test_priority.py` was changed on purpose.** The old tests checked the point sum, which no longer exists. They now check the risk formula, the response categories, and that the Python and SQL functions give identical results on every input combination. `test_ai.py` (two asserts) and `test_reports.py` / `test_task_fixes.py` (new status words, new response shape, resolving now needs proof) were also updated; each change is in the diff.

### 2. Screenshots

In [docs/screenshots/authority-v2/](docs/screenshots/authority-v2/). "Before" is your original code and API; "after" is the new build on a **copy** of your dev database.

| View | Before | After |
|---|---|---|
| Authority page (top) | before-0-authority-top-desktop.png | after-0-authority-top-desktop.png |
| Authority list | before-1-authority-list-desktop.png | after-1-authority-list-desktop.png |
| Open incident (desktop) | before-2-incident-open-desktop.png | after-2-incident-brief-desktop.png (full: after-2b-…-full.png) |
| Drawer at 390 px | before-3-drawer-390.png | after-3-drawer-390.png |
| Analysis tab | n/a (new) | after-4-analysis-desktop.png |
| Keyboard focus on a chip | n/a | after-6-keyboard-focus-chip.png |

What the "before" drawer shows: one citizen with 9 photos, "Priority 61/100 High", "1 / 9 citizens", a header thumbnail that repeats the main photo. The "after" drawer has 1 photo, the complaint's response category and due date, and no clipped text.

Checked with a script on the new UI: Tab reaches a chip, Enter activates it (`aria-pressed` true, list total 4 = chip count 4), focus outline 3 px, Escape closes the drawer, with `prefers-reduced-motion: reduce` the drawer animation is `none` and 0 animations run.

### 3. New migrations and how to apply them

`0009` duplicate marking · `0010` status enum · `0011` workflow columns, `resolution_proofs`, `ireport_is_open()` · `0012` `osm_features`, `geo_facts` · `0013` risk functions, `categories.impact`, `incidents.risk`, due dates.

```powershell
docker compose up --build        # the api container runs `alembic upgrade head` on start
```

I applied all five to a **copy** of your dev database (`ireport_review`) and they ran cleanly on your real rows (28 incidents, 39 reports; 9 reports were flagged as repeats). Your own `ireport` database was **not** touched. `0013` drops the old `ireport_priority()` and does not restore it on downgrade.

### 4. One-time scripts

| Script | Result |
|---|---|
| `python -m scripts.load_osm` | **Failed.** Every public Overpass server returned 500/504 for the whole session, so no schools, hospitals or roads were loaded. Nothing was invented: priority uses the citizen's flags and labels them "citizen says". Run it again later (`docker compose exec api python -m scripts.load_osm`; `--from-fixture` reloads a saved file). The download and tile-cache code ran; the load-into-database step of the script itself has not run on real data (the same SQL is covered by `test_risk.py` with hand-made features). |
| `python -m scripts.fetch_area_photos` | **Not written** (cut, see below). |

### 5. What was cut or is incomplete (honestly)

- **Area photos (item 8): cut.** No `fetch_area_photos.py`, no photos. The brief shows nothing for the ward, as you specified for "no photo". Area name labels on the map are done.
- **Admin weights page: cut** (it was last in your cut order).
- **Your later request, the citizen card** (training-dataset photo and "model confidence", "1 citizens affected", "Pending / High severity"): **not done.** The community card in [App.tsx](src/App.tsx) is unchanged apart from status filters and status words.
- **UI actions not clicked in a browser:** acknowledge, assign, schedule, hold, reject, duplicate, transfer, the ATR form (photo plus device location), bulk actions, the citizen Confirm/Reopen buttons and "add a photo". They are type-checked and built, and every rule behind them is covered by API tests, but I did not drive them in the UI. Treat steps 4–9 of the script below as the first real test.
- **Seed scripts** `seed_demo.py` and `seed_load.py` were updated for the new statuses and risk columns but **not run**.
- **Hindi and Marathi** strings were written by me and need a native reader. About 200 new strings.
- **Old unused strings** (the removed explainer, tiles, ML/GIS tags) are still in `i18nStaff.ts`.
- **A lone live-wire report scores Routine (14 days)**: 4 x 1. This follows your method exactly; see decision 69 for the suggested fix.
- **Backlog chart:** a reopened complaint stays counted as finished at its first completion (decision 75).
- **No recharts** (decision 76): hand-written SVG charts.
- **Embedded map in the brief** is the existing OpenStreetMap iframe; it rendered blank in my headless browser, so I could not check it.
- **Took far longer than 3 hours.** Package downloads ran at a few KB/s, so I ran the tests inside the existing `ireport_copy-tests` image with the working tree mounted (my `docker compose build` failed on `pip`). Your `docker compose --profile test run --rm tests` will rebuild from the new code and needs a working network.

Things I created on your machine that you can remove: database `ireport_review`; containers `ireport-review-api` and one finished OSM container; an **empty folder `C:\ABDULH~1`** I created by mistake (a safety check blocked me from deleting it); `backend/data/` (empty); `docs/screenshots/`.

### 6. Ten-step manual test

Start the stack (`docker compose up --build`, then `docker compose exec api python -m scripts.seed_demo` on a fresh database) and the frontend on port 5173.

1. **Duplicate:** as citizen `aarav@example.com / citizen123`, start a report, set the pin on one of Aarav's existing complaints. Expect "You already reported this (IR-…). Add a photo instead?" and the Next button disabled. Add a photo; it appears in My Reports.
2. **Confirm instead:** as a second citizen, pin within 50 m of someone else's open complaint. Expect "Already reported here, confirm it instead". Confirm; the affected count goes up by 1.
3. **Chips:** log in as `officer@bmc.demo / bmc12345`. Click each chip (All, New, Acknowledged, … Overdue, Unassigned); the list count under "Select all" equals the number on the chip. Change the ward or category and check again.
4. **Brief:** open a complaint. Read top to bottom: what, why urgent (at most 3 reasons, each with its source), where, evidence, history, nearby work, timeline. No "Priority 61/100", no raw coordinates. Try Navigate, Copy location, Print work order (A4, brief only).
5. **Next action:** on a Reported complaint press Acknowledge, then Assign (pick yourself), then Schedule (pick a date), then Start work. Check the timeline lines and the chips move.
6. **ATR:** press "Upload ATR & resolve" without a photo or note (the button stays disabled). Add a photo and a note on a phone at the site, or on a desktop (expect the "too far" message, then give a reason). The complaint becomes "Resolved (awaiting citizen)".
7. **Citizen answer:** as the reporting citizen, open My Reports. You see the work note and after-photo. Press "Not fixed, reopen" with a reason; the officer sees "Reopened 1x" and the original due date. Resolve again and press "Yes, it is fixed"; status is Closed.
8. **Side states:** put one complaint On Hold (reason required), reject one (reason required), mark one Duplicate of another (enter its IR number): its reporters move and the target's "Reported by N citizens" updates. Try Transfer to another category: the department and due date change.
9. **Bulk:** select three Reported complaints; Acknowledge, Assign and Schedule work; there is no Resolve in bulk.
10. **Analysis tab:** each chart title is a sentence; open "Show as a table"; click a ward on the map or in the table, then "Open the list" shows that ward. Press "Export list (CSV)". Switch the language to Hindi and Marathi and look at the officer screens. Tab through the page with the keyboard only.

### 7. `git diff --stat` (tracked files; the new files are listed above and untracked)

```
 DECISIONS.md                     |  25 +++
 backend/app/ai/rules.py          |  15 +-
 backend/app/config.py            |   2 +
 backend/app/errors.py            |  11 +-
 backend/app/incidents.py         | 256 +++++++++++++++++++---------
 backend/app/jobs.py              |  17 +-
 backend/app/main.py              |   4 +-
 backend/app/models.py            |  20 ++-
 backend/app/priority.py          | 135 ++++++++++-----
 backend/app/ratelimit.py         |  16 +-
 backend/app/refdata.py           |  14 ++
 backend/app/routers/admin.py     |  17 +-
 backend/app/routers/authority.py | 199 ++++++++++++----------
 backend/app/routers/incidents.py |  32 +++-
 backend/app/routers/me.py        |  18 +-
 backend/app/routers/reports.py   |  69 +++++++-
 backend/app/schemas.py           |  30 +++-
 backend/scripts/seed_demo.py     |  32 ++--
 backend/scripts/seed_load.py     |   9 +-
 backend/tests/conftest.py        |  25 +++
 backend/tests/test_ai.py         |  13 +-
 backend/tests/test_priority.py   | 137 ++++++++++-----
 backend/tests/test_reports.py    |  37 ++--
 backend/tests/test_task_fixes.py |  18 +-
 src/AdminPanel.tsx               |   2 +-
 src/App.tsx                      |  68 +++++++-
 src/AuthorityDashboard.tsx       | 261 ++++++++++++-----------------
 src/IncidentDetail.tsx           | 354 +++++++++++++++++++++++++++++----------
 src/MapDashboard.tsx             |  43 ++---
 src/ProblemMap.tsx               |  41 ++++-
 src/ReportFlow.tsx               |  86 ++++++----
 src/api.ts                       |  90 ++++++++--
 src/brand.tsx                    |   2 +-
 src/facts.ts                     |  56 ++++---
 src/i18n.ts                      |  39 ++++-
 src/i18nStaff.ts                 | 193 ++++++++++++++++++++-
 src/index.css                    | 126 ++++++++++++++
 src/store.ts                     |  11 +-
 38 files changed, 1819 insertions(+), 704 deletions(-)
```

(Tracked files only. New untracked files: migrations 0009–0013, `brief.py`, `risk_config.py`, `status.py`, `uploads.py`, `workflow.py`, `routers/analytics.py`, `scripts/load_osm.py`, four new test files, `src/AnalysisTab.tsx`, `src/WardMap.tsx`, `docs/screenshots/`, and this file.)

---

## Open items

Open items after the authority v2 work. Each line says what is missing and why.

- **Map checks from OpenStreetMap:** `python -m scripts.load_osm` is written but the Overpass download failed during the last build. Run it again; until then "near a school" and "on a main road" use the citizen's flags, labelled "citizen says".
- **Real ward boundaries:** load polygons with `scripts/load_wards.py`; today an area is the nearest of the seeded area centres.
- **Location pictures and symbols:** the files in `public/areas` and `public/symbols` have no licence record, and `critical.png` carries a stock-site watermark. Confirm the licences or replace them. `andheri-east.png` is 1.9 MB and should be compressed.
- **Area picture script:** an automated fetch of freely licensed area pictures with credits was not built.
- **Browser check of officer actions:** assign, schedule, hold, reject, duplicate, transfer, bulk actions and the citizen confirm / reopen buttons are covered by API tests but were not clicked through by a person. Follow the manual test script in `REVIEW_AUTHORITY_V2.md`.
- **Hindi and Marathi:** all new text was machine-written and needs review by native speakers (see `docs/I18N_REVIEW.md`).
- **Live-wire scoring:** a single live-wire report with nothing else known scores 4 x 1 (MODERATE RISK). Decide on a floor for impact 4 (DECISIONS.md entry 69).
- **Unused table:** `resolution_proofs` (migration 0011) is no longer used after proof of resolution was removed; drop it in a new migration if not needed.
- **Image model:** six classes only; needs real Mumbai photos and data for water leakage, drainage and electrical hazards.
- **Performance:** photo analysis and the 100,000-incident list were measured on an earlier build; re-measure on the real server with `scripts/bench.py`.
- **Old import folder:** `src/imports/` (a Figma export) is not imported anywhere and causes the one remaining type-check error; it can be deleted.
- **Admin weights page:** a screen to edit the risk configuration was not built; the numbers live in `backend/app/risk_config.py`.
- **Nominatim:** place search runs from the browser; add a backend proxy if usage grows.
