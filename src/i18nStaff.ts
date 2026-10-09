/* Strings for the authority control room, the admin panel, the duplicate / photo-mismatch steps of the report flow and the
   landing-page guide, in English, Hindi and Marathi. Merged into STR by i18n.ts. Place names stay as written on the map. */

type Row = { en: string; hi: string; mr: string };
export type Lang = "en" | "hi" | "mr";
const T = (en: string, hi: string, mr: string): Row => ({ en, hi, mr });

export const STAFF = {
  /* ---- report flow: photo does not match the category ---- */
  mmTitle: T("Some photos do not match the category", "कुछ फ़ोटो चुनी गई श्रेणी से मेल नहीं खातीं", "काही फोटो निवडलेल्या श्रेणीशी जुळत नाहीत"),
  mmBody: T("Only photos that match your category are sent to the authority. Choose what to do with each one.", "केवल श्रेणी से मेल खाती फ़ोटो ही अधिकारी को भेजी जाती हैं। हर फ़ोटो के लिए चुनें क्या करना है।", "फक्त श्रेणीशी जुळणारे फोटो अधिकाऱ्यांना पाठवले जातात. प्रत्येक फोटोसाठी काय करायचे ते निवडा."),
  mmLooksLike: T("This photo looks like", "यह फ़ोटो दिखती है", "हा फोटो दिसतो"),
  mmNotCivic: T("This photo does not look like a civic problem", "यह फ़ोटो नागरिक समस्या जैसी नहीं दिखती", "हा फोटो नागरी समस्येसारखा दिसत नाही"),
  mmChosen: T("You chose", "आपने चुना", "तुम्ही निवडले"),
  mmNotAttached: T("Not attached", "संलग्न नहीं", "जोडलेला नाही"),
  mmSwitch: T("Change category to", "श्रेणी बदलकर करें", "श्रेणी बदलून करा"),
  mmKeep: T("Keep this photo anyway", "फिर भी यह फ़ोटो रखें", "तरीही हा फोटो ठेवा"),
  needEvidenceAfter: T("No matching photo is attached. Add a matching photo or describe the problem in words to continue.", "कोई मेल खाती फ़ोटो संलग्न नहीं है। आगे बढ़ने के लिए सही फ़ोटो जोड़ें या शब्दों में बताएँ।", "जुळणारा फोटो जोडलेला नाही. पुढे जाण्यासाठी योग्य फोटो जोडा किंवा शब्दांत सांगा."),
  /* ---- report flow: same problem within 50 m ---- */
  dupTitle: T("This problem may already be reported", "यह समस्या शायद पहले ही दर्ज हो चुकी है", "ही समस्या कदाचित आधीच नोंदवली आहे"),
  dupBody: T("A similar open problem is within 50 m of your pin. Upvoting tells the authority more people are affected, without a duplicate report.", "आपके पिन से 50 मीटर के भीतर ऐसी ही खुली समस्या है। अपवोट से अधिकारी को पता चलता है कि और लोग प्रभावित हैं, बिना दोहरी शिकायत के।", "तुमच्या पिनपासून ५० मीटरच्या आत अशीच खुली समस्या आहे. अपव्होट केल्यास दुसरी तक्रार न करता अधिक लोक प्रभावित असल्याचे अधिकाऱ्यांना कळते."),
  dupAffected: T("people affected", "लोग प्रभावित", "लोक प्रभावित"),
  dupAlreadyYours: T("You already reported this one.", "यह शिकायत आप पहले ही दर्ज कर चुके हैं।", "ही तक्रार तुम्ही आधीच नोंदवली आहे."),
  dupAlreadyUpvoted: T("You already upvoted this one.", "आप इसे पहले ही अपवोट कर चुके हैं।", "तुम्ही हे आधीच अपव्होट केले आहे."),
  dupUpvote: T("Upvote this problem", "इस समस्या को अपवोट करें", "या समस्येला अपव्होट करा"),
  dupRaise: T("Raise my own report", "मेरी अपनी शिकायत दर्ज करें", "माझी स्वतःची तक्रार नोंदवा"),
  dupHelp: T("Raising your own report adds your photo and details to the same problem, so the authority sees all of it in one place.", "अपनी शिकायत दर्ज करने पर आपकी फ़ोटो और जानकारी उसी समस्या में जुड़ जाती है, ताकि अधिकारी को सब एक जगह दिखे।", "स्वतःची तक्रार नोंदवल्यास तुमचा फोटो आणि माहिती त्याच समस्येत जोडली जाते, त्यामुळे अधिकाऱ्यांना सर्व एकाच ठिकाणी दिसते."),
  dupFailed: T("Could not upvote. Please try again.", "अपवोट नहीं हो सका। फिर कोशिश करें।", "अपव्होट करता आले नाही. पुन्हा प्रयत्न करा."),
  dupChoose: T("Choose to upvote the existing problem or raise your own report to continue.", "आगे बढ़ने के लिए मौजूदा समस्या को अपवोट करें या अपनी शिकायत दर्ज करें।", "पुढे जाण्यासाठी विद्यमान समस्येला अपव्होट करा किंवा स्वतःची तक्रार नोंदवा."),
  dupDone: T("Upvoted. Thank you!", "अपवोट हो गया। धन्यवाद!", "अपव्होट झाले. धन्यवाद!"),
  voiceNetwork: T("Voice typing needs an internet connection. Please type instead.", "वॉइस टाइपिंग के लिए इंटरनेट चाहिए। कृपया टाइप करें।", "व्हॉइस टायपिंगसाठी इंटरनेट हवे. कृपया टाइप करा."),
  voiceNoMic: T("No microphone was found on this device.", "इस डिवाइस पर माइक्रोफ़ोन नहीं मिला।", "या डिव्हाइसवर मायक्रोफोन सापडला नाही."),

  /* ---- authority: list and cards ---- */
  s_needNow: T("Needs attention now", "अभी ध्यान चाहिए", "आता लक्ष देणे आवश्यक"),
  s_needNowSub: T("Open problems that are critical, or have waited longer than their target time.", "गंभीर खुली समस्याएँ, या जो तय समय से ज़्यादा इंतज़ार कर रही हैं।", "गंभीर खुल्या समस्या, किंवा ठरलेल्या वेळेपेक्षा जास्त वाट पाहणाऱ्या."),
  s_overdueCount: T("overdue", "समय सीमा पार", "मुदत उलटली"),
  s_criticalOpen: T("critical and open", "गंभीर और खुली", "गंभीर आणि खुल्या"),
  s_allClear: T("Nothing urgent right now. Good work.", "अभी कुछ ज़रूरी नहीं। बढ़िया काम।", "आत्ता काहीही तातडीचे नाही. छान काम."),
  s_quick: T("Quick filters", "त्वरित फ़िल्टर", "झटपट फिल्टर"),
  s_qAll: T("All", "सभी", "सर्व"),
  s_qCritical: T("Critical", "गंभीर", "गंभीर"),
  s_qHigh: T("High and above", "उच्च और ऊपर", "उच्च आणि वरील"),
  s_qSchool: T("Near school", "स्कूल के पास", "शाळेजवळ"),
  s_qHospital: T("Near hospital", "अस्पताल के पास", "रुग्णालयाजवळ"),
  s_qNew: T("Not yet reviewed", "अभी देखी नहीं गई", "अजून तपासलेल्या नाहीत"),
  s_openFor: T("Open for", "खुली है", "खुली आहे"),
  s_today: T("< 1 day", "1 दिन से कम", "१ दिवसाहून कमी"),
  s_day: T("day", "दिन", "दिवस"),
  s_days: T("days", "दिन", "दिवस"),
  s_target: T("Target", "लक्ष्य", "लक्ष्य"),
  s_overdueBy: T("Overdue by", "देरी", "उशीर"),
  s_onTime: T("Within target", "समय सीमा में", "मुदतीत"),
  s_closed: T("Closed", "बंद", "बंद"),
  s_people: T("people affected", "लोग प्रभावित", "लोक प्रभावित"),
  s_person: T("person affected", "व्यक्ति प्रभावित", "व्यक्ती प्रभावित"),
  s_dept: T("Department", "विभाग", "विभाग"),
  s_action: T("Recommended action", "सुझाई गई कार्रवाई", "सुचवलेली कृती"),
  s_act_review: T("Review this report first, then send a team.", "पहले इस शिकायत को देखें, फिर टीम भेजें।", "आधी ही तक्रार तपासा, मग पथक पाठवा."),
  s_act_Critical: T("Send a team today. Warn people nearby if it is dangerous.", "आज ही टीम भेजें। खतरनाक हो तो आसपास के लोगों को सावधान करें।", "आजच पथक पाठवा. धोकादायक असल्यास आजूबाजूच्या लोकांना सावध करा."),
  s_act_High: T("Plan a visit within 3 days.", "3 दिन में दौरा तय करें।", "३ दिवसांत भेट ठरवा."),
  s_act_Medium: T("Add it to this week's work plan.", "इसे इस सप्ताह की कार्य योजना में जोड़ें।", "याचा या आठवड्याच्या कामाच्या आराखड्यात समावेश करा."),
  s_act_Low: T("Handle in routine maintenance.", "नियमित रखरखाव में निपटाएँ।", "नियमित देखभालीत हाताळा."),
  s_act_done: T("Resolved. No action needed.", "सुलझ गई। कार्रवाई की ज़रूरत नहीं।", "सोडवली आहे. कृतीची गरज नाही."),
  s_act_progress: T("Work has started. Mark it resolved when the team is done.", "काम शुरू हो गया है। टीम का काम पूरा होने पर 'सुलझी' चिह्नित करें।", "काम सुरू झाले आहे. पथकाचे काम संपल्यावर 'सोडवली' म्हणून नोंदवा."),
  s_startWork: T("Start work", "काम शुरू करें", "काम सुरू करा"),
  s_resolve: T("Mark resolved", "सुलझी चिह्नित करें", "सोडवली म्हणून नोंदवा"),
  s_details: T("Details", "विवरण", "तपशील"),
  s_hideDetails: T("Hide details", "विवरण छिपाएँ", "तपशील लपवा"),
  s_noArea: T("Unknown area", "अज्ञात क्षेत्र", "अज्ञात क्षेत्र"),
  s_autoCheck: T("Auto-check", "स्वचालित जाँच", "स्वयंचलित तपासणी"),
  s_loading: T("Loading…", "लोड हो रहा है…", "लोड होत आहे…"),
  s_updatedAgo: T("Updated", "अपडेट", "अपडेट"),
  s_secAgo: T("s ago", "से पहले", "से. पूर्वी"),
  s_refresh: T("refreshes every 20 s", "हर 20 सेकंड में ताज़ा होता है", "दर २० सेकंदांनी रीफ्रेश होते"),
  s_selectAll: T("Select all", "सभी चुनें", "सर्व निवडा"),
  s_of: T("of", "में से", "पैकी"),
  s_clearFilters: T("Clear filters", "फ़िल्टर हटाएँ", "फिल्टर काढा"),
  s_noMatch: T("No problems match these filters.", "इन फ़िल्टर से कोई समस्या नहीं मिली।", "या फिल्टरशी जुळणारी कोणतीही समस्या नाही."),
  s_loadFail: T("Could not load problems.", "समस्याएँ लोड नहीं हो सकीं।", "समस्या लोड करता आल्या नाहीत."),
  s_retry: T("Retry", "फिर कोशिश करें", "पुन्हा प्रयत्न करा"),
  s_loadMore: T("Load more", "और दिखाएँ", "आणखी दाखवा"),
  s_selected: T("selected", "चुनी गईं", "निवडल्या"),
  s_bulkPlaceholder: T("Message to all selected citizens (optional)", "सभी चुने गए नागरिकों के लिए संदेश (वैकल्पिक)", "निवडलेल्या सर्व नागरिकांसाठी संदेश (ऐच्छिक)"),
  s_message: T("Message", "संदेश", "संदेश"),
  s_resolveAll: T("Resolve all", "सभी सुलझाएँ", "सर्व सोडवा"),
  s_clear: T("Clear", "हटाएँ", "काढा"),
  s_category: T("By category (tap to filter)", "श्रेणी के अनुसार (फ़िल्टर के लिए टैप करें)", "श्रेणीनुसार (फिल्टरसाठी टॅप करा)"),
  s_solved: T("solved", "सुलझी", "सोडवल्या"),
  s_open: T("open", "खुली", "खुल्या"),
  s_critical: T("critical", "गंभीर", "गंभीर"),
  s_citizen: T("citizen", "नागरिक", "नागरिक"),
  s_citizens: T("citizens", "नागरिक", "नागरिक"),
  s_confirmations: T("confirmations", "पुष्टियाँ", "पुष्टी"),
  s_impact: T("Impact", "प्रभाव", "प्रभाव"),
  s_because: T("because", "क्योंकि", "कारण"),
  s_showArea: T("Show this area in the list", "इस क्षेत्र को सूची में दिखाएँ", "हे क्षेत्र यादीत दाखवा"),
  s_hotTip: T("Impact score: 60% worst incident priority + 40% incident count (8 points each, max 100)", "प्रभाव स्कोर: 60% सबसे गंभीर घटना की प्राथमिकता + 40% घटनाओं की संख्या (प्रति घटना 8 अंक, अधिकतम 100)", "प्रभाव गुण: ६०% सर्वात गंभीर घटनेचे प्राधान्य + ४०% घटनांची संख्या (प्रत्येकी ८ गुण, कमाल १००)"),
  s_r_open: T("{n} open incident(s) within 400 m of each other", "{n} खुली घटना(एँ) एक-दूसरे से 400 मी के भीतर", "{n} खुल्या घटना एकमेकांपासून ४०० मीटरच्या आत"),
  s_r_types: T("{n} problem types", "{n} प्रकार की समस्याएँ", "{n} प्रकारच्या समस्या"),
  s_r_crit: T("{n} critical", "{n} गंभीर", "{n} गंभीर"),
  s_r_cit: T("{n} citizens reporting", "{n} नागरिक शिकायत कर रहे हैं", "{n} नागरिक तक्रार करत आहेत"),
  s_r_aff: T("{n} people affected", "{n} लोग प्रभावित", "{n} लोक प्रभावित"),
  s_legendHelp: T("What do these words mean?", "इन शब्दों का क्या मतलब है?", "या शब्दांचा अर्थ काय?"),
  s_g_priority: T("Priority score (0 to 100): how urgent a problem is. 65+ is Critical, 48 to 64 High, 30 to 47 Medium, below 30 Low.", "प्राथमिकता स्कोर (0 से 100): समस्या कितनी ज़रूरी है। 65+ गंभीर, 48 से 64 उच्च, 30 से 47 मध्यम, 30 से कम निम्न।", "प्राधान्य गुण (० ते १००): समस्या किती तातडीची. ६५+ गंभीर, ४८ ते ६४ उच्च, ३० ते ४७ मध्यम, ३० पेक्षा कमी निम्न."),
  s_g_sla: T("Target time: Critical 1 day, High 3 days, Medium 7 days, Low 14 days. After that a problem is shown as overdue.", "लक्ष्य समय: गंभीर 1 दिन, उच्च 3 दिन, मध्यम 7 दिन, निम्न 14 दिन। इसके बाद समस्या 'देरी' दिखती है।", "लक्ष्य वेळ: गंभीर १ दिवस, उच्च ३ दिवस, मध्यम ७ दिवस, निम्न १४ दिवस. त्यानंतर समस्या 'उशीर' म्हणून दिसते."),
  s_g_auto: T("Auto-check: the system compares the photo and the words with known problem types and says how sure it is. It only suggests; the citizen's choice is kept.", "स्वचालित जाँच: सिस्टम फ़ोटो और शब्दों को ज्ञात समस्या प्रकारों से मिलाकर बताता है कि वह कितना आश्वस्त है। यह केवल सुझाव है; नागरिक का चुनाव बना रहता है।", "स्वयंचलित तपासणी: सिस्टम फोटो आणि शब्द ज्ञात समस्या प्रकारांशी जुळवून किती खात्री आहे ते सांगते. हे फक्त सुचवते; नागरिकाची निवड कायम राहते."),
  s_g_cluster: T("Cluster: several open problems close together. One visit may fix them all.", "समूह: पास-पास की कई खुली समस्याएँ। एक दौरे में सब ठीक हो सकती हैं।", "समूह: जवळजवळ असलेल्या अनेक खुल्या समस्या. एका भेटीत सर्व सुटू शकतात."),
  s_g_affected: T("People affected: citizens who reported or upvoted the same problem.", "प्रभावित लोग: जिन नागरिकों ने वही समस्या दर्ज की या अपवोट की।", "प्रभावित लोक: ज्यांनी तीच समस्या नोंदवली किंवा अपव्होट केली ते नागरिक."),

  /* ---- authority: detail ---- */
  s_atGlance: T("At a glance", "एक नज़र में", "एका नजरेत"),
  s_priority: T("Priority", "प्राथमिकता", "प्राधान्य"),
  s_evidence: T("Evidence photo", "प्रमाण फ़ोटो", "पुरावा फोटो"),
  s_noPhoto: T("No photo from the citizen. Showing the category picture.", "नागरिक की कोई फ़ोटो नहीं। श्रेणी की तस्वीर दिखाई जा रही है।", "नागरिकाचा फोटो नाही. श्रेणीचे चित्र दाखवले आहे."),
  s_exampleNote: T("Example photo from the training dataset. Not a citizen report.", "प्रशिक्षण डेटासेट का उदाहरण फ़ोटो। यह नागरिक की शिकायत नहीं है।", "प्रशिक्षण डेटासेटमधील उदाहरण फोटो. नागरिकाची तक्रार नाही."),
  s_reportedBy: T("reported by", "दर्ज करने वाले", "नोंदवणारे"),
  s_loadingReporters: T("loading reporters…", "शिकायतकर्ता लोड हो रहे हैं…", "तक्रारदार लोड होत आहेत…"),
  s_severity: T("severity", "गंभीरता", "गंभीरता"),
  s_location: T("Location", "स्थान", "ठिकाण"),
  s_pointSource: T("pin placed by", "पिन किसने रखा", "पिन कोणी ठेवला"),
  s_notRecorded: T("not recorded", "दर्ज नहीं", "नोंद नाही"),
  s_openMap: T("Open in Map", "नक्शे में खोलें", "नकाशात उघडा"),
  s_whatSystemThinks: T("What the system detected", "सिस्टम ने क्या पहचाना", "सिस्टमने काय ओळखले"),
  s_photoSaid: T("Photo said", "फ़ोटो ने बताया", "फोटोने सांगितले"),
  s_descSaid: T("description said", "विवरण ने बताया", "वर्णनाने सांगितले"),
  s_textRead: T("What the citizen wrote", "नागरिक ने क्या लिखा", "नागरिकाने काय लिहिले"),
  s_duration: T("How long", "कितने समय से", "किती काळ"),
  s_obstruction: T("Blocking", "रुकावट", "अडथळा"),
  s_hazard: T("Who is at risk", "किसे जोखिम है", "कोणाला धोका"),
  s_urgency: T("Urgency", "तत्परता", "तातडी"),
  s_notStated: T("not stated", "नहीं बताया", "सांगितले नाही"),
  s_noDesc: T("No description was written.", "कोई विवरण नहीं लिखा गया।", "कोणतेही वर्णन लिहिले नाही."),
  s_respDept: T("Responsible department", "ज़िम्मेदार विभाग", "जबाबदार विभाग"),
  s_citizenMsg: T("Citizen message", "नागरिक का संदेश", "नागरिकाचा संदेश"),
  s_citizenSays: T("Citizen says", "नागरिक ने कहा", "नागरिक म्हणतो"),
  s_cluster: T("Problem cluster", "समस्या समूह", "समस्या समूह"),
  s_clusterText: T("open problems within {m} m of each other. Several nearby problems usually share a cause, so one visit may cover all of them.", "खुली समस्याएँ एक-दूसरे से {m} मी के भीतर। पास की कई समस्याओं का कारण अक्सर एक ही होता है, इसलिए एक दौरा सबको कवर कर सकता है।", "खुल्या समस्या एकमेकांपासून {m} मीटरच्या आत. जवळच्या अनेक समस्यांचे कारण बहुधा एकच असते, म्हणून एक भेट सर्वांना पुरेशी ठरू शकते."),
  s_whyPriority: T("Why this priority", "यह प्राथमिकता क्यों", "हे प्राधान्य का"),
  s_loadDetailFail: T("Could not load the detail.", "विवरण लोड नहीं हो सका।", "तपशील लोड करता आला नाही."),
  s_timeline: T("Progress so far", "अब तक की प्रगति", "आतापर्यंतची प्रगती"),
  s_messages: T("Messages", "संदेश", "संदेश"),
  s_noMessages: T("No messages yet.", "अभी कोई संदेश नहीं।", "अजून संदेश नाहीत."),
  s_writeMsg: T("Write a message to the citizen (optional)", "नागरिक को संदेश लिखें (वैकल्पिक)", "नागरिकाला संदेश लिहा (ऐच्छिक)"),
  s_sendMsg: T("Send message", "संदेश भेजें", "संदेश पाठवा"),
  s_underReview: T("Under review", "समीक्षा में", "तपासणीत"),
  s_inProgressBtn: T("In progress", "काम जारी", "काम सुरू"),
  s_readOnly: T("Read-only view. Status changes and messages are handled by the authority control room.", "केवल देखने के लिए। स्थिति बदलना और संदेश प्राधिकरण नियंत्रण कक्ष से होता है।", "फक्त पाहण्यासाठी. स्थिती बदल आणि संदेश प्राधिकरण नियंत्रण कक्षातून होतात."),
  s_noAi: T("No automatic check. The citizen chose the category.", "कोई स्वचालित जाँच नहीं। श्रेणी नागरिक ने चुनी।", "स्वयंचलित तपासणी नाही. श्रेणी नागरिकाने निवडली."),
  s_looksLike: T("Looks like", "दिखता है", "दिसते"),
  s_sure: T("sure", "आश्वस्त", "खात्री"),
  s_srcPhoto: T("from the photo", "फ़ोटो से", "फोटोवरून"),
  s_srcText: T("from the description", "विवरण से", "वर्णनावरून"),
  s_srcBoth: T("from photo and description", "फ़ोटो और विवरण से", "फोटो आणि वर्णनावरून"),
  s_agree: T("photo and words agree", "फ़ोटो और शब्द मेल खाते हैं", "फोटो आणि शब्द जुळतात"),
  s_disagree: T("please verify: photo and words disagree", "कृपया जाँचें: फ़ोटो और शब्द मेल नहीं खाते", "कृपया तपासा: फोटो आणि शब्द जुळत नाहीत"),
  s_changedCat: T("citizen changed the category", "नागरिक ने श्रेणी बदली", "नागरिकाने श्रेणी बदलली"),
  s_textUrgency: T("urgency from words", "शब्दों से तत्परता", "शब्दांवरून तातडी"),
  s_exampleChip: T("Example photo", "उदाहरण फ़ोटो", "उदाहरण फोटो"),
  s_by: T("by", "द्वारा", "द्वारे"),

  /* ---- map dashboard ---- */
  m_title: T("Problem map", "समस्या नक्शा", "समस्या नकाशा"),
  m_openOf: T("open of", "खुली, कुल", "खुल्या, एकूण"),
  m_problems: T("problems", "समस्याएँ", "समस्या"),
  m_resolved: T("Resolved", "सुलझी", "सोडवलेल्या"),
  m_cluster: T("Cluster", "समूह", "समूह"),
  m_allCats: T("All categories", "सभी श्रेणियाँ", "सर्व श्रेणी"),
  m_showResolved: T("Show resolved", "सुलझी दिखाएँ", "सोडवलेल्या दाखवा"),
  m_showClusters: T("Problem clusters", "समस्या समूह", "समस्या समूह"),
  m_loadFail: T("Could not load the map.", "नक्शा लोड नहीं हो सका।", "नकाशा लोड करता आला नाही."),
  m_clusterNote: T("Rings show where at least {n} open problems sit within {m} m of each other. It shows where problems pile up; it does not predict anything.", "घेरे वहाँ दिखाते हैं जहाँ कम से कम {n} खुली समस्याएँ एक-दूसरे से {m} मी के भीतर हैं। यह दिखाता है कि समस्याएँ कहाँ जमा हैं; कोई भविष्यवाणी नहीं करता।", "वर्तुळे जिथे किमान {n} खुल्या समस्या एकमेकांपासून {m} मीटरच्या आत आहेत ते दाखवतात. समस्या कुठे साचत आहेत ते दिसते; कोणताही अंदाज नाही."),
  m_noClusters: T("No clusters in this view.", "इस दृश्य में कोई समूह नहीं।", "या दृश्यात कोणताही समूह नाही."),
  m_clustersFound: T("clusters found.", "समूह मिले।", "समूह सापडले."),
  m_noneHere: T("No problems in this view.", "इस दृश्य में कोई समस्या नहीं।", "या दृश्यात कोणतीही समस्या नाही."),
  m_showMore: T("Show more", "और दिखाएँ", "आणखी दाखवा"),
  m_left: T("left", "शेष", "उरलेल्या"),
  m_close: T("Close", "बंद करें", "बंद करा"),
  m_inCluster: T("in a cluster", "समूह में", "समूहात"),
  m_done: T("done", "पूर्ण", "पूर्ण"),
  m_mapLoading: T("Loading map…", "नक्शा लोड हो रहा है…", "नकाशा लोड होत आहे…"),
  m_truncated: T("(showing the first 3000)", "(पहली 3000 दिखाई गईं)", "(पहिल्या ३००० दाखवल्या)"),

  /* ---- admin ---- */
  a_noArea: T("No area", "कोई क्षेत्र नहीं", "क्षेत्र नाही"),
  a_requested: T("Requested", "अनुरोध", "विनंती"),
  a_loadFail: T("Could not load accounts.", "खाते लोड नहीं हो सके।", "खाती लोड करता आली नाहीत."),
  a_overviewFail: T("Could not load the overview.", "सार लोड नहीं हो सका।", "आढावा लोड करता आला नाही."),
  a_noPending: T("No pending requests.", "कोई लंबित अनुरोध नहीं।", "प्रलंबित विनंत्या नाहीत."),
  a_noApproved: T("No approved authorities yet.", "अभी कोई मंज़ूर प्राधिकरण नहीं।", "अजून मंजूर प्राधिकरणे नाहीत."),
  a_noOpen: T("No open problems.", "कोई खुली समस्या नहीं।", "खुल्या समस्या नाहीत."),
  a_noHot: T("No open problems with a known area.", "ज्ञात क्षेत्र वाली कोई खुली समस्या नहीं।", "ज्ञात क्षेत्र असलेली खुली समस्या नाही."),
  a_openWord: T("open", "खुली", "खुल्या"),
  a_critWord: T("critical", "गंभीर", "गंभीर"),
  a_whatToDo: T("What to do next", "आगे क्या करें", "पुढे काय करावे"),
  a_whatToDoSub: T("Plain suggestions from the numbers above. Nothing is assigned automatically.", "ऊपर के आँकड़ों से सरल सुझाव। कुछ भी अपने-आप नहीं सौंपा जाता।", "वरील आकड्यांवरून सोपे सुझाव. काहीही आपोआप सोपवले जात नाही."),
  a_busiest: T("Busiest department", "सबसे व्यस्त विभाग", "सर्वात व्यस्त विभाग"),
  a_biggestCat: T("Biggest problem type", "सबसे बड़ी समस्या का प्रकार", "सर्वात मोठा समस्या प्रकार"),
  a_worstArea: T("Area needing attention", "ध्यान चाहने वाला क्षेत्र", "लक्ष हवे असलेले क्षेत्र"),
  a_seeInList: T("Open the problem map below to see them.", "देखने के लिए नीचे समस्या नक्शा खोलें।", "पाहण्यासाठी खालील समस्या नकाशा उघडा."),
} satisfies Record<string, Row>;

