"""Version 1 severity, risk flags and explanations: fixed rules, no model.

Cue keywords are matched on lower-cased, NFC-normalised text in English, Hindi, Marathi and
Hinglish. Rules only ever add flags from the fixed list and only ever raise severity."""

import re
import unicodedata

SEVERITY_ORDER = ["Low", "Medium", "High", "Critical"]
FLAGS = ["Live wiring", "Injury reported", "Near school", "Near hospital", "Flood risk", "Main road", "Night-time hazard", "Blocks footpath"]

# Keyword lists per flag. Latin entries are matched as word prefixes; Devanagari as substrings
# (Devanagari words take many suffixes, and \b does not work well with combining marks).
CUES: dict[str, list[str]] = {
    "Live wiring": ["spark", "live wire", "naked wire", "bare wire", "exposed wire", "electric current", "current lag", "current aa", "current maar", "shock", "electrocut", "wire hanging", "hanging wire",
                    "करंट", "चिंगारी", "नंगा तार", "नंगी तार", "खुला तार", "बिजली का तार", "झटका", "ठिणगी", "उघडी वायर", "विजेची तार", "शॉक"],
    "Injury reported": ["injur", "accident", "hurt", "bleeding", "fell", "fallen", "died", "ghayal", "chot",
                        "घायल", "चोट", "दुर्घटना", "हादसा", "जखमी", "अपघात", "मार लागला"],
    "Near school": ["school", "college", "shala", "vidyalaya", "स्कूल", "विद्यालय", "शाला", "शाळा", "शाळे", "कॉलेज", "महाविद्यालय"],
    "Near hospital": ["hospital", "clinic", "dispensary", "aspatal", "अस्पताल", "हॉस्पिटल", "रुग्णालय", "दवाखान", "दवाख़ान"],
    "Flood risk": ["flood", "waterlog", "water logging", "blocked drain", "drain blocked", "drain is blocked", "choked", "knee deep", "paani bhar", "pani bhar",
                   "बाढ़", "पानी भर", "जलभराव", "पूर", "पाणी साचले", "पाणी साचलं", "तुंबले", "तुंबलं"],
    "Main road": ["main road", "highway", "flyover", "junction", "signal", "link road", "express", "s.v. road", "sv road",
                  "मुख्य सड़क", "मेन रोड", "हाईवे", "महामार्ग", "मुख्य रस्ता", "मेन रोड"],
    "Night-time hazard": ["night", "dark", "no light", "raat", "andhera", "रात", "अंधेरा", "अँधेरा", "रात्री", "अंधार"],
    "Blocks footpath": ["footpath", "pavement", "sidewalk", "फुटपाथ", "रास्ता बंद", "पदपथ", "अडथळा"],
}
# Raise severity without adding a flag (there is no flag for these in the fixed list).
SEVERE_CUES = ["open manhole", "manhole open", "manhole cover", "no cover", "caved", "collapse", "sinkhole", "deep",
               "खुला मैनहोल", "मैनहोल", "गड्ढा गहरा", "धंसी", "मॅनहोल", "खचला", "खोल खड्डा"]

DEFAULT_FLAGS = {
    "Electrical Hazard": ["Live wiring"],
    "Pothole": ["Main road"],
    "Road Damage": ["Main road"],
    "Drainage": ["Flood risk"],
    "Streetlight": ["Night-time hazard"],
}

EXPLANATIONS = {
    "Pothole": "The image shows a depressed, broken road surface with traffic exposure.",
    "Road Damage": "The image shows cracked or uneven road surface that can affect vehicles and pedestrians.",
    "Streetlight": "The image shows a street light or pole that appears damaged or not working.",
    "Garbage": "The image shows waste collected or dumped in a public space.",
    "Water Leakage": "The image shows water escaping from a pipe or flowing where it should not.",
    "Drainage": "The image shows a blocked, open or overflowing drain or manhole.",
    "Electrical Hazard": "The image shows exposed wiring or electrical equipment that may be unsafe.",
    "Other": "The image shows a public-space problem that does not fit the main categories.",
}
TEXT_EXPLANATION = "Your description mentions words usually used for {category} problems."
_HIGH_PROBLEM = re.compile(r"dangerous|large|multiple|broken|damaged|overflowing|illegal|unsafe", re.I)


