/* The 2-3 quick questions asked per category. Answers feed the fields the backend already has:
   `problem` becomes problem_type (English, because severity rules read it), `flags` are risk flags from the
   fixed list, and `addon` is a short sentence added to the description so the rule-based NLP can read it
   (duration, obstruction). Nothing else is invented. */

import { L, type Label, type Lang } from "./i18n";

export type Option = { id: string; label: Label; problem?: string; flags?: string[]; addon?: string };
export type Question = { id: string; text: Label; options: Option[] };

const o = (id: string, en: string, hi: string, mr: string, extra: Partial<Option> = {}): Option => ({ id, label: L(en, hi, mr), ...extra });

const DURATION: Question = {
  id: "duration", text: L("How long has it been like this?", "यह कब से ऐसा है?", "हे किती दिवसांपासून असे आहे?"),
  options: [
    o("today", "Since today", "आज से", "आजपासून"),
    o("days", "A few days", "कुछ दिनों से", "काही दिवसांपासून", { addon: "For about 3 days." }),
    o("week", "A week or more", "एक हफ्ते या अधिक से", "आठवडाभर किंवा जास्त", { addon: "Since last week." }),
  ],
};

const TRAFFIC: Question = {
  id: "traffic", text: L("Where is it?", "यह कहाँ है?", "हे कुठे आहे?"),
  options: [
    o("main", "On a main road", "मुख्य सड़क पर", "मुख्य रस्त्यावर", { flags: ["Main road"] }),
    o("side", "On a side street", "छोटी गली में", "आतल्या रस्त्यावर"),
    o("foot", "On the footpath", "फुटपाथ पर", "पदपथावर", { flags: ["Blocks footpath"] }),
  ],
};

const PEOPLE: Question = {
  id: "people", text: L("Who is at risk?", "किसे खतरा है?", "कोणाला धोका आहे?"),
  options: [
    o("few", "A few people", "कुछ लोग", "काही लोक"),
    o("many", "Many commuters", "बहुत यात्री", "अनेक प्रवासी"),
    o("school", "Near a school", "स्कूल के पास", "शाळेजवळ", { flags: ["Near school"] }),
    o("hospital", "Near a hospital", "अस्पताल के पास", "रुग्णालयाजवळ", { flags: ["Near hospital"] }),
  ],
};

const WET: Question = {
  id: "water", text: L("Is there water on the road?", "क्या सड़क पर पानी है?", "रस्त्यावर पाणी आहे का?"),
  options: [
    o("no", "No", "नहीं", "नाही"),
    o("some", "Some water", "थोड़ा पानी", "थोडे पाणी"),
    o("flood", "Flooding the street", "सड़क पर जलभराव", "रस्त्यावर पूर", { flags: ["Flood risk"] }),
  ],
};

const BLOCKS: Question = {
  id: "blocks", text: L("Is it blocking anything?", "क्या यह कुछ रोक रहा है?", "हे काही अडवत आहे का?"),
  options: [
    o("none", "Nothing", "कुछ नहीं", "काही नाही"),
    o("foot", "The footpath", "फुटपाथ", "पदपथ", { flags: ["Blocks footpath"] }),
    o("road", "The road", "सड़क", "रस्ता", { addon: "Blocking the road." }),
    o("gate", "An entrance", "प्रवेश द्वार", "प्रवेशद्वार", { addon: "Blocking the gate." }),
  ],
};

const problemQ = (options: Option[]): Question => ({ id: "problem", text: L("What kind of problem is it?", "यह किस तरह की समस्या है?", "ही कोणत्या प्रकारची समस्या आहे?"), options });

