import { Icon } from "./Icon";
import { CategoryPhoto } from "./brand";
import { tr, type Lang, type StrKey } from "./i18n";
import { catLabel, deptLabel } from "./i18nStaff";

const IMG = (path: string) => `${import.meta.env.BASE_URL}${path}`;

/** English, Hindi, Marathi. */
type L = [string, string, string];
const pick = (lang: Lang, t: L) => t[lang === "hi" ? 1 : lang === "mr" ? 2 : 0];

/** A short guide for officers and admins. Pictures first, a few plain words under each. */
const STEPS: [L, L][] = [
  [["Citizen reports", "नागरिक शिकायत करता है", "नागरिक तक्रार करतो"], ["Photo, pin on the map, short description.", "फ़ोटो, नक्शे पर पिन, छोटा विवरण।", "फोटो, नकाशावर पिन, थोडक्यात वर्णन."]],
  [["System routes it", "सिस्टम सही जगह भेजता है", "प्रणाली योग्य ठिकाणी पाठवते"], ["The pin gives the area. The category gives the department.", "पिन से क्षेत्र तय होता है। श्रेणी से विभाग।", "पिनवरून भाग ठरतो. श्रेणीवरून विभाग."]],
  [["System sets the priority", "सिस्टम प्राथमिकता तय करता है", "प्रणाली प्राधान्य ठरवते"], ["Critical, High risk, Moderate risk or Routine, each with a deadline.", "गंभीर, उच्च जोखिम, मध्यम जोखिम या सामान्य, हर एक की समय सीमा के साथ।", "गंभीर, उच्च जोखीम, मध्यम जोखीम किंवा नियमित, प्रत्येकाची मुदत ठरलेली."]],
  [["Officer works it", "अधिकारी काम करता है", "अधिकारी काम करतो"], ["Acknowledge, assign, schedule, start work.", "स्वीकार करें, सौंपें, तारीख तय करें, काम शुरू करें।", "स्वीकारा, नियुक्त करा, तारीख ठरवा, काम सुरू करा."]],
  [["Officer resolves it", "अधिकारी समाधान करता है", "अधिकारी निराकरण करतो"], ["Write what was done. The citizen sees the note.", "क्या किया लिखें। नागरिक यह टिप्पणी देखता है।", "काय केले ते लिहा. नागरिकाला ही टिप दिसते."]],
  [["Citizen confirms", "नागरिक पुष्टि करता है", "नागरिक पुष्टी करतो"], ["Confirmed means Closed. Not fixed means Reopened.", "पुष्टि होने पर बंद। ठीक नहीं हुआ तो फिर से खुलती है।", "पुष्टी झाल्यास बंद. दुरुस्त नसल्यास पुन्हा उघडते."]],
];

const LEVELS: { key: StrKey; when: L; cls: string; symbol: string }[] = [
  { key: "resp_Emergency", when: ["Fix in 24 hours", "24 घंटे में ठीक करें", "24 तासांत दुरुस्त करा"], cls: "red", symbol: "critical.png" },
  { key: "resp_Urgent", when: ["Within 3 days", "3 दिन में", "3 दिवसांत"], cls: "orange", symbol: "high_risk.png" },
  { key: "resp_Routine", when: ["Within 14 days", "14 दिन में", "14 दिवसांत"], cls: "amber", symbol: "moderate_risk.png" },
  { key: "resp_Planned", when: ["Within 30 days", "30 दिन में", "30 दिवसांत"], cls: "green", symbol: "daily_routine.png" },
];

