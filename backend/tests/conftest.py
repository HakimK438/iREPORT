import os
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE / "fixtures"))
from build_models import prepare  # noqa: E402

# A stand-in image model plus the real text model, in a scratch folder used as MODELS_DIR.
prepare(_HERE / ".models", _HERE.parent / "models")

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://ireport:ireport@localhost:5434/ireport_test")
os.environ["MODELS_DIR"] = str(_HERE / ".models")
os.environ.update(
    ENV="test", STORAGE_BACKEND="memory", ENABLE_SCHEDULER="false",
    ADMIN_EMAIL="admin@example.com", ADMIN_PASSWORD="admin-pass-123",
    JWT_SECRET="test-secret-test-secret-test-secret-123", RATE_REGISTER="1000", HOTSPOT_CACHE_SECONDS="0",
)

import asyncio  # noqa: E402
import uuid  # noqa: E402
from pathlib import Path  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).parent / "fixtures"
TABLES = "messages, status_events, confirmations, media, reports, incidents, refresh_tokens, authority_profiles, users"


async def _reset_schema() -> None:
    engine = create_async_engine(os.environ["DATABASE_URL"])
    async with engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
    await engine.dispose()


@pytest.fixture(scope="session", autouse=True)
def database():
    asyncio.run(_reset_schema())
    cwd = os.getcwd()
    os.chdir(ROOT)
    try:
        command.upgrade(Config(str(ROOT / "alembic.ini")), "head")
    finally:
        os.chdir(cwd)


@pytest.fixture(autouse=True)
async def clean():
    from app import ratelimit
    from app.db import engine

    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {TABLES} RESTART IDENTITY CASCADE"))
        await conn.execute(text("ALTER SEQUENCE incident_public_seq RESTART"))
    ratelimit.reset()
    from app import storage

    storage.reset_memory()
    yield


@pytest.fixture
async def client():
    from app.main import app

    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://api.test/api/v1") as c:
            yield c


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def register_citizen(client: httpx.AsyncClient, email: str | None = None, name: str = "Asha Citizen", area: str = "Andheri West") -> dict:
    email = email or f"citizen-{uuid.uuid4().hex[:8]}@example.com"
    r = await client.post("/auth/register", json={"role": "citizen", "name": name, "email": email, "password": "citizen-pass-1", "area": area, "consent": True})
    assert r.status_code == 201, r.text
    data = r.json()
    data["headers"] = auth(data["access_token"])
    return data


async def resolve_complaint(client: httpx.AsyncClient, officer: dict, incident_id: str, **extra) -> httpx.Response:
    """Marks a complaint Resolved: one click for the officer (README.md (Design decisions) #79)."""
    return await client.post(f"/authority/incidents/{incident_id}/update", json={"status": "Resolved", **extra}, headers=officer["headers"])


async def admin_headers(client: httpx.AsyncClient) -> dict[str, str]:
    r = await client.post("/auth/login", json={"email": "admin@example.com", "password": "admin-pass-123", "role": "admin"})
    assert r.status_code == 200, r.text
    return auth(r.json()["access_token"])


async def make_authority(client: httpx.AsyncClient, approve: bool = True, email: str | None = None) -> dict:
    email = email or f"officer-{uuid.uuid4().hex[:8]}@bmc.example.com"
    r = await client.post("/auth/register", json={"role": "authority", "name": "R. Kulkarni", "email": email, "password": "officer-pass-1", "area": "Fort", "department": "General / Ward Office", "employee_id": "BMC-10482", "consent": True})
    assert r.status_code == 201, r.text
    result = {"email": email}
    if approve:
        admin = await admin_headers(client)
        pending = (await client.get("/admin/authorities?approval=pending", headers=admin)).json()
        uid = next(a["id"] for a in pending if a["email"] == email)
        assert (await client.post(f"/admin/authorities/{uid}/decision", json={"decision": "approve"}, headers=admin)).status_code == 200
        r = await client.post("/auth/login", json={"email": email, "password": "officer-pass-1", "role": "authority"})
        assert r.status_code == 200, r.text
        result.update(r.json())
        result["headers"] = auth(result["access_token"])
    return result
