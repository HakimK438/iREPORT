"""OpenStreetMap features used for the "checked on map" facts: schools, hospitals and main roads.

The table is filled by the developer-run job scripts/load_osm.py (Overpass API -> data/osm_features.geojson ->
this table). It is created empty here: no data is invented. incidents.geo_facts holds what PostGIS found around
each incident ({checked, school, hospital, main_road}); 'checked' is false until features have been loaded, and
priority then falls back to the citizen's own flags, labelled "citizen says".

Revision ID: 0012
Revises: 0011
"""
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""CREATE TABLE osm_features (
      id bigserial PRIMARY KEY,
      osm_id bigint NOT NULL,
      kind text NOT NULL CHECK (kind IN ('school', 'hospital', 'main_road')),
      name text,
      highway text,
      geom geography(Geometry, 4326) NOT NULL,
      UNIQUE (kind, osm_id)
    )""")
    op.execute("CREATE INDEX osm_features_geom_idx ON osm_features USING gist (geom)")
    op.execute("CREATE INDEX osm_features_kind_idx ON osm_features (kind)")
    op.execute("ALTER TABLE incidents ADD COLUMN geo_facts jsonb NOT NULL DEFAULT '{}'::jsonb")


def downgrade() -> None:
    op.execute("ALTER TABLE incidents DROP COLUMN geo_facts")
    op.execute("DROP TABLE osm_features")