/* ---------- display names for values the API sends in English ---------- */

const CAT: Record<string, { hi: string; mr: string }> = {
  Pothole: { hi: "गड्ढे और सड़क क्षति", mr: "खड्डे आणि रस्त्याचे नुकसान" }, Streetlight: { hi: "खराब स्ट्रीटलाइट", mr: "बिघडलेले पथदिवे" },
  Garbage: { hi: "कचरा और अपशिष्ट", mr: "कचरा आणि टाकाऊ पदार्थ" }, "Water Leakage": { hi: "पानी और जल निकासी", mr: "पाणी आणि गटारे" },
  "Electrical Hazard": { hi: "बिजली का खतरा", mr: "विजेचा धोका" }, Other: { hi: "अन्य नागरिक समस्याएँ", mr: "इतर नागरी समस्या" },
};
const MERGED: Record<string, string> = { "Road Damage": "Pothole", Drainage: "Water Leakage" };
const EN_CAT: Record<string, string> = {
  Pothole: "Potholes & Road Damage", Garbage: "Garbage & Waste", Streetlight: "Broken Streetlights",
  "Water Leakage": "Water & Drainage", "Electrical Hazard": "Electrical Hazards", Other: "Other Civic Issues",
};
export const catLabel = (lang: Lang, name: string): string => { const k = MERGED[name] ?? name; return lang === "en" ? EN_CAT[k] ?? name : CAT[k]?.[lang] ?? EN_CAT[k] ?? name; };

