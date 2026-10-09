"""New complaint statuses. Only the enum changes here, because PostgreSQL cannot USE a value in the same
transaction that added it (alembic runs all pending migrations in one transaction). The ADD VALUEs run in an
autocommit block, so the following migrations (0011+) can use them.

Lifecycle: Reported -> Acknowledged -> Scheduled -> In Progress -> Resolved -> Closed
Side states: Reopened, On Hold, Rejected, Duplicate, Transferred.
'Under Review' is renamed to 'Acknowledged' (existing rows and history keep their meaning).

Revision ID: 0010
Revises: 0009
"""
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

NEW_VALUES = ["Scheduled", "Closed", "Reopened", "On Hold", "Rejected", "Duplicate", "Transferred"]


def upgrade() -> None:
    op.execute("ALTER TYPE issue_status RENAME VALUE 'Under Review' TO 'Acknowledged'")
    # Commit what ran so far, then run the ADD VALUEs outside a transaction block.
    with op.get_context().autocommit_block():
        for value in NEW_VALUES:
            op.execute(f"ALTER TYPE issue_status ADD VALUE IF NOT EXISTS '{value}'")


def downgrade() -> None:
    # PostgreSQL cannot drop enum values. Rename back so older code still finds its label; the added values stay unused.
    op.execute("ALTER TYPE issue_status RENAME VALUE 'Acknowledged' TO 'Under Review'")
