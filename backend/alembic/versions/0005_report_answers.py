"""Quick answers from the report flow, stored as {question id: option id} (validated against a whitelist).

Revision ID: 0005
Revises: 0004
"""
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE reports ADD COLUMN answers jsonb")


def downgrade() -> None:
    op.execute("ALTER TABLE reports DROP COLUMN answers")
