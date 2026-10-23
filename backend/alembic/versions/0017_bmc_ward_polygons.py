"""Official BMC ward polygons, one polygon per area, and four areas for wards that had none.

Until now an incident's area was the nearest of 29 hand-placed area centres, so a point near Elphinstone Road or Parel could land in
the wrong ward. This migration loads the 24 official BMC ward boundaries (DataMeet, CC BY-SA 2.5 India, backend/app/data/bmc_wards.geojson)
into `bmc_wards`, then gives every Mumbai area (`wards` row) a polygon: the ward polygon itself when the ward has one area, otherwise the
ward polygon split between its areas by a Voronoi diagram of the area centres. The areas of one ward therefore tile it exactly and never
cross a ward border. `resolve_ward` already uses `wards.geom` (ST_Covers) once it exists.

Four wards had no area at all (B, C, F/S, M/E): Dongri, Kalbadevi, Parel and Govandi are added for them. Five area centres sat in the
neighbouring ward (Dadar East is F/N, Jogeshwari East and Vile Parle East are K/E, Vikhroli East is N, Versova was in a coastline gap); they
are moved to a point inside the intended ward (checked with PostGIS). Finally every existing incident is re-filed by its own position.

Revision ID: 0017
Revises: 0016
"""
import json
from pathlib import Path

import sqlalchemy as sa
from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None

GEOJSON = Path(__file__).resolve().parents[2] / "app" / "data" / "bmc_wards.geojson"

# area -> (BMC ward, lat, lng). Every centre was checked to lie inside its ward polygon.
AREAS: dict[str, tuple[str, float, float]] = {
    "Fort": ("A", 18.9345, 72.8352), "Colaba": ("A", 18.9067, 72.8147), "Dongri": ("B", 18.9600, 72.8380), "Kalbadevi": ("C", 18.9535, 72.8285),
    "Malabar Hill": ("D", 18.9548, 72.7985), "Byculla": ("E", 18.9780, 72.8333), "Parel": ("F/S", 19.0035, 72.8395), "Sion": ("F/N", 19.0390, 72.8619),
    "Lower Parel": ("G/S", 18.9930, 72.8300), "Worli": ("G/S", 19.0176, 72.8170), "Dadar": ("G/N", 19.0230, 72.8400), "Mahim": ("G/N", 19.0410, 72.8400),
    "Bandra": ("H/W", 19.0596, 72.8295), "Santacruz": ("H/E", 19.0810, 72.8420),
    "Vile Parle": ("K/W", 19.1000, 72.8370), "Juhu": ("K/W", 19.1075, 72.8263), "Versova": ("K/W", 19.1310, 72.8230),
    "Andheri West": ("K/W", 19.1364, 72.8296), "Jogeshwari": ("K/W", 19.1350, 72.8390), "Andheri East": ("K/E", 19.1136, 72.8697),
    "Goregaon": ("P/S", 19.1663, 72.8526), "Malad": ("P/N", 19.1874, 72.8484), "Kandivali": ("R/S", 19.2043, 72.8520),
    "Borivali": ("R/C", 19.2307, 72.8567), "Dahisar": ("R/N", 19.2500, 72.8590), "Kurla": ("L", 19.0726, 72.8826),
    "Govandi": ("M/E", 19.0485, 72.9250), "Chembur": ("M/W", 19.0522, 72.9005), "Ghatkopar": ("N", 19.0860, 72.9081),
    "Powai": ("S", 19.1176, 72.9060), "Vikhroli": ("S", 19.1150, 72.9250), "Bhandup": ("S", 19.1440, 72.9380), "Mulund": ("T", 19.1726, 72.9425),
}
NEW_AREAS = ("Dongri", "Kalbadevi", "Parel", "Govandi")


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("""CREATE TABLE bmc_wards (code text PRIMARY KEY, geom geography(MultiPolygon, 4326) NOT NULL)"""))
    bind.execute(sa.text("CREATE INDEX bmc_wards_geom_idx ON bmc_wards USING gist (geom)"))
    bind.execute(sa.text("ALTER TABLE wards ADD COLUMN bmc_ward text"))

    for name in NEW_AREAS:
        bind.execute(sa.text("INSERT INTO wards (name) SELECT :n WHERE NOT EXISTS (SELECT 1 FROM wards WHERE name = :n)"), {"n": name})

    for feature in json.loads(GEOJSON.read_text(encoding="utf-8"))["features"]:
        bind.execute(sa.text("""INSERT INTO bmc_wards (code, geom) VALUES (:c,
            ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(:g), 4326)), 3))::geography)"""),
                     {"c": feature["properties"]["code"], "g": json.dumps(feature["geometry"])})

    for name, (code, _lat, _lng) in AREAS.items():
        bind.execute(sa.text("UPDATE wards SET bmc_ward = :c WHERE name = :n"), {"c": code, "n": name})

    for code in sorted({c for c, _, _ in AREAS.values()}):
        members = {n: v for n, v in AREAS.items() if v[0] == code}
        if len(members) == 1:  # the area is the whole ward
            bind.execute(sa.text("UPDATE wards SET geom = (SELECT geom FROM bmc_wards WHERE code = :c) WHERE name = :n"), {"c": code, "n": next(iter(members))})
            continue
        # Several areas: split the ward polygon between them with a Voronoi diagram of the area centres (constants above, not user input).
        values = ", ".join(f"('{n}', {lat}, {lng})" for n, (_c, lat, lng) in members.items())
        bind.execute(sa.text(f"""
            WITH pt AS (SELECT name, ST_SetSRID(ST_MakePoint(lng, lat), 4326) AS p FROM (VALUES {values}) AS v(name, lat, lng)),
                 w  AS (SELECT geom::geometry AS g FROM bmc_wards WHERE code = :c),
                 cells AS (SELECT (ST_Dump(ST_VoronoiPolygons((SELECT ST_Collect(p) FROM pt), 0, (SELECT ST_Expand(g, 0.2) FROM w)))).geom AS cell),
                 cut AS (SELECT pt.name, ST_Multi(ST_CollectionExtract(ST_Intersection(cells.cell, w.g), 3)) AS g
                         FROM cells JOIN pt ON ST_Contains(cells.cell, pt.p) CROSS JOIN w)
            UPDATE wards SET geom = cut.g::geography FROM cut WHERE wards.name = cut.name AND NOT ST_IsEmpty(cut.g)"""), {"c": code})

    # Re-file every existing incident by its own position (areas of one ward never overlap, so there is one match at most).
    bind.execute(sa.text("""UPDATE incidents i SET ward_id = w.id FROM wards w
                            WHERE w.geom IS NOT NULL AND ST_Covers(w.geom, i.location) AND i.ward_id IS DISTINCT FROM w.id"""))


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE wards SET geom = NULL"))
    bind.execute(sa.text("ALTER TABLE wards DROP COLUMN bmc_ward"))
    bind.execute(sa.text("DROP TABLE bmc_wards"))
    bind.execute(sa.text("""DELETE FROM wards WHERE name = ANY(:n) AND NOT EXISTS (SELECT 1 FROM incidents WHERE ward_id = wards.id)
                            AND NOT EXISTS (SELECT 1 FROM users WHERE ward_id = wards.id)"""), {"n": list(NEW_AREAS)})
