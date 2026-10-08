"""Per-report evidence needed for authority decision support.

- location_source: where the incident coordinates came from (photo EXIF, device GPS, or a manual pick).
- citizen_message: optional note from the citizen to the authority, kept apart from AI fields.
- ai_source / ai_disagreement: how the AI category was produced and whether image and text disagreed.
- nlp: rule-based facts extracted from the citizen's text (duration, obstruction, hazard, urgency).

Revision ID: 0004
Revises: 0003
"""
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""ALTER TABLE reports
        ADD COLUMN location_source text CHECK (location_source IN ('photo', 'gps', 'manual')),
        ADD COLUMN citizen_message text,
        ADD COLUMN ai_source text,
        ADD COLUMN ai_disagreement jsonb,
        ADD COLUMN nlp jsonb""")


def downgrade() -> None:
    op.execute("ALTER TABLE reports DROP COLUMN location_source, DROP COLUMN citizen_message, DROP COLUMN ai_source, DROP COLUMN ai_disagreement, DROP COLUMN nlp")
