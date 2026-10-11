"""Photo checks and the "needs review" flag.

- media.ai_label / ai_conf: what the image model saw in the photo when it was uploaded (used to refuse a wrong photo
  and to flag doubtful reports).
- incidents.needs_review / review_reason: "Potentially fake / needs review" shown to officers in their own queue.

Revision ID: 0014
Revises: 0013
"""
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE media ADD COLUMN ai_label text, ADD COLUMN ai_conf real")
    op.execute("ALTER TABLE incidents ADD COLUMN needs_review boolean NOT NULL DEFAULT false, ADD COLUMN review_reason text")
    op.execute("CREATE INDEX incidents_needs_review_idx ON incidents (ward_id) WHERE needs_review")


def downgrade() -> None:
    op.execute("DROP INDEX incidents_needs_review_idx")
    op.execute("ALTER TABLE incidents DROP COLUMN needs_review, DROP COLUMN review_reason")
    op.execute("ALTER TABLE media DROP COLUMN ai_label, DROP COLUMN ai_conf")
