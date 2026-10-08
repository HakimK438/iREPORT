import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon, type IconName } from "./Icon";
import { Brand, categories, categoryLabel, homeCards, MERGED_CATEGORY } from "./brand";
import { analyze, api, ApiError, type Analysis, type ReportCreated } from "./api";
import { compressPhoto, PhotoTooLargeError } from "./compress";
import { AREA_CENTRES, AREAS } from "./store";
import { tr, type Lang, type StrKey } from "./i18n";
import { QUESTIONS, fromAnswers, optLabel, type Answers } from "./questions";

type Shot = { key: string; blob: Blob; url: string };
type Ai = { phase: "idle" } | { phase: "loading"; progress: number } | { phase: "done"; result: Analysis } | { phase: "failed"; message: string };
/** The incident location. Always chosen in this flow (photo GPS, device GPS or a manual pick), never the profile area. */
type Spot = { lat: number; lng: number; source: "photo" | "gps" | "manual"; label?: string };
type Hit = { lat: number; lng: number; name: string };

const SPEECH_LANG: Record<Lang, string> = { en: "en-IN", hi: "hi-IN", mr: "mr-IN" };
const MAX_PHOTOS = 3;
const STEP_KEYS: StrKey[] = ["stepProblem", "stepQuestions", "stepPhoto", "stepLocation", "stepReview", "stepDone"];

type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
const SpeechRecognitionImpl = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;

const CAT_NAME: Record<string, { hi: string; mr: string }> = {
  Pothole: { hi: "गड्ढे और सड़क क्षति", mr: "खड्डे आणि रस्त्याचे नुकसान" }, Streetlight: { hi: "खराब स्ट्रीटलाइट", mr: "बिघडलेले पथदिवे" },
  Garbage: { hi: "कचरा और अपशिष्ट", mr: "कचरा आणि टाकाऊ पदार्थ" }, "Water Leakage": { hi: "पानी और जल निकासी", mr: "पाणी आणि गटारे" },
  "Electrical Hazard": { hi: "बिजली का खतरा", mr: "विजेचा धोका" }, Other: { hi: "अन्य", mr: "इतर" },
};
/** One plain line under each category so people know what it covers. */
const CAT_HINT: Record<string, Record<Lang, string>> = {
  Pothole: { en: "Potholes, cracks, broken road or footpath", hi: "गड्ढे, दरारें, टूटी सड़क या फुटपाथ", mr: "खड्डे, भेगा, तुटलेला रस्ता किंवा फुटपाथ" },
  Streetlight: { en: "Street lamp not working", hi: "स्ट्रीट लाइट बंद है", mr: "पथदिवा बंद आहे" },
  Garbage: { en: "Waste piling up or not collected", hi: "कचरा जमा है या उठाया नहीं गया", mr: "कचरा साचला आहे किंवा उचललेला नाही" },
  "Water Leakage": { en: "Leaking pipe, flooded road or blocked drain", hi: "पाइप लीक, सड़क पर पानी या जाम नाली", mr: "पाइप गळती, रस्त्यावर पाणी किंवा तुंबलेली गटारे" },
  "Electrical Hazard": { en: "Loose wires or sparking poles", hi: "खुले तार या चिंगारी देते खंभे", mr: "उघड्या तारा किंवा ठिणग्या देणारे खांब" },
  Other: { en: "Any other public problem", hi: "कोई अन्य सार्वजनिक समस्या", mr: "इतर कोणतीही सार्वजनिक समस्या" },
};
/** Merged legacy names (Road Damage, Drainage) resolve to their citizen-facing category. */
const catName = (lang: Lang, name: string) => (lang === "en" ? categoryLabel(name) : CAT_NAME[MERGED_CATEGORY[name] ?? name]?.[lang] ?? name);

