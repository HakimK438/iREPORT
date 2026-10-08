import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from .answers import unknown_answers

Lang = Literal["en", "hi", "mr"]
StatusName = Literal["Reported", "Under Review", "In Progress", "Resolved"]
SeverityName = Literal["Low", "Medium", "High", "Critical"]

FLAGS = ("Live wiring", "Injury reported", "Near school", "Near hospital", "Flood risk", "Main road", "Night-time hazard", "Blocks footpath")


def _clean(v: str | None) -> str | None:
    if v is None:
        return None
    v = " ".join(v.split())
    return v or None


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# ---------- auth / users ----------


class RegisterIn(Strict):
    role: Literal["citizen", "authority"]
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=20, pattern=r"^[0-9+\-\s()]*$")
    password: str = Field(min_length=8, max_length=128)
    area: str | None = Field(default=None, max_length=60)
    department: str | None = Field(default=None, max_length=60)
    employee_id: str | None = Field(default=None, max_length=40)
    lang: Lang = "en"
    consent: bool = Field(description="Citizen agreed to the data use notice shown at registration.")

    @field_validator("name", "phone", "employee_id")
    @classmethod
    def clean_text(cls, v: str | None) -> str | None:
        return _clean(v)


class LoginIn(Strict):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    role: Literal["citizen", "authority", "admin"]


class UserOut(BaseModel):
    id: uuid.UUID
    role: str
    name: str
    email: str
    phone: str | None
    area: str | None
    lang: str
    department: str | None = None
    employee_id: str | None = None
    approval: str
    created_at: datetime


class SessionOut(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: UserOut


class PendingOut(BaseModel):
    pending: Literal[True] = True
    message: str


class MePatch(Strict):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    phone: str | None = Field(default=None, max_length=20, pattern=r"^[0-9+\-\s()]*$")
    area: str | None = Field(default=None, max_length=60)
    lang: Lang | None = None

    @field_validator("name", "phone")
    @classmethod
    def clean_text(cls, v: str | None) -> str | None:
        return _clean(v)


# ---------- admin ----------


class AuthorityOut(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    phone: str | None
    area: str | None
    department: str | None
    employee_id: str
    approval: str
    created_at: datetime
    decided_at: datetime | None


class DecisionIn(Strict):
    decision: Literal["approve", "reject", "revoke"]


class AdminStats(BaseModel):
    pending: int
    approved: int
    rejected: int
    citizens: int
    incidents: int
    reports: int


# ---------- reports / incidents ----------


class AiIn(Strict):
    category: str | None = Field(default=None, max_length=40)
    confidence: float | None = Field(default=None, ge=0, le=1)
    model_version: str | None = Field(default=None, max_length=40)
    source: Literal["image", "text", "image+text"] | None = None
    disagreement: dict[str, str] | None = None


class ReportIn(Strict):
    media_ids: list[uuid.UUID] = Field(default_factory=list, max_length=3)
    category: str = Field(min_length=1, max_length=40)
    problem_type: str | None = Field(default=None, max_length=60)
    description: str | None = Field(default=None, max_length=500)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    address_text: str | None = Field(default=None, max_length=200)
    # Where lat/lng came from. Required: a report must carry a genuine incident location, never the profile area.
    location_source: Literal["photo", "gps", "manual"]
    # Optional area chosen/shown in the flow for the incident point (used only while ward polygons are not loaded).
    area: str | None = Field(default=None, max_length=60)
    flags: list[str] = Field(default_factory=list, max_length=8)
    citizen_message: str | None = Field(default=None, max_length=500)
    ai: AiIn | None = None
    # Quick answers from the flow ({question id: option id}); unknown keys or values are rejected with 422.
    answers: dict[str, str] | None = Field(default=None, max_length=10)

    @field_validator("answers")
    @classmethod
    def known_answers(cls, v: dict[str, str] | None) -> dict[str, str] | None:
        if v and (bad := unknown_answers(v)):
            raise ValueError(f"Unknown answers: {', '.join(bad)}")
        return v

    @field_validator("problem_type", "address_text", "citizen_message")
    @classmethod
    def clean_text(cls, v: str | None) -> str | None:
        return _clean(v)

    @field_validator("flags")
    @classmethod
    def known_flags(cls, v: list[str]) -> list[str]:
        return [f for f in dict.fromkeys(v) if f in FLAGS]


class ReportCreated(BaseModel):
    report_id: uuid.UUID
    incident_id: uuid.UUID
    incident_public_id: str
    merged: bool
    affected_count: int
    severity: str
    status: str
    area: str | None = None
    department: str | None = None


class MessageIn(Strict):
    body: str = Field(min_length=1, max_length=1000)


class MessageOut(BaseModel):
    id: int
    from_: Literal["authority", "citizen"] = Field(alias="from")
    by: str
    text: str
    at: datetime
    model_config = ConfigDict(populate_by_name=True)


class TimelineEvent(BaseModel):
    status: str
    at: datetime


class IncidentPublic(BaseModel):
    id: uuid.UUID
    public_id: str
    title: str
    category: str
    area: str | None
    address_text: str | None
    severity: str
    status: str
    flags: list[str]
    affected_count: int
    created_at: datetime
    updated_at: datetime
    distance_m: float | None = None
    thumb_url: str | None = None
    confirmed_by_me: bool = False
    reported_by_me: bool = False


class Page(BaseModel):
    items: list
    next_cursor: str | None


class MyReport(BaseModel):
    report_id: uuid.UUID
    incident_id: uuid.UUID
    public_id: str
    title: str
    category: str
    area: str | None
    address_text: str | None
    severity: str
    status: str
    affected_count: int
    created_at: datetime
    updated_at: datetime
    image_url: str | None
    thumb_url: str | None
    history: list[TimelineEvent]
    messages: list[MessageOut]


class AuthorityUpdate(Strict):
    status: StatusName | None = None
    message: str | None = Field(default=None, max_length=1000)
    flags: list[str] | None = Field(default=None, max_length=8)

    @field_validator("flags")
    @classmethod
    def known_flags(cls, v: list[str] | None) -> list[str] | None:
        return None if v is None else [f for f in dict.fromkeys(v) if f in FLAGS]


class BulkUpdate(Strict):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=100)
    status: StatusName | None = None
    message: str | None = Field(default=None, max_length=1000)
