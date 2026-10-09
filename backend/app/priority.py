"""Risk-based priority: risk = impact x likelihood (1-16). The SQL functions ireport_risk() / ireport_priority()
(migration 0013) implement the same formula; tests/test_risk.py compares them on every input combination.

The database stores the result (incidents.risk, incidents.priority_score, incidents.due_at); the reasons shown in
the incident brief are computed on read from the same facts and never stored.
"""

import math
from dataclasses import dataclass

from . import risk_config as cfg


def js_round(x: float) -> int:
    """Half-up rounding for non-negative numbers (Python's round() is banker's rounding; SQL uses floor(x + 0.5))."""
    return math.floor(x + 0.5)


@dataclass(frozen=True)
class RiskInputs:
    base_impact: int          # categories.impact
    citizen_severity: str     # Low | Medium | High | Critical, from the citizen's own answers
    main_road: bool
    sensitive: bool           # within 100 m of a school or hospital
    citizens: int             # DISTINCT users who reported or confirmed
    monsoon: bool             # monsoon month AND a monsoon-sensitive category
    night: bool               # night-time hazard, or a streetlight-out complaint within 100 m


def impact_of(base: int, citizen_severity: str) -> int:
    raised = cfg.SEVERITY_RAISE_BY if citizen_severity in cfg.SEVERITY_RAISES else 0
    return min(4, base + raised)


def likelihood_of(i: RiskInputs) -> int:
    points = int(i.main_road) + int(i.sensitive) + int(i.citizens >= cfg.CITIZENS_THRESHOLD) + int(i.monsoon) + int(i.night)
    return min(cfg.LIKELIHOOD_MAX, cfg.LIKELIHOOD_BASE + points)


def risk_of(i: RiskInputs) -> int:
    return impact_of(i.base_impact, i.citizen_severity) * likelihood_of(i)


def score_of(risk: int) -> int:
    """Sort key 0-100: risk scaled so the existing (open, priority_score, id) index keeps working."""
    return js_round(risk * 100 / cfg.MAX_RISK)


def priority_of(i: RiskInputs) -> int:
    return score_of(risk_of(i))


def response_of(risk: int) -> tuple[str, int]:
    """(response category, hours allowed) for a risk value."""
    for floor, name, hours in cfg.RESPONSES:
        if risk >= floor:
            return name, hours
    return cfg.RESPONSES[-1][1], cfg.RESPONSES[-1][2]


def sla_hours(risk: int) -> int:
    return response_of(risk)[1]


# ---------- the "Why urgent" reasons (structured: the browser words them in the officer's language) ----------

SOURCE_LABELS = ("map", "citizen", "records", "calendar", "category")


def reasons_of(f: dict) -> list[dict]:
    """Reasons for the risk of one incident. `f` is a row of incidents.INPUTS_SQL as a dict. Each reason says where it
    came from: map (PostGIS on OpenStreetMap), citizen (what the reporter said), records (complaints in iREPORT),
    calendar, category (the category table). Highest-impact reasons first."""
    out: list[dict] = []
    base = f["base_impact"]
    impact = impact_of(base, f["citizen_severity"])
    if base >= 3:
        out.append({"code": f"impact_{base}", "source": "category", "params": {"category": f["category"]}})
    if impact > base:
        out.append({"code": "severity_raise", "source": "citizen", "params": {}})
    geo = f.get("geo_facts") or {}
    if f.get("main_road_src"):
        road = geo.get("main_road") if f["main_road_src"] == "map" else None
        out.append({"code": "main_road", "source": f["main_road_src"], "params": {"name": (road or {}).get("name")}})
    if f.get("sensitive_src"):
        place = None
        if f["sensitive_src"] == "map":
            kind = "school" if isinstance(geo.get("school"), dict) else "hospital"
            place = {**geo[kind], "kind": kind}
        else:
            kind = "school" if "Near school" in f["flags"] else "hospital"
            place = {"kind": kind}
        out.append({"code": "near_sensitive", "source": f["sensitive_src"], "params": {"kind": place["kind"], "name": place.get("name"), "distance_m": place.get("distance_m")}})
    if f["citizens"] >= cfg.CITIZENS_THRESHOLD:
        out.append({"code": "many_citizens", "source": "records", "params": {"n": f["citizens"]}})
    if f["monsoon"]:
        out.append({"code": "monsoon", "source": "calendar", "params": {}})
    if f.get("night_src"):
        out.append({"code": "night", "source": f["night_src"], "params": {}})
    return out
