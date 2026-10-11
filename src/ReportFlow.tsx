import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon, type IconName } from "./Icon";
import { Brand, categories, categoryLabel, homeCards, MERGED_CATEGORY } from "./brand";
import { analyze, api, ApiError, type Analysis, type NearbyCheck, type PhotoCheck, type ReportCreated } from "./api";
import { compressPhoto, PhotoTooLargeError } from "./compress";
import LocationPicker from "./LocationPicker";
import { statusName, tr, trf, type Lang, type StrKey } from "./i18n";
import { QUESTIONS, fromAnswers, optLabel, type Answers } from "./questions";

type Shot = { key: string; blob: Blob; url: string; cat: string };
type Ai = { phase: "idle" } | { phase: "loading"; progress: number } | { phase: "done"; result: Analysis } | { phase: "failed"; message: string };
/** The incident location. Always chosen in this flow (photo GPS, device GPS or a manual pick), never the profile area. */
type Spot = { lat: number; lng: number; source: "photo" | "gps" | "manual"; label?: string };

const SPEECH_LANG: Record<Lang, string> = { en: "en-IN", hi: "hi-IN", mr: "mr-IN" };
// One category per report: the server refuses a second report from the same citizen within 50 m (any category), so extra problems at one spot cannot be filed.
const MAX_PHOTOS = 3, MAX_CATEGORIES = 1;
const STEP_KEYS: StrKey[] = ["stepProblem", "stepQuestions", "stepPhotoLoc", "stepReview", "stepDone"];

