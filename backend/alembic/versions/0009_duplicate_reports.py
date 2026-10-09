"""Mark repeat reports as duplicates (a user re-reporting the same incident). Nothing is deleted.

The old merge rule added +0 to affected_count for a repeat report from the same user but still inserted a
reports row and attached the photos, so one person could show up as 9 "citizens" with 9 photos. From now on a
repeat is rejected with 409 before anything is inserted (app/incidents.py). This migration flags the rows that
already exist: for each (incident, user) the earliest report is kept and the others get duplicate_of_report_id.
Counts, evidence lists and the brief all skip rows where duplicate_of_report_id IS NOT NULL.

Revision ID: 0009
Revises: 0008
"""
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


# Also run by tests/test_duplicates.py against rows made to look like the old data.
MARK_DUPLICATES = """
    UPDATE reports r SET duplicate_of_report_id = f.id
    FROM (SELECT DISTINCT ON (incident_id, user_id) incident_id, user_id, id
          FROM reports ORDER BY incident_id, user_id, created_at, id) f
    WHERE r.incident_id = f.incident_id AND r.user_id = f.user_id AND r.id <> f.id AND r.duplicate_of_report_id IS NULL"""


def upgrade() -> None:
    op.execute("ALTER TABLE reports ADD COLUMN duplicate_of_report_id uuid REFERENCES reports(id)")
    op.execute(MARK_DUPLICATES)
    # Most queries want only the real (non-duplicate) reports of an incident, oldest first.
    op.execute("CREATE INDEX reports_live_incident_idx ON reports (incident_id, created_at) WHERE duplicate_of_report_id IS NULL")
    op.execute("CREATE INDEX reports_live_user_idx ON reports (user_id, created_at DESC) WHERE duplicate_of_report_id IS NULL")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS reports_live_user_idx")
    op.execute("DROP INDEX IF EXISTS reports_live_incident_idx")
    op.execute("ALTER TABLE reports DROP COLUMN duplicate_of_report_id")
