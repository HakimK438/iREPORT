"""Priority = risk (impact x likelihood). CHANGED ON PURPOSE in authority-v2: the old tests checked the made-up
point sum (severity + hazard + flags + age + votes), which no longer exists. These check the risk formula, the
response categories, and that the Python and SQL implementations are identical."""

import itertools

from sqlalchemy import text

from app import risk_config as cfg
from app.priority import RiskInputs, impact_of, likelihood_of, priority_of, response_of, risk_of, score_of
from app.status import NOT_OPEN_STATUSES, OPEN_STATUSES, STATUSES

SEVERITIES = ["Low", "Medium", "High", "Critical"]


def inputs(base=3, sev="Medium", main_road=False, sensitive=False, citizens=1, monsoon=False, night=False) -> RiskInputs:
    return RiskInputs(base, sev, main_road, sensitive, citizens, monsoon, night)


def test_worked_examples():
    # pothole (3), nothing else known: impact 3 x likelihood 1 = 3 -> Planned
    assert risk_of(inputs()) == 3 and response_of(3) == ("Planned", 720)
    # same pothole on a main road, near a school: 3 x 3 = 9 -> Urgent, 3 days
    assert risk_of(inputs(main_road=True, sensitive=True)) == 9 and response_of(9) == ("Urgent", 72)
    # live wire (4) near a hospital on a main road: 4 x 3 = 12 -> Emergency, 24 h
    assert risk_of(inputs(base=4, main_road=True, sensitive=True)) == 12 and response_of(12) == ("Emergency", 24)
    # garbage (2), three citizens: 2 x 2 = 4 -> Routine, 14 days
    assert risk_of(inputs(base=2, citizens=3)) == 4 and response_of(4) == ("Routine", 336)
    # "other" (1) with nothing: 1 -> Planned
    assert risk_of(inputs(base=1)) == 1


def test_impact_is_raised_by_at_most_one_and_never_lowered():
    for base, sev in itertools.product(range(1, 5), SEVERITIES):
        got = impact_of(base, sev)
        assert base <= got <= min(4, base + 1)
    assert impact_of(3, "High") == 4 and impact_of(3, "Low") == 3 and impact_of(4, "Critical") == 4 and impact_of(1, "Medium") == 1


def test_likelihood_starts_at_one_adds_per_factor_and_caps_at_four():
    assert likelihood_of(inputs()) == 1
    assert likelihood_of(inputs(citizens=2)) == 1 and likelihood_of(inputs(citizens=3)) == 2  # 3 DISTINCT citizens
    assert likelihood_of(inputs(main_road=True, sensitive=True, monsoon=True, night=True, citizens=5)) == 4  # 1 + 5 factors, capped


def test_response_category_boundaries():
    expected = {16: "Emergency", 12: "Emergency", 11: "Urgent", 8: "Urgent", 7: "Routine", 4: "Routine", 3: "Planned", 1: "Planned"}
    for risk, name in expected.items():
        assert response_of(risk)[0] == name, risk
    assert [response_of(r)[1] for r in (12, 8, 4, 1)] == [24, 72, 336, 720]


def test_score_is_a_monotonic_0_100_sort_key():
    scores = [score_of(r) for r in range(1, 17)]
    assert scores == sorted(set(scores)) and scores[0] > 0 and scores[-1] == 100
    assert score_of(12) == 75 and score_of(8) == 50 and score_of(4) == 25


def _all_cases():
    cases = []
    for base, sev, main_road, sensitive, monsoon, night, citizens in itertools.product(range(1, 5), SEVERITIES, (False, True), (False, True), (False, True), (False, True), (0, 2, 3, 9)):
        cases.append(RiskInputs(base, sev, main_road, sensitive, citizens, monsoon, night))
    return cases


async def test_sql_functions_match_python_on_every_input(client):
    """The risk formula exists twice (app/priority.py and the SQL functions of migration 0013). Compare them on all
    combinations: 4 impacts x 4 severities x 4 boolean factors x 4 citizen counts = 1024 cases."""
    from app.db import engine

    cases = _all_cases()
    async with engine.connect() as conn:
        rows = (await conn.execute(text("""
            SELECT ireport_risk(b, CAST(s AS severity_level), m, sn, c, mo, n) AS risk,
                   ireport_priority(b, CAST(s AS severity_level), m, sn, c, mo, n) AS score,
                   ireport_sla_hours(ireport_risk(b, CAST(s AS severity_level), m, sn, c, mo, n)) AS hours
            FROM unnest(CAST(:b AS smallint[]), CAST(:s AS text[]), CAST(:m AS boolean[]), CAST(:sn AS boolean[]), CAST(:c AS int[]), CAST(:mo AS boolean[]), CAST(:n AS boolean[]))
                 AS t(b, s, m, sn, c, mo, n)"""), {
            "b": [c.base_impact for c in cases], "s": [c.citizen_severity for c in cases], "m": [c.main_road for c in cases], "sn": [c.sensitive for c in cases],
            "c": [c.citizens for c in cases], "mo": [c.monsoon for c in cases], "n": [c.night for c in cases]})).all()
    assert len(rows) == len(cases) == 1024
    for case, row in zip(cases, rows, strict=True):
        assert row.risk == risk_of(case), case
        assert row.score == priority_of(case), case
        assert row.hours == response_of(risk_of(case))[1], case


async def test_category_table_matches_risk_config(client):
    """risk_config.py is the one config module; categories.impact / monsoon_sensitive are its snapshot in the database."""
    from app.db import engine

    async with engine.connect() as conn:
        rows = (await conn.execute(text("SELECT name, impact, monsoon_sensitive FROM categories"))).all()
    assert {r.name for r in rows} == set(cfg.CATEGORY_IMPACT)
    for r in rows:
        assert r.impact == cfg.CATEGORY_IMPACT[r.name], r.name
        assert r.monsoon_sensitive == (r.name in cfg.MONSOON_CATEGORIES), r.name


async def test_open_definition_is_the_same_in_python_and_sql(client):
    """ONE definition of open: app/status.py and ireport_is_open() agree on every enum value, and the enum has exactly STATUSES."""
    from app.db import engine

    async with engine.connect() as conn:
        labels = [r[0] for r in (await conn.execute(text("SELECT unnest(enum_range(NULL::issue_status))::text"))).all()]
        assert set(labels) == set(STATUSES)
        for status in labels:
            sql_open = await conn.scalar(text("SELECT ireport_is_open(CAST(:s AS issue_status))"), {"s": status})
            assert sql_open == (status in OPEN_STATUSES), status
    assert set(OPEN_STATUSES) | set(NOT_OPEN_STATUSES) == set(STATUSES) and not set(OPEN_STATUSES) & set(NOT_OPEN_STATUSES)
    assert set(OPEN_STATUSES) == {"Reported", "Acknowledged", "Scheduled", "In Progress", "Reopened", "On Hold"}
