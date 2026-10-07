"""Initial schema (section 4 of the build spec, plus the indexes listed in DECISIONS.md).

Revision ID: 0001
Revises:
"""
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

SCHEMA = [
    "CREATE EXTENSION IF NOT EXISTS postgis",
    "CREATE EXTENSION IF NOT EXISTS citext",
    "CREATE TYPE user_role AS ENUM ('citizen','authority','admin')",
    "CREATE TYPE approval_state AS ENUM ('pending','approved','rejected')",
    "CREATE TYPE severity_level AS ENUM ('Low','Medium','High','Critical')",
    "CREATE TYPE issue_status AS ENUM ('Reported','Under Review','In Progress','Resolved')",
    """CREATE TABLE wards (
      id smallserial PRIMARY KEY, name text UNIQUE NOT NULL,
      geom geography(MultiPolygon,4326)
    )""",
    "CREATE INDEX wards_geom_idx ON wards USING gist (geom)",
    "CREATE TABLE departments (id smallserial PRIMARY KEY, name text UNIQUE NOT NULL)",
    """CREATE TABLE categories (
      id smallserial PRIMARY KEY, code text UNIQUE NOT NULL, name text NOT NULL,
      department_id smallint REFERENCES departments(id),
      hazard_points smallint NOT NULL
    )""",
    """CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      role user_role NOT NULL,
      name text NOT NULL,
      email citext UNIQUE NOT NULL,
      phone text,
      password_hash text NOT NULL,
      ward_id smallint REFERENCES wards(id),
      lang char(2) NOT NULL DEFAULT 'en',
      messages_seen_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    )""",
    """CREATE TABLE authority_profiles (
      user_id uuid PRIMARY KEY REFERENCES users(id),
      employee_id text NOT NULL,
      department_id smallint REFERENCES departments(id),
      approval approval_state NOT NULL DEFAULT 'pending',
      decided_by uuid REFERENCES users(id), decided_at timestamptz
    )""",
    """CREATE TABLE refresh_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id),
      token_hash text NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz
    )""",
    "CREATE UNIQUE INDEX refresh_tokens_hash_idx ON refresh_tokens (token_hash)",
    "CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id)",
    "CREATE SEQUENCE incident_public_seq",
    """CREATE TABLE incidents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      public_id text UNIQUE NOT NULL,
      category_id smallint NOT NULL REFERENCES categories(id),
      location geography(Point,4326) NOT NULL,
      ward_id smallint REFERENCES wards(id),
      address_text text,
      severity severity_level NOT NULL,
      flags text[] NOT NULL DEFAULT '{}',
      status issue_status NOT NULL DEFAULT 'Reported',
      affected_count int NOT NULL DEFAULT 1,
      priority_score smallint NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      resolved_at timestamptz
    )""",
    "CREATE INDEX ON incidents USING gist (location)",
    "CREATE INDEX ON incidents (status, priority_score DESC)",
    "CREATE INDEX ON incidents (category_id, ward_id)",
    # Keyset paging for the authority list (resolved last, then score).
    "CREATE INDEX incidents_priority_page_idx ON incidents ((status <> 'Resolved'), priority_score, id)",
    "CREATE INDEX incidents_created_idx ON incidents (created_at, id)",
    """CREATE TABLE reports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      incident_id uuid NOT NULL REFERENCES incidents(id),
      user_id uuid NOT NULL REFERENCES users(id),
      problem_type text,
      description text CHECK (char_length(description) <= 500),
      ai_category_id smallint REFERENCES categories(id),
      ai_confidence real,
      model_version text,
      user_corrected boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    )""",
    "CREATE INDEX ON reports (user_id, created_at DESC)",
    "CREATE INDEX reports_incident_idx ON reports (incident_id, created_at)",
    """CREATE TABLE media (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      report_id uuid REFERENCES reports(id),
      uploader_id uuid NOT NULL REFERENCES users(id),
      storage_key text NOT NULL, thumb_key text NOT NULL,
      width smallint, height smallint, bytes int,
      created_at timestamptz NOT NULL DEFAULT now()
    )""",
    "CREATE INDEX media_report_idx ON media (report_id, created_at)",
    "CREATE INDEX media_drafts_idx ON media (created_at) WHERE report_id IS NULL",
    """CREATE TABLE confirmations (
      incident_id uuid REFERENCES incidents(id),
      user_id uuid REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (incident_id, user_id)
    )""",
    """CREATE TABLE status_events (
      id bigserial PRIMARY KEY,
      incident_id uuid NOT NULL REFERENCES incidents(id),
      from_status issue_status, to_status issue_status NOT NULL,
      actor_id uuid REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now()
    )""",
    "CREATE INDEX status_events_incident_idx ON status_events (incident_id, created_at)",
    """CREATE TABLE messages (
      id bigserial PRIMARY KEY,
      incident_id uuid NOT NULL REFERENCES incidents(id),
      sender_id uuid NOT NULL REFERENCES users(id),
      recipient_id uuid REFERENCES users(id),
      body text NOT NULL CHECK (char_length(body) <= 1000),
      created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz
    )""",
    "CREATE INDEX messages_incident_idx ON messages (incident_id, created_at)",
    # Priority score, same formula as priorityOf() in the old frontend store (see app/priority.py).
    # floor(x + 0.5) instead of round() so ties match JavaScript Math.round and Python exactly.
    """CREATE FUNCTION ireport_priority(sev severity_level, hazard smallint, flags text[], st issue_status,
                                       created timestamptz, affected int, at timestamptz DEFAULT now())
    RETURNS smallint LANGUAGE sql STABLE AS $$
      SELECT floor(least(100.0, (
          (CASE sev WHEN 'Critical' THEN 40 WHEN 'High' THEN 30 WHEN 'Medium' THEN 18 ELSE 8 END)
        + hazard
        + least(28, coalesce((SELECT sum(CASE f
              WHEN 'Live wiring' THEN 20 WHEN 'Injury reported' THEN 18 WHEN 'Near school' THEN 12
              WHEN 'Near hospital' THEN 12 WHEN 'Flood risk' THEN 10 WHEN 'Main road' THEN 8
              WHEN 'Night-time hazard' THEN 6 WHEN 'Blocks footpath' THEN 5 ELSE 4 END) FROM unnest(flags) f), 0))
        + (CASE WHEN st = 'Resolved' THEN 0
                ELSE least(15.0, greatest(0.0, extract(epoch FROM at - created)::float8 / 86400.0) * 1.5) END)
        + least(8.0, ln((1 + greatest(affected, 0))::float8) / ln(2::float8) * 1.6)
      ) / 116.0 * 100.0) + 0.5)::smallint
    $$""",
]


def upgrade() -> None:
    for statement in SCHEMA:
        op.execute(statement)


def downgrade() -> None:
    for table in ["messages", "status_events", "confirmations", "media", "reports", "incidents", "refresh_tokens", "authority_profiles", "users", "categories", "departments", "wards"]:
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
    op.execute("DROP FUNCTION IF EXISTS ireport_priority")
    op.execute("DROP SEQUENCE IF EXISTS incident_public_seq")
    for t in ["issue_status", "severity_level", "approval_state", "user_role"]:
        op.execute(f"DROP TYPE IF EXISTS {t}")