export const QUESTIONS: Record<string, Question[]> = {
  Pothole: [
    problemQ([
      o("small", "Small", "छोटा", "लहान", { problem: "Small" }), o("medium", "Medium", "मध्यम", "मध्यम", { problem: "Medium" }),
      o("large", "Large", "बड़ा", "मोठा", { problem: "Large" }), o("multiple", "Multiple potholes", "कई गड्ढे", "अनेक खड्डे", { problem: "Multiple potholes" }),
      o("danger", "Dangerous road condition", "खतरनाक सड़क", "धोकादायक रस्ता", { problem: "Dangerous road condition" }),
    ]),
    TRAFFIC, PEOPLE,
  ],
  "Road Damage": [
    problemQ([
      o("cracks", "Cracked surface", "दरारें", "भेगा", { problem: "Cracked surface" }), o("uneven", "Uneven road", "ऊबड़-खाबड़ सड़क", "खडबडीत रस्ता", { problem: "Uneven road" }),
      o("broken", "Broken edge", "टूटा किनारा", "तुटलेली कड", { problem: "Broken edge" }), o("danger", "Dangerous road condition", "खतरनाक सड़क", "धोकादायक रस्ता", { problem: "Dangerous road condition" }),
    ]),
    TRAFFIC, PEOPLE,
  ],
  Streetlight: [
    problemQ([
      o("off", "Not working", "काम नहीं कर रही", "बंद आहे", { problem: "Not working" }), o("flicker", "Flickering", "टिमटिमा रही", "लुकलुकते", { problem: "Flickering" }),
      o("pole", "Broken pole", "टूटा खंभा", "तुटलेला खांब", { problem: "Broken pole" }), o("wire", "Damaged wiring", "क्षतिग्रस्त तार", "खराब वायरिंग", { problem: "Damaged wiring", flags: ["Live wiring"] }),
    ]),
    { id: "dark", text: L("How dark is the street?", "सड़क कितनी अंधेरी है?", "रस्ता किती अंधारा आहे?"), options: [
      o("full", "Fully dark", "पूरी तरह अंधेरा", "पूर्ण अंधार", { flags: ["Night-time hazard"] }), o("part", "Partly dark", "आंशिक अंधेरा", "अंशतः अंधार"),
    ] },
    { id: "safety", text: L("Is there a safety concern?", "क्या सुरक्षा की चिंता है?", "सुरक्षेची काळजी आहे का?"), options: [
      o("none", "Not really", "खास नहीं", "विशेष नाही"), o("unsafe", "Feels unsafe at night", "रात में असुरक्षित", "रात्री असुरक्षित वाटते", { flags: ["Night-time hazard"] }),
      o("junction", "Busy junction", "व्यस्त चौराहा", "वर्दळीचा चौक", { flags: ["Main road"] }),
    ] },
  ],
  Garbage: [
    problemQ([
      o("overflow", "Overflowing", "ओवरफ्लो", "ओसंडून वाहत आहे", { problem: "Overflowing" }), o("dump", "Illegal dumping", "अवैध डंपिंग", "बेकायदेशीर कचरा", { problem: "Illegal dumping" }),
      o("uncollected", "Uncollected garbage", "न उठा कचरा", "न उचललेला कचरा", { problem: "Uncollected garbage" }),
    ]),
    BLOCKS, DURATION,
  ],
  "Water Leakage": [
    problemQ([
      o("pipe", "Broken pipe", "टूटा पाइप", "तुटलेला पाईप", { problem: "Broken pipe" }), o("road", "Water on the road", "सड़क पर पानी", "रस्त्यावर पाणी", { problem: "Water on the road" }),
      o("dirty", "Dirty water", "गंदा पानी", "घाण पाणी", { problem: "Dirty water" }), o("tap", "Leaking valve or tap", "रिसता वाल्व/नल", "गळणारा व्हॉल्व्ह/नळ", { problem: "Leaking valve" }),
    ]),
    { id: "amount", text: L("How much water is leaking?", "कितना पानी बह रहा है?", "किती पाणी गळत आहे?"), options: [
      o("trickle", "A trickle", "हल्का रिसाव", "थोडी गळती"), o("steady", "A steady flow", "लगातार बहाव", "सतत प्रवाह"),
      o("flood", "Flooding the street", "सड़क पर बाढ़", "रस्त्यावर पूर", { flags: ["Flood risk"] }),
    ] },
    DURATION,
  ],
  Drainage: [
    problemQ([
      o("blocked", "Blocked drain", "जाम नाली", "तुंबलेली गटार", { problem: "Blocked drain" }), o("overflow", "Overflowing drain", "ओवरफ्लो नाली", "ओसंडणारी गटार", { problem: "Overflowing drain" }),
      o("open", "Open manhole", "खुला मैनहोल", "उघडे मॅनहोल", { problem: "Open manhole", addon: "Manhole is open." }), o("cover", "Damaged cover", "टूटा ढक्कन", "तुटलेले झाकण", { problem: "Damaged cover" }),
    ]),
    WET, DURATION,
  ],
  "Electrical Hazard": [
    problemQ([
      o("exposed", "Exposed wires", "खुले तार", "उघड्या तारा", { problem: "Exposed wires", flags: ["Live wiring"] }), o("spark", "Sparking", "चिंगारी", "ठिणग्या", { problem: "Sparking", flags: ["Live wiring"] }),
      o("pole", "Leaning pole", "झुका खंभा", "वाकलेला खांब", { problem: "Leaning pole" }), o("box", "Damaged box", "क्षतिग्रस्त बॉक्स", "खराब बॉक्स", { problem: "Damaged box" }),
    ]),
    { id: "danger", text: L("Is anyone in danger?", "क्या कोई खतरे में है?", "कोणी धोक्यात आहे का?"), options: [
      o("no", "No one nearby", "आसपास कोई नहीं", "जवळ कोणी नाही"), o("people", "People pass nearby", "लोग पास से गुज़रते हैं", "लोक जवळून जातात", { addon: "Children and people pass nearby." }),
      o("hurt", "Someone was hurt", "कोई घायल हुआ", "कोणी जखमी झाले", { flags: ["Injury reported"] }),
    ] },
    WET,
  ],
  Other: [
    problemQ([
      o("damaged", "Damaged", "क्षतिग्रस्त", "खराब", { problem: "Damaged" }), o("notworking", "Not working", "काम नहीं कर रहा", "चालत नाही", { problem: "Not working" }),
      o("unsafe", "Unsafe condition", "असुरक्षित स्थिति", "असुरक्षित स्थिती", { problem: "Unsafe condition" }), o("other", "Other", "अन्य", "इतर", { problem: "Other" }),
    ]),
    BLOCKS, DURATION,
  ],
};

export type Answers = Record<string, string>;

/** Turns the chosen answers into the backend inputs. */
export function fromAnswers(category: string, answers: Answers): { problem: string; flags: string[]; addons: string[] } {
  const qs = QUESTIONS[category] ?? [];
  let problem = "Damaged";
  const flags = new Set<string>();
  const addons: string[] = [];
  for (const q of qs) {
    const opt = q.options.find(x => x.id === answers[q.id]);
    if (!opt) continue;
    if (opt.problem) problem = opt.problem;
    opt.flags?.forEach(f => flags.add(f));
    if (opt.addon) addons.push(opt.addon);
  }
  return { problem, flags: [...flags], addons };
}

export const defaultAnswers = (category: string): Answers => {
  const first = QUESTIONS[category]?.[0]?.options[0];
  return first ? { problem: first.id } : {};
};

export const optLabel = (o: Option, lang: Lang) => o.label[lang] ?? o.label.en;
