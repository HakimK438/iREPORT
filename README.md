# iREPORT: Mumbai civic reporting

The React + Vite frontend (in `src/`) talks to a FastAPI backend (`backend/`) with PostgreSQL + PostGIS, S3-compatible photo storage and two small CPU models. The backend is the source of truth. The browser keeps only the access token (in memory) and the language preference.

```
src/                 React 19 + Vite + Tailwind (UI unchanged, data from the API; report flow is a lazy chunk)
backend/app/         FastAPI app: routers/, incidents.py (merge rule), priority.py, images.py, ai/, jobs.py
backend/alembic/     migrations: 0001 schema, 0002 seed (departments, categories, areas), 0003 list indexes
backend/models/      shipped model files (txt-1.0.npz; img-1.0.onnx once trained)
backend/scripts/     seed_demo, seed_load, table_sizes, bench, load_wards
backend/tests/       pytest: auth, admin, reports, merge, priority, images, AI, jobs
ml/                  offline training only: text + image training, ONNX export/quantisation, evaluation
DECISIONS.md         every choice the spec left open, and every addition
```

## Run it (one command)

Needs Docker and Node 22.

```bash
cp .env.example .env              # set JWT_SECRET and ADMIN_PASSWORD
docker compose up --build         # postgres+postgis (host port 5434), minio (9000/9001), api (8000)
```

- API: http://localhost:8000/api/v1. Interactive docs: http://localhost:8000/api/docs (not served in production).
- Health: `GET /api/v1/health` (process up) and `GET /api/v1/ready` (database + models).
- Migrations run on container start. The first admin comes from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- Demo citizen, officer and incidents for development: `docker compose exec api python -m scripts.seed_demo`. This refuses to run when `ENV=production`.

Frontend:

```bash
npx pnpm@10 install
npx pnpm@10 dev                    # reads VITE_API_URL from .env (default http://localhost:8000/api/v1)
```

Add the frontend's origin to `CORS_ORIGINS`, for example a Figma Make preview URL. If the frontend and API are on different sites in production, set `COOKIE_SAMESITE=none` and `COOKIE_SECURE=true`.

## Tests

```bash
docker compose --profile test run --rm tests                  # in the Python 3.12 image (uses the ireport_test database)
# or on the host:
cd backend && python -m venv .venv && .venv/Scripts/pip install -r requirements-dev.txt && .venv/Scripts/python -m pytest -q
ml/.venv/Scripts/python -m pytest ml/tests                     # text runtime == scikit-learn
```

There are 86 backend tests and 2 ML tests, all passing. They cover:
- auth: refresh rotation and reuse detection, rate limits, role checks, authority approval and revocation
- the merge rule (50 m, same category, open, under 14 days), with no double counting
- keyset paging returning every row exactly once
- priority: the SQL function equals the Python port on 300 random incidents, and a dangerous incident with 2 reports ranks above a safe one with 30
- the image pipeline: magic bytes, size and pixel limits, EXIF orientation and GPS, metadata stripping, WebP sizes, HEIC
- the AI: image-only, multilingual text-only, disagreement between the two, failure still returning 200, and draft cleanup
- retention and the hourly priority refresh

Image tests use a tiny generated ONNX stand-in, so the real ONNX Runtime path runs without shipping a model.

## Train the models

See [ml/README.md](ml/README.md).
- **Text:** trained and shipped (`backend/models/txt-1.0.npz`, 0.14 MB). Measured on a held-out split: macro-F1 0.73 (5-fold CV 0.72 ± 0.08) on a small hand-written seed set. Retrain on real reports.
- **Image:** `img-1.0` is a **linear probe**: a frozen ImageNet EfficientNet-Lite0 (int8 ONNX, 3.83 MB) with a logistic-regression head, trained in about 3 minutes on CPU on 1,800 images from public datasets. It predicts 6 classes: Pothole, Road Damage, Streetlight, Garbage, Other, not_civic. Held-out test (360 images): accuracy 0.928, macro-F1 0.927; recall Garbage 0.90, Other 0.92, Pothole 0.88, Road Damage 0.97, Streetlight 0.97, not_civic 0.93. Limits: the test images come from the same public sources as the training images (de-duplicated, but not independent), so real-world accuracy will be lower; `not_civic` was trained on flowers and Caltech101 objects only; there are no Mumbai photos; Water Leakage, Drainage and Electrical Hazard have no data and are never predicted (the image result is ignored when the citizen has chosen one of those). Numbers: `ml/reports/img-1.0.json`. Retrain or upgrade with `ml/prepare_data.py`, `ml/train_probe.py` (fast) or `ml/train_image.py` (full fine-tune), then `ml/evaluate.py`.

## Measured performance (2026-10-07, dev laptop, Docker Desktop)

