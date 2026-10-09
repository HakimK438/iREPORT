"""More Mumbai areas (so an incident is not always filed under the same few neighbourhoods) and a marker for
example photos taken from the training dataset.

Revision ID: 0006
Revises: 0005
"""
import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

NEW_AREAS = [
    "Andheri East", "Versova", "Juhu", "Vile Parle", "Santacruz", "Jogeshwari", "Kandivali", "Dahisar", "Mahim", "Sion",
    "Worli", "Lower Parel", "Byculla", "Malabar Hill", "Kurla", "Ghatkopar", "Chembur", "Powai", "Vikhroli", "Bhandup", "Mulund",
]


def upgrade() -> None:
    # sample_confidence: set only on example reports whose photo comes from the training dataset (the model's confidence for it).
    op.execute("ALTER TABLE reports ADD COLUMN sample_confidence real")
    for name in NEW_AREAS:
        op.get_bind().execute(sa.text("INSERT INTO wards (name) SELECT :n WHERE NOT EXISTS (SELECT 1 FROM wards WHERE name = :n)"), {"n": name})


def downgrade() -> None:
    op.execute("ALTER TABLE reports DROP COLUMN sample_confidence")
