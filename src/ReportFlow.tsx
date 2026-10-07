import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Icon } from "./Icon";
import { Brand, categories, problems } from "./brand";
import { analyze, api, ApiError, type Analysis, type ReportCreated } from "./api";
import { compressPhoto, PhotoTooLargeError } from "./compress";
import { AREA_CENTRES } from "./store";

type Lang = "en" | "hi" | "mr";
type Shot = { key: string; blob: Blob; url: string };
type Ai = { phase: "idle" } | { phase: "loading"; progress: number } | { phase: "done"; result: Analysis } | { phase: "failed"; message: string };
type Spot = { lat: number; lng: number; source: string };

const SPEECH_LANG: Record<Lang, string> = { en: "en-IN", hi: "hi-IN", mr: "mr-IN" };
const MAX_PHOTOS = 3;

type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
const SpeechRecognitionImpl = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;

function mapSrc({ lat, lng }: Spot) {
  const dLat = 0.0175, dLng = 0.0195;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${(lng - dLng).toFixed(4)}%2C${(lat - dLat).toFixed(4)}%2C${(lng + dLng).toFixed(4)}%2C${(lat + dLat).toFixed(4)}&layer=mapnik&marker=${lat.toFixed(5)}%2C${lng.toFixed(5)}`;
}

export default function ReportFlow({ close, done, lang, area }: { close: () => void; done: (created: ReportCreated) => void; lang: Lang; area: string }) {
  const [step, setStep] = useState(1), [category, setCategory] = useState("Pothole"), [problem, setProblem] = useState("Large");
  const [shots, setShots] = useState<Shot[]>([]), [photoError, setPhotoError] = useState(""), [busyPhotos, setBusyPhotos] = useState(0);
  const [description, setDescription] = useState(""), [recording, setRecording] = useState(false), [voiceNote, setVoiceNote] = useState("");
  const [location, setLocation] = useState(""), [spot, setSpot] = useState<Spot>(() => ({ ...(AREA_CENTRES[area] ?? AREA_CENTRES["Andheri West"]), source: `${area} (area centre)` }));
  const [locating, setLocating] = useState(false), [locError, setLocError] = useState("");
  const [ai, setAi] = useState<Ai>({ phase: "idle" }), [finalCategory, setFinalCategory] = useState("Pothole");
  const [consent, setConsent] = useState(true), [submitting, setSubmitting] = useState(false), [submitError, setSubmitError] = useState("");
  const [created, setCreated] = useState<ReportCreated | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null), uploadRef = useRef<HTMLInputElement>(null), recRef = useRef<Recognition | null>(null), abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [close]);
  const shotsRef = useRef(shots);
  shotsRef.current = shots;
  useEffect(() => () => { shotsRef.current.forEach(s => URL.revokeObjectURL(s.url)); recRef.current?.stop(); abortRef.current?.abort(); }, []);

  const labels = ["Category", "Problem", "Evidence & Location", "AI Understanding", "Confirm", "Submitted"];
  const next = () => setStep(s => Math.min(6, s + 1));
  const options = useMemo(() => problems[category] || ["Damaged", "Not working", "Unsafe condition", "Other"], [category]);

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
    rec.onresult = ev => setDescription((before + Array.from(ev.results).map(r => r[0].transcript).join(" ")).slice(0, 500));
    rec.onend = () => setRecording(false);
    rec.onerror = () => { setRecording(false); setVoiceNote("Could not hear you. Please try again or type instead."); };
    recRef.current = rec;
    setVoiceNote("");
    setRecording(true);
    rec.start();
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) { setLocError("Location is not available on this device."); return; }
    setLocating(true); setLocError("");
    navigator.geolocation.getCurrentPosition(
      p => { setSpot({ lat: p.coords.latitude, lng: p.coords.longitude, source: "Your current location" }); setLocating(false); },
      () => { setLocError("Could not get your location. The area centre is used; add a landmark below."); setLocating(false); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  /* ---------- AI ---------- */
  const runAnalysis = async () => {
    recRef.current?.stop();
    setStep(4);
    setAi({ phase: "loading", progress: 0 });
    setFinalCategory(category);
    const form = new FormData();
    shots.forEach((s, i) => form.append("photos", s.blob, `photo-${i + 1}.${s.blob.type === "image/webp" ? "webp" : "jpg"}`));
    if (description.trim()) form.append("text", description.trim());
    form.append("lang", lang); form.append("lat", String(spot.lat)); form.append("lng", String(spot.lng));
    form.append("category", category); form.append("problem_type", problem);
    abortRef.current = new AbortController();
    try {
      const result = await analyze(form, progress => setAi(a => (a.phase === "loading" ? { phase: "loading", progress } : a)), abortRef.current.signal);
      setAi({ phase: "done", result });
    } catch (err) {
      if (err instanceof ApiError && err.code === "aborted") return;
      setAi({ phase: "failed", message: err instanceof ApiError && err.status >= 400 && err.status < 500 ? err.message : "iREPORT could not analyse this right now." });
    }
  };

  const result = ai.phase === "done" ? ai.result : null;
  const sure = !!(result && result.category && !result.uncertain);
  const mediaIds = result?.media_ids ?? [];
  const photoUploadFailed = ai.phase === "failed" && shots.length > 0;
  const pct = result?.confidence != null ? Math.round(result.confidence * 100) : null;
  const firstImage = shots[0]?.url;

  const submit = async () => {
    setSubmitting(true); setSubmitError("");
    try {
      const res = await api.createReport({
        media_ids: mediaIds, category: finalCategory, problem_type: problem, description: description.trim() || undefined,
        lat: spot.lat, lng: spot.lng, address_text: location.trim() || undefined, area,
        flags: result?.flags ?? [],
        ai: result?.category ? { category: result.category, confidence: result.confidence, model_version: result.model_version } : undefined,
      });
      setCreated(res);
      next();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Could not submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const picker = <div className="flow-categories compact-picker">{categories.map(([name, icon]) => <button className={finalCategory === name ? "selected" : ""} onClick={() => setFinalCategory(name)} key={name}><span><Icon name={icon} size={22} /></span><b>{name}</b>{finalCategory === name && <Icon name="check" />}</button>)}</div>;

  return <div className="modal-backdrop"><div className="report-modal" role="dialog" aria-modal="true" aria-label="Report a problem"><div className="report-top"><Brand /><button onClick={close} aria-label="Close report">×</button></div><div className="progress">{labels.map((x, i) => <div className={step >= i + 1 ? "active" : ""} key={x}><span>{step > i + 1 ? <Icon name="check" size={13} /> : String(i + 1).padStart(2, "0")}</span><b>{x}</b></div>)}</div><div className="flow-body">
    {step === 1 && <><span className="flow-eyebrow">STEP 01 · CATEGORY</span><h2>What needs attention?</h2><p>Select the closest category. You can correct it later.</p><div className="flow-categories">{categories.map(([name, icon]) => <button className={category === name ? "selected" : ""} onClick={() => { setCategory(name); setProblem(problems[name]?.[0] || "Damaged"); }} key={name}><span><Icon name={icon} size={27} /></span><b>{name}</b>{category === name && <Icon name="check" />}</button>)}</div><button className="primary full" onClick={next}>Continue to problem <Icon name="arrow" /></button></>}

    {step === 2 && <><span className="flow-eyebrow">STEP 02 · SPECIFIC PROBLEM</span><h2>What kind of {category.toLowerCase()}?</h2><p>Choose one. No typing needed.</p><div className="problem-list">{options.map(x => <button className={problem === x ? "selected" : ""} onClick={() => setProblem(x)} key={x}><span>{problem === x && <Icon name="check" />}</span>{x}</button>)}</div><button className="primary full" onClick={next}>Continue <Icon name="arrow" /></button></>}

    {step === 3 && <><span className="flow-eyebrow">STEP 03 · EVIDENCE & LOCATION</span><h2>Show us the problem and where it is.</h2><p>Add up to 3 photos or a voice note, then confirm the location on the map.</p>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={addFiles} />
      <input ref={uploadRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple hidden onChange={addFiles} />
      {shots.length > 0 && <div className="photo-strip">{shots.map((s, i) => <div className="upload-preview" key={s.key}><img src={s.url} alt={`Evidence photo ${i + 1}`} /><span><Icon name="check" /> Photo {i + 1} ready · {Math.round(s.blob.size / 1024)} KB</span><button onClick={() => removeShot(s.key)}>Remove</button></div>)}</div>}
      {busyPhotos > 0 && <div className="upload-progress indeterminate" role="status"><i /><small>Preparing photo…</small></div>}
      {photoError && <div className="form-error" role="alert"><Icon name="alert" size={16} /> {photoError}</div>}
      <div className="capture-grid">
        <button onClick={() => cameraRef.current?.click()} disabled={shots.length >= MAX_PHOTOS}><span><Icon name="camera" size={30} /></span><b>Take Photo</b><small>{shots.length >= MAX_PHOTOS ? "3 photos added" : "Use your camera"}</small></button>
        <button onClick={() => uploadRef.current?.click()} disabled={shots.length >= MAX_PHOTOS}><span><Icon name="plus" size={30} /></span><b>Upload Photo</b><small>Choose from device · up to 3</small></button>
        <button className={recording ? "recording" : ""} onClick={toggleVoice}><span><Icon name="mic" size={30} /></span><b>{recording ? "Recording… tap to stop" : "Tell us by Voice"}</b><small>{recording ? "Listening" : "English · हिन्दी · मराठी"}</small></button>
      </div>
      <label className="field describe"><span>Describe it (optional)</span><textarea id="report-description" value={description} maxLength={500} rows={2} onChange={e => setDescription(e.target.value)} placeholder="For example: open wire near the school gate" /></label>
      {voiceNote && <p className="muted-line">{voiceNote}</p>}
      <div className="evidence-divider"><span>REPORT LOCATION</span></div>
      <div className="location-actions"><button className="primary" onClick={useMyLocation} disabled={locating}><Icon name="pin" /> {locating ? "Finding you…" : "Use my current location"}</button><label><Icon name="search" /><input value={location} maxLength={200} onChange={e => setLocation(e.target.value)} placeholder="Landmark, street or locality" aria-label="Search an area, landmark, street or locality" /></label></div>
      {locError && <p className="muted-line">{locError}</p>}
      <div className="flow-map"><iframe title="Choose report location on OpenStreetMap" src={mapSrc(spot)} /><span><Icon name="pin" /> Move the map and confirm the pin</span></div>
      <div className="location-details"><div><small>REPORT LOCATION</small><b>{spot.source}</b></div><div><small>AREA</small><b>{area}</b></div><div><small>LANDMARK / ADDRESS</small><b>{location || "Not added"}</b></div></div>
      <div className="mini-loop"><span>SEE</span><i>→</i><span>CAPTURE</span><i>→</i><span>LOCATE</span><i>→</i><span>AI UNDERSTANDS</span></div>
      <button className="primary full" disabled={(shots.length === 0 && !description.trim()) || busyPhotos > 0} onClick={runAnalysis}>Analyse report <Icon name="arrow" /></button></>}

    {step === 4 && <><span className="flow-eyebrow">STEP 04 · AI UNDERSTANDING</span><h2>Here’s what iREPORT understands.</h2><p>Review this suggestion. Nothing changes without you.</p>
      {ai.phase === "loading" && <div className="analysis-card skeleton-card" aria-busy="true"><div className="analysis-image">{firstImage ? <img src={firstImage} alt="Evidence being analysed" /> : <div className="skeleton-block" />}<span>{ai.progress < 1 && shots.length ? "UPLOADING" : "ANALYSING"}</span></div><div className="analysis-info"><div className="skeleton-line w60" /><div className="skeleton-line w90" /><div className="skeleton-line w75" /><div className="skeleton-line w50" />{shots.length > 0 && <div className="upload-progress" role="progressbar" aria-valuenow={Math.round(ai.progress * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.round(ai.progress * 100)}%` }} /><small>{ai.progress < 1 ? `Uploading ${Math.round(ai.progress * 100)}%` : "Looking at your photo…"}</small></div>}</div></div>}
      {(ai.phase === "done" || ai.phase === "failed") && <>
        <div className="analysis-card"><div className="analysis-image">{firstImage ? <img src={firstImage} alt="Evidence being analysed" /> : <div className="no-photo"><Icon name="mic" size={30} /><small>Description only</small></div>}<span>VISUAL ESTIMATE</span></div><div className="analysis-info">
          <div className="analysis-head"><span className="ai-icon"><Icon name="spark" /></span><div><small>{sure ? "POSSIBLE ISSUE" : "NOT SURE"}</small><h3>{sure ? `${problem} ${result!.category!.toLowerCase()}` : "Not sure, please choose the category"}</h3></div><strong>{sure && pct !== null ? `${pct}%` : "?"}</strong></div>
          <dl><div><dt>Category</dt><dd>{finalCategory}</dd></div><div><dt>Confidence</dt><dd>{pct !== null ? `${pct}% · ${sure ? (pct >= 85 ? "likely match" : "possible match") : "low"}` : "Not available"}</dd></div><div><dt>Severity</dt><dd className={result?.severity === "High" || result?.severity === "Critical" ? "high" : ""}>{result?.severity ?? "Set after review"}</dd></div><div><dt>Evidence</dt><dd>{shots.length ? `${shots.length} photo${shots.length > 1 ? "s" : ""}` : "Description"}{description.trim() && shots.length ? " + description" : ""}</dd></div><div><dt>Approx. visual size</dt><dd>{problem} — not a physical measurement</dd></div></dl>
          <div className="why"><Icon name="spark" /><span><b>Why iREPORT thinks this</b>{result?.explanation ?? (ai.phase === "failed" ? ai.message : "iREPORT could not tell from this evidence. Your own choice is used.")}</span></div>
        </div></div>
        {ai.phase === "failed" && <div className="form-error" role="alert"><Icon name="alert" size={16} /> {photoUploadFailed ? "Your photos were not uploaded. Retry, or continue without them." : ai.message} <button className="text-button" onClick={runAnalysis}>Retry</button></div>}
        {result?.not_civic && <p className="muted-line">This photo may not show a civic problem. Choose the category below, or go back and add another photo.</p>}
        {result?.disagreement && <p className="muted-line">The photo looks like <b>{result.disagreement.image}</b>, but the description sounds like <b>{result.disagreement.text}</b>. Please choose.</p>}
        {sure && result!.category !== category && <div className="ai-suggest"><span>You chose <b>{category}</b>. iREPORT suggests <b>{result!.category}</b>.</span><button className={finalCategory === result!.category ? "secondary compact selected" : "secondary compact"} onClick={() => setFinalCategory(result!.category!)}>Use {result!.category}</button><button className={finalCategory === category ? "secondary compact selected" : "secondary compact"} onClick={() => setFinalCategory(category)}>Keep {category}</button></div>}
        {!sure && <><h3 className="picker-title">Not sure, please choose the category</h3>{picker}</>}
        {result?.gps_suggestion && spot.source !== "Photo location" && <div className="ai-suggest"><span><Icon name="pin" size={16} /> Your photo has a location.</span><button className="secondary compact" onClick={() => setSpot({ ...result.gps_suggestion!, source: "Photo location" })}>Use photo location</button></div>}
        <div className="two-actions"><button className="primary" onClick={next}><Icon name="check" /> Confirm</button><button className="secondary" onClick={() => setStep(1)}>Correct</button></div>
      </>}</>}

    {step === 5 && <><span className="flow-eyebrow">STEP 05 · CONFIRM</span><h2>Ready to report.</h2><p>Check the essentials once more before submitting.</p><div className="confirm-card">{firstImage ? <img src={firstImage} alt="Report evidence" /> : <div className="no-photo"><Icon name="reports" size={30} /></div>}<div><span><small>PROBLEM</small><b>{problem} {finalCategory.toLowerCase()}</b></span><span><small>LOCATION</small><b>{location || spot.source}</b></span><span><small>SEVERITY</small><b className={result?.severity === "High" || result?.severity === "Critical" ? "high" : ""}>{result?.severity ?? "Set after review"}{result?.flags.length ? ` · ${result.flags.join(", ").toLowerCase()}` : ""}</b></span><span><small>EVIDENCE</small><b>{mediaIds.length ? `${mediaIds.length} photo${mediaIds.length > 1 ? "s" : ""} attached` : shots.length ? "Photos not uploaded" : "Description only"}</b></span></div></div><label className="consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> I confirm this report is accurate to the best of my knowledge.</label>{submitError && <div className="form-error" role="alert"><Icon name="alert" size={16} /> {submitError}</div>}<button className="primary full" onClick={submit} disabled={!consent || submitting}>{submitting ? "Submitting…" : "Submit report"} <Icon name="arrow" /></button></>}

    {step === 6 && created && <div className="success-screen"><span className="success-icon"><Icon name="check" size={38} /></span><span className="flow-eyebrow">REPORT SUBMITTED</span><h2>Your report is on its way.</h2><p>{created.merged ? `Added to an existing report nearby. ${created.affected_count} people have reported this.` : "You’ll receive an update when its status changes."}</p><div className="report-id"><small>REPORT ID</small><b>{created.incident_public_id}</b><span>{created.status}</span></div><div className="submitted-list"><span><Icon name="check" /> {mediaIds.length ? "Evidence attached" : "Description saved"}</span><span><Icon name="check" /> Location saved</span><span><Icon name="check" /> Citizen confirmation saved</span></div><button className="primary full" onClick={() => done(created)}>Track my report <Icon name="arrow" /></button></div>}
    {step > 1 && step < 6 && <button className="back" onClick={() => { if (step === 4) abortRef.current?.abort(); setStep(s => s - 1); }}>← Back</button>}
  </div></div></div>;
}