const FLAG: Record<string, { hi: string; mr: string }> = {
  "Live wiring": { hi: "खुले तार", mr: "उघड्या तारा" }, "Injury reported": { hi: "चोट की सूचना", mr: "दुखापतीची नोंद" }, "Near school": { hi: "स्कूल के पास", mr: "शाळेजवळ" },
  "Near hospital": { hi: "अस्पताल के पास", mr: "रुग्णालयाजवळ" }, "Flood risk": { hi: "बाढ़ का खतरा", mr: "पुराचा धोका" }, "Main road": { hi: "मुख्य सड़क", mr: "मुख्य रस्ता" },
  "Night-time hazard": { hi: "रात का खतरा", mr: "रात्रीचा धोका" }, "Blocks footpath": { hi: "फुटपाथ बंद", mr: "पदपथ अडवतो" },
};
export const flagLabel = (lang: Lang, f: string): string => (lang === "en" ? f : FLAG[f]?.[lang] ?? f);

const DEPT: Record<string, { hi: string; mr: string }> = {
  "Roads & Traffic": { hi: "सड़क और यातायात", mr: "रस्ते आणि वाहतूक" }, "Street Lighting": { hi: "स्ट्रीट लाइटिंग", mr: "पथदिवे" },
  "Solid Waste Management": { hi: "ठोस कचरा प्रबंधन", mr: "घनकचरा व्यवस्थापन" }, "Water Supply": { hi: "जलापूर्ति", mr: "पाणीपुरवठा" },
  "Storm Water Drains": { hi: "वर्षा जल नालियाँ", mr: "पावसाळी गटारे" }, "Electrical Safety": { hi: "विद्युत सुरक्षा", mr: "विद्युत सुरक्षा" },
  "General / Ward Office": { hi: "सामान्य / वार्ड कार्यालय", mr: "सामान्य / वॉर्ड कार्यालय" },
};
export const deptLabel = (lang: Lang, d: string | null | undefined): string => (!d ? "—" : lang === "en" ? d : DEPT[d]?.[lang] ?? d);

