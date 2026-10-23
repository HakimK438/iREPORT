"""Admin-editable response times.

response_settings holds the hours allowed for each response category (Emergency = Critical, Urgent = High risk, Routine = Moderate
risk, Planned = Routine work). ireport_sla_hours() now reads it instead of fixed numbers, so the admin can change the days from the
admin panel. The risk bands (12+, 8-11, 4-7, below 4) stay fixed. Defaults are the old values: 24 h, 72 h, 336 h, 720 h.

Revision ID: 0019
Revises: 0018
"""
import sqlalchemy as sa
from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("""CREATE TABLE response_settings (
        name text PRIMARY KEY CHECK (name IN ('Emergency', 'Urgent', 'Routine', 'Planned')),
        hours int NOT NULL CHECK (hours BETWEEN 1 AND 2160),
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by uuid REFERENCES users(id) ON DELETE SET NULL)"""))
    bind.execute(sa.text("INSERT INTO response_settings (name, hours) VALUES ('Emergency', 24), ('Urgent', 72), ('Routine', 336), ('Planned', 720)"))
    bind.execute(sa.text("""CREATE OR REPLACE FUNCTION ireport_sla_hours(risk int) RETURNS int LANGUAGE sql STABLE AS $$
        SELECT hours FROM response_settings
        WHERE name = CASE WHEN risk >= 12 THEN 'Emergency' WHEN risk >= 8 THEN 'Urgent' WHEN risk >= 4 THEN 'Routine' ELSE 'Planned' END $$"""))


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("""CREATE OR REPLACE FUNCTION ireport_sla_hours(risk int) RETURNS int LANGUAGE sql IMMUTABLE AS $$
        SELECT CASE WHEN risk >= 12 THEN 24 WHEN risk >= 8 THEN 72 WHEN risk >= 4 THEN 336 ELSE 720 END $$"""))
    bind.execute(sa.text("DROP TABLE response_settings"))
