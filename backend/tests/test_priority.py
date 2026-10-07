import random
from datetime import UTC, datetime, timedelta

from sqlalchemy import text

from app.priority import FLAG_POINTS, priority_of

NOW = datetime(2026, 10, 7, 12, 0, tzinfo=UTC)
HAZARD = {"Electrical Hazard": 25, "Drainage": 14, "Pothole": 12, "Road Damage": 12, "Water Leakage": 8, "Streetlight": 8, "Garbage": 6, "Other": 4}


def test_dangerous_with_two_reports_beats_safe_with_thirty():
    dangerous = priority_of("Critical", "Electrical Hazard", 25, ["Live wiring", "Near school"], "Reported", NOW - timedelta(days=2), 2, NOW)
    safe = priority_of("Low", "Garbage", 6, [], "Reported", NOW - timedelta(hours=1), 30, NOW)
    assert dangerous.score > safe.score
    # worked by hand: 40 + 25 + min(28, 32) + 3 + log2(3)*1.6 = 98.54 -> 84.9 -> 85
    assert (dangerous.score, dangerous.level) == (85, "Critical")
    # 8 + 6 + 0 + 0.06 + log2(31)*1.6 = 21.98 -> 18.9 -> 19
    assert (safe.score, safe.level) == (19, "Low")


def test_reasons_match_frontend_labels():
    p = priority_of("High", "Pothole", 12, ["Main road"], "In Progress", NOW - timedelta(days=6), 23, NOW)
    labels = [r["label"] for r in p.reasons]
    assert labels[0] == "High severity" and "Open for 6 days" in labels and "23 citizens affected" in labels
    assert p.reasons == sorted(p.reasons, key=lambda r: -r["pts"])


def test_resolved_has_no_age_points_and_score_is_capped():
    p = priority_of("Critical", "Electrical Hazard", 25, list(FLAG_POINTS), "Resolved", NOW - timedelta(days=90), 10_000, NOW)
    assert not any(r["label"].startswith("Open for") for r in p.reasons)
    assert p.score <= 100
    open_ = priority_of("Critical", "Electrical Hazard", 25, list(FLAG_POINTS), "Reported", NOW - timedelta(days=90), 10_000, NOW)
    assert open_.score == 100


async def test_sql_function_matches_python_port(client):
    from app.db import engine

    rng = random.Random(7)
    cases = []
    for _ in range(300):
        cat = rng.choice(list(HAZARD))
        cases.append((
            rng.choice(["Low", "Medium", "High", "Critical"]), cat,
            rng.sample(list(FLAG_POINTS) + ["Something else"], rng.randint(0, 4)),
            rng.choice(["Reported", "Under Review", "In Progress", "Resolved"]),
            NOW - timedelta(seconds=rng.randint(0, 40 * 86400)), rng.randint(1, 500),
        ))
    async with engine.connect() as conn:
        for sev, cat, flags, status, created, affected in cases:
            sql = await conn.scalar(
                text("SELECT ireport_priority(CAST(:s AS severity_level), CAST(:h AS smallint), CAST(:f AS text[]), CAST(:st AS issue_status), :c, :a, :now)"),
                {"s": sev, "h": HAZARD[cat], "f": flags, "st": status, "c": created, "a": affected, "now": NOW},
            )
            assert sql == priority_of(sev, cat, HAZARD[cat], flags, status, created, affected, NOW).score, (sev, cat, flags, status, created, affected)