const HAZ: Record<string, { hi: string; mr: string }> = {
  "two-wheelers": { hi: "दोपहिया वाहन", mr: "दुचाकी" }, vehicles: { hi: "वाहन", mr: "वाहने" }, children: { hi: "बच्चे", mr: "मुले" },
  "live wire": { hi: "खुला तार", mr: "उघडी तार" }, water: { hi: "पानी", mr: "पाणी" }, elderly: { hi: "बुज़ुर्ग", mr: "ज्येष्ठ" },
};
export const hazardLabel = (lang: Lang, h: string): string => (lang === "en" ? h : HAZ[h]?.[lang] ?? h);
const OBS: Record<string, { en: string; hi: string; mr: string }> = {
  road: { en: "the road", hi: "सड़क", mr: "रस्ता" }, footpath: { en: "the footpath", hi: "फुटपाथ", mr: "पदपथ" }, entrance: { en: "an entrance", hi: "प्रवेश द्वार", mr: "प्रवेशद्वार" },
};
export const obstructionLabel = (lang: Lang, o: string): string => OBS[o]?.[lang] ?? o;

const UNIT: Record<string, { hi: string; mr: string }> = {
  day: { hi: "दिन", mr: "दिवस" }, week: { hi: "सप्ताह", mr: "आठवडे" }, month: { hi: "महीने", mr: "महिने" }, hour: { hi: "घंटे", mr: "तास" },
};
const SINCE: Record<string, { hi: string; mr: string }> = {
  "since last week": { hi: "पिछले सप्ताह से", mr: "गेल्या आठवड्यापासून" }, "since yesterday": { hi: "कल से", mr: "कालपासून" }, "since last month": { hi: "पिछले महीने से", mr: "गेल्या महिन्यापासून" },
};
/** "4 days" / "since yesterday" as produced by the text rules, shown in the viewer's language. */
export const durationLabel = (lang: Lang, d: string): string => {
  if (lang === "en") return d;
  if (SINCE[d]) return SINCE[d][lang];
  const m = /^(\d+(?:\.\d+)?) (day|week|month|hour)s?$/.exec(d);
  return m ? `${m[1]} ${UNIT[m[2]][lang]}` : d;
};

