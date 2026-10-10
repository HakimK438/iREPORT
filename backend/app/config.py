from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Every setting is read from the environment (see .env.example)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: Literal["development", "test", "production"] = "development"
    database_url: str = "postgresql+asyncpg://ireport:ireport@localhost:5434/ireport"
    db_pool_size: int = 10

    # Auth
    jwt_secret: str = Field(default="change-me-in-production-please-32b", min_length=32)
    access_token_minutes: int = 15
    refresh_token_days: int = 30
    cookie_secure: bool = False
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:8443", "http://localhost:5173"]  # comma-separated in the env

    # First admin, created at startup if no admin exists. Never hard-coded.
    admin_email: str | None = None
    admin_password: str | None = None
    admin_name: str = "System Admin"

    # Object storage (S3 / R2 / MinIO)
    storage_backend: Literal["s3", "memory"] = "s3"
    s3_endpoint: str = "localhost:9000"
    s3_public_endpoint: str | None = None  # host the browser uses for signed URLs
    s3_secure: bool = False
    s3_public_secure: bool | None = None
    s3_region: str = "us-east-1"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket: str = "ireport"
    s3_create_bucket: bool = True
    signed_url_minutes: int = 15

    # Uploads
    max_upload_bytes: int = 8 * 1024 * 1024
    max_pixels: int = 25_000_000
    max_photos: int = 3
    main_max_side: int = 1280
    thumb_max_side: int = 400

    # AI
    models_dir: str = "models"
    image_model_name: str = "img-1.0"
    text_model_name: str = "txt-1.0"
    ai_uncertain_below: float = 0.60
    ai_threads: int = 2
    require_image_model: bool = False  # /ready fails without it when true

    # Merge rule
    merge_radius_m: float = 50
    merge_max_age_days: int = 14

    # Retention and jobs
    enable_scheduler: bool = True
    draft_ttl_minutes: int = 60
    full_image_retention_days: int = 365

    # Rate limits (requests per minute, per client)
    rate_login: int = 10
    rate_register: int = 5
    rate_analyze: int = 20
    rate_reports_per_hour: int = 10  # new reports per citizen per hour
    rate_photos_per_hour: int = 30
    hotspot_cache_seconds: int = 60  # in-process cache for the hotspot query (0 = off); see README.md (Design decisions)

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, v: object) -> object:
        if isinstance(v, str) and not v.strip().startswith("["):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()
