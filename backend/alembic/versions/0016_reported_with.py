"""A citizen can report up to three problems at one place.

reports.reported_with points at the MAIN complaint of the batch, so the officer of each complaint can see the others, and so the
"one report per spot" rule can tell a deliberate batch from a repeat report.

Revision ID: 0016
Revises: 0015
"""
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE reports ADD COLUMN reported_with uuid REFERENCES incidents(id)")
    op.execute("CREATE INDEX reports_reported_with_idx ON reports (reported_with) WHERE reported_with IS NOT NULL")


def downgrade() -> None:
    op.execute("DROP INDEX reports_reported_with_idx")
    op.execute("ALTER TABLE reports DROP COLUMN reported_with")