/** Priority reason labels come from the API in English ("High severity", "Pothole hazard type", "Near school"). */
export const reasonLabel = (lang: Lang, label: string, sev: (s: string) => string): string => {
  if (lang === "en") return label;
  let m = /^(Critical|High|Medium|Low) severity$/.exec(label);
  if (m) return `${sev(m[1])} ${lang === "hi" ? "गंभीरता" : "गंभीरता"}`;
  m = /^(.+) hazard type$/.exec(label);
  if (m) return `${catLabel(lang, m[1])} ${lang === "hi" ? "का जोखिम प्रकार" : "धोक्याचा प्रकार"}`;
  m = /^Open for (\d+) days$/.exec(label);
  if (m) return lang === "hi" ? `${m[1]} दिन से खुली` : `${m[1]} दिवसांपासून खुली`;
  m = /^(\d+) citizens affected$/.exec(label);
  if (m) return lang === "hi" ? `${m[1]} नागरिक प्रभावित` : `${m[1]} नागरिक प्रभावित`;
  return flagLabel(lang, label);
};

/* ---------- landing page: how it works + FAQ ---------- */

export const HOW_STEPS: { icon: string; title: Row; body: Row }[] = [
  { icon: "plus", title: T("1. Pick the problem", "1. समस्या चुनें", "१. समस्या निवडा"), body: T("Choose up to 3 categories: pothole, garbage, streetlight, water leak, electrical hazard or other. Tap the picture that looks closest.", "3 तक श्रेणियाँ चुनें: गड्ढा, कचरा, स्ट्रीटलाइट, पानी रिसाव, बिजली का खतरा या अन्य। सबसे मिलती तस्वीर पर टैप करें।", "३ पर्यंत श्रेणी निवडा: खड्डा, कचरा, पथदिवा, पाणी गळती, विजेचा धोका किंवा इतर. सर्वात जवळच्या चित्रावर टॅप करा.") },
  { icon: "mic", title: T("2. Answer, type or speak", "2. उत्तर दें, लिखें या बोलें", "२. उत्तर द्या, लिहा किंवा बोला"), body: T("Tap a few quick answers. Add a short description by typing, or press the microphone and speak in English, Hindi or Marathi.", "कुछ छोटे उत्तर चुनें। लिखकर छोटा विवरण दें, या माइक दबाकर अंग्रेज़ी, हिंदी या मराठी में बोलें।", "काही छोटी उत्तरे निवडा. लिहून थोडक्यात वर्णन द्या, किंवा माइक दाबून इंग्रजी, हिंदी किंवा मराठीत बोला.") },
  { icon: "camera", title: T("3. Add photos and the exact spot", "3. फ़ोटो और सही जगह जोड़ें", "३. फोटो आणि अचूक जागा जोडा"), body: T("Add up to 3 photos. If a photo does not match your category we tell you and leave it out. Then drop the pin on the exact spot, or use your GPS.", "3 तक फ़ोटो जोड़ें। अगर कोई फ़ोटो श्रेणी से मेल नहीं खाती तो हम बताते हैं और उसे छोड़ देते हैं। फिर सही जगह पर पिन रखें या GPS इस्तेमाल करें।", "३ पर्यंत फोटो जोडा. एखादा फोटो श्रेणीशी जुळत नसल्यास आम्ही सांगतो आणि तो वगळतो. मग अचूक जागी पिन ठेवा किंवा GPS वापरा.") },
  { icon: "check", title: T("4. Review and check for duplicates", "4. जाँचें और दोहराव देखें", "४. तपासा आणि पुनरावृत्ती पहा"), body: T("We show what the system understood. If the same problem is already open within 50 m, you can upvote it instead of reporting again, or raise your own report.", "हम दिखाते हैं कि सिस्टम ने क्या समझा। अगर वही समस्या 50 मी के भीतर पहले से खुली है, तो दोबारा शिकायत करने के बजाय अपवोट कर सकते हैं, या अपनी शिकायत दर्ज कर सकते हैं।", "सिस्टमने काय समजले ते आम्ही दाखवतो. तीच समस्या ५० मीटरच्या आत आधीच खुली असल्यास पुन्हा तक्रार करण्याऐवजी अपव्होट करू शकता, किंवा स्वतःची तक्रार नोंदवू शकता.") },
  { icon: "shield", title: T("5. The right team is alerted", "5. सही टीम को सूचना जाती है", "५. योग्य पथकाला सूचना जाते"), body: T("The report goes to the responsible department with a priority score, so dangerous problems near schools, hospitals and main roads come first.", "शिकायत प्राथमिकता स्कोर के साथ ज़िम्मेदार विभाग को जाती है, ताकि स्कूल, अस्पताल और मुख्य सड़कों के पास के खतरनाक मामले पहले आएँ।", "तक्रार प्राधान्य गुणांसह जबाबदार विभागाकडे जाते, त्यामुळे शाळा, रुग्णालये आणि मुख्य रस्त्यांजवळच्या धोकादायक समस्या आधी येतात.") },
  { icon: "reports", title: T("6. Track it to the end", "6. अंत तक ट्रैक करें", "६. शेवटपर्यंत मागोवा घ्या"), body: T("Open My Reports to see each status (Pending, Under review, In progress, Resolved) and read messages from the authority.", "हर स्थिति (लंबित, समीक्षा में, काम जारी, सुलझी) देखने और अधिकारी के संदेश पढ़ने के लिए मेरी शिकायतें खोलें।", "प्रत्येक स्थिती (प्रलंबित, तपासणीत, काम सुरू, सोडवली) पाहण्यासाठी आणि अधिकाऱ्यांचे संदेश वाचण्यासाठी माझ्या तक्रारी उघडा.") },
];

