"""Whitelist for the report-flow quick answers ({question id: option id}) and the flags they raise.
Mirrors src/questions.ts. Answers are stored as sent (after validation); they never change affected_count."""

ANSWER_OPTIONS: dict[str, frozenset[str]] = {
    "duration": frozenset({"today", "days", "week"}),
    "traffic": frozenset({"main", "side", "foot"}),
    "people": frozenset({"few", "many", "school", "hospital"}),
    "water": frozenset({"no", "some", "flood"}),
    "blocks": frozenset({"none", "foot", "road", "gate"}),
    "problem": frozenset({
        "small", "medium", "large", "multiple", "danger", "cracks", "uneven", "broken", "off", "flicker", "pole", "wire", "overflow",
        "dump", "uncollected", "pipe", "road", "dirty", "tap", "blocked", "open", "cover", "exposed", "spark", "box", "damaged",
        "notworking", "unsafe", "other",
    }),
    "dark": frozenset({"full", "part"}),
    "safety": frozenset({"none", "unsafe", "junction"}),
    "amount": frozenset({"trickle", "steady", "flood"}),
    "danger": frozenset({"no", "people", "hurt"}),
}

# (question id, option id) -> flag from the fixed FLAGS list
ANSWER_FLAGS: dict[tuple[str, str], str] = {
    ("blocks", "foot"): "Blocks footpath",
    ("blocks", "road"): "Blocks footpath",
    ("dark", "full"): "Night-time hazard",
    ("safety", "unsafe"): "Night-time hazard",
    ("traffic", "main"): "Main road",
}


def unknown_answers(answers: dict[str, str]) -> list[str]:
    """Keys or values that are not in the whitelist."""
    return [f"{k}={v}" for k, v in answers.items() if v not in ANSWER_OPTIONS.get(k, frozenset())]


def flags_from_answers(answers: dict[str, str] | None) -> list[str]:
    return list(dict.fromkeys(f for k, v in (answers or {}).items() if (f := ANSWER_FLAGS.get((k, v)))))
