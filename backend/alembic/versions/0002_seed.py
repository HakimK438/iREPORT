"""Seed departments, categories and wards.

Wards: the frontend uses these 8 area names. Their polygons are left NULL here and can be
loaded from open data with scripts/load_wards.py (see DECISIONS.md).

Revision ID: 0002
Revises: 0001
"""
import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

DEPARTMENTS = ["Roads & Traffic", "Street Lighting", "Solid Waste Management", "Water Supply", "Storm Water Drains", "Electrical Safety", "General / Ward Office"]

# code, name, department, hazard points (section 8)
CATEGORIES = [
    ("pothole", "Pothole", "Roads & Traffic", 12),
    ("road_damage", "Road Damage", "Roads & Traffic", 12),
    ("streetlight", "Streetlight", "Street Lighting", 8),
    ("garbage", "Garbage", "Solid Waste Management", 6),
    ("water_leakage", "Water Leakage", "Water Supply", 8),
    ("drainage", "Drainage", "Storm Water Drains", 14),
    ("electrical_hazard", "Electrical Hazard", "Electrical Safety", 25),
    ("other", "Other", "General / Ward Office", 4),
]

WARDS = ["Andheri West", "Bandra", "Colaba", "Fort", "Dadar", "Goregaon", "Malad", "Borivali"]


def upgrade() -> None:
    conn = op.get_bind()
    for name in DEPARTMENTS:
        conn.execute(sa.text("INSERT INTO departments (name) VALUES (:n)"), {"n": name})
    for code, name, dept, pts in CATEGORIES:
        conn.execute(
            sa.text("INSERT INTO categories (code, name, department_id, hazard_points) SELECT :c, :n, id, :p FROM departments WHERE name = :d"),
            {"c": code, "n": name, "d": dept, "p": pts},
        )
    for name in WARDS:
        conn.execute(sa.text("INSERT INTO wards (name) VALUES (:n)"), {"n": name})


def downgrade() -> None:
    op.execute("DELETE FROM categories")
    op.execute("DELETE FROM departments")
    op.execute("DELETE FROM wards")