type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error?: string }) => void) | null };
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
  /* Several problems can be reported at once: the first is the main one, each extra becomes its own report (own team, own priority). */
  const [selected, setSelected] = useState<string[]>(initialCategory ? [initialCategory] : []), [answersBy, setAnswersBy] = useState<Record<string, Answers>>({});
  const [shots, setShots] = useState<Shot[]>([]), [photoError, setPhotoError] = useState(""), [busyPhotos, setBusyPhotos] = useState(0);
  const [description, setDescription] = useState(""), [recording, setRecording] = useState(false), [voiceNote, setVoiceNote] = useState(""), [heard, setHeard] = useState("");
  const [spot, setSpot] = useState<Spot | null>(null), [landmark, setLandmark] = useState("");
  const [locating, setLocating] = useState(false), [locError, setLocError] = useState("");
  const [ai, setAi] = useState<Ai>({ phase: "idle" }), [finalCategory, setFinalCategory] = useState<string | null>(null), [pickingCategory, setPickingCategory] = useState(false);
  const [message, setMessage] = useState(""), [consent, setConsent] = useState(true), [submitting, setSubmitting] = useState(false), [submitError, setSubmitError] = useState("");
  const [created, setCreated] = useState<ReportCreated[]>([]);
  /* Photo vs category: photos the model is sure show something else are NOT attached unless the citizen keeps them. */
  const [keepPhotos, setKeepPhotos] = useState<string[]>([]), [mmPicking, setMmPicking] = useState(false);
  /* Same problem within 50 m: null = not decided yet, "raise" = file my own report, "upvoted" = confirmed the existing one. */
  const [dup, setDup] = useState<null | "raise" | "upvoted">(null), [upvoting, setUpvoting] = useState(false), [dupError, setDupError] = useState("");
  const wantVoice = useRef(false);
  const recRef = useRef<Recognition | null>(null), abortRef = useRef<AbortController | null>(null), runRef = useRef(0), sigRef = useRef(""), spotRef = useRef<Spot | null>(null);
  const autoLandmark = useRef(""), uploadRef = useRef<HTMLInputElement>(null), geoRun = useRef(0);
  spotRef.current = spot;

  const category = selected[0] ?? null, extras = selected.slice(1);
  const answers = (category && answersBy[category]) || {};

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
  useEffect(() => () => { shotsRef.current.forEach(s => URL.revokeObjectURL(s.url)); wantVoice.current = false; recRef.current?.stop(); abortRef.current?.abort(); }, []);

  /* The quick answers belong to the category chosen in step 1; if the citizen switches to another category (for example the AI suggestion) they no longer apply. */
  const sameCategory = !finalCategory || finalCategory === category;
  const mapped = useMemo(() => (category && sameCategory ? fromAnswers(category, answers) : { problem: "Damaged", flags: [] as string[], addons: [] as string[] }), [category, answers, sameCategory]);
  const problem = mapped.problem;
  const fullText = [description.trim(), ...mapped.addons].filter(Boolean).join(" ").slice(0, 500);
  const mainShots = shots.filter(s => s.cat === category);
  const result = ai.phase === "done" ? ai.result : null;
  const effective = finalCategory ?? category ?? "Other";
  const signature = () => JSON.stringify([mainShots.map(s => s.key), fullText, category, problem]);

  const next = () => setStep(s => Math.min(5, s + 1));
  const back = () => { if (step === 1) close(); else setStep(s => s - 1); };

  const toggleCategory = (name: string) => {
    if (selected.includes(name)) {
      const rest = selected.filter(c => c !== name);
      setShots(sh => sh.map(x => (x.cat === name ? { ...x, cat: rest[0] ?? x.cat } : x))); // photos of a removed problem move to the main one
      setSelected(rest);
    } else if (MAX_CATEGORIES === 1) setSelected([name]);
    else if (selected.length < MAX_CATEGORIES) setSelected([...selected, name]);
  };

  /* ---------- evidence ---------- */
  const addFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, MAX_PHOTOS - shots.length);
    e.target.value = "";
    setPhotoError("");
    for (const file of files) {
      setBusyPhotos(n => n + 1);
      try {
        const blob = await compressPhoto(file);
        setShots(list => list.length >= MAX_PHOTOS ? list : [...list, { key: `${Date.now()}-${Math.random()}`, blob, url: URL.createObjectURL(blob), cat: selected[0] ?? "Other" }]);
      } catch (err) {
        setPhotoError(err instanceof PhotoTooLargeError ? err.message : tr(lang, "photoUnreadable"));
      } finally {
        setBusyPhotos(n => n - 1);
      }
    }
  };
  const removeShot = (key: string) => setShots(list => { const s = list.find(x => x.key === key); if (s) URL.revokeObjectURL(s.url); return list.filter(x => x.key !== key); });
  const assignShot = (key: string, cat: string) => setShots(list => list.map(x => (x.key === key ? { ...x, cat } : x)));

  /* Voice: the spoken words are written into the description box live, so the citizen can see and fix them.
     Continuous mode keeps listening through short pauses; it restarts itself if the browser ends a session on its own,
     and stops for good on the button, on a real error, or when the flow is hidden. */
  const stopVoice = () => { wantVoice.current = false; try { recRef.current?.stop(); } catch { /* already stopped */ } recRef.current = null; setRecording(false); };
  const descRef = useRef(description);
  descRef.current = description;
  const toggleVoice = () => {
    if (recording) { stopVoice(); return; }
    if (!SpeechRecognitionImpl) { setVoiceNote(tr(lang, "voiceUnsupported")); document.getElementById("report-description")?.focus(); return; }
    wantVoice.current = true;
    setVoiceNote(""); setHeard("");
    const begin = () => {
      const rec = new SpeechRecognitionImpl();
      rec.lang = SPEECH_LANG[lang]; rec.interimResults = true; rec.continuous = true;
      const base = descRef.current ? `${descRef.current.trim()} ` : ""; // text already in the box when this session started
      rec.onresult = ev => {
        const parts = Array.from(ev.results);
        const finals = parts.filter(r => r.isFinal).map(r => r[0].transcript.trim()).join(" ");
        const interim = parts.filter(r => !r.isFinal).map(r => r[0].transcript.trim()).join(" ");
        const said = [finals, interim].filter(Boolean).join(" ");
        setHeard(said);
        setDescription((base + said).slice(0, 500));
      };
      rec.onend = () => {
        if (!wantVoice.current) { setRecording(false); return; }
        window.setTimeout(() => { if (!wantVoice.current) return; try { begin(); } catch { stopVoice(); } }, 150); // the browser ended the session by itself: continue
      };
      rec.onerror = e => {
        const code = e?.error;
        if (code === "aborted") return;
        stopVoice();
        setVoiceNote(tr(lang, code === "not-allowed" || code === "service-not-allowed" ? "voiceBlocked" : code === "no-speech" ? "voiceNoSpeech" : code === "network" ? "voiceNetwork" : code === "audio-capture" ? "voiceNoMic" : "voiceError"));
      };
      recRef.current = rec;
      rec.start();
    };
    try { begin(); setRecording(true); } catch { stopVoice(); setVoiceNote(tr(lang, "voiceError")); }
  };
  // Hiding the flow or leaving the description step must not leave the microphone open.
  useEffect(() => { if (!open || step !== 2) stopVoice(); }, [open, step]); // eslint-disable-line react-hooks/exhaustive-deps

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
    mainShots.forEach((s, i) => form.append("photos", s.blob, `photo-${i + 1}.${s.blob.type === "image/webp" ? "webp" : "jpg"}`));
    if (fullText) form.append("text", fullText);
    form.append("lang", lang); form.append("category", category); form.append("problem_type", problem);
    abortRef.current = new AbortController();
    try {
      const res = await analyze(form, progress => { if (run === runRef.current) setAi(a => (a.phase === "loading" ? { phase: "loading", progress } : a)); }, abortRef.current.signal);
      if (run !== runRef.current) return;
      setAi({ phase: "done", result: res });
      // Photo GPS is the preferred incident location, but never overrides a place the citizen already chose.
      if (res.gps_suggestion && !spotRef.current) pickSpot({ ...res.gps_suggestion, source: "photo" });
    } catch (err) {
      if (run !== runRef.current || (err instanceof ApiError && err.code === "aborted")) return;
      sigRef.current = "";
      setAi({ phase: "failed", message: err instanceof ApiError && err.status >= 400 && err.status < 500 ? err.message : "iREPORT could not analyse this right now." });
    }
  };

  // Analyse as soon as photos are added on the Photo & location step, so a photo's GPS can pre-fill the pin.
  useEffect(() => { if (step === 3 && mainShots.length > 0 && busyPhotos === 0) void runAnalysis(); }, [step, shots, busyPhotos]); // eslint-disable-line react-hooks/exhaustive-deps
  const toReview = () => { void runAnalysis(); next(); };

  /* ---------- location (the exact pin the citizen chose is what is stored and what the authority sees) ---------- */
  /** Names the pin with a short street/area label (OpenStreetMap reverse lookup). Failure is fine: coordinates are what count. */
  const nameSpot = async (lat: number, lng: number) => {
    const run = ++geoRun.current;
    try {
      const r = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=${lat}&lon=${lng}`, { headers: { Accept: "application/json" } })).json() as { address?: Record<string, string> };
      if (run !== geoRun.current || !r.address) return;
      const a = r.address;
      const label = [a.road ?? a.pedestrian ?? a.neighbourhood, a.suburb ?? a.city_district ?? a.quarter].filter(Boolean).join(", ");
      if (!label) return;
      setSpot(sp => (sp && Math.abs(sp.lat - lat) < 1e-9 && Math.abs(sp.lng - lng) < 1e-9 ? { ...sp, label } : sp));
      setLandmark(cur => { if (!cur || cur === autoLandmark.current) { autoLandmark.current = label; return label; } return cur; });
    } catch { /* offline or blocked: keep the coordinates only */ }
  };
  const pickSpot = (sp: Spot) => { setSpot(sp); setLocError(""); void nameSpot(sp.lat, sp.lng); };
  const useMyLocation = () => {
    if (!navigator.geolocation) { setLocError(tr(lang, "gpsUnavailable")); return; }
    setLocating(true); setLocError("");
    navigator.geolocation.getCurrentPosition(
      p => { pickSpot({ lat: p.coords.latitude, lng: p.coords.longitude, source: "gps" }); setLocating(false); },
      () => { setLocError(tr(lang, "gpsFailed")); setLocating(false); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };
  const sourceLabel = (s: Spot) => tr(lang, s.source === "photo" ? "fromPhoto" : s.source === "gps" ? "fromGps" : "fromManual");

  /* ---------- review data ---------- */
  const geoKey = spot ? [spot.lat.toFixed(4), spot.lng.toFixed(4)] : null;
  const geo = useQuery({ queryKey: ["geo", geoKey], queryFn: () => api.resolveGeo(spot!.lat, spot!.lng), enabled: step >= 4 && !!spot, staleTime: 5 * 60_000 });
  /* Asked right after the location is set: my own open report within 50 m (any category), or other people's open complaints there to confirm instead. */
  const nc = useQuery({
    queryKey: ["nearbyCheck", spot ? [spot.lat.toFixed(5), spot.lng.toFixed(5)] : null], enabled: step >= 3 && step < 5 && !!spot,
    queryFn: () => api.nearbyCheck(spot!.lat, spot!.lng), staleTime: 15_000,
  });
  const [photoMsg, setPhotoMsg] = useState(""), [addingPhoto, setAddingPhoto] = useState(false);
  const addPhotoRef = useRef<HTMLInputElement>(null);

  // A moved pin or a changed category is a different question: ask about nearby duplicates again.
  useEffect(() => { setDup(d => (d === "upvoted" ? d : null)); setDupError(""); setPhotoMsg(""); }, [geoKey?.join(",")]);

  const pct = result?.confidence != null ? Math.round(result.confidence * 100) : null;
  const imageUsed = !!result && result.source.includes("image");
  const textUsed = !!result && result.source.includes("text");
  const sure = !!(result && result.category && !result.uncertain);
  const aiBusy = ai.phase === "loading";
  const sourceText = result ? tr(lang, result.source === "image" ? "fromPhotoSrc" : result.source === "text" ? "fromTextSrc" : "fromBothSrc") : "";
  const qualityKey = (l: string): StrKey => (l === "good" ? "q_good" : l === "blurry" ? "q_blurry" : l === "dark" ? "q_dark" : "q_low");
  const department = geo.data?.departments[effective] ?? null;
  /* A photo is "not matching" when the model is sure it shows another category than the one now chosen. Those are left out. */
  const norm = (c: string) => MERGED_CATEGORY[c] ?? c;
  const checks: PhotoCheck[] = result?.photo_checks ?? [];
  const isMismatch = (c: PhotoCheck) => effective !== "Other" && c.looks_like !== "Other" && c.confidence >= 0.6 && norm(c.looks_like) !== norm(effective) && !keepPhotos.includes(c.media_id);
  const mismatched = checks.filter(isMismatch);
  const dropped = new Set(mismatched.map(c => c.media_id));
  const mediaIds = (result?.media_ids ?? []).filter(id => !dropped.has(id));
  /** The local photo behind a check (uploads that failed to decode are skipped by the server, so indexes are mapped). */
  const shotOf = (c: PhotoCheck): Shot | undefined => {
    const bad = new Set((result?.photo_errors ?? []).map(e => e.index));
    return mainShots.filter((_, n) => !bad.has(n))[c.index];
  };
  const hasEvidence = mediaIds.length > 0 || !!fullText;

  /** Confirm the already-reported problem instead of filing a new report. */
  const upvote = async (item: NearbyCheck["others"][number]) => {
    setUpvoting(true); setDupError("");
    try {
      const r = await api.confirm(item.id);
      setCreated([{ report_id: item.id, incident_id: item.id, incident_public_id: item.public_id, merged: true, affected_count: r.affected_count, severity: "Medium", status: item.status, area: null, department: geo.data?.departments[effective] ?? null }]);
      setDup("upvoted"); setStep(5);
    } catch (err) {
      setDupError(err instanceof ApiError ? err.message : tr(lang, "dupFailed"));
    } finally {
      setUpvoting(false);
    }
  };

  /** "You already reported this": add photos to my own report instead of filing it again. */
  const addPhotos = async (incidentId: string, files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;
    setAddingPhoto(true); setPhotoMsg("");
    try {
      const form = new FormData();
      for (const f of list) { const blob = await compressPhoto(f); form.append("photos", blob, `photo.${blob.type === "image/webp" ? "webp" : "jpg"}`); }
      await api.addPhotos(incidentId, form);
      setPhotoMsg(trf(lang, "nc_photoAdded", { no: nc.data?.mine?.public_id ?? "" }));
      void nc.refetch();
    } catch (err) {
      setPhotoMsg(err instanceof ApiError ? err.message : err instanceof PhotoTooLargeError ? err.message : tr(lang, "nc_photoFail"));
    } finally {
      setAddingPhoto(false);
    }
  };

  const submit = async () => {
    if (!spot) return;
    setSubmitting(true); setSubmitError("");
    const place = { lat: spot.lat, lng: spot.lng, location_source: spot.source, address_text: landmark.trim() || spot.label || undefined };
    try {
      const flags = [...new Set([...(result?.flags ?? []), ...mapped.flags])];
      const res = await api.createReport({
        media_ids: mediaIds, category: effective, problem_type: problem, description: fullText || undefined, ...place,
        flags, citizen_message: message.trim() || undefined, answers: sameCategory && Object.keys(answers).length ? answers : undefined,
        ai: result?.category ? {
          category: result.category, confidence: result.confidence, model_version: result.model_version,
          source: result.source === "none" ? undefined : result.source, disagreement: result.disagreement ?? undefined,
        } : undefined,
      });
      const all: ReportCreated[] = [res];
      // Extra problems: same place, their own answers and photos, analysed one by one. One failing does not undo the others.
      const failed: string[] = [];
      for (const extra of extras) {
        try {
          const a = answersBy[extra] ?? {}, m = fromAnswers(extra, a);
          const text = [description.trim(), ...m.addons].filter(Boolean).join(" ").slice(0, 500);
          const mine = shots.filter(s => s.cat === extra);
          let analysis: Analysis | null = null;
          if (mine.length || text) {
            const form = new FormData();
            mine.forEach((s, i) => form.append("photos", s.blob, `photo-${i + 1}.${s.blob.type === "image/webp" ? "webp" : "jpg"}`));
            if (text) form.append("text", text);
            form.append("lang", lang); form.append("category", extra); form.append("problem_type", m.problem);
            analysis = await analyze(form, () => undefined).catch(() => null);
          }
          const okMedia = (analysis?.media_ids ?? []).filter(id => !(analysis?.photo_checks ?? []).some(c => c.media_id === id && !c.matches));
          all.push(await api.createReport({
            media_ids: okMedia, category: extra, problem_type: m.problem, description: text || undefined, ...place,
            flags: [...new Set([...(analysis?.flags ?? []), ...m.flags])], citizen_message: message.trim() || undefined, answers: Object.keys(a).length ? a : undefined,
            ai: analysis?.category ? { category: analysis.category, confidence: analysis.confidence, model_version: analysis.model_version, source: analysis.source === "none" ? undefined : analysis.source, disagreement: analysis.disagreement ?? undefined } : undefined,
          }));
        } catch { failed.push(extra); }
      }
      setCreated(all);
      if (failed.length) setSubmitError(`${tr(lang, "extraFailed")}: ${failed.map(f => catName(lang, f)).join(", ")}`);
      setStep(5);
    } catch (err) {
      if (err instanceof ApiError && err.code === "already_reported") void nc.refetch();
      setSubmitError(err instanceof ApiError ? err.message : "Could not submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  /** Photos that do not match the chosen category: shown with the reason, left out by default, the citizen decides. */
  const mismatchPanel = () => mismatched.length === 0 ? null : <div className="mm-panel" role="alert">
    <h3><Icon name="alert" size={17} /> {tr(lang, "mmTitle")}</h3>
    <p>{tr(lang, "mmBody")}</p>
    {mismatched.map(c => { const shot = shotOf(c); const looks = c.looks_like === "not_civic" ? null : c.looks_like;
      return <div className="mm-item" key={c.media_id}>
        <img src={shot?.url ?? c.thumb_url} alt="" />
        <div><b>{looks ? `${tr(lang, "mmLooksLike")} ${catName(lang, looks)} (${Math.round(c.confidence * 100)}%)` : tr(lang, "mmNotCivic")}</b>
          <small>{tr(lang, "mmChosen")}: {catName(lang, effective)} · {tr(lang, "mmNotAttached")}</small>
          <span className="mm-actions">
            {looks && <button className="secondary compact" onClick={() => setFinalCategory(looks)}>{tr(lang, "mmSwitch")} {catName(lang, looks)}</button>}
            {/* A wrong photo is never sent: remove it and pick another. */}
            <button className="primary compact" onClick={() => { if (shot) removeShot(shot.key); uploadRef.current?.click(); }}>{tr(lang, "mmReplace")}</button>
          </span></div></div>; })}
    <button className="text-button" onClick={() => setMmPicking(p => !p)}>{tr(lang, "chooseOwn")}</button>
    {mmPicking && categoryButtons([effective], name => { setFinalCategory(name); setMmPicking(false); })}
  </div>;

  /* Right after the location is set: either "You already reported this (IR-...). Add a photo instead?" or "Already reported here, confirm it instead". */
  const mine = nc.data?.mine ?? null;
  const others = nc.data && !mine && dup !== "raise" ? nc.data.others : [];
  const nearCard = () => mine ? <div className="dup-card" role="alert">
      <h3><Icon name="pin" size={17} /> {trf(lang, "nc_mineTitle", { no: mine.public_id })}</h3>
      <p>{tr(lang, "nc_mineHelp")}</p>
      <input ref={addPhotoRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple hidden onChange={e => { void addPhotos(mine.id, e.target.files); e.target.value = ""; }} />
      <div className="dup-actions"><button className="primary compact" onClick={() => addPhotoRef.current?.click()} disabled={addingPhoto}><Icon name="camera" size={16} /> {addingPhoto ? tr(lang, "submitting") : tr(lang, "nc_addPhoto")}</button></div>
      {photoMsg && <p className="muted-line" role="status">{photoMsg}</p>}
    </div>
    : others.length > 0 ? <div className="dup-card" role="alert">
      <h3><Icon name="pin" size={17} /> {tr(lang, "nc_othersTitle")}</h3>
      <p>{trf(lang, "nc_othersHelp", { m: nc.data?.radius_m ?? 50 })}</p>
      {others.map(o => <div className="dup-item" key={o.id}><b>{o.title}</b><small>{o.distance_m} m · {trf(lang, o.affected_count === 1 ? "nc_people1" : "nc_peopleN", { n: o.affected_count })} · {statusName(lang, o.status)} · {o.public_id}</small>
        <div className="dup-actions">{o.confirmed_by_me ? <span className="muted-line">{tr(lang, "dupAlreadyUpvoted")}</span> : <button className="primary compact" onClick={() => void upvote(o)} disabled={upvoting}>{upvoting ? tr(lang, "submitting") : tr(lang, "nc_confirm")}</button>}</div></div>)}
      <div className="dup-actions"><button className="secondary compact" onClick={() => setDup("raise")}>{tr(lang, "dupRaise")}</button></div>
      {dupError && <div className="form-error" role="alert"><Icon name="alert" size={16} /> {dupError}</div>}
    </div> : null;

  const categoryButtons = (picked: string[], onPick: (name: string) => void, multi = false) => (
    <div className="flow-categories">{categories.map(([name, icon]) => { const n = picked.indexOf(name); return <button className={n >= 0 ? "selected" : ""} aria-pressed={n >= 0} onClick={() => onPick(name)} key={name}><CategoryThumb name={name} icon={icon} /><b>{catName(lang, name)}</b><small>{(CAT_HINT[name] ?? CAT_HINT.Other)[lang]}</small>{n >= 0 && (multi ? <em className="pick-badge">{n === 0 ? tr(lang, "mainBadge") : `+${n}`}</em> : <Icon name="check" />)}</button>; })}</div>
  );

  const canQuestions = selected.length > 0 && selected.every(c => { const q = QUESTIONS[c] ?? []; return q.length === 0 || !!answersBy[c]?.[q[0].id]; });
  const canPhotoLoc = (shots.length > 0 || !!description.trim()) && busyPhotos === 0 && !!spot && !nc.data?.mine;

  return <div className="modal-backdrop" hidden={!open}><div className="report-modal" role="dialog" aria-modal="true" aria-label="Report a problem">
    <div className="report-top"><Brand /><button onClick={close} aria-label={tr(lang, "close")} title={tr(lang, "close")}>×</button></div>
    <div className="progress">{STEP_KEYS.map((k, i) => <div className={step >= i + 1 ? "active" : ""} key={k}><span>{step > i + 1 ? <Icon name="check" size={13} /> : String(i + 1).padStart(2, "0")}</span><b>{tr(lang, k)}</b></div>)}</div>
    <div className="flow-body">
      {step < 5 && <button className="back" onClick={back}>← {tr(lang, "back")}</button>}

      {step === 1 && <><span className="flow-eyebrow">1 · {tr(lang, "stepProblem").toUpperCase()}</span><h2>{tr(lang, "whatNeeds")}</h2><p>{tr(lang, "pickMulti")}</p>
        {categoryButtons(selected, toggleCategory, true)}
        <button className="primary full" disabled={selected.length === 0} onClick={next}>{tr(lang, "next")} <Icon name="arrow" /></button></>}

      {step === 2 && category && <><span className="flow-eyebrow">2 · {tr(lang, "stepQuestions").toUpperCase()}</span><h2>{tr(lang, "fewQuestions")}</h2><p>{tr(lang, "tapAnswer")}</p>
        {selected.map(c => <section className="q-group" key={c}>
          {selected.length > 1 && <h3 className="q-cat"><span>{c === category ? tr(lang, "mainBadge") : tr(lang, "alsoBadge")}</span>{catName(lang, c)}</h3>}
          {(QUESTIONS[c] ?? []).map(q => <div className="q-block" key={q.id}><h3>{q.text[lang]}</h3><div className="problem-list">{q.options.map(opt => <button className={answersBy[c]?.[q.id] === opt.id ? "selected" : ""} onClick={() => setAnswersBy(a => ({ ...a, [c]: { ...a[c], [q.id]: opt.id } }))} key={opt.id}><span>{answersBy[c]?.[q.id] === opt.id && <Icon name="check" />}</span>{optLabel(opt, lang)}</button>)}</div></div>)}
        </section>)}
        <div className="describe-box">
          <div className="describe-head"><label htmlFor="report-description">{tr(lang, "describe")}</label>
            <button type="button" className={recording ? "voice-btn recording" : "voice-btn"} onClick={toggleVoice} aria-pressed={recording}><Icon name="mic" size={18} /> {recording ? tr(lang, "recording") : tr(lang, "voice")}</button></div>
          <textarea id="report-description" value={description} maxLength={500} rows={3} onChange={e => setDescription(e.target.value)} placeholder={tr(lang, "describeEx")} />
          {recording && <p className="muted-line" aria-live="polite">{tr(lang, "listening")} {heard && `“${heard}”`}</p>}
          {voiceNote && <p className="muted-line" role="status">{voiceNote}</p>}
          <small className="muted-line">{tr(lang, "voiceLangs")}</small>
        </div>
        <button className="primary full" disabled={!canQuestions} onClick={next}>{tr(lang, "next")} <Icon name="arrow" /></button></>}

      {step === 3 && <><span className="flow-eyebrow">3 · {tr(lang, "stepPhotoLoc").toUpperCase()}</span><h2>{tr(lang, "photoLocTitle")}</h2><p>{tr(lang, "photoLocHelp")}</p>
        <input ref={uploadRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple hidden onChange={addFiles} />
        <button className="upload-drop" onClick={() => uploadRef.current?.click()} disabled={shots.length >= MAX_PHOTOS}><span><Icon name="plus" size={26} /></span><b>{tr(lang, "uploadPhoto")}</b><small>{shots.length}/{MAX_PHOTOS}</small></button>
        {shots.length > 0 && <div className="photo-strip">{shots.map((s, i) => <div className="upload-preview" key={s.key}><img src={s.url} alt={`Evidence photo ${i + 1}`} /><span><Icon name="check" /> {i + 1} · {Math.round(s.blob.size / 1024)} KB</span><button onClick={() => removeShot(s.key)}>{tr(lang, "remove")}</button>
          {selected.length > 1 && <select className="shot-cat" value={s.cat} onChange={e => assignShot(s.key, e.target.value)} aria-label={tr(lang, "whichProblem")}>{selected.map(c => <option key={c} value={c}>{catName(lang, c)}</option>)}</select>}</div>)}</div>}
        {busyPhotos > 0 && <div className="upload-progress indeterminate" role="status"><i /><small>{tr(lang, "preparing")}</small></div>}
        {photoError && <div className="form-error" role="alert"><Icon name="alert" size={16} /> {photoError}</div>}
        {mismatchPanel()}

        <h3 className="loc-title"><Icon name="pin" size={17} /> {tr(lang, "whereIsIt")}</h3>
        <p className="muted-line">{tr(lang, "whereHelp")}</p>
        {result?.gps_suggestion && spot?.source !== "photo" && <div className="ai-suggest"><span><Icon name="pin" size={16} /> {tr(lang, "photoHasGps")}</span><button className="secondary compact" onClick={() => pickSpot({ ...result.gps_suggestion!, source: "photo" })}>{tr(lang, "use")}</button></div>}
        <div className="location-actions"><button className="primary" onClick={useMyLocation} disabled={locating}><Icon name="pin" /> {locating ? tr(lang, "finding") : tr(lang, "useGps")}</button><span className="muted-line">{tr(lang, "tapMap")}</span></div>
        <LocationPicker spot={spot} onPick={(lat, lng) => pickSpot({ lat, lng, source: "manual" })} />
        {locError && <p className="muted-line">{locError}</p>}
        {nearCard()}
        {spot ? <div className="location-details"><div><small>{tr(lang, "incidentLocation").toUpperCase()}</small><b>{sourceLabel(spot)}{spot.label ? ` · ${spot.label}` : ""}</b></div><div><small>{tr(lang, "coordinates").toUpperCase()}</small><b>{spot.lat.toFixed(5)}, {spot.lng.toFixed(5)}</b></div></div>
          : <div className="empty-note"><Icon name="pin" /><span><b>{tr(lang, "noSpot")}</b></span></div>}
        <label className="field"><span>{tr(lang, "landmark")}</span><input value={landmark} maxLength={120} onChange={e => setLandmark(e.target.value)} /></label>
        {!(shots.length > 0 || description.trim()) && busyPhotos === 0 && <p className="muted-line">{tr(lang, "needEvidence")}</p>}
        <button className="primary full" disabled={!canPhotoLoc} onClick={toReview}>{tr(lang, "next")} <Icon name="arrow" /></button></>}

      {step === 4 && category && spot && <><span className="flow-eyebrow">4 · {tr(lang, "stepReview").toUpperCase()}</span><h2>{tr(lang, "reviewTitle")}</h2><p>{tr(lang, "reviewHelp")}</p>
        {nearCard()}
        {mismatchPanel()}
        <div className="rv-card">
          {mainShots.length > 0 ? <div className="rv-photos">{mainShots.map((s, i) => { const skipped = checks.some(c => isMismatch(c) && shotOf(c)?.key === s.key); return <span className={skipped ? "rv-shot skipped" : "rv-shot"} key={s.key}><img src={s.url} alt={`Evidence photo ${i + 1}`} />{skipped && <em>{tr(lang, "mmNotAttached")}</em>}</span>; })}</div> : <div className="no-photo"><Icon name="mic" size={26} /></div>}
          <dl className="rv-list">
            <div><dt>{tr(lang, "problem")} <Tag kind="you" lang={lang} /></dt><dd><b>{problem} · {catName(lang, effective)}</b> <button className="text-button" onClick={() => setPickingCategory(p => !p)}>{tr(lang, "edit")}</button></dd></div>
            <div><dt>{tr(lang, "incidentLocation")} <Tag kind="you" lang={lang} /></dt><dd>{landmark ? <b>{landmark}</b> : null}{landmark ? <br /> : null}{spot.lat.toFixed(5)}, {spot.lng.toFixed(5)} · {sourceLabel(spot)} <button className="text-button" onClick={() => setStep(3)}>{tr(lang, "edit")}</button><br /><small className="muted-line">{tr(lang, "authoritySees")}</small></dd></div>
            <div><dt>{tr(lang, "areaWard")} <Tag kind="gis" lang={lang} /></dt><dd>{geo.isPending ? "…" : geo.data?.area ?? "—"}{geo.data?.method === "nearest_area_centre" ? ` (${tr(lang, "nearestArea")})` : ""}</dd></div>
            <div><dt>{tr(lang, "department")}</dt><dd>{department ?? "—"}</dd></div>
            <div><dt>{tr(lang, "severity")} <Tag kind="rule" lang={lang} /></dt><dd className={result?.severity === "High" || result?.severity === "Critical" ? "high" : ""}>{result?.severity ?? "—"}{result?.flags.length ? ` · ${result.flags.join(", ")}` : ""}</dd></div>
          </dl>
          {pickingCategory && <>{categoryButtons([effective], name => { setFinalCategory(name); setPickingCategory(false); })}</>}
        </div>
        {extras.length > 0 && <div className="rv-extra"><h3>{tr(lang, "separateReports")}</h3><ul>{extras.map(c => <li key={c}><b>{catName(lang, c)}</b><span>{fromAnswers(c, answersBy[c] ?? {}).problem} · {shots.filter(s => s.cat === c).length} {tr(lang, "photosWord")}</span></li>)}</ul><small className="muted-line">{tr(lang, "extraNote")}</small></div>}

        <div className="rv-ai ai-pro" aria-live="polite">
          <div className="ai-head"><span className="ai-badge"><Icon name="spark" size={16} /></span><div><h3>{tr(lang, "aiTitle")}</h3><small>{tr(lang, "aiSubtitle")}</small></div>
            {result && result.ai_available && pct !== null && <div className={`ai-ring ${sure ? "ok" : "low"}`} style={{ "--p": pct } as React.CSSProperties} role="img" aria-label={`${tr(lang, "confidence")} ${pct}%`}><b>{pct}%</b></div>}</div>
          {aiBusy && <div className="ai-loading"><i /><span>{tr(lang, "analysing")} {mainShots.length > 0 && ai.phase === "loading" && ai.progress < 1 ? `${Math.round(ai.progress * 100)}%` : ""}</span></div>}
          {ai.phase === "failed" && <div className="form-error" role="alert"><Icon name="alert" size={16} /> {tr(lang, "aiUnavailable")}. {mainShots.length > 0 && tr(lang, "photosNotUploaded")} <button className="text-button" onClick={() => void runAnalysis(true)}>{tr(lang, "retry")}</button></div>}
          {result && !result.ai_available && <p className="muted-line">{mainShots.length > 0 && result.media_ids.length > 0 ? tr(lang, "noImageModel") : tr(lang, "aiUnavailable")}</p>}
          {result && result.ai_available && <>
            <div className="ai-main"><small>{tr(lang, "detected")} <Tag kind="ml" lang={lang} /></small><b>{result.category ? catName(lang, result.category) : "—"}</b>
              <div className="ai-chips">{pct !== null && <span className={`ai-chip ${sure ? "ok" : "warn"}`}>{pct}% · {sourceText}{!sure ? ` · ${tr(lang, "lowConf")}` : ""}</span>}
                {result.agreement === "agree" && <span className="ai-chip ok"><Icon name="check" size={13} /> {tr(lang, "aiHigh")}</span>}
                {result.severity && <span className={`ai-chip ${result.severity === "High" || result.severity === "Critical" ? "warn" : ""}`}>{tr(lang, "severity")}: {result.severity}</span>}</div></div>
            {pct !== null && result.image_confidence != null && result.text_confidence != null && <div className="ai-bars">
              <div><span>{tr(lang, "fromPhotoSrc")}</span><i><u style={{ width: `${Math.round(result.image_confidence * 100)}%` }} /></i><b>{Math.round(result.image_confidence * 100)}%</b></div>
              <div><span>{tr(lang, "fromTextSrc")}</span><i><u style={{ width: `${Math.round(result.text_confidence * 100)}%` }} /></i><b>{Math.round(result.text_confidence * 100)}%</b></div></div>}
            <ul className="ai-evidence">
              {imageUsed && result.explanation && <li><span>{tr(lang, "photoEvidence")} <Tag kind="ml" lang={lang} /></span>{result.explanation}</li>}
              {!imageUsed && textUsed && result.explanation && <li><span>{tr(lang, "textEvidence")} <Tag kind="ml" lang={lang} /></span>{result.explanation}</li>}
              {result.flags.length > 0 && <li><span>{tr(lang, "riskFlags")} <Tag kind="rule" lang={lang} /></span>{result.flags.join(", ")}</li>}
              {result.photo_quality.length > 0 && <li><span>{tr(lang, "photoQuality")} <Tag kind="rule" lang={lang} /></span>{result.photo_quality.map((q, i) => `${i + 1}: ${tr(lang, qualityKey(q.label))}`).join(" · ")}</li>}
            </ul></>}
          {result && result.ai_available && !result.image_model_active && mainShots.length > 0 && <p className="muted-line">{tr(lang, "photoNotAnalysed")}</p>}
          {result && result.photo_errors.length > 0 && <p className="muted-line">{result.photo_errors.length} {tr(lang, "photosSkipped")}: {result.photo_errors[0].message}</p>}
          {result?.not_civic && <p className="muted-line">{tr(lang, "notCivic")}</p>}
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
        {!hasEvidence && <p className="muted-line" role="status">{tr(lang, "needEvidenceAfter")}</p>}
        {others.length > 0 && <p className="muted-line" role="status">{tr(lang, "dupChoose")}</p>}
        <button className="primary full" onClick={() => void submit()} disabled={!consent || submitting || aiBusy || !hasEvidence || !!mine || others.length > 0}>{submitting ? tr(lang, "submitting") : tr(lang, "confirmSubmit")} <Icon name="arrow" /></button></>}

      {step === 5 && created.length > 0 && <div className="success-screen"><svg className="check-anim" viewBox="0 0 52 52" aria-hidden="true"><circle className="check-circle" cx="26" cy="26" r="24" fill="none" /><path className="check-mark" fill="none" d="M14 27l8 8 16-17" /></svg>
        <h2>{dup === "upvoted" ? tr(lang, "dupDone") : tr(lang, "success")}</h2>
        {created.map(c => <div className="report-id" key={c.report_id}><small>{tr(lang, "reportId").toUpperCase()}</small><b>{c.incident_public_id}</b><span>{c.status}</span><p>{c.merged ? `${tr(lang, "merged")} ${c.affected_count}` : ""}{c.area ? ` ${c.area}` : ""}{c.department ? ` · ${c.department}` : ""}</p></div>)}
        {submitError && <div className="form-error" role="alert"><Icon name="alert" size={16} /> {submitError}</div>}
        <p>{tr(lang, "trackIt")}</p>
        <button className="primary full" onClick={() => done(created[0])}>{tr(lang, "trackBtn")} <Icon name="arrow" /></button></div>}

      {step < 5 && (shots.length > 0 || description || spot || selected.length > 0) && <button className="text-button discard" onClick={discard}>{tr(lang, "startOver")}</button>}
    </div></div></div>;
}