function mapSrc({ lat, lng }: { lat: number; lng: number }) {
  const dLat = 0.0175, dLng = 0.0195;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${(lng - dLng).toFixed(4)}%2C${(lat - dLat).toFixed(4)}%2C${(lng + dLng).toFixed(4)}%2C${(lat + dLat).toFixed(4)}&layer=mapnik&marker=${lat.toFixed(5)}%2C${lng.toFixed(5)}`;
}

function Tag({ kind, lang }: { kind: "ml" | "rule" | "gis" | "you"; lang: Lang }) {
  const key: StrKey = kind === "ml" ? "tagMl" : kind === "rule" ? "tagRule" : kind === "gis" ? "tagGis" : "tagYou";
  return <em className={`src-tag src-${kind}`}>{tr(lang, key)}</em>;
}

/** Category photo from public/categories/ (same files as the home cards); the icon is the fallback for categories without a photo. */
function CategoryThumb({ name, icon }: { name: string; icon: IconName }) {
  const [ok, setOk] = useState(true);
  const file = homeCards.find(c => c.flow === name)?.file;
  return <span className={file && ok ? "cat-thumb" : "cat-thumb cat-icon"}>{file && ok ? <img src={`${import.meta.env.BASE_URL}categories/${file}`} alt="" loading="lazy" width={120} height={72} onError={() => setOk(false)} /> : <Icon name={icon} size={27} />}</span>;
}

export default function ReportFlow({ open, close, discard, done, lang, initialCategory }: { open: boolean; close: () => void; discard: () => void; done: (created: ReportCreated) => void; lang: Lang; initialCategory?: string }) {
  const [step, setStep] = useState(initialCategory ? 2 : 1);
  const [category, setCategory] = useState<string | null>(initialCategory ?? null), [answers, setAnswers] = useState<Answers>({});
  const [shots, setShots] = useState<Shot[]>([]), [photoError, setPhotoError] = useState(""), [busyPhotos, setBusyPhotos] = useState(0);
  const [description, setDescription] = useState(""), [recording, setRecording] = useState(false), [voiceNote, setVoiceNote] = useState("");
  const [spot, setSpot] = useState<Spot | null>(null), [landmark, setLandmark] = useState("");
  const [locating, setLocating] = useState(false), [locError, setLocError] = useState("");
  const [query, setQuery] = useState(""), [hits, setHits] = useState<Hit[]>([]), [searching, setSearching] = useState(false);
  const [ai, setAi] = useState<Ai>({ phase: "idle" }), [finalCategory, setFinalCategory] = useState<string | null>(null), [pickingCategory, setPickingCategory] = useState(false);
  const [message, setMessage] = useState(""), [consent, setConsent] = useState(true), [submitting, setSubmitting] = useState(false), [submitError, setSubmitError] = useState("");
  const [created, setCreated] = useState<ReportCreated | null>(null);
  const recRef = useRef<Recognition | null>(null), abortRef = useRef<AbortController | null>(null), runRef = useRef(0), sigRef = useRef(""), spotRef = useRef<Spot | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null), uploadRef = useRef<HTMLInputElement>(null);
  spotRef.current = spot;

  /* Escape and the close button only hide the flow: the draft (answers, photos, location, AI result) stays in memory. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [open, close]);
  const shotsRef = useRef(shots);
  shotsRef.current = shots;
  useEffect(() => () => { shotsRef.current.forEach(s => URL.revokeObjectURL(s.url)); recRef.current?.stop(); abortRef.current?.abort(); }, []);

  const mapped = useMemo(() => (category ? fromAnswers(category, answers) : { problem: "Damaged", flags: [] as string[], addons: [] as string[] }), [category, answers]);
  const problem = mapped.problem;
  const questions = category ? QUESTIONS[category] ?? [] : [];
  const fullText = [description.trim(), ...mapped.addons].filter(Boolean).join(" ").slice(0, 500);
  const result = ai.phase === "done" ? ai.result : null;
  const effective = finalCategory ?? category ?? "Other";
  const signature = () => JSON.stringify([shots.map(s => s.key), fullText, category, problem]);

  const next = () => setStep(s => Math.min(6, s + 1));
  const back = () => { if (step === 1) close(); else setStep(s => s - 1); };

  /* ---------- evidence ---------- */
  const addFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, MAX_PHOTOS - shots.length);
    e.target.value = "";
    setPhotoError("");
    for (const file of files) {
      setBusyPhotos(n => n + 1);
      try {
        const blob = await compressPhoto(file);
        setShots(list => list.length >= MAX_PHOTOS ? list : [...list, { key: `${Date.now()}-${Math.random()}`, blob, url: URL.createObjectURL(blob) }]);
      } catch (err) {
        setPhotoError(err instanceof PhotoTooLargeError ? err.message : "This photo could not be read. Please pick another photo.");
      } finally {
        setBusyPhotos(n => n - 1);
      }
    }
  };
  const removeShot = (key: string) => setShots(list => { const s = list.find(x => x.key === key); if (s) URL.revokeObjectURL(s.url); return list.filter(x => x.key !== key); });

  const toggleVoice = () => {
    if (recording) { recRef.current?.stop(); return; }
    if (!SpeechRecognitionImpl) { setVoiceNote("Voice input is not supported in this browser. Please type instead."); document.getElementById("report-description")?.focus(); return; }
    const rec = new SpeechRecognitionImpl();
    rec.lang = SPEECH_LANG[lang]; rec.interimResults = true; rec.continuous = false;
    const before = description ? `${description.trim()} ` : "";
    rec.onresult = ev => setDescription((before + Array.from(ev.results).map(r => r[0].transcript).join(" ")).slice(0, 500)); // the spoken words become the description
    rec.onend = () => setRecording(false);
    rec.onerror = () => { setRecording(false); setVoiceNote("Could not hear you. Please try again or type instead."); };
    recRef.current = rec;
    setVoiceNote("");
    setRecording(true);
    rec.start();
  };

  /* ---------- AI (runs once per distinct evidence; Back/Next never re-uploads the same photos) ---------- */
  const runAnalysis = async (force = false) => {
    if (!category) return;
    const sig = signature();
    if (!force && sigRef.current === sig && (ai.phase === "done" || ai.phase === "loading")) return;
    sigRef.current = sig;
    abortRef.current?.abort();
    const run = ++runRef.current;
    setAi({ phase: "loading", progress: 0 });
    setFinalCategory(null);
    const form = new FormData();
    shots.forEach((s, i) => form.append("photos", s.blob, `photo-${i + 1}.${s.blob.type === "image/webp" ? "webp" : "jpg"}`));
    if (fullText) form.append("text", fullText);
    form.append("lang", lang); form.append("category", category); form.append("problem_type", problem);
    abortRef.current = new AbortController();
    try {
      const res = await analyze(form, progress => { if (run === runRef.current) setAi(a => (a.phase === "loading" ? { phase: "loading", progress } : a)); }, abortRef.current.signal);
      if (run !== runRef.current) return;
      setAi({ phase: "done", result: res });
      // Photo GPS is the preferred incident location, but never overrides a place the citizen already chose.
      if (res.gps_suggestion && !spotRef.current) setSpot({ ...res.gps_suggestion, source: "photo" });
    } catch (err) {
      if (run !== runRef.current || (err instanceof ApiError && err.code === "aborted")) return;
      sigRef.current = "";
      setAi({ phase: "failed", message: err instanceof ApiError && err.status >= 400 && err.status < 500 ? err.message : "iREPORT could not analyse this right now." });
    }
  };

  const toLocation = () => { void runAnalysis(); next(); };
  const toReview = () => { void runAnalysis(); next(); };

  /* ---------- location ---------- */
  const useMyLocation = () => {
    if (!navigator.geolocation) { setLocError("Location is not available on this device."); return; }
    setLocating(true); setLocError("");
    navigator.geolocation.getCurrentPosition(
      p => { setSpot({ lat: p.coords.latitude, lng: p.coords.longitude, source: "gps" }); setLocating(false); },
      () => { setLocError("Could not get your location. Search a place or pick an area below."); setLocating(false); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };
  const searchPlace = async () => {
    const q = query.trim();
    if (q.length < 3) return;
    setSearching(true); setLocError(""); setHits([]);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=in&viewbox=72.75,19.30,73.00,18.85&q=${encodeURIComponent(`${q}, Mumbai`)}`;
      const rows = (await (await fetch(url, { headers: { Accept: "application/json" } })).json()) as { lat: string; lon: string; display_name: string }[];
      setHits(rows.map(r => ({ lat: Number(r.lat), lng: Number(r.lon), name: r.display_name.split(",").slice(0, 3).join(",") })));
      if (rows.length === 0) setLocError("No match. Try a nearby landmark or pick the area below.");
    } catch {
      setLocError("Search is unavailable right now. Use GPS or pick the area below.");
    } finally {
      setSearching(false);
    }
  };
  const chooseHit = (h: Hit) => { setSpot({ lat: h.lat, lng: h.lng, source: "manual", label: h.name }); if (!landmark) setLandmark(h.name); setHits([]); };
  const chooseArea = (name: string) => { const c = AREA_CENTRES[name]; if (c) setSpot({ ...c, source: "manual", label: `${name} (approximate centre)` }); };
  const sourceLabel = (s: Spot) => tr(lang, s.source === "photo" ? "fromPhoto" : s.source === "gps" ? "fromGps" : "fromManual");

  /* ---------- review data ---------- */
  const geoKey = spot ? [spot.lat.toFixed(4), spot.lng.toFixed(4)] : null;
  const geo = useQuery({ queryKey: ["geo", geoKey], queryFn: () => api.resolveGeo(spot!.lat, spot!.lng), enabled: step >= 5 && !!spot, staleTime: 5 * 60_000 });
  const similar = useQuery({
    queryKey: ["similar", geoKey, effective], enabled: step === 5 && !!spot,
    queryFn: () => api.nearby({ lat: spot!.lat, lng: spot!.lng, radius: 50, category: effective, status: "Reported,Under Review,In Progress", sort: "nearest" }),
  });

  const pct = result?.confidence != null ? Math.round(result.confidence * 100) : null;
  const imageUsed = !!result && result.source.includes("image");
  const textUsed = !!result && result.source.includes("text");
  const sure = !!(result && result.category && !result.uncertain);
  const aiBusy = ai.phase === "loading";
  const sourceText = result ? tr(lang, result.source === "image" ? "fromPhotoSrc" : result.source === "text" ? "fromTextSrc" : "fromBothSrc") : "";
  const qualityKey = (l: string): StrKey => (l === "good" ? "q_good" : l === "blurry" ? "q_blurry" : l === "dark" ? "q_dark" : "q_low");
  const firstImage = shots[0]?.url;
  const department = geo.data?.departments[effective] ?? null;
  const mediaIds = result?.media_ids ?? [];

  const submit = async () => {
    if (!spot) return;
    setSubmitting(true); setSubmitError("");
    try {
      const flags = [...new Set([...(result?.flags ?? []), ...mapped.flags])];
      const res = await api.createReport({
        media_ids: mediaIds, category: effective, problem_type: problem, description: fullText || undefined,
        lat: spot.lat, lng: spot.lng, location_source: spot.source, address_text: landmark.trim() || spot.label || undefined,
        flags, citizen_message: message.trim() || undefined, answers: Object.keys(answers).length ? answers : undefined,
        ai: result?.category ? {
          category: result.category, confidence: result.confidence, model_version: result.model_version,
          source: result.source === "none" ? undefined : result.source, disagreement: result.disagreement ?? undefined,
        } : undefined,
      });
      setCreated(res);
      setStep(6);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Could not submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const categoryButtons = (selected: string | null, onPick: (name: string) => void) => (
    <div className="flow-categories">{categories.map(([name, icon]) => <button className={selected === name ? "selected" : ""} onClick={() => onPick(name)} key={name}><CategoryThumb name={name} icon={icon} /><b>{catName(lang, name)}</b><small>{(CAT_HINT[name] ?? CAT_HINT.Other)[lang]}</small>{selected === name && <Icon name="check" />}</button>)}</div>
  );

  const canQuestions = !!category && (questions.length === 0 || !!answers[questions[0].id]);
  const canPhoto = (shots.length > 0 || !!description.trim()) && busyPhotos === 0;

  return <div className="modal-backdrop" hidden={!open}><div className="report-modal" role="dialog" aria-modal="true" aria-label="Report a problem">
    <div className="report-top"><Brand /><button onClick={close} aria-label={tr(lang, "close")} title={tr(lang, "close")}>×</button></div>
    <div className="progress">{STEP_KEYS.map((k, i) => <div className={step >= i + 1 ? "active" : ""} key={k}><span>{step > i + 1 ? <Icon name="check" size={13} /> : String(i + 1).padStart(2, "0")}</span><b>{tr(lang, k)}</b></div>)}</div>
    <div className="flow-body">
      {step < 6 && <button className="back" onClick={back}>← {tr(lang, "back")}</button>}

      {step === 1 && <><span className="flow-eyebrow">1 · {tr(lang, "stepProblem").toUpperCase()}</span><h2>{tr(lang, "whatNeeds")}</h2><p>{tr(lang, "pickCategory")}</p>
        {categoryButtons(category, name => { setCategory(name); setAnswers({}); setFinalCategory(null); })}
        <button className="primary full" disabled={!category} onClick={next}>{tr(lang, "next")} <Icon name="arrow" /></button></>}

      {step === 2 && category && <><span className="flow-eyebrow">2 · {tr(lang, "stepQuestions").toUpperCase()} · {catName(lang, category).toUpperCase()}</span><h2>{tr(lang, "fewQuestions")}</h2><p>{tr(lang, "tapAnswer")}</p>
        {questions.map(q => <div className="q-block" key={q.id}><h3>{q.text[lang]}</h3><div className="problem-list">{q.options.map(opt => <button className={answers[q.id] === opt.id ? "selected" : ""} onClick={() => setAnswers(a => ({ ...a, [q.id]: opt.id }))} key={opt.id}><span>{answers[q.id] === opt.id && <Icon name="check" />}</span>{optLabel(opt, lang)}</button>)}</div></div>)}
        <button className="primary full" disabled={!canQuestions} onClick={next}>{tr(lang, "next")} <Icon name="arrow" /></button></>}

      {step === 3 && <><span className="flow-eyebrow">3 · {tr(lang, "stepPhoto").toUpperCase()}</span><h2>{tr(lang, "showProblem")}</h2><p>{tr(lang, "photoHelp")}</p>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={addFiles} />
        <input ref={uploadRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple hidden onChange={addFiles} />
        {shots.length > 0 && <div className="photo-strip">{shots.map((s, i) => <div className="upload-preview" key={s.key}><img src={s.url} alt={`Evidence photo ${i + 1}`} /><span><Icon name="check" /> {i + 1} · {Math.round(s.blob.size / 1024)} KB</span><button onClick={() => removeShot(s.key)}>{tr(lang, "remove")}</button></div>)}</div>}
        {busyPhotos > 0 && <div className="upload-progress indeterminate" role="status"><i /><small>Preparing photo…</small></div>}
        {photoError && <div className="form-error" role="alert"><Icon name="alert" size={16} /> {photoError}</div>}
        <div className="capture-grid">
          <button onClick={() => cameraRef.current?.click()} disabled={shots.length >= MAX_PHOTOS}><span><Icon name="camera" size={30} /></span><b>{tr(lang, "takePhoto")}</b></button>
          <button onClick={() => uploadRef.current?.click()} disabled={shots.length >= MAX_PHOTOS}><span><Icon name="plus" size={30} /></span><b>{tr(lang, "uploadPhoto")}</b></button>
          <button className={recording ? "recording" : ""} onClick={toggleVoice}><span><Icon name="mic" size={30} /></span><b>{recording ? tr(lang, "recording") : tr(lang, "voice")}</b><small>English · हिन्दी · मराठी</small></button>
        </div>
        <label className="field describe"><span>{tr(lang, "describe")}</span><textarea id="report-description" value={description} maxLength={500} rows={3} onChange={e => setDescription(e.target.value)} placeholder={tr(lang, "describeEx")} /></label>
        {voiceNote && <p className="muted-line">{voiceNote}</p>}
        {!canPhoto && busyPhotos === 0 && <p className="muted-line">{tr(lang, "needEvidence")}</p>}
        <button className="primary full" disabled={!canPhoto} onClick={toLocation}>{tr(lang, "next")} <Icon name="arrow" /></button></>}

      {step === 4 && <><span className="flow-eyebrow">4 · {tr(lang, "stepLocation").toUpperCase()}</span><h2>{tr(lang, "whereIsIt")}</h2><p>{tr(lang, "whereHelp")}</p>
        {result?.gps_suggestion && spot?.source !== "photo" && <div className="ai-suggest"><span><Icon name="pin" size={16} /> {tr(lang, "photoHasGps")}</span><button className="secondary compact" onClick={() => setSpot({ ...result.gps_suggestion!, source: "photo" })}>{tr(lang, "use")}</button></div>}
        {spot?.source === "photo" && <div className="ai-suggest"><span><Icon name="pin" size={16} /> {tr(lang, "photoHasGps")}</span></div>}
        <div className="location-actions"><button className="primary" onClick={useMyLocation} disabled={locating}><Icon name="pin" /> {locating ? tr(lang, "finding") : tr(lang, "useGps")}</button></div>
        <div className="loc-search"><label><Icon name="search" /><input value={query} maxLength={100} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void searchPlace(); }} placeholder={tr(lang, "searchPlace")} aria-label={tr(lang, "searchPlace")} /></label><button className="secondary compact" onClick={() => void searchPlace()} disabled={searching || query.trim().length < 3}>{tr(lang, "search")}</button></div>
        {hits.length > 0 && <ul className="loc-hits">{hits.map(h => <li key={`${h.lat}${h.lng}`}><button onClick={() => chooseHit(h)}><Icon name="pin" size={14} /> {h.name}</button></li>)}</ul>}
        <label className="field"><span>{tr(lang, "orPickArea")}</span><select value="" onChange={e => chooseArea(e.target.value)}><option value="">{tr(lang, "chooseArea")}</option>{AREAS.map(a => <option key={a} value={a}>{a}</option>)}</select></label>
        {locError && <p className="muted-line">{locError}</p>}
        {spot ? <><div className="flow-map"><iframe title="Incident location on OpenStreetMap" src={mapSrc(spot)} /><span><Icon name="pin" /> {spot.lat.toFixed(5)}, {spot.lng.toFixed(5)}</span></div>
          <div className="location-details"><div><small>{tr(lang, "incidentLocation").toUpperCase()}</small><b>{sourceLabel(spot)}{spot.label ? ` · ${spot.label}` : ""}</b></div></div></>
          : <div className="empty-note"><Icon name="pin" /><span><b>{tr(lang, "noSpot")}</b></span></div>}
        <label className="field"><span>{tr(lang, "landmark")}</span><input value={landmark} maxLength={200} onChange={e => setLandmark(e.target.value)} /></label>
        <button className="primary full" disabled={!spot} onClick={toReview}>{tr(lang, "next")} <Icon name="arrow" /></button></>}

      {step === 5 && category && spot && <><span className="flow-eyebrow">5 · {tr(lang, "stepReview").toUpperCase()}</span><h2>{tr(lang, "reviewTitle")}</h2><p>{tr(lang, "reviewHelp")}</p>
        <div className="rv-card">
          {firstImage ? <div className="rv-photos">{shots.map((s, i) => <img key={s.key} src={s.url} alt={`Evidence photo ${i + 1}`} />)}</div> : <div className="no-photo"><Icon name="mic" size={26} /></div>}
          <dl className="rv-list">
            <div><dt>{tr(lang, "problem")} <Tag kind="you" lang={lang} /></dt><dd><b>{problem} · {catName(lang, effective)}</b> <button className="text-button" onClick={() => setPickingCategory(p => !p)}>{tr(lang, "edit")}</button></dd></div>
            <div><dt>{tr(lang, "incidentLocation")} <Tag kind="you" lang={lang} /></dt><dd>{spot.lat.toFixed(5)}, {spot.lng.toFixed(5)} · {sourceLabel(spot)}{landmark ? ` · ${landmark}` : ""} <button className="text-button" onClick={() => setStep(4)}>{tr(lang, "edit")}</button></dd></div>
            <div><dt>{tr(lang, "areaWard")} <Tag kind="gis" lang={lang} /></dt><dd>{geo.isPending ? "…" : geo.data?.area ?? "—"}{geo.data?.method === "nearest_area_centre" ? " (nearest area)" : ""}</dd></div>
            <div><dt>{tr(lang, "department")}</dt><dd>{department ?? "—"}</dd></div>
            {similar.data && <div><dt>{tr(lang, "similarNearby")}</dt><dd>{similar.data.items.length}</dd></div>}
            <div><dt>{tr(lang, "severity")} <Tag kind="rule" lang={lang} /></dt><dd className={result?.severity === "High" || result?.severity === "Critical" ? "high" : ""}>{result?.severity ?? "—"}{result?.flags.length ? ` · ${result.flags.join(", ")}` : ""}</dd></div>
          </dl>
          {pickingCategory && <>{categoryButtons(effective, name => { setFinalCategory(name); setPickingCategory(false); })}</>}
        </div>

        <div className="rv-ai" aria-live="polite">
          <h3><Icon name="spark" size={16} /> {tr(lang, "aiTitle")}</h3>
          {aiBusy && <p className="muted-line">{tr(lang, "analysing")} {shots.length > 0 && ai.phase === "loading" && ai.progress < 1 ? `${Math.round(ai.progress * 100)}%` : ""}</p>}
          {ai.phase === "failed" && <div className="form-error" role="alert"><Icon name="alert" size={16} /> {tr(lang, "aiUnavailable")}. {shots.length > 0 && "Your photos were not uploaded. Retry, or continue without them."} <button className="text-button" onClick={() => void runAnalysis(true)}>{tr(lang, "retry")}</button></div>}
          {result && !result.ai_available && <p className="muted-line">{shots.length > 0 && result.media_ids.length > 0 ? tr(lang, "noImageModel") : tr(lang, "aiUnavailable")}</p>}
          {result && result.ai_available && !result.image_model_active && shots.length > 0 && <p className="muted-line">{tr(lang, "photoNotAnalysed")}</p>}
          {result && result.ai_available && <dl className="rv-list">
            <div><dt>{tr(lang, "detected")} <Tag kind="ml" lang={lang} /></dt><dd><b>{result.category ? catName(lang, result.category) : "—"}</b></dd></div>
            <div><dt>{tr(lang, "confidence")}</dt><dd>{pct !== null ? (result.image_confidence != null && result.text_confidence != null
              ? `${tr(lang, "fromPhotoSrc")} ${Math.round(result.image_confidence * 100)}% · ${tr(lang, "fromTextSrc")} ${Math.round(result.text_confidence * 100)}%${result.agreement === "agree" ? ` · ${tr(lang, "aiHigh")}` : ""}`
              : `${pct}% · ${sourceText}`) : "—"}{pct !== null && !sure ? ` · ${tr(lang, "lowConf")}` : ""}</dd></div>
            {imageUsed && result.explanation && <div><dt>{tr(lang, "photoEvidence")} <Tag kind="ml" lang={lang} /></dt><dd>{result.explanation}</dd></div>}
            {!imageUsed && textUsed && result.explanation && <div><dt>{tr(lang, "textEvidence")} <Tag kind="ml" lang={lang} /></dt><dd>{result.explanation}</dd></div>}
            {result.flags.length > 0 && <div><dt>{tr(lang, "riskFlags")} <Tag kind="rule" lang={lang} /></dt><dd>{result.flags.join(", ")}</dd></div>}
          </dl>}
          {result && shots.length > 0 && result.media_ids.length > 0 && !imageUsed && result.ai_available && <p className="muted-line">{tr(lang, "noImageModel")}</p>}
          {result && result.photo_quality.length > 0 && <p className="muted-line">{tr(lang, "photoQuality")} <Tag kind="rule" lang={lang} />: {result.photo_quality.map((q, i) => `${i + 1}: ${tr(lang, qualityKey(q.label))}`).join(" · ")}</p>}
          {result && result.photo_errors.length > 0 && <p className="muted-line">{result.photo_errors.length} photo(s) could not be read and were skipped: {result.photo_errors[0].message}</p>}
          {result?.agreement === "agree" && <p className="rv-agree"><Icon name="check" size={15} /> {tr(lang, "aiHigh")}</p>}
          {result?.not_civic && <p className="muted-line">This photo may not show a civic problem. Check the category below.</p>}
          {result && (result.disagreement || (result.category && result.category !== category && sure)) && <div className="ai-suggest rv-verify">
            <span><b>{result.disagreement ? tr(lang, "aiVerify") : `${tr(lang, "suggests")}: ${catName(lang, result.category!)}`}</b>
              {result.disagreement && <><br />{tr(lang, "photoSays")}: {catName(lang, result.disagreement.image)} · {tr(lang, "textSays")}: {catName(lang, result.disagreement.text)}</>}</span>
            {result.disagreement && <><button className={effective === result.disagreement.image ? "secondary compact selected" : "secondary compact"} onClick={() => setFinalCategory(result.disagreement!.image)}>{tr(lang, "use")} {catName(lang, result.disagreement.image)}</button>
              <button className={effective === result.disagreement.text ? "secondary compact selected" : "secondary compact"} onClick={() => setFinalCategory(result.disagreement!.text)}>{tr(lang, "use")} {catName(lang, result.disagreement.text)}</button></>}
            {!result.disagreement && <><button className={effective === result.category ? "secondary compact selected" : "secondary compact"} onClick={() => setFinalCategory(result.category!)}>{tr(lang, "use")} {catName(lang, result.category!)}</button>
              <button className={effective === category ? "secondary compact selected" : "secondary compact"} onClick={() => setFinalCategory(category)}>{tr(lang, "keep")} {catName(lang, category)}</button></>}
            <button className="secondary compact" onClick={() => setPickingCategory(true)}>{tr(lang, "chooseOwn")}</button>
          </div>}
          {result && result.ai_available && !sure && !result.disagreement && <div className="ai-suggest"><span>{tr(lang, "lowConf")}</span><button className="secondary compact" onClick={() => setPickingCategory(true)}>{tr(lang, "chooseOwn")}</button></div>}
          {(ai.phase === "failed" || (result && !result.ai_available)) && <div className="ai-suggest"><span>{tr(lang, "aiUnavailable")}</span><button className="secondary compact" onClick={() => setPickingCategory(true)}>{tr(lang, "chooseOwn")}</button></div>}
          <details className="rv-about"><summary>{tr(lang, "aboutAi")}</summary><p>{tr(lang, "aboutText")}</p>{(!result || result.models.image !== "used") && <p>{tr(lang, "aboutNoImage")}</p>}</details>
        </div>

        {result?.nlp && (result.nlp.duration || result.nlp.obstruction || result.nlp.hazard || result.nlp.flags.length > 0) && <div className="rv-ai"><h3>{tr(lang, "nlpTitle")} <Tag kind="rule" lang={lang} /></h3><dl className="rv-list">
          <div><dt>{tr(lang, "duration")}</dt><dd>{result.nlp.duration?.text ?? tr(lang, "notStated")}</dd></div>
          <div><dt>{tr(lang, "obstruction")}</dt><dd>{result.nlp.obstruction ?? tr(lang, "notStated")}</dd></div>
          <div><dt>{tr(lang, "hazard")}</dt><dd>{result.nlp.hazard?.join(", ") ?? tr(lang, "notStated")}</dd></div>
          <div><dt>{tr(lang, "urgency")}</dt><dd>{result.nlp.urgency ?? "—"}</dd></div>
        </dl></div>}

        <label className="field describe"><span>{tr(lang, "describe")}</span><textarea value={description} maxLength={500} rows={2} onChange={e => setDescription(e.target.value)} onBlur={() => void runAnalysis()} /></label>
        <label className="field describe"><span>{tr(lang, "messageToAuthority")}</span><textarea value={message} maxLength={500} rows={2} onChange={e => setMessage(e.target.value)} placeholder={tr(lang, "messageEx")} /></label>
        <label className="consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> {tr(lang, "accurate")}</label>
        {submitError && <div className="form-error" role="alert"><Icon name="alert" size={16} /> {submitError}</div>}
        <button className="primary full" onClick={() => void submit()} disabled={!consent || submitting || aiBusy}>{submitting ? tr(lang, "submitting") : tr(lang, "confirmSubmit")} <Icon name="arrow" /></button></>}

      {step === 6 && created && <div className="success-screen"><svg className="check-anim" viewBox="0 0 52 52" aria-hidden="true"><circle className="check-circle" cx="26" cy="26" r="24" fill="none" /><path className="check-mark" fill="none" d="M14 27l8 8 16-17" /></svg>
        <h2>{tr(lang, "success")}</h2>
        <div className="report-id"><small>{tr(lang, "reportId").toUpperCase()}</small><b>{created.incident_public_id}</b><span>{created.status}</span></div>
        <p>{created.merged ? `${tr(lang, "merged")} ${created.affected_count}` : tr(lang, "trackIt")}{created.area ? ` · ${created.area}` : ""}{created.department ? ` · ${created.department}` : ""}</p>
        <button className="primary full" onClick={() => done(created)}>{tr(lang, "trackBtn")} <Icon name="arrow" /></button></div>}

      {step < 6 && (shots.length > 0 || description || spot || category) && <button className="text-button discard" onClick={discard}>{tr(lang, "startOver")}</button>}
    </div></div></div>;
}