const SCREENS: { file: string; title: L; points: L[]; wide?: boolean }[] = [
  { file: "screen-map-cards", title: ["The map cards", "नक्शे के कार्ड", "नकाशावरील कार्ड"], points: [
    ["Each card is one problem in your area.", "हर कार्ड आपके क्षेत्र की एक समस्या है।", "प्रत्येक कार्ड तुमच्या भागातील एक समस्या आहे."],
    ["The photo is the citizen's own photo.", "फ़ोटो नागरिक की अपनी खींची हुई है।", "फोटो नागरिकाने स्वतः काढलेला आहे."],
    ["Colour and badge show the priority. Red text means overdue.", "रंग और बैज प्राथमिकता दिखाते हैं। लाल लिखा हो तो समय सीमा पार।", "रंग आणि बॅज प्राधान्य दाखवतात. लाल मजकूर म्हणजे मुदत उलटली."],
    ["Details opens the full complaint.", "'Details' पर पूरी शिकायत खुलती है।", "'Details' वर पूर्ण तक्रार उघडते."]] },
  { file: "screen-chips-list", title: ["Chips and the complaint list", "चिप्स और शिकायत सूची", "चिप्स आणि तक्रार यादी"], points: [
    ["Top row: status. The number is how many complaints are in it.", "ऊपर की पंक्ति: स्थिति। संख्या बताती है कितनी शिकायतें हैं।", "वरची ओळ: स्थिती. आकडा म्हणजे किती तक्रारी आहेत."],
    ["Second row: priority. Combine it with a status.", "दूसरी पंक्ति: प्राथमिकता। इसे किसी स्थिति के साथ मिलाएँ।", "दुसरी ओळ: प्राधान्य. ते एखाद्या स्थितीसोबत वापरा."],
    ["Overdue and Unassigned are the ones to clear first.", "'समय सीमा पार' और 'किसी को सौंपी नहीं' पहले निपटाएँ।", "'मुदत उलटलेल्या' आणि 'नियुक्त नसलेल्या' आधी निपटवा."],
    ["Cards are sorted most urgent first.", "कार्ड सबसे ज़रूरी पहले दिखते हैं।", "कार्ड सर्वात तातडीचे आधी दिसतात."]] },
  { file: "screen-more-menu", title: ["The More menu", "'More' मेनू", "'More' मेनू"], points: [
    ["The big dark button is the next step. Here it is Acknowledge.", "बड़ा काला बटन अगला कदम है। यहाँ 'Acknowledge'।", "मोठे काळे बटण पुढचे पाऊल आहे. येथे 'Acknowledge'."],
    ["More holds the other actions: assign, schedule, start work, put on hold, reject, mark duplicate, transfer, mark resolved.", "'More' में बाकी कार्रवाइयाँ हैं: सौंपें, तारीख, काम शुरू, रोकें, अस्वीकार, डुप्लिकेट, स्थानांतरित, समाधान।", "'More' मध्ये इतर कृती आहेत: नियुक्त, तारीख, काम सुरू, थांबवा, नाकारा, डुप्लिकेट, हस्तांतर, निराकरण."]] },
  { file: "screen-assign", wide: true, title: ["Assign", "सौंपना", "नियुक्त करणे"], points: [
    ["Pick a colleague from your own department and area, or yourself.", "अपने विभाग और क्षेत्र के किसी सहकर्मी को चुनें, या खुद को।", "तुमच्या विभाग आणि भागातील सहकारी निवडा, किंवा स्वतःला."],
    ["Until someone is assigned the card says Unassigned.", "जब तक कोई नहीं सौंपा जाता, कार्ड पर 'किसी को सौंपी नहीं' दिखता है।", "कोणालाही नियुक्त करेपर्यंत कार्डवर 'नियुक्त नाही' दिसते."]] },
  { file: "screen-transfer", wide: true, title: ["Transfer", "स्थानांतरण", "हस्तांतर"], points: [
    ["Use it when the complaint is in the wrong category.", "शिकायत गलत श्रेणी में हो तो इसका उपयोग करें।", "तक्रार चुकीच्या श्रेणीत असल्यास वापरा."],
    ["Choose the right category and give a reason.", "सही श्रेणी चुनें और कारण लिखें।", "योग्य श्रेणी निवडा आणि कारण लिहा."],
    ["It moves to that department's queue as a new Reported complaint.", "यह उस विभाग की कतार में नई शिकायत के रूप में जाती है।", "ती त्या विभागाच्या रांगेत नवी तक्रार म्हणून जाते."]] },
  { file: "screen-work-order", title: ["The printed work order", "छपा हुआ कार्य आदेश", "छापलेला कार्य आदेश"], points: [
    ["Top box: priority, why, and the recommended action.", "ऊपर का बॉक्स: प्राथमिकता, कारण और सुझाई गई कार्रवाई।", "वरचा बॉक्स: प्राधान्य, कारण आणि शिफारस केलेली कृती."],
    ["Table: what, category, department, status, deadline, who it is assigned to, where.", "तालिका: क्या, श्रेणी, विभाग, स्थिति, समय सीमा, किसे सौंपा, कहाँ।", "तक्ता: काय, श्रेणी, विभाग, स्थिती, मुदत, कोणाला नियुक्त, कुठे."],
    ["Then: the citizen's own words and photo, the timeline, and a blank area to fill in on site.", "फिर: नागरिक के शब्द और फ़ोटो, समयरेखा, और स्थल पर भरने की खाली जगह।", "मग: नागरिकाचे शब्द आणि फोटो, कालरेषा, आणि जागेवर भरण्यासाठी रिकामी जागा."]] },
];

