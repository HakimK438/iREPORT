"""Every complaint an officer has worked on has an owner.

Until now an officer could move a complaint to In progress (or Resolved) without assigning anyone, so the dashboards counted it as
"not assigned". The workflow now makes the acting officer the owner. This fills the same gap in existing rows: the owner becomes the
officer who last changed the status. Complaints with no officer in their history (for example bulk-loaded test rows) are left alone.

Revision ID: 0015
Revises: 0014
"""
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        UPDATE incidents i SET assigned_to = e.actor_id
        FROM (SELECT DISTINCT ON (ev.incident_id) ev.incident_id, ev.actor_id
              FROM status_events ev JOIN users u ON u.id = ev.actor_id AND u.role = 'authority'
              WHERE ev.from_status <> ev.to_status ORDER BY ev.incident_id, ev.created_at DESC) e
        WHERE e.incident_id = i.id AND i.assigned_to IS NULL AND i.status IN ('Acknowledged', 'Scheduled', 'In Progress', 'Resolved', 'Closed', 'On Hold')""")


def downgrade() -> None:
    pass  # the backfilled owners are real history; nothing to undo
