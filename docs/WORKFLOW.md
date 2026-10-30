# Complete workflow

How a problem travels from a citizen's phone to a closed complaint, who can do what at each step, and which rule the server enforces. For the overview see [README.md](PURPOSE_AND_IMPACT.md); for purpose and impact see [PROJECT_EXPLAINED.md](#purpose-and-impact).

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

**Count chips** (All, New, Acknowledged, Scheduled, In progress, Awaiting verification, Closed, Overdue) filter the list. The chip numbers and the list total use the same SQL predicates, under the same ward, category and search filters, and a test compares them.

**List card:** picture, what and where, complaint number, hazard chip with symbol, "Fix by" date or Overdue, status.

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

Everything else is under **More**: schedule, hold, reject, mark duplicate, transfer to another category, reopen for rework.

#### Rules enforced by `workflow.apply_officer_update`

| Action | Rule |
|---|---|
| Any change | Written to `status_events` with the actor and reason; locked statuses (Closed, Rejected, Duplicate) cannot be changed by an officer |
| Scheduled | A date is required |
| On Hold, Rejected | A reason is required |
| Duplicate | The original complaint number is required; its reporters, photos and confirmations move to it, repeat reporters are collapsed, and its count is recomputed from distinct people |
| Transferred | The correct category and a reason are required; the department follows the category; the complaint returns to the new department's queue as Reported, unassigned, with its due date restarted |
| Resolved | A completion note is required (the citizen sees it). The citizen then answers |
| Closed, Reopened | Set only by the citizen (or the 72-hour job); officers cannot set them |
| Assign | Only to approved officers |

**Bulk actions** (`POST /authority/incidents/bulk`, up to 100): acknowledge, assign, schedule, message. Resolving in bulk is refused (422). Complaints outside the officer's area or department are skipped. Complaints for which a move is not allowed are skipped and counted in the response.

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
- Dashboard (`GET /admin/performance`): summary cards, weekly line chart, priority, problem-type and area charts, department table, ranked hotspots, officer workload. Every figure is a count; definitions are on the page.
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

