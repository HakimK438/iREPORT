# How to run iREPORT (Windows)

Needs: Docker Desktop (running) and Node 22.
Run all commands from the `iREPORT_Copy` folder.

## 1. Backend (database + storage + API)

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

## 2. Frontend

In another terminal:

```powershell
npx pnpm@10 install
$env:PORT=5173; npx pnpm@10 dev
```

Open **http://localhost:5173**.

Why `PORT=5173`: `vite.config.ts` defaults to port 8443. Some programs (for example the
AdBlock360 service) already use 8443 on Windows and answer with a JSON 404 instead of the app.
5173 is already allowed in `CORS_ORIGINS` in `.env`.

## 3. Admin login

Email and password come from `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`.

## Stop

- Frontend: Ctrl+C in its terminal.
- Backend: Ctrl+C, then `docker compose down` (add `-v` to also wipe the database).

## Tests

```powershell
docker compose --profile test run --rm tests
```

## Troubleshooting

| Problem | Fix |
|---|---|
| 404 JSON `{"code":404,"error":"Cannot GET /"}` in the browser | Wrong port. Use 5173 as above. |
| Page loads but data does not | Check the API is up (`/api/v1/health`) and `CORS_ORIGINS` in `.env` includes your frontend URL. |
| `port is already allocated` | Something else uses 5434, 8000, 9000 or 9001. Stop it or change the mapping in `docker-compose.yml`. |
| Docker errors on start | Make sure Docker Desktop is running. |
