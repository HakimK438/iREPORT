# iREPORT: civic problem reporting for Mumbai

iREPORT lets residents report broken roads, garbage, dead streetlights, water leaks and electrical hazards in a few taps. It gives ward offices a control room that shows **what the problem is, where it is, how serious it is, and who acts next**.

- **Citizens** report with a photo and a map pin, follow every step, then confirm the fix or reopen the complaint.
- **Officers** get one list sorted by hazard, a map, a work-order style complaint view, one primary action per complaint and an analysis tab with a printable report.
- **Administrators** approve officer accounts and see the city overview.

Available in English, Hindi and Marathi (the Hindi and Marathi text is machine-written and needs a native reader).

> **Status:** a working application with automated tests. It has not been deployed to real users, so nothing here describes measured real-world outcomes. The seeded complaints are demo data.

**Demo video:** see [video/](video/) for the Remotion project behind the LinkedIn walkthrough.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 8, Tailwind 4, TanStack Query, Leaflet |
| Backend | Python 3.12, FastAPI, SQLAlchemy 2 (async), Alembic, APScheduler |
| Data | PostgreSQL 16 + PostGIS, MinIO (S3-compatible photo storage) |
| AI | Two small CPU models on ONNX Runtime (text and image), used only as labelled suggestions |
| Tooling | Docker Compose, pnpm, pytest |

---

