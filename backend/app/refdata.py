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


async def load(db: AsyncSession) -> None:
    ref.wards = {w.id: w.name for w in (await db.scalars(select(Ward))).all()}
    ref.departments = {d.id: d.name for d in (await db.scalars(select(Department))).all()}
    ref.categories = {c.id: CategoryRef(c.id, c.code, c.name, c.department_id, c.hazard_points) for c in (await db.scalars(select(Category))).all()}
