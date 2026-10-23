"""Indexes found necessary by the 100,000-incident load test (see README, "Performance").

- pg_trgm GIN indexes so the control-room search (ILIKE '%q%' on address and report ID) does not scan every row.
- keyset indexes for the "Longest open" and "Most citizens affected" sorts.

Revision ID: 0003
Revises: 0002
"""
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute("CREATE INDEX incidents_address_trgm_idx ON incidents USING gin (address_text gin_trgm_ops)")
    op.execute("CREATE INDEX incidents_public_id_trgm_idx ON incidents USING gin (public_id gin_trgm_ops)")
    op.execute("CREATE INDEX incidents_oldest_page_idx ON incidents ((status = 'Resolved'), created_at, id)")
    op.execute("CREATE INDEX incidents_affected_page_idx ON incidents (affected_count, id)")


def downgrade() -> None:
    for name in ("incidents_affected_page_idx", "incidents_oldest_page_idx", "incidents_public_id_trgm_idx", "incidents_address_trgm_idx"):
        op.execute(f"DROP INDEX IF EXISTS {name}")