const BUTTONS: [L, L][] = [
  [["Acknowledge", "स्वीकार करें", "स्वीकारा"], ["You have seen it and own it.", "आपने देख लिया और जिम्मेदारी ली।", "तुम्ही पाहिले आणि जबाबदारी घेतली."]],
  [["Assign", "सौंपें", "नियुक्त करा"], ["Give it to a colleague or yourself.", "किसी सहकर्मी या खुद को दें।", "सहकाऱ्याला किंवा स्वतःला द्या."]],
  [["Schedule", "तारीख तय करें", "तारीख ठरवा"], ["Set the visit or work date.", "भेट या काम की तारीख तय करें।", "भेट किंवा कामाची तारीख ठरवा."]],
  [["Start work", "काम शुरू करें", "काम सुरू करा"], ["A crew is on it (In progress).", "टीम काम कर रही है (कार्य जारी)।", "पथक काम करत आहे (काम सुरू)."]],
  [["Mark resolved", "समाधान चिह्नित करें", "निराकरण नोंदवा"], ["Write what was done. The citizen then confirms.", "क्या किया लिखें। फिर नागरिक पुष्टि करता है।", "काय केले ते लिहा. मग नागरिक पुष्टी करतो."]],
  [["More", "More", "More"], ["On hold, Reject, Duplicate, Transfer.", "रोकें, अस्वीकार, डुप्लिकेट, स्थानांतरित।", "थांबवा, नाकारा, डुप्लिकेट, हस्तांतर."]],
  [["Print work order", "कार्य आदेश छापें", "कार्य आदेश छापा"], ["One page for the crew.", "टीम के लिए एक पन्ना।", "पथकासाठी एक पान."]],
  [["It is genuine / Reject as fake", "यह सही है / फर्जी मानकर अस्वीकार", "हे खरे आहे / बनावट म्हणून नाकारा"], ["Only on a flagged complaint.", "सिर्फ़ चिह्नित शिकायत पर।", "फक्त चिन्हांकित तक्रारीवर."]],
];

const STATUSES: [L, L][] = [
  [["Reported", "दर्ज", "नोंदवलेली"], ["New. Not seen yet.", "नई। अभी देखी नहीं गई।", "नवी. अजून पाहिली नाही."]],
  [["Acknowledged", "स्वीकृत", "स्वीकारलेली"], ["An officer owns it.", "एक अधिकारी जिम्मेदार है।", "एक अधिकारी जबाबदार आहे."]],
  [["Scheduled", "तय तारीख", "तारीख ठरली"], ["A date is set.", "तारीख तय है।", "तारीख ठरली आहे."]],
  [["In progress", "कार्य जारी", "काम सुरू"], ["Work has started.", "काम शुरू हो गया है।", "काम सुरू झाले आहे."]],
  [["Awaiting verification", "पुष्टि की प्रतीक्षा", "पडताळणीची प्रतीक्षा"], ["Resolved. Waiting for the citizen.", "समाधान हुआ। नागरिक की प्रतीक्षा।", "निराकरण झाले. नागरिकाची प्रतीक्षा."]],
  [["Closed", "बंद", "बंद"], ["Citizen confirmed, or 72 hours passed.", "नागरिक ने पुष्टि की, या 72 घंटे बीते।", "नागरिकाने पुष्टी केली, किंवा 72 तास झाले."]],
  [["Reopened", "फिर खोली गई", "पुन्हा उघडली"], ["Citizen says it is not fixed.", "नागरिक कहता है ठीक नहीं हुआ।", "नागरिक म्हणतो दुरुस्त झाले नाही."]],
];

const CATEGORIES: [string, string][] = [
  ["Pothole", "Roads & Traffic"], ["Road Damage", "Roads & Traffic"], ["Garbage", "Solid Waste Management"], ["Electrical Hazard", "Electrical Safety"],
  ["Drainage", "Storm Water Drains"], ["Streetlight", "Street Lighting"], ["Other", "General / Ward Office"],
];

