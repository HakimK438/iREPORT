import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from . import errors, jobs, refdata
from .ai import pipeline
from .config import get_settings
from .db import SessionLocal, engine
from .models import User
from .routers import admin, ai, auth, authority, health, incidents, me, reports
from .security import hash_password
from .storage import get_storage

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("ireport")


async def seed_admin() -> None:
    """Create the first admin from ADMIN_EMAIL / ADMIN_PASSWORD if no admin exists yet."""
    s = get_settings()
    if not (s.admin_email and s.admin_password):
        return
    async with SessionLocal() as db:
        if await db.scalar(select(User.id).where(User.role == "admin").limit(1)):
            return
        db.add(User(role="admin", name=s.admin_name, email=s.admin_email.lower(), password_hash=hash_password(s.admin_password)))
        await db.commit()
        log.info("created first admin account %s", s.admin_email)


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    async with SessionLocal() as db:
        await refdata.load(db)
    await seed_admin()
    await get_storage().ensure_bucket()
    if not (pipeline.models.image or pipeline.models.text):  # load once per process
        await run_in_threadpool(pipeline.load, s)
    scheduler = jobs.start_scheduler() if s.enable_scheduler else None
    yield
    if scheduler:
        scheduler.shutdown(wait=False)
    await engine.dispose()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="iREPORT API", version="1.0.0", lifespan=lifespan, docs_url="/api/docs" if s.env != "production" else None, openapi_url="/api/openapi.json" if s.env != "production" else None)
    errors.install(app)
    app.add_middleware(
        CORSMiddleware, allow_origins=s.cors_origins, allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Authorization", "Content-Type"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Cross-Origin-Resource-Policy", "same-site")
        if request.url.path.startswith("/api/v1"):
            response.headers.setdefault("Cache-Control", "no-store")
            response.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        if s.cookie_secure:
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response

    api = APIRouter(prefix="/api/v1")
    for module in (auth, me, admin, ai, reports, incidents, authority, health):
        api.include_router(module.router)
    app.include_router(api)
    return app


app = create_app()