export const HOW_TIPS: Row[] = [
  T("Stand where the problem is and use GPS, or tap the exact spot on the map.", "समस्या वाली जगह पर खड़े होकर GPS इस्तेमाल करें, या नक्शे पर सही जगह टैप करें।", "समस्येच्या जागी उभे राहून GPS वापरा, किंवा नकाशावर अचूक जागी टॅप करा."),
  T("Take clear daylight photos with the problem in the middle of the frame.", "दिन की रोशनी में साफ़ फ़ोटो लें, समस्या फ़्रेम के बीच में हो।", "दिवसाच्या प्रकाशात स्पष्ट फोटो घ्या, समस्या फ्रेमच्या मध्यभागी असावी."),
  T("Say if children, vehicles or elderly people are at risk. It raises the priority.", "बताएँ कि बच्चे, वाहन या बुज़ुर्ग खतरे में हैं। इससे प्राथमिकता बढ़ती है।", "मुले, वाहने किंवा ज्येष्ठ धोक्यात असल्यास सांगा. त्यामुळे प्राधान्य वाढते."),
  T("Mention how many days it has been there. Older problems rise in the list.", "बताएँ कि समस्या कितने दिनों से है। पुरानी समस्याएँ सूची में ऊपर आती हैं।", "समस्या किती दिवसांपासून आहे ते सांगा. जुन्या समस्या यादीत वर येतात."),
  T("For live wires or injuries, call 112 first, then report here.", "खुले तार या चोट के मामले में पहले 112 पर कॉल करें, फिर यहाँ शिकायत करें।", "उघड्या तारा किंवा दुखापत असल्यास आधी ११२ वर कॉल करा, मग येथे तक्रार करा."),
];