const T = {
  eyebrow: ["GUIDE", "मार्गदर्शिका", "मार्गदर्शक"] as L,
  title: ["How iREPORT works", "iREPORT कैसे काम करता है", "iREPORT कसे चालते"] as L,
  forAdmin: ["For admins. Short and visual.", "एडमिन के लिए। छोटा और चित्रों के साथ।", "ॲडमिनसाठी. थोडक्यात आणि चित्रांसह."] as L,
  forOfficer: ["For officers. Short and visual.", "अधिकारियों के लिए। छोटा और चित्रों के साथ।", "अधिकाऱ्यांसाठी. थोडक्यात आणि चित्रांसह."] as L,
  journey: ["The journey of a complaint", "शिकायत का सफ़र", "तक्रारीचा प्रवास"] as L,
  priority: ["Priority", "प्राथमिकता", "प्राधान्य"] as L,
  screens: ["The screens", "स्क्रीन", "स्क्रीन"] as L,
  buttons: ["The buttons", "बटन", "बटणे"] as L,
  statuses: ["The statuses", "स्थितियाँ", "स्थिती"] as L,
  categories: ["The categories", "श्रेणियाँ", "श्रेणी"] as L,
  who: ["Who sees what", "कौन क्या देखता है", "कोण काय पाहतो"] as L,
  citizen: ["Citizen: reports and confirms.", "नागरिक: शिकायत करता है और पुष्टि करता है।", "नागरिक: तक्रार करतो आणि पुष्टी करतो."] as L,
  authority: ["Area authority: only their own area and department. Use the area tabs to sign in to another area.", "क्षेत्र अधिकारी: सिर्फ़ अपना क्षेत्र और विभाग। दूसरे क्षेत्र के लिए क्षेत्र टैब से साइन इन करें।", "भाग अधिकारी: फक्त स्वतःचा भाग आणि विभाग. दुसऱ्या भागासाठी भाग टॅबमधून साइन इन करा."] as L,
  admin: ["Admin: all of Mumbai, read only, plus officer approvals.", "एडमिन: पूरा मुंबई, सिर्फ़ देखने के लिए, और अधिकारियों की मंज़ूरी।", "ॲडमिन: संपूर्ण मुंबई, फक्त पाहण्यासाठी, आणि अधिकाऱ्यांची मंजुरी."] as L,
  habit: ["Habit: clear Critical and Overdue first, and always write a clear note when you resolve.", "आदत: पहले गंभीर और समय सीमा पार वाली शिकायतें निपटाएँ, और समाधान पर हमेशा साफ़ टिप्पणी लिखें।", "सवय: आधी गंभीर आणि मुदत उलटलेल्या तक्रारी निपटवा, आणि निराकरण करताना नेहमी स्पष्ट टिप लिहा."] as L,
};

export default function StaffGuide({ role, lang = "en" }: { role: "authority" | "admin"; lang?: Lang }) {
  const t = (x: L) => pick(lang, x);
  return <main className="page section how">
    <div className="page-heading"><div><span className="eyebrow">{t(T.eyebrow)}</span><h1>{t(T.title)}</h1><p>{t(role === "admin" ? T.forAdmin : T.forOfficer)}</p></div></div>

    <section className="how-card"><h2>{t(T.journey)}</h2>
      <ol className="how-flow">{STEPS.map(([h, b], k) => <li key={k}><i>{k + 1}</i><b>{t(h)}</b><span>{t(b)}</span></li>)}</ol></section>

    <section className="how-card"><h2>{t(T.priority)}</h2>
      <div className="how-levels">{LEVELS.map(l => <div key={l.key} className={`how-level ${l.cls}`}><img src={IMG(`symbols/${l.symbol}`)} alt="" width={44} height={44} /><b>{tr(lang, l.key)}</b><span>{t(l.when)}</span></div>)}</div></section>

    <section className="how-card"><h2>{t(T.screens)}</h2>
      <div className="how-screens">{SCREENS.map(s => <figure key={s.file} className={s.wide ? "wide" : ""}>
        <img src={IMG(`guide/${s.file}.jpg`)} alt={t(s.title)} loading="lazy" />
        <figcaption><b>{t(s.title)}</b><ul>{s.points.map((p, k) => <li key={k}>{t(p)}</li>)}</ul></figcaption></figure>)}</div></section>

    <section className="how-card"><h2>{t(T.buttons)}</h2>
      <dl className="how-buttons">{BUTTONS.map(([b, w], k) => <div key={k}><dt><span className="secondary compact how-fake">{t(b)}</span></dt><dd>{t(w)}</dd></div>)}</dl></section>

    <section className="how-card"><h2>{t(T.statuses)}</h2>
      <dl className="how-status">{STATUSES.map(([k, v], i) => <div key={i}><dt>{t(k)}</dt><dd>{t(v)}</dd></div>)}</dl></section>

    <section className="how-card"><h2>{t(T.categories)}</h2>
      <div className="how-cats">{CATEGORIES.map(([c, d]) => <div key={c} className="how-cat"><CategoryPhoto category={c} className="cat-photo sm" label={false} /><div><b>{catLabel(lang, c)}</b><small>{deptLabel(lang, d)}</small></div></div>)}</div></section>

    <section className="how-card"><h2>{t(T.who)}</h2>
      <ul className="how-list"><li>{t(T.citizen)}</li><li>{t(T.authority)}</li><li>{t(T.admin)}</li></ul></section>

    <section className="how-card how-tip"><Icon name="shield" size={20} /><p>{t(T.habit)}</p></section>
  </main>;
}