## Quick start

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (running)
- [Node.js 22](https://nodejs.org/)

Everything else (Python, PostgreSQL, PostGIS, MinIO) runs inside Docker.

### 1. Clone and configure

```bash
git clone https://github.com/HakimK438/iREPORT.git
cd iREPORT
```

Create your `.env` file from the example:

```bash
cp .env.example .env          # macOS / Linux / Git Bash
copy .env.example .env        # Windows cmd or PowerShell
```

Open `.env` and set at least:

- `JWT_SECRET`: any long random string (for example the output of `openssl rand -hex 32`)
- `ADMIN_EMAIL` and `ADMIN_PASSWORD`: the first admin account, created on first start

### 2. Start the backend (database, storage, API)

```bash
docker compose up --build
```

Leave this terminal open. When it is ready:

| Service | URL |
|---|---|
| API | http://localhost:8000/api/v1 |
| API docs | http://localhost:8000/api/docs |
| Health check | http://localhost:8000/api/v1/health |
| MinIO console | http://localhost:9001 (`minioadmin` / `minioadmin`) |

`http://localhost:8000/` on its own shows a 404. That is normal; the API lives under `/api/v1`. Database migrations run automatically when the API starts.

### 3. Load demo data (optional, recommended)

In a second terminal:

```bash
docker compose exec api python -m scripts.seed_demo
```

This adds a demo citizen, a demo officer and sample complaints. For a fuller city, also run `python -m scripts.seed_area_problems` and `python -m scripts.seed_extra_problems` the same way (see [docs/WINDOWS_SETUP.md](docs/WINDOWS_SETUP.md)). These scripts refuse to run when `ENV=production`.

### 4. Start the frontend

In a third terminal, from the repository root:

```bash
npx pnpm@10 install
```

then start the dev server on port 5173:

```bash
# macOS / Linux / Git Bash
PORT=5173 npx pnpm@10 dev

# Windows PowerShell
$env:PORT=5173; npx pnpm@10 dev
```

Open **http://localhost:5173**.

> Port 5173 is already allowed in `CORS_ORIGINS`. The Vite default is 8443, which some Windows programs already use and which then answers with a JSON 404 instead of the app.

### 5. Log in

Development accounts (created by the seed script, development only):

| Role | Email | Password |
|---|---|---|
| Citizen | `aarav@example.com` | `citizen123` |
| Officer | `officer@bmc.demo` | `bmc12345` |
| Admin | value of `ADMIN_EMAIL` in `.env` | value of `ADMIN_PASSWORD` in `.env` |

### Stop

- Frontend: `Ctrl+C`
- Backend: `Ctrl+C`, then `docker compose down` (add `-v` to also wipe the database)

### Troubleshooting

| Problem | Fix |
|---|---|
| Browser shows `{"code":404,"error":"Cannot GET /"}` | Wrong port. Use 5173 as above. |
| Page loads but shows no data | Check `http://localhost:8000/api/v1/health` and that `CORS_ORIGINS` in `.env` includes your frontend URL. |
| `port is already allocated` | Something else uses 5434, 8000, 9000 or 9001. Stop it or change the mapping in `docker-compose.yml`. |
| Docker errors on start | Make sure Docker Desktop is running. |

---

## Run the tests

```bash
docker compose --profile test run --rm tests     # 133 backend tests + 2 ML tests
npx tsc --noEmit                                 # frontend type check
npx pnpm@10 build                                # production build
```

---

## Project structure

```
iREPORT/
├── src/                 React app (citizen pages, report flow, officer control room, admin dashboard, i18n)
├── public/              Static assets: area pictures, hazard symbols, guide screenshots
├── backend/
│   ├── app/             FastAPI app: routers, workflow, risk scoring, AI models
│   ├── alembic/         Database migrations
│   ├── scripts/         Seed and maintenance scripts
│   ├── seed_data/       Demo photos used by the seed scripts
│   ├── models/          Exported ONNX models
│   └── tests/           pytest suite
├── ml/                  Offline training and evaluation of the text and image models
├── video/               Remotion project for the LinkedIn demo video
├── scripts/             Frontend checks (for example the i18n completeness gate)
├── docs/                Detailed documentation (see below)
├── docker-compose.yml   Postgres + PostGIS, MinIO, API, test runner
└── .env.example         Configuration template
```

---

## How it works in one minute

1. A citizen picks the problem, answers a few questions, adds up to 3 photos and pins the spot.
2. The server rejects repeat reports of the same spot, merges nearby reports into one complaint and scores it: **risk = impact x likelihood**, giving **CRITICAL**, **HIGH RISK**, **MODERATE RISK** or **ROUTINE** and a fix-by date.
3. The ward officer sees the list sorted by hazard and takes one action at a time: Acknowledge, Start work, Mark resolved. Resolving needs a completion note and a photo taken at the site.
4. The citizen confirms the fix or reopens it. With no answer in 72 hours it closes automatically.
5. Every status change is logged with who did it and why. Admins and officers see backlog, overdue work and hotspots in the Analysis tab.

---

## Documentation

| Document | What is in it |
|---|---|
| [docs/FEATURES.md](docs/FEATURES.md) | Full feature list, hazard categories, lifecycle, architecture, API, known gaps |
| [docs/PURPOSE_AND_IMPACT.md](docs/PURPOSE_AND_IMPACT.md) | Why the project exists and how its effect can be checked |
| [docs/WORKFLOW.md](docs/WORKFLOW.md) | Every step from report to closure, rules, data model, security |
| [docs/WINDOWS_SETUP.md](docs/WINDOWS_SETUP.md) | Detailed Windows setup and extra seed scripts |
| [docs/AI_AND_GIS.md](docs/AI_AND_GIS.md) | What the models and map logic really do, and what they do not |
| [docs/MODEL_TRAINING.md](docs/MODEL_TRAINING.md) | Offline training and evaluation |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Numbered design decisions |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | What changed in v3, v4 and v5 |
| [docs/OPEN_ITEMS.md](docs/OPEN_ITEMS.md) | What is not finished and why |
| [docs/LANGUAGE_REVIEW.md](docs/LANGUAGE_REVIEW.md) | Status of the Hindi and Marathi translations |
| [docs/IMAGE_CREDITS.md](docs/IMAGE_CREDITS.md) | Photo credits and licences |

---

## Honest limits

- The image model is small (at most 20 training images per class) and is a demonstration-level suggestion tool. A suggestion never overrides the citizen and never sets urgency.
- Hindi and Marathi text has not been reviewed by native speakers.
- Several officer actions are covered by API tests but were not clicked through in a browser.
- Before any public launch, data handling should be reviewed under India's DPDP Act, 2023.

More in [docs/OPEN_ITEMS.md](docs/OPEN_ITEMS.md).
