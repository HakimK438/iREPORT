"""Small, static reference tables (wards, departments, categories) cached in memory at startup."""

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Category, Department, Ward


@dataclass
class CategoryRef:
    id: int
    code: str
    name: str
    department_id: int | None
    hazard_points: int


@dataclass
class RefData:
    wards: dict[int, str] = field(default_factory=dict)
    departments: dict[int, str] = field(default_factory=dict)
    categories: dict[int, CategoryRef] = field(default_factory=dict)

    def ward_id(self, name: str | None) -> int | None:
        if not name:
            return None
        return next((i for i, n in self.wards.items() if n.lower() == name.strip().lower()), None)

    def department_id(self, name: str | None) -> int | None:
        if not name:
            return None
        return next((i for i, n in self.departments.items() if n.lower() == name.strip().lower()), None)

    def category(self, value: str | None) -> CategoryRef | None:
        """Accepts a category code ('water_leakage') or display name ('Water Leakage')."""
        if not value:
            return None
        v = value.strip().lower()
        return next((c for c in self.categories.values() if v in (c.code, c.name.lower())), None)

    def category_by_code(self, code: str) -> CategoryRef:
        return next(c for c in self.categories.values() if c.code == code)


ref = RefData()

# Approximate centre of each seeded neighbourhood. Ward polygons are not loaded (see DECISIONS.md #1), so until
# scripts/load_wards.py is run, an incident's area is the nearest centre to the INCIDENT coordinates.
AREA_CENTRES: dict[str, tuple[float, float]] = {
    "Andheri West": (19.1364, 72.8296), "Bandra": (19.0596, 72.8295), "Colaba": (18.9067, 72.8147), "Fort": (18.9345, 72.8352),
    "Dadar": (19.0178, 72.8478), "Goregaon": (19.1663, 72.8526), "Malad": (19.1874, 72.8484), "Borivali": (19.2307, 72.8567),
    "Andheri East": (19.1136, 72.8697), "Versova": (19.1300, 72.8120), "Juhu": (19.1075, 72.8263), "Vile Parle": (19.0996, 72.8446),
    "Santacruz": (19.0810, 72.8420), "Jogeshwari": (19.1360, 72.8490), "Kandivali": (19.2043, 72.8520), "Dahisar": (19.2500, 72.8590),
    "Mahim": (19.0410, 72.8400), "Sion": (19.0390, 72.8619), "Worli": (19.0176, 72.8170), "Lower Parel": (18.9930, 72.8300),
    "Byculla": (18.9780, 72.8333), "Malabar Hill": (18.9548, 72.7985), "Kurla": (19.0726, 72.8826), "Ghatkopar": (19.0860, 72.9081),
    "Chembur": (19.0522, 72.9005), "Powai": (19.1176, 72.9060), "Vikhroli": (19.1100, 72.9270), "Bhandup": (19.1440, 72.9380),
    "Mulund": (19.1726, 72.9425),
    # Mumbai Metropolitan Region (migration 0007): a pin here must not be filed under the nearest Mumbai area.
    "Kalyan": (19.2437, 73.1355), "Dombivli": (19.2183, 73.0868), "Thane": (19.2183, 72.9781), "Navi Mumbai": (19.0771, 72.9986),
    "Mira Road": (19.2813, 72.8561), "Vasai": (19.3919, 72.8397), "Panvel": (18.9894, 73.1175), "Ulhasnagar": (19.2215, 73.1645),
    "Bhiwandi": (19.3002, 73.0588),
}
MAX_AREA_KM = 12.0


def nearest_area(lat: float, lng: float) -> str | None:
    """Name of the closest seeded area centre within MAX_AREA_KM, else None (point is outside Mumbai)."""
    import math

    def km(c: tuple[float, float]) -> float:
        dy, dx = (lat - c[0]) * 111.32, (lng - c[1]) * 111.32 * math.cos(math.radians(lat))
        return math.hypot(dx, dy)

    name, centre = min(AREA_CENTRES.items(), key=lambda kv: km(kv[1]))
    return name if km(centre) <= MAX_AREA_KM else None


async def load(db: AsyncSession) -> None:
    ref.wards = {w.id: w.name for w in (await db.scalars(select(Ward))).all()}
    ref.departments = {d.id: d.name for d in (await db.scalars(select(Department))).all()}
    ref.categories = {c.id: CategoryRef(c.id, c.code, c.name, c.department_id, c.hazard_points) for c in (await db.scalars(select(Category))).all()}
