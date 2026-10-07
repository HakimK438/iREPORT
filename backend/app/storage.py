"""Object storage. S3-compatible (MinIO locally, R2 or S3 in production); an in-memory store for tests.
The database only ever holds object keys. Images are served to browsers through short-lived signed URLs."""

import io
import uuid
from datetime import UTC, datetime, timedelta
from typing import Protocol

from starlette.concurrency import run_in_threadpool

from .config import get_settings


class Storage(Protocol):
    async def put(self, key: str, data: bytes, content_type: str) -> None: ...
    async def delete(self, key: str) -> None: ...
    def signed_url(self, key: str) -> str: ...
    async def ensure_bucket(self) -> None: ...


def new_keys(at: datetime | None = None) -> tuple[str, str]:
    """Random, unguessable keys such as media/2026/10/<uuid>.webp and thumbs/2026/10/<uuid>.webp."""
    at = at or datetime.now(UTC)
    name = f"{at:%Y/%m}/{uuid.uuid4()}.webp"
    return f"media/{name}", f"thumbs/{name}"


class S3Storage:
    def __init__(self) -> None:
        from minio import Minio

        s = get_settings()
        self.bucket = s.s3_bucket
        self.ttl = timedelta(minutes=s.signed_url_minutes)
        self.create_bucket = s.s3_create_bucket
        self.client = Minio(s.s3_endpoint, access_key=s.s3_access_key, secret_key=s.s3_secret_key, secure=s.s3_secure, region=s.s3_region)
        # Signing is local (no network call), so a second client can sign for the host the browser sees.
        public_secure = s.s3_secure if s.s3_public_secure is None else s.s3_public_secure
        self.signer = Minio(s.s3_public_endpoint or s.s3_endpoint, access_key=s.s3_access_key, secret_key=s.s3_secret_key, secure=public_secure, region=s.s3_region)

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        await run_in_threadpool(self.client.put_object, self.bucket, key, io.BytesIO(data), len(data), content_type=content_type, metadata={"Cache-Control": "private, max-age=86400, immutable"})

    async def delete(self, key: str) -> None:
        await run_in_threadpool(self.client.remove_object, self.bucket, key)

    def signed_url(self, key: str) -> str:
        return self.signer.presigned_get_object(self.bucket, key, expires=self.ttl)

    async def ensure_bucket(self) -> None:
        if self.create_bucket and not await run_in_threadpool(self.client.bucket_exists, self.bucket):
            await run_in_threadpool(self.client.make_bucket, self.bucket)


class MemoryStorage:
    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        self.objects[key] = (data, content_type)

    async def delete(self, key: str) -> None:
        self.objects.pop(key, None)

    def signed_url(self, key: str) -> str:
        return f"https://storage.test/{key}?sig=test"

    async def ensure_bucket(self) -> None:
        return None


_storage: Storage | None = None


def get_storage() -> Storage:
    global _storage
    if _storage is None:
        _storage = MemoryStorage() if get_settings().storage_backend == "memory" else S3Storage()
    return _storage


def reset_memory() -> None:
    if isinstance(_storage, MemoryStorage):
        _storage.objects.clear()