| Budget | Result |
|---|---|
| `/ai/analyze` p95 < 1.5 s, one 250 KB photo, 2 vCPU | **p95 876 ms, p50 462 ms** (container limited to `--cpus 2 --memory 1g`, 60 sequential requests after one warm-up; that first cold request took about 2 s) |
| Model inference < 150 ms | **p95 51 ms, p50 19 ms** (EfficientNet-Lite0 int8, 2 threads). Untrained head: speed and size only |
| No model file > 15 MB, all models < 30 MB | EfficientNet-Lite0 **int8 3.8 MB** (fp32 13.6 MB). Text model 0.14 MB |
| API image < 700 MB, no PyTorch | **509 MB**. No torch, no scikit-learn, onnxruntime only |
| Stored photo 100–300 KB, thumb < 40 KB, nothing > 500 KB | Real 1400×1829 street photo (428 KB JPEG) stored as **173 KB** WebP at 980×1280 with a **19 KB** thumbnail. Hard cap 500 KB (quality steps down). Worst case, a synthetic full-noise photo: 403 KB |
| `/authority/incidents` p95 < 300 ms with 100,000 incidents | **p95 76 ms, p50 34 ms, max 166 ms** (300 mixed requests: every sort, filters, search, cursor pages; warm cache) |
| `/authority/hotspots` p95 < 300 ms with 100,000 incidents | **p95 82 ms, p50 57 ms** with the 60 s in-process cache; **uncached p95 1076 ms** (first call after each expiry, about 1 s). Run: `python -m scripts.bench hotspots --n 30` |
| DB growth < 1 KB per report row set | **534 B** row data (report + incident + status event + 1 photo row). About 1.5 KB including all indexes |
| Home page loads no AI or compression code | Report flow and compression are a separate 19.5 KB chunk; the main bundle has no `canvas.toBlob` |

Reproduce:
```bash
docker compose exec api python -m scripts.seed_load --n 100000
cd backend && python -m scripts.bench authority --n 300
python -m scripts.bench analyze --n 60          # one 250 KB photo per request
docker compose exec api python -m scripts.table_sizes
docker compose exec api python -m scripts.seed_load --drop
```
Run the same benchmarks on the real 2 vCPU server before launch. A laptop is only an approximation.

## API (all under `/api/v1`, JSON, errors `{"error": {"code", "message"}}`)

| Area | Routes |
|---|---|
| Auth | `POST /auth/register` (citizen, or authority → pending) · `POST /auth/login` · `POST /auth/refresh` (httpOnly cookie, rotated, reuse ends all sessions) · `POST /auth/logout` · `GET/PATCH /me` · `GET /me/export` · `DELETE /me` |
| Admin | `GET /admin/authorities?approval=` · `POST /admin/authorities/{id}/decision` (approve, reject, revoke) · `GET /admin/stats` |
| AI | `POST /ai/analyze` (multipart, ≤ 3 photos, text, lang, lat, lng): stores draft photos, returns category, confidence, top3, uncertain, not_civic, severity, flags, explanation, gps_suggestion and media_ids. Always 200 if the AI fails |
| Citizen | `POST /reports` (merge rule) · `GET /reports/mine` · `GET /incidents/nearby` · `GET /incidents/{id}` · `POST/DELETE /incidents/{id}/confirm` · `POST /incidents/{id}/messages` · `GET /messages/unread-count` |
| Authority | `GET /authority/incidents` (ward, category, status, q, hide_resolved, sort, cursor, limit) · `GET /authority/stats` · `GET /authority/incidents/{id}` · `POST /authority/incidents/{id}/update` · `POST /authority/incidents/bulk` (≤ 100) |
| Ops | `GET /health` · `GET /ready` |

Rate limits apply to login (by IP and by email), register and analyze. Background jobs run in the API process: draft photos are deleted after 1 hour, priorities refresh every hour, and full images of incidents resolved more than 12 months ago are deleted (thumbnails kept).

## Deploy

1. **Database:** PostgreSQL 16 with PostGIS (and the bundled `pg_trgm`), for example a managed Postgres with the PostGIS extension enabled. Set `DATABASE_URL`.
2. **Storage:** Cloudflare R2 or S3. Create a private bucket, then set `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT` (usually the same), `S3_SECURE=true`, `S3_REGION` (`auto` for R2), the keys, and `S3_CREATE_BUCKET=false`. Photos are only ever served through signed URLs (15 minutes).
3. **API:** build `backend/` (target `runtime`). It is one uvicorn worker per container; the image runs `alembic upgrade head` on start. Set `ENV=production`, a random `JWT_SECRET`, `COOKIE_SECURE=true`, `CORS_ORIGINS` (the frontend origin), and `ADMIN_EMAIL` / `ADMIN_PASSWORD` for the first start. Put it behind HTTPS. With more than one replica, set `ENABLE_SCHEDULER=false` on all but one, and note that rate limits become per replica (DECISIONS.md #33).
4. **Frontend:** `VITE_API_URL=https://api.example.org/api/v1 pnpm build`, then serve `dist/`.
5. **Before launch:** have the data handling reviewed by someone qualified under India's DPDP Act, 2023. The app collects name, email, optional phone and area, shows a consent line at registration, and supports data export and account deletion. It strips photo metadata and logs authority actions in `status_events` and `messages`.


For reviewers: [docs/AI_AND_GIS.md](docs/AI_AND_GIS.md) explains the models, GIS and decision logic.
