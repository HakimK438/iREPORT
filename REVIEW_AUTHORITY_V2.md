# Review: authority v2 (branch `feat/authority-v2`, nothing committed)

Everything is uncommitted. Read `git diff`, then decide. Design decisions are numbered **57–78** in [DECISIONS.md](DECISIONS.md).

**Verified:** backend tests **124 passed** (baseline 86; one old test file was rewritten on purpose, see below). Frontend `tsc` is clean except the one old error in `src/imports/vite.config.ts` (missing `.figma` file), and `vite build` passes.
**Not verified:** several UI actions were never clicked in a browser. See section 5 before you trust the screens.

## 1. What changed and where

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

## 2. Screenshots

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

## 3. New migrations and how to apply them

`0009` duplicate marking · `0010` status enum · `0011` workflow columns, `resolution_proofs`, `ireport_is_open()` · `0012` `osm_features`, `geo_facts` · `0013` risk functions, `categories.impact`, `incidents.risk`, due dates.

```powershell
docker compose up --build        # the api container runs `alembic upgrade head` on start
```

I applied all five to a **copy** of your dev database (`ireport_review`) and they ran cleanly on your real rows (28 incidents, 39 reports; 9 reports were flagged as repeats). Your own `ireport` database was **not** touched. `0013` drops the old `ireport_priority()` and does not restore it on downgrade.

## 4. One-time scripts

| Script | Result |
|---|---|
| `python -m scripts.load_osm` | **Failed.** Every public Overpass server returned 500/504 for the whole session, so no schools, hospitals or roads were loaded. Nothing was invented: priority uses the citizen's flags and labels them "citizen says". Run it again later (`docker compose exec api python -m scripts.load_osm`; `--from-fixture` reloads a saved file). The download and tile-cache code ran; the load-into-database step of the script itself has not run on real data (the same SQL is covered by `test_risk.py` with hand-made features). |
| `python -m scripts.fetch_area_photos` | **Not written** (cut, see below). |

## 5. What was cut or is incomplete (honestly)

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

## 6. Ten-step manual test

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

## 7. `git diff --stat` (tracked files; the new files are listed above and untracked)

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
