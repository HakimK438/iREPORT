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
