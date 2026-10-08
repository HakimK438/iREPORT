/* Strings for the citizen flow (home categories, report steps, review, AI card, success, profile) in English,
   Hindi and Marathi. Same approach as the `copy` object in App.tsx: a table keyed by language, no library. */

export type Lang = "en" | "hi" | "mr";
type Row = { en: string; hi: string; mr: string };

const T = (en: string, hi: string, mr: string): Row => ({ en, hi, mr });

export const STR = {
  // steps
  stepProblem: T("Problem", "समस्या", "समस्या"),
  stepQuestions: T("Questions", "प्रश्न", "प्रश्न"),
  stepPhoto: T("Photo", "फ़ोटो", "फोटो"),
  stepLocation: T("Location", "स्थान", "ठिकाण"),
  stepReview: T("Review", "समीक्षा", "तपासणी"),
  stepDone: T("Done", "पूर्ण", "पूर्ण"),
  back: T("Back", "वापस", "मागे"),
  next: T("Continue", "आगे बढ़ें", "पुढे जा"),
  close: T("Close (your draft is kept)", "बंद करें (ड्राफ्ट सुरक्षित रहेगा)", "बंद करा (मसुदा जतन राहील)"),
  draftKept: T("Your draft was kept.", "आपका ड्राफ्ट सुरक्षित है।", "तुमचा मसुदा जतन केला आहे."),
  startOver: T("Start over", "फिर से शुरू करें", "पुन्हा सुरू करा"),
  // step 1
  whatNeeds: T("What needs attention?", "किस पर ध्यान चाहिए?", "कशाकडे लक्ष हवे?"),
  pickCategory: T("Select the closest category. You can change it later.", "सबसे नज़दीकी श्रेणी चुनें। बाद में बदल सकते हैं।", "सर्वात जवळची श्रेणी निवडा. नंतर बदलता येईल."),
  // step 2
  fewQuestions: T("A few quick questions", "कुछ छोटे प्रश्न", "काही छोटे प्रश्न"),
  tapAnswer: T("Tap an answer. No typing needed.", "उत्तर चुनें। टाइप करने की ज़रूरत नहीं।", "उत्तर निवडा. टाइप करण्याची गरज नाही."),
  // step 3
  showProblem: T("Show us the problem", "हमें समस्या दिखाएँ", "आम्हाला समस्या दाखवा"),
  photoHelp: T("Add up to 3 photos, or describe it by typing or voice.", "3 तक फ़ोटो जोड़ें, या लिखकर/बोलकर बताएँ।", "3 पर्यंत फोटो जोडा, किंवा लिहून/बोलून सांगा."),
  takePhoto: T("Take Photo", "फ़ोटो लें", "फोटो काढा"),
  uploadPhoto: T("Upload Photo", "फ़ोटो अपलोड करें", "फोटो अपलोड करा"),
  voice: T("Tell us by Voice", "बोलकर बताएँ", "बोलून सांगा"),
  recording: T("Recording… tap to stop", "रिकॉर्ड हो रहा है… रोकने के लिए टैप करें", "रेकॉर्ड होत आहे… थांबवण्यासाठी टॅप करा"),
  describe: T("Describe it (optional)", "बताएँ (वैकल्पिक)", "वर्णन करा (ऐच्छिक)"),
  describeEx: T("For example: open wire near the school gate", "उदाहरण: स्कूल के गेट के पास खुला तार", "उदा. शाळेच्या गेटजवळ उघडी तार"),
  remove: T("Remove", "हटाएँ", "काढा"),
  needEvidence: T("Add a photo or a description to continue.", "आगे बढ़ने के लिए फ़ोटो या विवरण जोड़ें।", "पुढे जाण्यासाठी फोटो किंवा वर्णन जोडा."),
  // step 4
  whereIsIt: T("Where exactly is the problem?", "समस्या ठीक कहाँ है?", "समस्या नेमकी कुठे आहे?"),
  whereHelp: T("This must be the place of the problem, not your home area.", "यह समस्या की जगह होनी चाहिए, आपका घर का क्षेत्र नहीं।", "हे समस्येचे ठिकाण असावे, तुमचे घराचे क्षेत्र नाही."),
  useGps: T("I am at the problem now (use GPS)", "मैं समस्या के पास हूँ (GPS)", "मी समस्येजवळ आहे (GPS)"),
  finding: T("Finding you…", "आपको ढूँढ रहे हैं…", "शोधत आहे…"),
  searchPlace: T("Search a landmark, street or locality", "लैंडमार्क, सड़क या इलाका खोजें", "खूण, रस्ता किंवा परिसर शोधा"),
  search: T("Search", "खोजें", "शोधा"),
  orPickArea: T("Or pick the area of the problem (approximate)", "या समस्या का क्षेत्र चुनें (अनुमानित)", "किंवा समस्येचे क्षेत्र निवडा (अंदाजे)"),
  chooseArea: T("Choose area…", "क्षेत्र चुनें…", "क्षेत्र निवडा…"),
  noSpot: T("No location chosen yet. Pick one of the options above.", "अभी स्थान नहीं चुना। ऊपर से कोई विकल्प चुनें।", "अजून ठिकाण निवडलेले नाही. वरीलपैकी एक पर्याय निवडा."),
  fromPhoto: T("From your photo", "आपकी फ़ोटो से", "तुमच्या फोटोतून"),
  fromGps: T("Your device GPS", "आपका डिवाइस GPS", "तुमचा डिव्हाइस GPS"),
  fromManual: T("Chosen by you", "आपके द्वारा चुना गया", "तुम्ही निवडलेले"),
  photoHasGps: T("Your photo has a location. Using it.", "आपकी फ़ोटो में स्थान है। उसका उपयोग हो रहा है।", "तुमच्या फोटोत ठिकाण आहे. ते वापरले जात आहे."),
  landmark: T("Landmark / address (optional)", "लैंडमार्क / पता (वैकल्पिक)", "खूण / पत्ता (ऐच्छिक)"),
  // step 5
  reviewTitle: T("Review your report", "अपनी रिपोर्ट जाँचें", "तुमचा अहवाल तपासा"),
  reviewHelp: T("Check everything. You can change any item.", "सब कुछ जाँचें। कोई भी चीज़ बदल सकते हैं।", "सर्व तपासा. काहीही बदलता येईल."),
  problem: T("Problem", "समस्या", "समस्या"),
  incidentLocation: T("Incident location", "घटना का स्थान", "घटनेचे ठिकाण"),
  areaWard: T("Area / ward (from the map point)", "क्षेत्र / वार्ड (मानचित्र बिंदु से)", "क्षेत्र / वॉर्ड (नकाशा बिंदूवरून)"),
  department: T("Responsible department", "ज़िम्मेदार विभाग", "जबाबदार विभाग"),
  similarNearby: T("Similar open reports within 50 m (yours will join them)", "50 मीटर में समान खुली रिपोर्ट (आपकी उनसे जुड़ेगी)", "50 मीटरमध्ये तशाच खुल्या तक्रारी (तुमची त्यात जोडली जाईल)"),
  severity: T("Severity (rule-based preview)", "गंभीरता (नियम-आधारित अनुमान)", "गंभीरता (नियमाधारित अंदाज)"),
  messageToAuthority: T("Message to the authority (optional)", "प्राधिकरण के लिए संदेश (वैकल्पिक)", "प्राधिकरणासाठी संदेश (ऐच्छिक)"),
  messageEx: T("Anything the officer should know", "अधिकारी को जो जानना चाहिए", "अधिकाऱ्याला काय माहिती असावी"),
  edit: T("Edit", "बदलें", "बदला"),
  confirmSubmit: T("Confirm & Submit", "पुष्टि करें और जमा करें", "पुष्टी करा आणि सादर करा"),
  submitting: T("Submitting…", "जमा हो रहा है…", "सादर होत आहे…"),
  accurate: T("I confirm this report is accurate to the best of my knowledge.", "मैं पुष्टि करता/करती हूँ कि यह रिपोर्ट मेरी जानकारी में सही है।", "माझ्या माहितीनुसार हा अहवाल बरोबर असल्याची मी पुष्टी करतो/करते."),
  // tags
  tagMl: T("ML model", "ML मॉडल", "ML मॉडेल"),
  tagRule: T("Rule-based", "नियम-आधारित", "नियमाधारित"),
  tagGis: T("GIS (PostGIS)", "GIS (PostGIS)", "GIS (PostGIS)"),
  tagYou: T("From you", "आपकी जानकारी", "तुमची माहिती"),
  // AI card
  aiTitle: T("AI analysis", "AI विश्लेषण", "AI विश्लेषण"),
  detected: T("Detected problem", "पहचानी गई समस्या", "ओळखलेली समस्या"),
  confidence: T("Confidence", "विश्वास", "विश्वास"),
  fromPhotoSrc: T("from photo", "फ़ोटो से", "फोटोवरून"),
  fromTextSrc: T("from your description", "आपके विवरण से", "तुमच्या वर्णनावरून"),
  fromBothSrc: T("photo + description", "फ़ोटो + विवरण", "फोटो + वर्णन"),
  lowConf: T("low confidence, please check", "कम विश्वास, कृपया जाँचें", "कमी विश्वास, कृपया तपासा"),
  photoEvidence: T("Photo evidence", "फ़ोटो का प्रमाण", "फोटोचा पुरावा"),
  textEvidence: T("Description evidence", "विवरण का प्रमाण", "वर्णनाचा पुरावा"),
  riskFlags: T("Risk flags", "जोखिम संकेत", "जोखिम संकेत"),
  photoQuality: T("Photo quality", "फ़ोटो की गुणवत्ता", "फोटोची गुणवत्ता"),
  q_good: T("good", "अच्छी", "चांगली"),
  q_blurry: T("blurry", "धुंधली", "धूसर"),
  q_dark: T("dark", "अंधेरी", "अंधारी"),
  q_low: T("low resolution", "कम रिज़ॉल्यूशन", "कमी रिझोल्यूशन"),
  noImageModel: T("Photo stored. Category chosen from your description / by you.", "फ़ोटो सुरक्षित है। श्रेणी आपके विवरण से / आपके द्वारा चुनी गई।", "फोटो जतन केला. श्रेणी तुमच्या वर्णनावरून / तुम्ही निवडलेली."),
  aiUnavailable: T("AI unavailable — choose the category", "AI उपलब्ध नहीं — श्रेणी चुनें", "AI उपलब्ध नाही — श्रेणी निवडा"),
  aiHigh: T("AI evidence: high confidence (photo and description agree)", "AI प्रमाण: उच्च विश्वास (फ़ोटो और विवरण मेल खाते हैं)", "AI पुरावा: उच्च विश्वास (फोटो आणि वर्णन जुळतात)"),
  aiVerify: T("AI classification needs verification", "AI वर्गीकरण की पुष्टि ज़रूरी है", "AI वर्गीकरणाची पडताळणी आवश्यक"),
  photoSays: T("Photo says", "फ़ोटो कहती है", "फोटो सांगतो"),
  textSays: T("Description says", "विवरण कहता है", "वर्णन सांगते"),
  chooseOwn: T("Choose another", "दूसरा चुनें", "दुसरी निवडा"),
  suggests: T("iREPORT suggests", "iREPORT सुझाव देता है", "iREPORT सुचवते"),
  keep: T("Keep", "रखें", "ठेवा"),
  use: T("Use", "चुनें", "वापरा"),
  analysing: T("Analysing your report…", "आपकी रिपोर्ट का विश्लेषण हो रहा है…", "तुमच्या अहवालाचे विश्लेषण होत आहे…"),
  retry: T("Retry", "फिर कोशिश करें", "पुन्हा प्रयत्न करा"),
  aboutAi: T("About this AI", "इस AI के बारे में", "या AI बद्दल"),
  aboutText: T("Text model: a small character n-gram TF-IDF + logistic regression trained on 280 hand-written demo sentences (held-out macro-F1 0.73). It is a demonstration, not a production classifier.", "टेक्स्ट मॉडल: 280 हाथ से लिखे डेमो वाक्यों पर प्रशिक्षित छोटा n-gram TF-IDF + लॉजिस्टिक रिग्रेशन (होल्ड-आउट macro-F1 0.73)। यह डेमो है, उत्पादन-स्तर का नहीं।", "टेक्स्ट मॉडेल: 280 हाताने लिहिलेल्या डेमो वाक्यांवर प्रशिक्षित लहान n-gram TF-IDF + लॉजिस्टिक रिग्रेशन (होल्ड-आउट macro-F1 0.73). हे प्रात्यक्षिक आहे, उत्पादन-स्तराचे नाही."),
  aboutNoImage: T("No trained photo model is installed, so photos are never used to guess the category.", "कोई प्रशिक्षित फ़ोटो मॉडल स्थापित नहीं है, इसलिए फ़ोटो से श्रेणी का अनुमान नहीं लगाया जाता।", "प्रशिक्षित फोटो मॉडेल स्थापित नाही, म्हणून फोटोवरून श्रेणीचा अंदाज लावला जात नाही."),
  // NLP
  nlpTitle: T("What we read in your description", "आपके विवरण से हमने क्या पढ़ा", "तुमच्या वर्णनातून आम्ही काय वाचले"),
  duration: T("Duration", "अवधि", "कालावधी"),
  obstruction: T("Obstruction", "रुकावट", "अडथळा"),
  hazard: T("Hazard", "खतरा", "धोका"),
  urgency: T("Urgency", "तात्कालिकता", "तातडी"),
  notStated: T("not stated", "नहीं बताया", "नमूद नाही"),
  // success
  success: T("Report Submitted Successfully", "रिपोर्ट सफलतापूर्वक जमा हुई", "अहवाल यशस्वीरित्या सादर झाला"),
  reportId: T("Report ID", "रिपोर्ट आईडी", "अहवाल आयडी"),
  trackIt: T("Track it from your dashboard", "अपने डैशबोर्ड से ट्रैक करें", "तुमच्या डॅशबोर्डवरून मागोवा घ्या"),
  trackBtn: T("Track my report", "मेरी रिपोर्ट ट्रैक करें", "माझ्या अहवालाचा मागोवा घ्या"),
  merged: T("Added to an existing report nearby.", "पास की मौजूदा रिपोर्ट में जोड़ी गई।", "जवळच्या अस्तित्वातील अहवालात जोडला."),
  // home
  homeWhat: T("What civic problems can you report?", "आप कौन-सी नागरिक समस्याएँ रिपोर्ट कर सकते हैं?", "तुम्ही कोणत्या नागरी समस्या नोंदवू शकता?"),
  homeWhatSub: T("Choose a category. iREPORT helps with the rest.", "एक श्रेणी चुनें। बाकी में iREPORT मदद करेगा।", "श्रेणी निवडा. पुढे iREPORT मदत करेल."),
  cat_pothole: T("Potholes & Road Damage", "गड्ढे और सड़क क्षति", "खड्डे आणि रस्त्याचे नुकसान"),
  cat_garbage: T("Garbage & Waste", "कचरा और अपशिष्ट", "कचरा आणि टाकाऊ पदार्थ"),
  cat_streetlight: T("Broken Streetlights", "खराब स्ट्रीटलाइट", "बिघडलेले पथदिवे"),
  cat_water: T("Water & Drainage", "पानी और जल निकासी", "पाणी आणि गटारे"),
  cat_electrical: T("Electrical Hazards", "बिजली के खतरे", "विजेचे धोके"),
  cat_other: T("Other Civic Issues", "अन्य नागरिक समस्याएँ", "इतर नागरी समस्या"),
  // profile
  homeArea: T("Home area (used for Community only, never as a report location)", "घर का क्षेत्र (केवल कम्युनिटी के लिए, रिपोर्ट स्थान के रूप में कभी नहीं)", "घराचे क्षेत्र (फक्त कम्युनिटीसाठी, अहवाल ठिकाण म्हणून कधीही नाही)"),
  contribution: T("Your contribution", "आपका योगदान", "तुमचे योगदान"),
  submitted: T("Reports submitted", "जमा की गई रिपोर्ट", "सादर केलेले अहवाल"),
  verified: T("Verified (resolved or backed by others)", "सत्यापित (हल हुई या दूसरों द्वारा समर्थित)", "पडताळलेले (सोडवलेले किंवा इतरांनी समर्थन दिलेले)"),
  confirmsGiven: T("Community confirmations given", "दी गई कम्युनिटी पुष्टियाँ", "दिलेल्या कम्युनिटी पुष्टी"),
  myLatest: T("My latest reports", "मेरी ताज़ा रिपोर्ट", "माझे अलीकडील अहवाल"),
  noReports: T("No reports yet.", "अभी कोई रिपोर्ट नहीं।", "अजून अहवाल नाहीत."),
  email: T("Email", "ईमेल", "ईमेल"),
} satisfies Record<string, Row>;

export type StrKey = keyof typeof STR;

export const tr = (lang: Lang, key: StrKey): string => STR[key][lang] ?? STR[key].en;

/** Question/option label table entry: a plain string for English-only values or a per-language row. */
export type Label = Row;
export const L = T;