def normalise(text: str | None) -> str:
    return unicodedata.normalize("NFC", text or "").lower()


def _matches(text: str, cue: str) -> bool:
    if cue.isascii():
        return re.search(r"(?<![a-z])" + re.escape(cue), text) is not None
    return cue in text


def cue_flags(text: str | None) -> tuple[list[str], bool]:
    """Returns (flags found in the text, whether a severe non-flag cue was found)."""
    t = normalise(text)
    if not t:
        return [], False
    flags = [flag for flag, words in CUES.items() if any(_matches(t, w) for w in words)]
    return flags, any(_matches(t, w) for w in SEVERE_CUES)


def merge_flags(*groups: list[str]) -> list[str]:
    present = {f for g in groups for f in g}
    return [f for f in FLAGS if f in present]


def raise_to(current: str, minimum: str) -> str:
    return max(current, minimum, key=SEVERITY_ORDER.index)


def severity_for(category: str, problem_type: str | None, flags: list[str], severe_cue: bool = False) -> str:
    if category == "Electrical Hazard":
        sev = "Critical"
    elif problem_type and _HIGH_PROBLEM.search(problem_type):
        sev = "High"
    elif problem_type and problem_type.lower() == "small" and not flags:
        sev = "Low"
    else:
        sev = "Medium"
    if "Live wiring" in flags or "Injury reported" in flags:
        sev = raise_to(sev, "Critical")
    if severe_cue or any(f in flags for f in ("Near school", "Near hospital", "Flood risk")):
        sev = raise_to(sev, "High")
    return sev


def assess(category: str, problem_type: str | None, description: str | None, extra_flags: list[str] | None = None) -> tuple[str, list[str]]:
    """Severity and flags for a report, from the category, step-2 choice, text cues and risk flags."""
    found, severe = cue_flags(description)
    flags = merge_flags(DEFAULT_FLAGS.get(category, []), found, extra_flags or [])
    return severity_for(category, problem_type, flags, severe), flags


def explanation(category: str, from_image: bool, flags: list[str]) -> str:
    base = EXPLANATIONS.get(category, EXPLANATIONS["Other"]) if from_image else TEXT_EXPLANATION.format(category=category.lower())
    risky = [f.lower() for f in flags if f in ("Live wiring", "Injury reported", "Near school", "Near hospital", "Flood risk")]
    return f"{base} Risk noted: {', '.join(risky)}." if risky else base


# ---------- NLP extraction (rule-based, no model) ----------
# Pulls a few facts out of the citizen's own text. Every field is None when the text does not say it.

NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "ek": 1, "do": 2, "teen": 3, "char": 4, "chaar": 4, "paanch": 5, "panch": 5, "chhe": 6, "saat": 7, "aath": 8, "nau": 9, "das": 10,
    "एक": 1, "दो": 2, "दोन": 2, "तीन": 3, "चार": 4, "पांच": 5, "पाँच": 5, "पाच": 5, "छह": 6, "छः": 6, "सहा": 6, "सात": 7, "आठ": 8, "नौ": 9, "नऊ": 9, "दस": 10, "दहा": 10,
}
UNIT_DAYS = {  # unit word (prefix match for Latin, substring for Devanagari) -> days
    "day": 1, "din": 1, "दिन": 1, "दिवस": 1,
    "week": 7, "hafte": 7, "hafta": 7, "haphte": 7, "हफ्त": 7, "हफ़्त": 7, "सप्ताह": 7, "आठवड": 7,
    "month": 30, "mahine": 30, "mahina": 30, "महीन": 30, "महिन": 30,
    "hour": 0, "ghante": 0, "घंट": 0, "तास": 0,
}
_UNITS = "|".join(sorted((re.escape(u) for u in UNIT_DAYS), key=len, reverse=True))
_NUM = "|".join(sorted((re.escape(w) for w in NUMBER_WORDS), key=len, reverse=True))
_DURATION = re.compile(rf"(?<![\w])(\d+|{_NUM})\s*\+?\s*({_UNITS})", re.I)
_SINCE = [  # phrase -> (label, days)
    (re.compile(r"since (last )?week|for a week|एक हफ्ते से|हफ्ते भर से|आठवड्यापासून|pichhle hafte se|hafte se"), ("since last week", 7)),
    (re.compile(r"since yesterday|from yesterday|kal se|कल से|कालपासून"), ("since yesterday", 1)),
    (re.compile(r"since (last )?month|for a month|महीने से|महिन्यापासून|mahine se"), ("since last month", 30)),
]

