"""Priority score: a port of priorityOf() from the original frontend store, kept identical to the SQL
function ireport_priority() in migration 0001. The database stores and sorts by the score; the
reasons are computed on read from the incident row and never stored."""

import math
from dataclasses import dataclass, field
from datetime import UTC, datetime

SEVERITY_POINTS = {"Critical": 40, "High": 30, "Medium": 18, "Low": 8}
FLAG_POINTS = {"Live wiring": 20, "Injury reported": 18, "Near school": 12, "Near hospital": 12, "Flood risk": 10, "Main road": 8, "Night-time hazard": 6, "Blocks footpath": 5}
UNKNOWN_FLAG_POINTS = 4
FLAG_CAP = 28
MAX_RAW = 40 + 25 + 28 + 15 + 8  # 116


def js_round(x: float) -> int:
    """JavaScript Math.round for non-negative numbers (Python's round() is banker's rounding)."""
    return math.floor(x + 0.5)


def level_of(score: int) -> str:
    return "Critical" if score >= 65 else "High" if score >= 48 else "Medium" if score >= 30 else "Low"


@dataclass
class Priority:
    score: int
    level: str
    reasons: list[dict] = field(default_factory=list)


def priority_of(severity: str, category: str, hazard_points: int, flags: list[str], status: str, created_at: datetime, affected: int, now: datetime | None = None) -> Priority:
    now = now or datetime.now(UTC)
    reasons: list[dict] = []
    sev = SEVERITY_POINTS[severity]
    reasons.append({"label": f"{severity} severity", "pts": sev})
    reasons.append({"label": f"{category} hazard type", "pts": hazard_points})
    flag_pts = 0
    for f in flags:
        pts = FLAG_POINTS.get(f, UNKNOWN_FLAG_POINTS)
        flag_pts += pts
        reasons.append({"label": f, "pts": pts})
    flag_pts = min(FLAG_CAP, flag_pts)
    days = max(0.0, (now - created_at).total_seconds() / 86400)
    age = 0.0 if status == "Resolved" else min(15.0, days * 1.5)
    if age >= 3:
        reasons.append({"label": f"Open for {math.floor(days)} days", "pts": js_round(age)})
    votes = min(8.0, math.log2(1 + max(affected, 0)) * 1.6)
    reasons.append({"label": f"{affected} citizens affected", "pts": js_round(votes)})
    raw = sev + hazard_points + flag_pts + age + votes
    score = js_round(min(100.0, raw / MAX_RAW * 100))
    reasons.sort(key=lambda r: -r["pts"])  # stable, like Array.prototype.sort
    return Priority(score, level_of(score), reasons)