export const FAQS: [Row, Row][] = [
  [T("What can I report?", "मैं क्या शिकायत कर सकता/सकती हूँ?", "मी कशाची तक्रार करू शकतो/शकते?"), T("Potholes and road damage, streetlights, waste, water and drainage, electrical hazards and other public-space issues.", "गड्ढे और सड़क क्षति, स्ट्रीटलाइट, कचरा, पानी और जल निकासी, बिजली के खतरे और सार्वजनिक स्थान की अन्य समस्याएँ।", "खड्डे आणि रस्त्याचे नुकसान, पथदिवे, कचरा, पाणी आणि गटारे, विजेचे धोके आणि सार्वजनिक जागेतील इतर समस्या.")],
  [T("Do I need an account?", "क्या खाता बनाना ज़रूरी है?", "खाते आवश्यक आहे का?"), T("Yes, a free citizen account, so the authority can reply to you and you can track your reports. Your phone number is never shown publicly.", "हाँ, एक मुफ़्त नागरिक खाता, ताकि अधिकारी आपको जवाब दे सकें और आप अपनी शिकायतें ट्रैक कर सकें। आपका फ़ोन नंबर सार्वजनिक नहीं दिखता।", "होय, मोफत नागरिक खाते, जेणेकरून अधिकारी तुम्हाला उत्तर देऊ शकतील आणि तुम्ही तक्रारींचा मागोवा घेऊ शकाल. तुमचा फोन नंबर सार्वजनिक दिसत नाही.")],
  [T("Can I choose the location manually?", "क्या मैं जगह खुद चुन सकता/सकती हूँ?", "मी ठिकाण स्वतः निवडू शकतो/शकते का?"), T("Yes. Tap the map, drag the pin, or use your GPS. The pin you place is exactly what the authority sees.", "हाँ। नक्शे पर टैप करें, पिन खींचें या GPS इस्तेमाल करें। आपका रखा पिन ही अधिकारी को दिखता है।", "होय. नकाशावर टॅप करा, पिन ओढा किंवा GPS वापरा. तुम्ही ठेवलेला पिनच अधिकाऱ्यांना दिसतो.")],
  [T("What if my photo does not match the category?", "अगर मेरी फ़ोटो श्रेणी से मेल न खाए तो?", "माझा फोटो श्रेणीशी जुळला नाही तर?"), T("We check each photo. A photo that clearly shows something else is not attached, and we ask you to switch the category, keep the photo or remove it.", "हम हर फ़ोटो जाँचते हैं। जो फ़ोटो साफ़ तौर पर कुछ और दिखाती है उसे संलग्न नहीं किया जाता, और हम आपसे श्रेणी बदलने, फ़ोटो रखने या हटाने को कहते हैं।", "आम्ही प्रत्येक फोटो तपासतो. जो फोटो स्पष्टपणे दुसरेच काही दाखवतो तो जोडला जात नाही, आणि श्रेणी बदलायची, फोटो ठेवायचा की काढायचा ते विचारतो.")],
  [T("Someone already reported the same problem. What now?", "किसी ने वही समस्या पहले ही दर्ज की है। अब क्या करें?", "कोणीतरी तीच समस्या आधीच नोंदवली आहे. आता काय?"), T("If it is within 50 m you can upvote it, which adds you to the people affected, or raise your own report with your photo and details.", "अगर यह 50 मी के भीतर है तो आप अपवोट कर सकते हैं, जिससे आप प्रभावित लोगों में जुड़ जाते हैं, या अपनी फ़ोटो और जानकारी के साथ अपनी शिकायत दर्ज कर सकते हैं।", "५० मीटरच्या आत असल्यास तुम्ही अपव्होट करू शकता, ज्यामुळे तुम्ही प्रभावित लोकांत जोडले जाता, किंवा फोटो आणि माहितीसह स्वतःची तक्रार नोंदवू शकता.")],
  [T("Can I speak instead of typing?", "क्या मैं टाइप करने के बजाय बोल सकता/सकती हूँ?", "टाइप करण्याऐवजी मी बोलू शकतो/शकते का?"), T("Yes. Press the microphone in the questions step and speak in English, Hindi or Marathi. It works best in Chrome or Edge with an internet connection and microphone permission.", "हाँ। प्रश्नों वाले चरण में माइक दबाएँ और अंग्रेज़ी, हिंदी या मराठी में बोलें। यह इंटरनेट और माइक अनुमति के साथ Chrome या Edge में सबसे अच्छा चलता है।", "होय. प्रश्नांच्या टप्प्यात माइक दाबा आणि इंग्रजी, हिंदी किंवा मराठीत बोला. इंटरनेट आणि माइक परवानगीसह Chrome किंवा Edge मध्ये उत्तम चालते.")],
  [T("How is the priority decided?", "प्राथमिकता कैसे तय होती है?", "प्राधान्य कसे ठरते?"), T("By a fixed score from 0 to 100: how dangerous it is, the type of problem, risks nearby (school, hospital, main road), how long it has been open and how many people are affected. Votes are only a small part.", "0 से 100 के तय स्कोर से: कितना खतरनाक है, समस्या का प्रकार, आसपास का जोखिम (स्कूल, अस्पताल, मुख्य सड़क), कितने समय से खुली है और कितने लोग प्रभावित हैं। वोट केवल छोटा हिस्सा हैं।", "० ते १०० च्या ठरलेल्या गुणांनी: किती धोकादायक, समस्येचा प्रकार, जवळचे धोके (शाळा, रुग्णालय, मुख्य रस्ता), किती काळ खुली आणि किती लोक प्रभावित. मते फक्त थोडा भाग आहेत.")],
  [T("How long will it take to fix?", "ठीक होने में कितना समय लगेगा?", "दुरुस्त व्हायला किती वेळ लागेल?"), T("It depends on the department. Critical problems should be visited within a day, high within 3 days. You will see every status change in My Reports.", "यह विभाग पर निर्भर है। गंभीर समस्याओं पर एक दिन में, उच्च पर 3 दिन में दौरा होना चाहिए। हर स्थिति बदलाव मेरी शिकायतें में दिखेगा।", "हे विभागावर अवलंबून आहे. गंभीर समस्यांना एका दिवसात, उच्च समस्यांना ३ दिवसांत भेट व्हावी. प्रत्येक स्थिती बदल माझ्या तक्रारींत दिसेल.")],
  [T("Does iREPORT automatically contact BMC?", "क्या iREPORT अपने-आप BMC से संपर्क करता है?", "iREPORT आपोआप BMC शी संपर्क साधते का?"), T("Not unless a verified authority integration is active. Approved authority officers see your report in their control room, and we always show the delivery state clearly.", "जब तक सत्यापित प्राधिकरण एकीकरण सक्रिय न हो, नहीं। स्वीकृत अधिकारी आपकी शिकायत अपने नियंत्रण कक्ष में देखते हैं, और हम स्थिति साफ़ दिखाते हैं।", "सत्यापित प्राधिकरण एकत्रीकरण सक्रिय असल्याशिवाय नाही. मंजूर अधिकारी तुमची तक्रार त्यांच्या नियंत्रण कक्षात पाहतात, आणि आम्ही स्थिती स्पष्ट दाखवतो.")],
  [T("Who can see my report and photos?", "मेरी शिकायत और फ़ोटो कौन देख सकता है?", "माझी तक्रार आणि फोटो कोण पाहू शकते?"), T("The community sees the problem, area and status, never your name, email or phone. Approved authority officers see the details they need to act.", "समुदाय को समस्या, क्षेत्र और स्थिति दिखती है, आपका नाम, ईमेल या फ़ोन कभी नहीं। स्वीकृत अधिकारी कार्रवाई के लिए ज़रूरी जानकारी देखते हैं।", "समुदायाला समस्या, क्षेत्र आणि स्थिती दिसते, तुमचे नाव, ईमेल किंवा फोन कधीही नाही. मंजूर अधिकारी कारवाईसाठी आवश्यक तपशील पाहतात.")],
  [T("Can I report something outside Mumbai city?", "क्या मैं मुंबई शहर के बाहर की समस्या दर्ज कर सकता/सकती हूँ?", "मी मुंबई शहराबाहेरील समस्या नोंदवू शकतो/शकते का?"), T("Yes, across the Mumbai region, including Thane, Kalyan, Dombivli, Navi Mumbai, Mira Road, Vasai and Panvel. The area is worked out from your pin.", "हाँ, ठाणे, कल्याण, डोंबिवली, नवी मुंबई, मीरा रोड, वसई और पनवेल सहित पूरे मुंबई क्षेत्र में। क्षेत्र आपके पिन से तय होता है।", "होय, ठाणे, कल्याण, डोंबिवली, नवी मुंबई, मीरा रोड, वसई आणि पनवेलसह संपूर्ण मुंबई प्रदेशात. क्षेत्र तुमच्या पिनवरून ठरते.")],
  [T("Why can I not submit?", "मैं जमा क्यों नहीं कर पा रहा/रही?", "मी सबमिट का करू शकत नाही?"), T("You need a location pin and either a matching photo or a description. If a similar problem is within 50 m, choose to upvote or raise your own report first.", "आपको स्थान पिन और या तो मेल खाती फ़ोटो या विवरण चाहिए। अगर 50 मी के भीतर ऐसी ही समस्या है, तो पहले अपवोट या अपनी शिकायत चुनें।", "तुम्हाला ठिकाण पिन आणि जुळणारा फोटो किंवा वर्णन हवे. ५० मीटरच्या आत अशीच समस्या असल्यास आधी अपव्होट किंवा स्वतःची तक्रार निवडा.")],
  [T("Who do I call in an emergency?", "आपातकाल में किसे कॉल करें?", "आणीबाणीत कोणाला कॉल करावा?"), T("Call 112 for emergencies. For civic complaints, the BMC helpline is 1916 (24x7).", "आपातकाल में 112 पर कॉल करें। नागरिक शिकायतों के लिए BMC हेल्पलाइन 1916 (24x7) है।", "आणीबाणीत ११२ वर कॉल करा. नागरी तक्रारींसाठी BMC हेल्पलाइन १९१६ (२४x७) आहे.")],
  [T("Is iREPORT an official BMC website?", "क्या iREPORT BMC की आधिकारिक वेबसाइट है?", "iREPORT ही BMC ची अधिकृत वेबसाइट आहे का?"), T("No. It is an independent citizen platform built for Metropolitan Mumbai.", "नहीं। यह महानगर मुंबई के लिए बना एक स्वतंत्र नागरिक मंच है।", "नाही. हे महानगर मुंबईसाठी बनवलेले स्वतंत्र नागरिक व्यासपीठ आहे.")],
];

