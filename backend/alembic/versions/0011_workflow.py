"""Officer workflow: assignment, scheduling, due date, duplicates, reopen count, resolution proof, and the
single SQL definition of "open".

- ireport_is_open(status): the SQL twin of app/status.py OPEN_STATUSES. The two list indexes that used
  `status <> 'Resolved'` are rebuilt on it, so "open" means the same thing in the index, the queries and Python.
- incidents: assigned_to, scheduled_for, due_at (set by the risk migration 0013), duplicate_of, reopen_count, status_reason.
- status_events.reason: why a transition happened (the work note for Resolved, the reason for On Hold, ...).
- resolution_proofs: what an officer submitted to mark a complaint Resolved (after photos, work note, device location, distance).
- media.incident_id: after-photos uploaded by an officer belong to an incident, not to a citizen report.

Revision ID: 0011
Revises: 0010
"""
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""CREATE FUNCTION ireport_is_open(st issue_status) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
        SELECT st IN ('Reported', 'Acknowledged', 'Scheduled', 'In Progress', 'Reopened', 'On Hold')
    $$""")
    op.execute("""ALTER TABLE incidents
        ADD COLUMN assigned_to uuid REFERENCES users(id),
        ADD COLUMN scheduled_for date,
        ADD COLUMN due_at timestamptz,
        ADD COLUMN duplicate_of uuid REFERENCES incidents(id),
        ADD COLUMN reopen_count int NOT NULL DEFAULT 0,
        ADD COLUMN status_reason text""")
    op.execute("ALTER TABLE status_events ADD COLUMN reason text")
    op.execute("""CREATE TABLE resolution_proofs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      incident_id uuid NOT NULL REFERENCES incidents(id),
      actor_id uuid NOT NULL REFERENCES users(id),
      media_ids uuid[] NOT NULL,
      note text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 1000),
      officer_lat double precision, officer_lng double precision,
      distance_m real,
      far_reason text,
      created_at timestamptz NOT NULL DEFAULT now()
    )""")
    op.execute("CREATE INDEX resolution_proofs_incident_idx ON resolution_proofs (incident_id, created_at)")
    op.execute("ALTER TABLE media ADD COLUMN incident_id uuid REFERENCES incidents(id)")
    op.execute("CREATE INDEX media_incident_idx ON media (incident_id) WHERE incident_id IS NOT NULL")

    # The default authority sort and the "longest open" sort put non-open complaints last, via the one definition of open.
    op.execute("DROP INDEX incidents_priority_page_idx")
    op.execute("DROP INDEX incidents_oldest_page_idx")
    op.execute("CREATE INDEX incidents_priority_page_idx ON incidents (ireport_is_open(status), priority_score, id)")
    op.execute("CREATE INDEX incidents_oldest_page_idx ON incidents ((NOT ireport_is_open(status)), created_at, id)")
    op.execute("CREATE INDEX incidents_assigned_idx ON incidents (assigned_to) WHERE assigned_to IS NOT NULL")
    op.execute("CREATE INDEX incidents_due_idx ON incidents (due_at) WHERE ireport_is_open(status)")
    op.execute("CREATE INDEX incidents_status_idx ON incidents (status, created_at)")
    op.execute("CREATE INDEX status_events_to_idx ON status_events (to_status, created_at)")


def downgrade() -> None:
    for name in ("status_events_to_idx", "incidents_status_idx", "incidents_due_idx", "incidents_assigned_idx", "incidents_oldest_page_idx", "incidents_priority_page_idx", "media_incident_idx"):
        op.execute(f"DROP INDEX IF EXISTS {name}")
    op.execute("CREATE INDEX incidents_priority_page_idx ON incidents ((status <> 'Resolved'), priority_score, id)")
    op.execute("CREATE INDEX incidents_oldest_page_idx ON incidents ((status = 'Resolved'), created_at, id)")
    op.execute("ALTER TABLE media DROP COLUMN incident_id")
    op.execute("DROP TABLE resolution_proofs")
    op.execute("ALTER TABLE status_events DROP COLUMN reason")
    op.execute("ALTER TABLE incidents DROP COLUMN assigned_to, DROP COLUMN scheduled_for, DROP COLUMN due_at, DROP COLUMN duplicate_of, DROP COLUMN reopen_count, DROP COLUMN status_reason")
    op.execute("DROP FUNCTION ireport_is_open(issue_status)")
