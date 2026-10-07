"""ORM mapping of the tables created in alembic/versions/0001_schema.py.

Spatial columns are mapped as an opaque type; all spatial work is done with PostGIS
functions in SQL (see services/), so no GeoAlchemy dependency is needed.
"""

import uuid
from datetime import datetime

from sqlalchemy import ARRAY, BigInteger, Boolean, DateTime, Float, ForeignKey, Integer, SmallInteger, String, Text, func
from sqlalchemy.dialects.postgresql import CITEXT, ENUM, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import UserDefinedType

ROLES = ("citizen", "authority", "admin")
APPROVALS = ("pending", "approved", "rejected")
SEVERITIES = ("Low", "Medium", "High", "Critical")
STATUSES = ("Reported", "Under Review", "In Progress", "Resolved")

RoleEnum = ENUM(*ROLES, name="user_role", create_type=False)
ApprovalEnum = ENUM(*APPROVALS, name="approval_state", create_type=False)
SeverityEnum = ENUM(*SEVERITIES, name="severity_level", create_type=False)
StatusEnum = ENUM(*STATUSES, name="issue_status", create_type=False)


class Geography(UserDefinedType):
    cache_ok = True

    def __init__(self, spec: str = "Point,4326"):
        self.spec = spec

    def get_col_spec(self, **_: object) -> str:
        return f"geography({self.spec})"


class Base(DeclarativeBase):
    pass


class Ward(Base):
    __tablename__ = "wards"
    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    name: Mapped[str] = mapped_column(Text, unique=True)


class Department(Base):
    __tablename__ = "departments"
    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    name: Mapped[str] = mapped_column(Text, unique=True)


class Category(Base):
    __tablename__ = "categories"
    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    code: Mapped[str] = mapped_column(Text, unique=True)
    name: Mapped[str] = mapped_column(Text)
    department_id: Mapped[int | None] = mapped_column(SmallInteger, ForeignKey("departments.id"))
    hazard_points: Mapped[int] = mapped_column(SmallInteger)


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    role: Mapped[str] = mapped_column(RoleEnum)
    name: Mapped[str] = mapped_column(Text)
    email: Mapped[str] = mapped_column(CITEXT, unique=True)
    phone: Mapped[str | None] = mapped_column(Text)
    password_hash: Mapped[str] = mapped_column(Text)
    ward_id: Mapped[int | None] = mapped_column(SmallInteger, ForeignKey("wards.id"))
    lang: Mapped[str] = mapped_column(String(2), server_default="en")
    messages_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuthorityProfile(Base):
    __tablename__ = "authority_profiles"
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    employee_id: Mapped[str] = mapped_column(Text)
    department_id: Mapped[int | None] = mapped_column(SmallInteger, ForeignKey("departments.id"))
    approval: Mapped[str] = mapped_column(ApprovalEnum, server_default="pending")
    decided_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    token_hash: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Incident(Base):
    __tablename__ = "incidents"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    public_id: Mapped[str] = mapped_column(Text, unique=True)
    category_id: Mapped[int] = mapped_column(SmallInteger, ForeignKey("categories.id"))
    location: Mapped[object] = mapped_column(Geography("Point,4326"), deferred=True)
    ward_id: Mapped[int | None] = mapped_column(SmallInteger, ForeignKey("wards.id"))
    address_text: Mapped[str | None] = mapped_column(Text)
    severity: Mapped[str] = mapped_column(SeverityEnum)
    flags: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default="{}")
    status: Mapped[str] = mapped_column(StatusEnum, server_default="Reported")
    affected_count: Mapped[int] = mapped_column(Integer, server_default="1")
    priority_score: Mapped[int] = mapped_column(SmallInteger, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    incident_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("incidents.id"))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    problem_type: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    ai_category_id: Mapped[int | None] = mapped_column(SmallInteger, ForeignKey("categories.id"))
    ai_confidence: Mapped[float | None] = mapped_column(Float(precision=24))
    model_version: Mapped[str | None] = mapped_column(Text)
    user_corrected: Mapped[bool] = mapped_column(Boolean, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Media(Base):
    __tablename__ = "media"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    report_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("reports.id"))
    uploader_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    storage_key: Mapped[str] = mapped_column(Text)
    thumb_key: Mapped[str] = mapped_column(Text)
    width: Mapped[int | None] = mapped_column(SmallInteger)
    height: Mapped[int | None] = mapped_column(SmallInteger)
    bytes: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Confirmation(Base):
    __tablename__ = "confirmations"
    incident_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("incidents.id"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StatusEvent(Base):
    __tablename__ = "status_events"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    incident_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("incidents.id"))
    from_status: Mapped[str | None] = mapped_column(StatusEnum)
    to_status: Mapped[str] = mapped_column(StatusEnum)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    incident_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("incidents.id"))
    sender_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    recipient_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