export const HOW_UI = {
  eyebrow: T("HOW IT WORKS", "यह कैसे काम करता है", "हे कसे काम करते"),
  title: T("From a problem on your street to a fix, in 6 steps", "आपकी गली की समस्या से समाधान तक, 6 चरणों में", "तुमच्या गल्लीतील समस्येपासून उपायापर्यंत, ६ टप्प्यांत"),
  sub: T("No department names. No long forms. Here is everything you need to use iREPORT well.", "न विभाग के नाम, न लंबे फॉर्म। iREPORT को अच्छे से इस्तेमाल करने के लिए सब कुछ यहाँ है।", "विभागांची नावे नाहीत, मोठे फॉर्म नाहीत. iREPORT उत्तम वापरण्यासाठी सर्व काही येथे आहे."),
  tips: T("Tips for a report that gets fixed faster", "जल्दी समाधान वाली शिकायत के लिए सुझाव", "लवकर निराकरण होणाऱ्या तक्रारीसाठी सुझाव"),
  after: T("What happens after you report", "शिकायत के बाद क्या होता है", "तक्रार केल्यावर काय होते"),
  after1: T("Reported", "दर्ज", "नोंदवली"), after2: T("Under review", "समीक्षा में", "तपासणीत"), after3: T("In progress", "काम जारी", "काम सुरू"), after4: T("Resolved", "सुलझी", "सोडवली"),
  afterNote: T("You can see each change in My Reports and get messages from the authority.", "हर बदलाव आप मेरी शिकायतें में देख सकते हैं और अधिकारी से संदेश पा सकते हैं।", "प्रत्येक बदल तुम्ही माझ्या तक्रारींत पाहू शकता आणि अधिकाऱ्यांकडून संदेश मिळवू शकता."),
  start: T("Start a report", "शिकायत शुरू करें", "तक्रार सुरू करा"),
  faqTitle: T("Common questions", "आम तौर पर पूछे जाने वाले प्रश्न", "नेहमी विचारले जाणारे प्रश्न"),
  faqEyebrow: T("HELP & FAQ", "सहायता और FAQ", "मदत आणि FAQ"),
  navHow: T("How it works", "कैसे काम करता है", "कसे काम करते"),
  navFaq: T("FAQ", "FAQ", "FAQ"),
} satisfies Record<string, Row>;
