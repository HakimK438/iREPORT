"""Risk-based priority: risk = impact x likelihood (1-16), replacing the made-up point sum.

Method: the risk-matrix approach of road-maintenance practice (UK "Well-managed Highway Infrastructure" risk
based approach; IRC:82 maintenance categories). Reasoning and the exact factors are in DECISIONS.md. The same
formula lives in app/priority.py; tests/test_risk.py proves the two agree.

- categories.impact (1-4) and categories.monsoon_sensitive: a snapshot of app/risk_config.py (a test checks they match).
- incidents.citizen_severity: severity from the citizen's own answers only (no map/flag double counting).
- incidents.risk (1-16); priority_score stays as the sort key = risk scaled to 0-100, so the index keeps working.
- incidents.due_at = created_at + the SLA of the response category (24 h / 3 d / 14 d / 30 d).
- ireport_priority() is replaced: new arguments, same name.

Revision ID: 0013
Revises: 0012
"""
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None

# category name -> (impact, monsoon_sensitive). Keep in step with app/risk_config.py.
CATEGORIES = {
    "Electrical Hazard": (4, False), "Pothole": (3, True), "Road Damage": (3, True), "Drainage": (3, True), "Water Leakage": (3, True),
    "Streetlight": (2, False), "Garbage": (2, False), "Other": (1, False),
}

FUNCTIONS = [
    """CREATE FUNCTION ireport_impact(base smallint, sev severity_level) RETURNS smallint LANGUAGE sql IMMUTABLE AS $$
        SELECT least(4, base + CASE WHEN sev IN ('High', 'Critical') THEN 1 ELSE 0 END)::smallint $$""",
    """CREATE FUNCTION ireport_likelihood(main_road boolean, sensitive boolean, citizens int, monsoon boolean, night boolean)
        RETURNS smallint LANGUAGE sql IMMUTABLE AS $$
        SELECT least(4, 1 + coalesce(main_road, false)::int + coalesce(sensitive, false)::int + (coalesce(citizens, 0) >= 3)::int
                         + coalesce(monsoon, false)::int + coalesce(night, false)::int)::smallint $$""",
    """CREATE FUNCTION ireport_risk(base smallint, sev severity_level, main_road boolean, sensitive boolean, citizens int, monsoon boolean, night boolean)
        RETURNS smallint LANGUAGE sql IMMUTABLE AS $$
        SELECT (ireport_impact(base, sev) * ireport_likelihood(main_road, sensitive, citizens, monsoon, night))::smallint $$""",
    # floor(x + 0.5): half-up, the same as app/priority.py js_round
    """CREATE FUNCTION ireport_score(risk smallint) RETURNS smallint LANGUAGE sql IMMUTABLE AS $$
        SELECT floor(risk * 100.0 / 16 + 0.5)::smallint $$""",
    """CREATE FUNCTION ireport_priority(base smallint, sev severity_level, main_road boolean, sensitive boolean, citizens int, monsoon boolean, night boolean)
        RETURNS smallint LANGUAGE sql IMMUTABLE AS $$
        SELECT ireport_score(ireport_risk(base, sev, main_road, sensitive, citizens, monsoon, night)) $$""",
    # Response category -> hours to make safe / complete. 12+ Emergency 24 h, 8-11 Urgent 3 d, 4-7 Routine 14 d, below 4 Planned 30 d.
    """CREATE FUNCTION ireport_sla_hours(risk int) RETURNS int LANGUAGE sql IMMUTABLE AS $$
        SELECT CASE WHEN risk >= 12 THEN 24 WHEN risk >= 8 THEN 72 WHEN risk >= 4 THEN 336 ELSE 720 END $$""",
]

# One-off recompute of every incident from the facts available now (geo_facts is still empty, so the citizen's own flags count).
BACKFILL = """
WITH f AS (
  SELECT i.id, c.impact AS base, i.citizen_severity AS sev,
         ('Main road' = ANY(i.flags)) AS main_road,
         ('Near school' = ANY(i.flags) OR 'Near hospital' = ANY(i.flags)) AS sensitive,
         (SELECT count(*) FROM (SELECT user_id FROM reports WHERE incident_id = i.id AND duplicate_of_report_id IS NULL
                                UNION SELECT user_id FROM confirmations WHERE incident_id = i.id) u)::int AS citizens,
         (c.monsoon_sensitive AND extract(month FROM now() AT TIME ZONE 'Asia/Kolkata') BETWEEN 6 AND 9) AS monsoon,
         ('Night-time hazard' = ANY(i.flags) OR c.code = 'streetlight') AS night
  FROM incidents i JOIN categories c ON c.id = i.category_id
), r AS (SELECT id, ireport_risk(base, sev, main_road, sensitive, citizens, monsoon, night) AS risk FROM f)
UPDATE incidents i SET risk = r.risk, priority_score = ireport_score(r.risk),
       due_at = i.created_at + ireport_sla_hours(r.risk) * interval '1 hour'
FROM r WHERE r.id = i.id
"""


def upgrade() -> None:
    op.execute("ALTER TABLE categories ADD COLUMN impact smallint NOT NULL DEFAULT 1 CHECK (impact BETWEEN 1 AND 4), ADD COLUMN monsoon_sensitive boolean NOT NULL DEFAULT false")
    for name, (impact, monsoon) in CATEGORIES.items():
        op.execute(f"UPDATE categories SET impact = {impact}, monsoon_sensitive = {str(monsoon).lower()} WHERE name = '{name}'")
    op.execute("ALTER TABLE incidents ADD COLUMN citizen_severity severity_level NOT NULL DEFAULT 'Low', ADD COLUMN risk smallint NOT NULL DEFAULT 1")
    op.execute("UPDATE incidents SET citizen_severity = severity")  # legacy rows: the best we have
    op.execute("DROP FUNCTION ireport_priority(severity_level, smallint, text[], issue_status, timestamptz, integer, timestamptz)")
    for statement in FUNCTIONS:
        op.execute(statement)
    op.execute(BACKFILL)


def downgrade() -> None:
    for fn in ("ireport_priority(smallint, severity_level, boolean, boolean, integer, boolean, boolean)", "ireport_score(smallint)", "ireport_sla_hours(integer)",
               "ireport_risk(smallint, severity_level, boolean, boolean, integer, boolean, boolean)", "ireport_likelihood(boolean, boolean, integer, boolean, boolean)",
               "ireport_impact(smallint, severity_level)"):
        op.execute(f"DROP FUNCTION {fn}")
    op.execute("ALTER TABLE incidents DROP COLUMN citizen_severity, DROP COLUMN risk")
    op.execute("ALTER TABLE categories DROP COLUMN impact, DROP COLUMN monsoon_sensitive")
    # The old point-sum function is not restored (it is replaced by design); older code is not supported after this migration.
