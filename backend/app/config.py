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
    image_model_name: str = "img-2.0"
    text_model_name: str = "txt-1.0"
    ai_uncertain_below: float = 0.60
    ai_threads: int = 2
    require_image_model: bool = False  # /ready fails without it when true

    # Merge rule
    merge_radius_m: float = 50
    merge_max_age_days: int = 14

    # Accountability (migration 0018). Proof of work: an officer cannot mark a complaint Resolved without a fresh photo taken at the site.
    require_resolution_proof: bool = True  # set false only for demos / development
    proof_radius_m: float = 150            # the phone must be this close to the complaint when the proof photo is taken
    proof_max_accuracy_m: float = 100      # a GPS fix less precise than this is refused ("move to open sky")
    proof_max_age_hours: int = 6           # a proof photo is valid for the next Resolved action only within this time
    proof_photo_max_age_hours: int = 24    # a photo whose own EXIF time is older than this is refused (an old photo reused)
    min_work_minutes: int = 20             # Resolved sooner than this after the last officer action is flagged "too_fast" for the admin
    # Abuse checks on citizen reports.
    photo_reuse_block: bool = True         # the same photo (perceptual hash) cannot back two different reports
    photo_reuse_days: int = 90
    photo_gps_max_gap_m: float = 1500      # a photo whose own GPS is further than this from the pinned spot sends the report to review
    rate_reports_per_day: int = 25         # new reports per citizen per 24 hours (on top of the hourly limit)
    strike_window_days: int = 30
    strike_review_at: int = 3              # this many fake-report decisions: every new report of that citizen goes to review
    strike_block_at: int = 5               # this many: the citizen cannot report until the oldest strike leaves the window

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
