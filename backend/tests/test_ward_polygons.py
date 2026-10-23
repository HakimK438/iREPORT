"""Official BMC ward polygons (migration 0017): an incident's area comes from the ward map, not from the nearest centre."""

import pytest
from sqlalchemy import text

from conftest import make_authority

# (place, lat, lng, expected area, expected method). Wards are the official BMC ones: Prabhadevi is G/North, Elphinstone Road F/South,
# Dadar East F/North (the "Sion" area), Dadar West G/North.
POINTS = [
    ("Prabhadevi", 19.0169, 72.8303, "Dadar", "polygon"),
    ("Worli Naka", 19.0112, 72.8176, "Worli", "polygon"),
    ("Elphinstone Road", 19.0073, 72.8403, "Parel", "polygon"),
    ("Dadar West", 19.0186, 72.8423, "Dadar", "polygon"),
    ("Dadar East", 19.0178, 72.8478, "Sion", "polygon"),
    ("Mahalaxmi", 18.9826, 72.8236, "Lower Parel", "polygon"),
    ("Dongri", 18.9600, 72.8380, "Dongri", "polygon"),
    ("Vile Parle West", 19.1000, 72.8370, "Vile Parle", "polygon"),
    ("Thane (outside BMC)", 19.2183, 72.9781, "Thane", "nearest_area_centre"),
]


@pytest.mark.parametrize(("place", "lat", "lng", "area", "method"), POINTS)
async def test_point_is_filed_under_its_official_ward(client, place, lat, lng, area, method):
    j = (await client.get("/geo/resolve", params={"lat": lat, "lng": lng})).json()
    assert (j["area"], j["method"]) == (area, method), place


async def test_a_pin_just_off_the_shore_stays_in_the_nearest_area(client):
    j = (await client.get("/geo/resolve", params={"lat": 19.0176, "lng": 72.8100})).json()  # in the sea off Worli, within the edge distance
    assert j["area"] == "Worli"


async def test_area_polygons_tile_every_ward_without_gaps_or_overlaps():
    from app.db import engine

    async with engine.connect() as conn:
        assert await conn.scalar(text("SELECT count(*) FROM bmc_wards")) == 24
        # Mumbai areas (those with a ward) all have a polygon; the Metropolitan Region areas have none.
        assert await conn.scalar(text("SELECT count(*) FROM wards WHERE bmc_ward IS NOT NULL AND geom IS NULL")) == 0
        assert await conn.scalar(text("SELECT count(DISTINCT bmc_ward) FROM wards WHERE bmc_ward IS NOT NULL")) == 24  # every ward has an area
        rows = (await conn.execute(text("""
            SELECT b.code, ST_Area(b.geom) AS ward_m2, sum(ST_Area(w.geom)) AS areas_m2, ST_Area(ST_Union(w.geom::geometry)::geography) AS union_m2
            FROM bmc_wards b JOIN wards w ON w.bmc_ward = b.code GROUP BY b.code, b.geom"""))).all()
    assert len(rows) == 24
    for r in rows:
        assert abs(r.areas_m2 - r.ward_m2) / r.ward_m2 < 1e-4, f"ward {r.code}: its areas do not add up to the ward"
        assert abs(r.areas_m2 - r.union_m2) / r.union_m2 < 1e-4, f"ward {r.code}: its areas overlap"


async def test_area_authority_map_carries_only_its_own_outline(client):
    worli = await make_authority(client, area="Worli")
    j = (await client.get("/authority/map", headers=worli["headers"])).json()
    assert j["outline"]["area"] == "Worli" and j["outline"]["bmc_ward"] == "G/S"
    assert j["outline"]["geometry"]["type"] == "MultiPolygon" and j["outline"]["geometry"]["coordinates"]
    citywide = await make_authority(client)  # no area: covers the whole city, so there is nothing to outline
    assert (await client.get("/authority/map", headers=citywide["headers"])).json()["outline"] is None