OBSTRUCTION_CUES = {
    "road": ["re:block[a-z]* (the |a )?(main )?road", "re:road (is |has been |was )?(block|closed)", "re:traffic (jam|block)", "सड़क बंद", "सड़क पर जाम", "रस्ता बंद", "रस्त्यावर अडथळा", "वाहतूक कोंडी", "sadak band", "rasta band"],
    "footpath": ["footpath", "pavement", "sidewalk", "फुटपाथ", "पदपथ"],
    "entrance": ["re:block[a-z]* (the |my |our )?(gate|entrance|doorway)", "re:(gate|entrance|doorway) (is |has been )?(block|closed)", "गेट बंद", "प्रवेश बंद", "दरवाजा बंद", "दार बंद", "gate band"],
}
HAZARD_CUES = {
    "two-wheelers": ["bike", "scooter", "two wheeler", "two-wheeler", "motorcycle", "cyclist", "बाइक", "दुचाकी", "स्कूटर"],
    "vehicles": [r"re:\bcars?\b", "truck", "vehicle", r"re:\bbus(es)?\b", "auto rickshaw", "rickshaw", "gaadi", "gadi", "गाड़ी", "गाडी", "वाहन", "ट्रक"],
    "children": ["child", "kids", r"re:\bkid\b", "student", "bachche", "bachhe", "बच्चे", "बच्चों", "मुले", "मुलं", "विद्यार्थी"],
    "live wire": [c for c in CUES["Live wiring"]],
    "water": ["water", "flood", "paani", "pani ", "पानी", "पाणी"],
    "elderly": ["elderly", "senior citizen", "old people", "बुज़ुर्ग", "बुजुर्ग", "वृद्ध", "ज्येष्ठ"],
}


def _has(text: str, cue: str) -> bool:
    if cue.startswith("re:"):
        return re.search(cue[3:], text) is not None
    return _matches(text, cue)


def _digits(s: str) -> str:
    """Devanagari digits to ASCII (४ -> 4)."""
    return "".join(str(unicodedata.digit(ch, ch)) if ch.isdigit() else ch for ch in s)


def extract_duration(text: str) -> dict | None:
    t = _digits(normalise(text))
    m = _DURATION.search(t)
    if m:
        n = int(m.group(1)) if m.group(1).isdigit() else NUMBER_WORDS.get(m.group(1).lower())
        unit = next((u for u in UNIT_DAYS if m.group(2).lower().startswith(u) or u in m.group(2).lower()), None)
        if n and unit:
            per = UNIT_DAYS[unit]
            label = {1: "day", 7: "week", 30: "month", 0: "hour"}[per]
            return {"text": f"{n} {label}{'s' if n != 1 else ''}", "days": n * per if per else round(n / 24, 2)}
    for pattern, (label, days) in _SINCE:
        if pattern.search(t):
            return {"text": label, "days": days}
    return None


def extract_nlp(description: str | None, severity: str, flags: list[str]) -> dict | None:
    """Returns {duration, obstruction, hazard, urgency, flags} or None when there is no text.
    duration/obstruction/hazard are None when the text does not state them. urgency is derived from
    severity, flags and duration with fixed rules (never from a model)."""
    t = normalise(_digits(description or "")).strip()
    if not t:
        return None
    duration = extract_duration(t)
    obstruction = next((k for k, cues in OBSTRUCTION_CUES.items() if any(_has(t, c) for c in cues)), None)
    hazards = [k for k, cues in HAZARD_CUES.items() if any(_has(t, c) for c in cues)]
    text_flags, _ = cue_flags(t)
    days = duration["days"] if duration else 0
    if severity in ("High", "Critical") or {"Live wiring", "Injury reported"} & (set(flags) | set(text_flags)):
        urgency = "High"
    elif days >= 3 or text_flags or hazards:
        urgency = "Medium"
    else:
        urgency = "Low"
    return {"duration": duration, "obstruction": obstruction, "hazard": hazards or None, "urgency": urgency, "flags": text_flags}
