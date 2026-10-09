"""Areas beyond Mumbai city (Kalyan, Thane, Navi Mumbai ...) so a problem there is filed under its own area
instead of the nearest Mumbai neighbourhood or none at all.

Revision ID: 0007
Revises: 0006
"""
import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

NEW_AREAS = ["Kalyan", "Dombivli", "Thane", "Navi Mumbai", "Mira Road", "Vasai", "Panvel", "Ulhasnagar", "Bhiwandi"]


CENTRES = {
    "Kalyan": (19.2437, 73.1355), "Dombivli": (19.2183, 73.0868), "Thane": (19.2183, 72.9781), "Navi Mumbai": (19.0771, 72.9986),
    "Mira Road": (19.2813, 72.8561), "Vasai": (19.3919, 72.8397), "Panvel": (18.9894, 73.1175), "Ulhasnagar": (19.2215, 73.1645),
    "Bhiwandi": (19.3002, 73.0588),
}


def upgrade() -> None:
    bind = op.get_bind()
    for name in NEW_AREAS:
        bind.execute(sa.text("INSERT INTO wards (name) SELECT :n WHERE NOT EXISTS (SELECT 1 FROM wards WHERE name = :n)"), {"n": name})
    # Incidents that had no area (they were outside every Mumbai centre) are filed under the new area when one is within 12 km.
    for name, (lat, lng) in CENTRES.items():
        bind.execute(sa.text("""
            UPDATE incidents SET ward_id = (SELECT id FROM wards WHERE name = :n)
            WHERE ward_id IS NULL
              AND ST_DWithin(location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, 12000)"""), {"n": name, "lat": lat, "lng": lng})


def downgrade() -> None:
    op.get_bind().execute(sa.text("DELETE FROM wards WHERE name = ANY(:n) AND NOT EXISTS (SELECT 1 FROM incidents WHERE ward_id = wards.id)"), {"n": NEW_AREAS})
