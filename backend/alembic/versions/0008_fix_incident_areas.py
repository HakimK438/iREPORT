"""Re-file every incident under the area nearest to its own map point.

Older reports (made before area-from-coordinates) kept the area the citizen had picked or a default such as
Andheri West even when the pin was in Kalyan or Sion. The area is now always derived from the incident point:
nearest known area centre within 12 km, else none.

Revision ID: 0008
Revises: 0007
"""
import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

CENTRES = {
    "Andheri West": (19.1364, 72.8296), "Bandra": (19.0596, 72.8295), "Colaba": (18.9067, 72.8147), "Fort": (18.9345, 72.8352),
    "Dadar": (19.0178, 72.8478), "Goregaon": (19.1663, 72.8526), "Malad": (19.1874, 72.8484), "Borivali": (19.2307, 72.8567),
    "Andheri East": (19.1136, 72.8697), "Versova": (19.1300, 72.8120), "Juhu": (19.1075, 72.8263), "Vile Parle": (19.0996, 72.8446),
    "Santacruz": (19.0810, 72.8420), "Jogeshwari": (19.1360, 72.8490), "Kandivali": (19.2043, 72.8520), "Dahisar": (19.2500, 72.8590),
    "Mahim": (19.0410, 72.8400), "Sion": (19.0390, 72.8619), "Worli": (19.0176, 72.8170), "Lower Parel": (18.9930, 72.8300),
    "Byculla": (18.9780, 72.8333), "Malabar Hill": (18.9548, 72.7985), "Kurla": (19.0726, 72.8826), "Ghatkopar": (19.0860, 72.9081),
    "Chembur": (19.0522, 72.9005), "Powai": (19.1176, 72.9060), "Vikhroli": (19.1100, 72.9270), "Bhandup": (19.1440, 72.9380),
    "Mulund": (19.1726, 72.9425), "Kalyan": (19.2437, 73.1355), "Dombivli": (19.2183, 73.0868), "Thane": (19.2183, 72.9781),
    "Navi Mumbai": (19.0771, 72.9986), "Mira Road": (19.2813, 72.8561), "Vasai": (19.3919, 72.8397), "Panvel": (18.9894, 73.1175),
    "Ulhasnagar": (19.2215, 73.1645), "Bhiwandi": (19.3002, 73.0588),
}


def upgrade() -> None:
    values = ", ".join(f"('{n.replace(chr(39), '')}', {lat}, {lng})" for n, (lat, lng) in CENTRES.items())
    op.execute(sa.text(f"""
        UPDATE incidents i SET ward_id = (
          SELECT w.id FROM (VALUES {values}) AS c(name, lat, lng) JOIN wards w ON w.name = c.name
          WHERE ST_Distance(i.location, ST_SetSRID(ST_MakePoint(c.lng, c.lat), 4326)::geography) <= 12000
          ORDER BY ST_Distance(i.location, ST_SetSRID(ST_MakePoint(c.lng, c.lat), 4326)::geography) LIMIT 1)
        WHERE NOT EXISTS (SELECT 1 FROM wards w2 WHERE w2.geom IS NOT NULL)"""))


def downgrade() -> None:
    pass  # the previous (wrong) areas are not recoverable and not worth restoring
