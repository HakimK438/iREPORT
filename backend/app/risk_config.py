"""All tunable numbers of the risk-based priority in ONE place (see DECISIONS.md, "Priority").

risk = impact (1-4) x likelihood (1-4)  ->  1..16
migration 0013 stores CATEGORY_IMPACT / MONSOON_CATEGORIES in categories.impact / monsoon_sensitive and
tests/test_risk.py fails if the two ever differ.
"""

# Impact by category name (the real names in the categories table).
#  4 life-safety | 3 injury or vehicle damage | 2 health or safety nuisance | 1 inconvenience
CATEGORY_IMPACT: dict[str, int] = {
    "Electrical Hazard": 4,   # live wire, electrocution risk
    "Pothole": 3,
    "Road Damage": 3,
    "Drainage": 3,            # open drain / manhole, waterlogging
    "Water Leakage": 3,       # the merged category includes flooded roads and blocked drains
    "Streetlight": 2,
    "Garbage": 2,
    "Other": 1,
}
# Only these categories get the monsoon likelihood point (potholes, waterlogging, drainage).
MONSOON_CATEGORIES = frozenset({"Pothole", "Road Damage", "Drainage", "Water Leakage"})
MONSOON_MONTHS = (6, 7, 8, 9)

# A citizen's severity can raise impact by at most this much, and never lowers it.
SEVERITY_RAISES = frozenset({"High", "Critical"})
SEVERITY_RAISE_BY = 1

# Likelihood: starts at 1, +1 for each factor, capped at 4.
LIKELIHOOD_BASE, LIKELIHOOD_MAX = 1, 4
CITIZENS_THRESHOLD = 3          # DISTINCT citizens who reported or confirmed

# Map checks (PostGIS against osm_features), in metres.
SENSITIVE_RADIUS_M = 100        # school or hospital
MAIN_ROAD_RADIUS_M = 30         # a pin is rarely more precise than this
STREETLIGHT_RADIUS_M = 100      # open streetlight-out complaint nearby

# risk -> response category and hours allowed (due_at = created_at + hours). First match wins.
RESPONSES: tuple[tuple[int, str, int], ...] = (
    (12, "Emergency", 24),      # make safe within 24 h
    (8, "Urgent", 72),          # 3 days
    (4, "Routine", 336),        # 14 days
    (0, "Planned", 720),        # 30 days
)
MAX_RISK = 16
# Stale-confirmation window: a Resolved complaint with no citizen answer is closed after this many hours.
AUTO_CLOSE_HOURS = 72
# Complaint history / nearby work windows used in the incident brief and the repeat-spot analysis.
HISTORY_RADIUS_M, HISTORY_DAYS = 50, 180
NEARBY_WORK_RADIUS_M = 300
REPEAT_SPOT_DAYS = 90
