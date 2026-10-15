"""Accountability: proof of work when an officer resolves a complaint, and abuse checks on citizen reports.

- media.dhash / gps_lat / gps_lng: a perceptual hash of every stored photo (to catch the same photo used again) and the photo's own
  GPS point (read once from EXIF before the metadata is stripped), to compare with the spot the citizen pinned.
- resolution_proofs (created in 0011, never filled by the app until now): the officer's "after" photo is uploaded first, with the phone's
  position and accuracy, and is used up by the next Resolved action, which writes the completion note and the audit flags
  (for example `too_fast`). So `note` may be empty until then, and `accuracy_m`, `flags` and `used_at` are added. Rows that already
  exist were written when the complaint was resolved, so they count as used.
- report_strikes: one row each time an officer decides a report is fake, so repeat abusers can be sent to review or paused.

Revision ID: 0018
Revises: 0017
"""
import sqlalchemy as sa
from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("ALTER TABLE media ADD COLUMN dhash bigint, ADD COLUMN gps_lat double precision, ADD COLUMN gps_lng double precision"))
    bind.execute(sa.text("CREATE INDEX media_dhash_idx ON media (created_at DESC) WHERE dhash IS NOT NULL AND dhash <> 0"))

    bind.execute(sa.text("""ALTER TABLE resolution_proofs ADD COLUMN accuracy_m real, ADD COLUMN flags text[] NOT NULL DEFAULT '{}', ADD COLUMN used_at timestamptz"""))
    bind.execute(sa.text("ALTER TABLE resolution_proofs ALTER COLUMN note DROP NOT NULL"))
    bind.execute(sa.text("UPDATE resolution_proofs SET used_at = created_at"))
    bind.execute(sa.text("CREATE INDEX resolution_proofs_actor_idx ON resolution_proofs (actor_id, created_at DESC)"))

    bind.execute(sa.text("""CREATE TABLE report_strikes (
        id bigserial PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id),
        incident_id uuid REFERENCES incidents(id) ON DELETE SET NULL,
        decided_by uuid REFERENCES users(id),
        reason text,
        created_at timestamptz NOT NULL DEFAULT now())"""))
    bind.execute(sa.text("CREATE INDEX report_strikes_user_idx ON report_strikes (user_id, created_at DESC)"))


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("DROP TABLE report_strikes"))
    bind.execute(sa.text("DROP INDEX resolution_proofs_actor_idx"))
    bind.execute(sa.text("DELETE FROM resolution_proofs WHERE note IS NULL"))  # unused proofs have nothing the old shape can hold
    bind.execute(sa.text("ALTER TABLE resolution_proofs ALTER COLUMN note SET NOT NULL"))
    bind.execute(sa.text("ALTER TABLE resolution_proofs DROP COLUMN accuracy_m, DROP COLUMN flags, DROP COLUMN used_at"))
    bind.execute(sa.text("DROP INDEX media_dhash_idx"))
    bind.execute(sa.text("ALTER TABLE media DROP COLUMN dhash, DROP COLUMN gps_lat, DROP COLUMN gps_lng"))
