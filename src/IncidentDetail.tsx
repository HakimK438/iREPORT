import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "./Icon";
import { CATEGORY_NAMES, isOpen, type ResponseCat, type Status } from "./store";
import { api, ApiError, type Brief, type ProofUploaded, type Reason } from "./api";
import { CategoryPhoto } from "./brand";
import ProofCard from "./ProofCard";
import { tr, trf, type Lang, type StrKey } from "./i18n";
import { catLabel, deptLabel } from "./i18nStaff";
import { areaSlug, LOCALE, navigateUrl, nextAction, shortDate, tone, type NextAction } from "./facts";

/* The incident brief: one complaint read top to bottom like a work order. Each fact appears once.
   Header, what, why urgent, where, evidence, history at this spot, nearby open work, timeline, messages, next action. */

const BASE = import.meta.env.BASE_URL;

export const Tag = ({ kind, lang = "en" }: { kind: "ml" | "rule" | "gis" | "you"; lang?: Lang }) => {
  const key = kind === "ml" ? "tagMl" : kind === "rule" ? "tagRule" : kind === "gis" ? "tagGis" : "tagYou";
  return <em className={`src-tag src-${kind}`}>{tr(lang, key)}</em>;
};

/** Status in the officer's words (the citizen app words it differently). */
export const staffStatus = (lang: Lang, s: string): string => { const k = `ss_${s.replace(" ", "")}` as StrKey; return tr(lang, k); };
export const StatusPill = ({ status, lang }: { status: string; lang: Lang }) => <span className={`pill st-${status.toLowerCase().replace(" ", "-")}`}>{staffStatus(lang, status)}</span>;
/** The four hazard categories. They come straight from the stored risk (impact x likelihood), never from a typed-in number: CRITICAL 12+, HIGH RISK 8-11,
    MODERATE RISK 4-7, ROUTINE below 4. Icon, colour and word say the same thing, so colour is never the only signal. */
const SEV_IMG: Record<ResponseCat, string> = { Emergency: "critical.png", Urgent: "high_risk.png", Routine: "moderate_risk.png", Planned: "daily_routine.png" };
const SevImg = ({ response, size }: { response: ResponseCat; size: number }) => <img className="sev-img" src={`${BASE}symbols/${SEV_IMG[response]}`} alt="" width={size} height={size} loading="lazy" />;
export const ResponseChip = ({ response, lang }: { response: ResponseCat; lang: Lang }) => <span className={`resp resp-${response.toLowerCase()}`} title={tr(lang, `resp_${response}_tip` as StrKey)}><SevImg response={response} size={24} />{tr(lang, `resp_${response}` as StrKey)}</span>;

/** "Due 12 Oct" or "Overdue 2 days" (red). Nothing for a complaint that is no longer open, except Resolved: awaiting the citizen. */
export function DueText({ row, lang }: { row: { status: string; due_at: string | null; overdue: boolean; overdue_days: number; created_at?: string }; lang: Lang }) {
  const when = (iso: string) => new Date(iso).toLocaleString(LOCALE[lang], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const tip = row.created_at && row.due_at ? `${when(row.created_at)} → ${when(row.due_at)}` : undefined; // reported → deadline
  if (row.status === "Resolved") return <span className="due">{tr(lang, "v_awaiting")}</span>;
  if (!isOpen(row.status) || !row.due_at) return null;
  if (row.overdue) {
    const n = row.overdue_days;
    return <span className="due red" title={tip}>{n < 1 ? tr(lang, "v_overdueToday") : trf(lang, "v_overdueBy", { n, unit: tr(lang, n === 1 ? "s_day" : "s_days") })}</span>;
  }
  return <span className="due" title={tip}>{trf(lang, "v_due", { date: shortDate(row.due_at, lang) })}</span>;
}

/** A photo from the citizen when there is one, otherwise the picture of the category, so a card is never blank. */
export function Evidence({ url, category, alt, className }: { url: string | null | undefined; category: string; alt: string; className?: string }) {
  const [bad, setBad] = useState<string | null>(null);
  if (url && bad !== url) return <img className={className} src={url} alt={alt} loading="lazy" onError={() => setBad(url)} />;
  return <span className={`no-photo ${className ?? ""}`} role="img" aria-label={alt}><Icon name="camera" size={18} /><small>No photo</small></span>;
}

export function mapSrc(lat: number, lng: number) {
  return `https://www.openstreetmap.org/export/embed.html?bbox=${(lng - 0.004).toFixed(4)}%2C${(lat - 0.003).toFixed(4)}%2C${(lng + 0.004).toFixed(4)}%2C${(lat + 0.003).toFixed(4)}&layer=mapnik&marker=${lat.toFixed(5)}%2C${lng.toFixed(5)}`;
}

/** Wording of one "why urgent" reason; the source is shown next to it ("checked on map" / "citizen says" / ...). */
export function reasonText(lang: Lang, r: Reason): string {
  const p = r.params;
  switch (r.code) {
    case "impact_4": return trf(lang, "v_r_life", { category: catLabel(lang, p.category ?? "") });
    case "impact_3": return trf(lang, "v_r_injury", { category: catLabel(lang, p.category ?? "") });
    case "severity_raise": return tr(lang, "v_r_dangerous");
    case "main_road": return p.name ? trf(lang, "v_r_roadNamed", { name: p.name }) : tr(lang, "v_r_road");
    case "near_sensitive": {
      const kind = tr(lang, p.kind === "hospital" ? "v_kind_hospital" : "v_kind_school");
      if (p.distance_m != null) return trf(lang, "v_r_nearPlace", { m: p.distance_m, place: p.name ?? kind });
      return trf(lang, "v_r_nearKind", { kind });
    }
    case "many_citizens": return trf(lang, "v_r_citizens", { n: p.n ?? 0 });
    case "monsoon": return tr(lang, "v_r_monsoon");
    case "night": return tr(lang, "v_r_night");
    default: return r.code;
  }
}

/** One generated sentence: what, with the street or landmark, and the school or hospital found on the map. */
function whatSentence(d: Brief, lang: Lang): string {
  const place = d.what.address ?? d.where.area ?? "";
  let s = lang === "en" ? d.title : place ? trf(lang, "v_whatAt", { category: catLabel(lang, d.category), place }) : catLabel(lang, d.category);
  if (d.what.near) s += `, ${trf(lang, "v_whatNear", { m: d.what.near.distance_m, place: d.what.near.name ?? tr(lang, d.what.near.kind === "hospital" ? "v_kind_hospital" : "v_kind_school") })}`;
  return s;
}

/** Picture of the locality (public/areas/<area>.png, from the Location_images folder). Small and lazy; nothing is shown when the area has no picture. */
function AreaPhoto({ area }: { area: string | null }) {
  const [bad, setBad] = useState<string | null>(null);
  if (!area || bad === area) return null;
  return <figure className="area-photo"><img src={`${BASE}areas/${areaSlug(area)}.png`} alt={area} loading="lazy" onError={() => setBad(area)} /><figcaption>{area}</figcaption></figure>;
}

type Panel = null | "assign" | "schedule" | "hold" | "reject" | "duplicate" | "transfer" | "resolve";

/** Print this complaint only. Two complaints can be open at once (list and map); without this both would be printed. */
function printBrief(button: HTMLElement) {
  const brief = button.closest(".brief");
  if (!brief) { window.print(); return; }
  brief.classList.add("printing-this");
  document.body.classList.add("print-one");
  const done = () => { brief.classList.remove("printing-this"); document.body.classList.remove("print-one"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  window.print();
}

export default function Brief({ id, lang = "en", readOnly = false, onClose }: { id: string; lang?: Lang; readOnly?: boolean; onClose?: () => void }) {
  const qc = useQueryClient();
  // Photo links are signed for 15 minutes, so refresh the open brief every 10 minutes.
  const q = useQuery({ queryKey: [readOnly ? "admin" : "authority", "incident", id], queryFn: () => (readOnly ? api.adminIncident(id) : api.authorityDetail(id)), refetchInterval: 10 * 60_000 });
  const d = q.data;
  const [panel, setPanel] = useState<Panel>(null);
  const [reply, setReply] = useState("");
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [officer, setOfficer] = useState("");
  const [category, setCategory] = useState("");
  const [copied, setCopied] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  // The site photo taken before "Resolved": uploaded with the phone's position, checked by the server, used up by the Resolved action.
  const [proof, setProof] = useState<ProofUploaded | null>(null), [proofBusy, setProofBusy] = useState(false), [proofError, setProofError] = useState("");
  const proofInput = useRef<HTMLInputElement>(null);
  const takeProof = async (file: File) => {
    setProofError(""); setProofBusy(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!navigator.geolocation) { reject(new Error(tr(lang, "v_proofNoGps"))); return; }
        navigator.geolocation.getCurrentPosition(resolve, e => reject(new Error(e.code === 1 ? tr(lang, "v_proofDenied") : tr(lang, "v_proofNoGps"))), { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 });
      });
      const form = new FormData();
      form.append("photo", file); form.append("lat", String(pos.coords.latitude)); form.append("lng", String(pos.coords.longitude)); form.append("accuracy_m", String(pos.coords.accuracy));
      setProof(await api.uploadProof(id, form));
    } catch (e) { setProof(null); setProofError((e as Error).message); } finally { setProofBusy(false); if (proofInput.current) proofInput.current.value = ""; }
  };
  const officers = useQuery({ queryKey: ["authority", "officers"], queryFn: api.officers, enabled: !readOnly && (panel === "assign"), staleTime: 5 * 60_000 });

  const refresh = () => {
    for (const key of [["authority", "list"], ["authority", "stats"], ["authority", "incident", id], ["authority", "map"], ["authority", "analytics"]]) qc.invalidateQueries({ queryKey: key });
    setPanel(null); setText(""); setReply(""); setProof(null); setProofError("");
  };
  const review = useMutation({ mutationFn: (v: { decision: "genuine" | "fake" }) => api.authorityReview(id, v.decision, reviewNote.trim() || undefined), onSuccess: refresh });
  const act = useMutation({ mutationFn: (body: Parameters<typeof api.authorityUpdate>[1]) => api.authorityUpdate(id, body), onSuccess: refresh });

  if (q.isPending) return <div className="brief" aria-busy="true"><div className="skeleton-line w75" /><div className="skeleton-line w50" /><div className="skeleton-line w90" /></div>;
  if (q.isError || !d) return <div className="brief"><p className="muted-line">{tr(lang, "s_loadDetailFail")} <button className="text-button" onClick={() => q.refetch()}>{tr(lang, "s_retry")}</button></p></div>;

  const t = tone(d);
  const status = d.status as Status;
  const action: NextAction = readOnly ? null : nextAction(d);
  const open = isOpen(status);
  const stamp = (iso: string) => new Date(iso).toLocaleString(LOCALE[lang], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const span = (ms: number) => { const h = Math.max(1, Math.round(ms / 3_600_000)); return h >= 48 ? `${Math.round(h / 24)} ${tr(lang, "s_days")}` : `${h} ${tr(lang, h === 1 ? "v_hourWord" : "v_hoursWord")}`; };
  // One line from the image model: what the first checked photo looks like, and whether that fits the reported problem.
  const checked = d.evidence.flatMap(e => e.photos).find(ph => ph.ai_label && ph.ai_conf != null);
  const MERGE: Record<string, string> = { "Road Damage": "Pothole", Drainage: "Water Leakage" };
  const aiLine = !checked ? tr(lang, "v_aiNone") : (() => {
    const label = checked.ai_label === "not_civic" ? tr(lang, "v_aiNotCivic") : catLabel(lang, checked.ai_label!);
    const same = checked.ai_label !== "not_civic" && (checked.ai_label === "Other" || d.category === "Other" || (MERGE[checked.ai_label!] ?? checked.ai_label) === (MERGE[d.category] ?? d.category));
    return trf(lang, same ? "v_aiMatch" : "v_aiDiff", { label, pct: Math.round((checked.ai_conf ?? 0) * 100), category: catLabel(lang, d.category) });
  })();
  const firstOfficerStep = d.timeline.find(h => h.by && h.status !== "Reported");
  const basis = {
    rule: d.due_at ? trf(lang, "v_basisRule", { rep: stamp(d.created_at), level: tr(lang, `resp_${d.response}` as StrKey), within: span(d.response_hours * 3_600_000), due: stamp(d.due_at) }) : "",
    state: !d.due_at || !open ? "" : d.overdue ? trf(lang, "v_basisLate", { late: span(Date.now() - new Date(d.due_at).getTime()), status: staffStatus(lang, status) }) : trf(lang, "v_basisLeft", { left: span(new Date(d.due_at).getTime() - Date.now()) }),
    acted: firstOfficerStep ? trf(lang, "v_basisActed", { when: stamp(firstOfficerStep.at) }) : (open ? tr(lang, "v_basisNobody") : ""),
    owner: d.assignee ? trf(lang, "v_basisOwner", { name: d.assignee.name }) : tr(lang, "v_basisNoOwner"),
  };
  const reasons = d.reasons.slice(0, 3);
  // Plain text for the field crew: what, where, how urgent and a map link. No reporter names or phone numbers.
  const crewText = [`${d.public_id}: ${catLabel("en", d.category)}${d.what.problem ? ` (${d.what.problem})` : ""}`, [d.where.address, d.where.area].filter(Boolean).join(", "),
    `${tr("en", `resp_${d.response}` as StrKey)}${d.due_at ? `, fix by ${new Date(d.due_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}`,
    `https://maps.google.com/?q=${d.where.lat.toFixed(6)},${d.where.lng.toFixed(6)}`].filter(Boolean).join("\n");
  const photoDisagrees = !!d.ai.category && d.ai.source !== "text" && catLabel("en", d.ai.category) !== catLabel("en", d.category);
  const estimate = d.people_estimate === "few" ? tr(lang, "v_est_few") : d.people_estimate === "many" ? tr(lang, "v_est_many") : null;
  const dept = deptLabel(lang, d.department);
  const run = (body: Parameters<typeof api.authorityUpdate>[1]) => act.mutate(body);
  const primaryLabel: Record<Exclude<NextAction, null>, StrKey> = { acknowledge: "v_a_acknowledge", assign: "v_a_assign", schedule: "v_a_schedule", start: "v_a_start", resume: "v_a_resume", resolve: "v_a_resolve" };
  const doPrimary = () => {
    if (action === "acknowledge") run({ status: "Acknowledged" });
    else if (action === "start" || action === "resume") run({ status: "In Progress" });
    else if (action) setPanel(action); // "resolve" opens the note box: a fix is never closed without saying what was done
  };
  const copyLocation = async () => {
    const link = `https://maps.google.com/?q=${d.where.lat.toFixed(6)},${d.where.lng.toFixed(6)}`;
    try { await navigator.clipboard.writeText([d.where.address, d.where.area, link].filter(Boolean).join(", ")); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked: nothing to do */ }
  };
  const submitPanel = () => {
    if (panel === "assign") run({ assigned_to: officer || officers.data?.items[0]?.id });
    else if (panel === "schedule") run({ status: "Scheduled", scheduled_for: date });
    else if (panel === "hold") run({ status: "On Hold", reason: text.trim() });
    else if (panel === "reject") run({ status: "Rejected", reason: text.trim() });
    else if (panel === "resolve") run({ status: "Resolved", reason: text.trim() });
    else if (panel === "duplicate") run({ status: "Duplicate", duplicate_of: text.trim() });
    else if (panel === "transfer") run({ status: "Transferred", category, reason: text.trim() });
  };
  const panelReady = panel === "resolve" ? text.trim().length >= 5 && (!d.proof_required || !!proof) : panel === "assign" ? !!(officer || officers.data?.items.length) : panel === "schedule" ? !!date : panel === "transfer" ? !!category && !!text.trim() : !!text.trim();
  const moreItems: { key: Panel | "ack" | "start" | "res"; label: StrKey }[] = [];
  if (!readOnly && open) {
    if (action !== "schedule") moreItems.push({ key: "schedule", label: "v_a_schedule" });
    if (action !== "resolve") moreItems.push({ key: "res", label: "v_a_resolve" });
    if (status !== "On Hold") moreItems.push({ key: "hold", label: "v_m_hold" });
    moreItems.push({ key: "reject", label: "v_m_reject" }, { key: "duplicate", label: "v_m_duplicate" }, { key: "transfer", label: "v_m_transfer" });
  } else if (!readOnly && status === "Resolved") moreItems.push({ key: "start", label: "v_m_rework" });
  const pickMore = (k: Panel | "ack" | "start" | "res") => { if (k === "ack") run({ status: "Acknowledged" }); else if (k === "start") run({ status: "In Progress" }); else if (k === "res") setPanel("resolve"); else setPanel(k); };

  return <div className={`brief tone-${t}`}>
    <header className="brief-head">
      <div className="brief-id"><b>{d.public_id}</b><span className="cat-tag"><CategoryPhoto category={d.category} className="cat-dot" label={false} />{catLabel(lang, d.category)}</span><StatusPill status={status} lang={lang} /><ResponseChip response={d.response} lang={lang} /><DueText row={d} lang={lang} />
        {d.reopen_count > 0 && <span className="due red">{trf(lang, "v_reopened", { n: d.reopen_count })}</span>}</div>
      <div className="brief-tools">{onClose && <button className="secondary compact" onClick={onClose}>{tr(lang, "m_close")}</button>}<button className="secondary compact print-btn" onClick={e => printBrief(e.currentTarget)}>{tr(lang, "v_print")}</button>
        {!readOnly && open && <span className="crew-links" aria-label={tr(lang, "v_sendCrew")}>{tr(lang, "v_sendCrew")}: <a className="secondary compact" href={`mailto:?subject=${encodeURIComponent(`Work order ${d.public_id}`)}&body=${encodeURIComponent(crewText)}`}>{tr(lang, "v_byEmail")}</a> <a className="secondary compact" href={`sms:?body=${encodeURIComponent(crewText)}`}>{tr(lang, "v_bySms")}</a></span>}</div>
    </header>

    <section className="summary" aria-label={tr(lang, "v_what")}>
      <p className="what">{whatSentence(d, lang)}</p>
      <p className="why-line"><b className={`lvl lvl-${d.response.toLowerCase()}`}>{tr(lang, `resp_${d.response}` as StrKey)}</b> {tr(lang, `lvl_${d.response}` as StrKey)}</p>
      <dl className="facts">
        {d.due_at && <div><dt>{tr(lang, "v_fixByLabel")}</dt><dd>{stamp(d.due_at)}{open && <span className={d.overdue ? "late" : "left"}> · {d.overdue ? trf(lang, "v_late", { late: span(Date.now() - new Date(d.due_at).getTime()) }) : trf(lang, "v_left", { left: span(new Date(d.due_at).getTime() - Date.now()) })}</span>}</dd></div>}
        <div><dt>{tr(lang, "v_reportedLabel")}</dt><dd>{stamp(d.created_at)} · {trf(lang, d.citizens === 1 ? "v_reportedBy1" : "v_reportedByN", { n: d.citizens ?? 1 })}</dd></div>
        <div><dt>{tr(lang, "v_responsible")}</dt><dd>{trf(lang, "v_areaAuthority", { area: d.area ?? "—" })} · {dept}</dd></div>
      </dl>
      {d.due_at && <p className="muted-line">{trf(lang, "v_deadlineRule", { within: span(d.response_hours * 3_600_000), level: tr(lang, `resp_${d.response}` as StrKey) })}</p>}
      {d.resolution_proof && <ProofCard p={d.resolution_proof} lang={lang} staff />}
      {d.scheduled_for && <p className="meta-line">{trf(lang, "v_visit", { date: shortDate(d.scheduled_for, lang) })}</p>}
      {d.duplicate_of && <p className="meta-line">{trf(lang, "v_dupOf", { no: d.duplicate_of })}</p>}
      {d.status_reason && ["On Hold", "Rejected", "Reopened", "Transferred"].includes(status) && <p className="meta-line">{staffStatus(lang, status)}: {d.status_reason}</p>}
    </section>

    {d.needs_review && <section className="rv-panel" role="alert" aria-label={tr(lang, "rv_title")}>
      <b><Icon name="alert" size={16} /> {tr(lang, "rv_title")}</b>
      <p>{d.review_reason}</p>
      {!readOnly && <><label className="fld"><span>{tr(lang, "rv_note")}</span><input value={reviewNote} maxLength={300} onChange={e => setReviewNote(e.target.value)} /></label>
        <div className="act-row"><button className="primary compact" disabled={review.isPending} onClick={() => review.mutate({ decision: "genuine" })}>{tr(lang, "rv_genuine")}</button>
          <button className="secondary compact" disabled={review.isPending} onClick={() => review.mutate({ decision: "fake" })}>{tr(lang, "rv_fake")}</button></div>
        {review.isError && <div className="form-error" role="alert">{(review.error as Error).message}</div>}</>}
    </section>}

    <section aria-label={tr(lang, "v_where")}>
      <h3>{tr(lang, "v_where")}</h3>
      <p className="where"><CategoryPhoto category={d.category} className="cat-dot" label={false} /> {[d.where.address, d.where.area].filter(Boolean).join(" · ") || tr(lang, "s_noArea")}</p>
      <AreaPhoto area={d.where.area} />
      <iframe className="ad-map" title={tr(lang, "v_where")} loading="lazy" src={mapSrc(d.where.lat, d.where.lng)} />
      <div className="act-row">
        <a className="secondary compact linkbtn" href={navigateUrl(d.where.lat, d.where.lng)} target="_blank" rel="noreferrer"><Icon name="map" size={15} /> {tr(lang, "v_navigate")}</a>
        <button className="secondary compact" onClick={() => void copyLocation()}>{copied ? tr(lang, "v_copied") : tr(lang, "v_copy")}</button>
      </div>
    </section>

    {d.evidence.length > 0 && <section aria-label={tr(lang, "v_evidence")}>
      <h3>{tr(lang, "v_evidence")}</h3>
      <div className="evidence">{d.evidence.map((e, k) => <figure key={k} className="ev">
        {e.photos.length > 0 ? <div className="ev-photos">{e.photos.map((p, j) => <a key={j} href={p.url} target="_blank" rel="noreferrer"><img src={p.thumb_url} alt={`${tr(lang, "v_evidence")} ${k + 1}.${j + 1}`} loading="lazy" /></a>)}</div> : <div className="ev-none"><Evidence url={null} category={d.category} alt="" className="ev-ph" /><small>{tr(lang, "s_noPhoto")}</small></div>}
        <figcaption><b>{e.reporter}</b> · {new Date(e.at).toLocaleString(LOCALE[lang], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{e.description ? <><br />“{e.description}”</> : null}{e.citizen_message ? <><br />{tr(lang, "ad_citizenSays")}: “{e.citizen_message}”</> : null}</figcaption>
      </figure>)}</div>
    </section>}

    <details className="more-detail">
      <summary>{tr(lang, "v_moreDetails")}</summary>
    <section aria-label={tr(lang, "v_why")}>
      <h3>{tr(lang, "v_why")}</h3>
      {reasons.length === 0 ? <p className="muted-line">{tr(lang, "v_whyNone")}</p> : <ul className="why-list">{reasons.map((r, k) => <li key={k}><span>{reasonText(lang, r)}</span><em className={`src src-${r.source}`}>{tr(lang, `v_src_${r.source}` as StrKey)}</em></li>)}</ul>}
    </section>
      <p className="ai-line">{aiLine}</p>
      {(d.batch.main || d.batch.others.length > 0) && <p className="batch-line">
        {d.batch.main ? <><b>{tr(lang, "v_batchPart")}</b> {trf(lang, "v_batchMain", { no: d.batch.main.public_id, category: catLabel(lang, d.batch.main.category) })}</> : <b>{tr(lang, "v_batchMainIs")}</b>}
        {d.batch.others.length > 0 && <> {tr(lang, "v_batchOthers")} {d.batch.others.map(o => `${o.public_id} (${catLabel(lang, o.category)})`).join(", ")}.</>}
      </p>}
      {photoDisagrees && <p className="meta-line warn"><em className="ai-flag">{tr(lang, "v_aiUnverified")}</em> {trf(lang, "v_photoCheck", { looks: catLabel(lang, d.ai.category ?? ""), chosen: catLabel(lang, d.category) })}</p>}
    {d.history_here.count > 0 && <section aria-label={tr(lang, "v_histHere")}>
      <h3>{tr(lang, "v_histHere")}</h3>
      <p>{trf(lang, "v_histLine", { n: d.history_here.count, category: catLabel(lang, d.category), radius: d.history_here.radius_m, days: d.history_here.days })} <b>{tr(lang, "v_histCheck")}</b></p>
      <ul className="plain">{d.history_here.items.map(h => <li key={h.public_id}>{h.public_id} · {shortDate(h.created_at, lang)} · {staffStatus(lang, h.status)}</li>)}</ul>
    </section>}

    {d.nearby_open.count > 0 && <section aria-label={tr(lang, "v_nearby")}>
      <h3>{tr(lang, "v_nearby")}</h3>
      <p>{trf(lang, "v_nearbyLine", { n: d.nearby_open.count, radius: d.nearby_open.radius_m })} <b>{tr(lang, "v_sameCrew")}</b></p>
      <ul className="plain">{d.nearby_open.items.map(n => <li key={n.id}>{n.public_id} · {catLabel(lang, n.category)} · {n.distance_m} m · {staffStatus(lang, n.status)}</li>)}</ul>
    </section>}

    </details>

    <section aria-label={tr(lang, "v_timeline")}>
      <h3>{tr(lang, "v_timeline")}</h3>
      <ol className="timeline-v">{d.timeline.map((h, k) => <li key={k} className={h.note ? "note" : ""}>
        <b>{h.note ? h.reason : staffStatus(lang, h.status)}</b><small>{new Date(h.at).toLocaleString(LOCALE[lang], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{h.by ? ` · ${h.by}` : ""}</small>
        {!h.note && h.reason && <small className="reason">{h.reason}</small>}</li>)}</ol>
    </section>

    <section aria-label={tr(lang, "v_messages")}>
      <h3>{tr(lang, "v_messages")}</h3>
      <div className="thread">{d.messages.length === 0 && <p className="muted-line">{tr(lang, "s_noMessages")}</p>}{d.messages.map(m => <div key={m.id} className={`msg ${m.from}`}><small>{m.by} · {new Date(m.at).toLocaleString(LOCALE[lang], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small><p>{m.text}</p></div>)}</div>
      {!readOnly && <><textarea value={reply} maxLength={1000} onChange={e => setReply(e.target.value)} placeholder={tr(lang, "s_writeMsg")} rows={2} aria-label={tr(lang, "s_writeMsg")} />
        <button className="secondary compact" disabled={!reply.trim() || act.isPending} onClick={() => run({ message: reply.trim() })}>{tr(lang, "s_sendMsg")}</button></>}
    </section>

    {!readOnly && (action || moreItems.length > 0 || status === "Resolved") && <footer className="next-action">
      {panel && <div className="act-panel" role="group">
        {panel === "assign" && <label className="fld"><span>{tr(lang, "v_a_assign")}</span><select value={officer} onChange={e => setOfficer(e.target.value)}>{officers.data?.items.map(o => <option key={o.id} value={o.id}>{o.name}{o.is_me ? ` (${tr(lang, "v_me")})` : ""} · {deptLabel(lang, o.department)}</option>)}</select></label>}
        {panel === "schedule" && <label className="fld"><span>{tr(lang, "v_visitDate")}</span><input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>}
        {panel === "resolve" && d.proof_required && <div className="proof-box">
          <b>{tr(lang, "v_proofTitle")}</b><small>{tr(lang, "v_proofHelp")}</small>
          <input ref={proofInput} type="file" accept="image/*" capture="environment" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void takeProof(f); }} />
          <button type="button" className="secondary compact" disabled={proofBusy} onClick={() => proofInput.current?.click()}><Icon name="camera" size={16} /> {proofBusy ? tr(lang, "v_proofChecking") : proof ? tr(lang, "v_proofAgain") : tr(lang, "v_proofTake")}</button>
          {proof && <p className="proof-ok" role="status"><Icon name="check" size={16} /> {trf(lang, "v_proofOk", { m: proof.distance_m })}</p>}
          {proof && <img className="proof-thumb" src={proof.thumb_url} alt="" />}
          {proofError && <div className="form-error" role="alert"><Icon name="alert" size={16} /> {proofError}</div>}</div>}
        {(panel === "hold" || panel === "reject" || panel === "transfer" || panel === "resolve") && <>
          {panel === "transfer" && <label className="fld"><span>{tr(lang, "v_correctCat")}</span><select value={category} onChange={e => setCategory(e.target.value)}><option value="">—</option>{[...CATEGORY_NAMES, "Road Damage", "Drainage"].filter(c => c !== d.category).map(c => <option key={c} value={c}>{catLabel(lang, c)}</option>)}</select></label>}
          <label className="fld"><span>{tr(lang, panel === "resolve" ? "v_resolveNote" : "v_reason")}</span><textarea rows={2} maxLength={500} value={text} onChange={e => setText(e.target.value)} /></label></>}
        {panel === "duplicate" && <label className="fld"><span>{tr(lang, "v_dupNo")}</span><input value={text} maxLength={30} onChange={e => setText(e.target.value)} placeholder="IR-20261009-00001" /></label>}
        <div className="act-row"><button className="primary" disabled={!panelReady || act.isPending} onClick={submitPanel}>{tr(lang, "v_confirm")}</button><button className="secondary" onClick={() => setPanel(null)}>{tr(lang, "v_cancel")}</button></div>
      </div>}
      {act.isError && <div className="form-error" role="alert"><Icon name="alert" size={16} /> {(act.error as Error).message}</div>}
      <div className="act-row main">
        {action ? <button className="primary big" disabled={act.isPending} onClick={doPrimary}><Icon name={action === "resolve" ? "check" : "arrow"} size={16} /> {tr(lang, primaryLabel[action])}</button>
          : status === "Resolved" ? <span className="muted-line">{tr(lang, "v_waitCitizen")}</span> : null}
        {moreItems.length > 0 && <details className="more"><summary className="secondary compact">{tr(lang, "v_more")}</summary>
          <div className="more-menu" role="menu">{moreItems.map(m => <button key={m.key} role="menuitem" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; pickMore(m.key); }}>{tr(lang, m.label)}</button>)}</div></details>}
      </div>
    </footer>}

    <div className="print-sheet" aria-hidden="true">
      <div className="ps-head"><div><b>iREPORT</b><span>{tr(lang, "p_title")}</span></div><div className="ps-no"><b>{d.public_id}</b><small>{tr(lang, "p_printed")}: {new Date().toLocaleString(LOCALE[lang], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</small></div></div>
      <div className={`ps-sev sev-${d.response.toLowerCase()}`}><SevImg response={d.response} size={34} /><div><b>{tr(lang, `resp_${d.response}` as StrKey)}</b><span>{tr(lang, "v_sevReason")}: {reasons[0] ? reasonText(lang, reasons[0]) : tr(lang, "v_whyNone")}</span><span>{tr(lang, "v_sevAction")}: {tr(lang, `resp_${d.response}_tip` as StrKey)}</span></div></div>
      <table className="ps-grid"><tbody>
        <tr><th>{tr(lang, "v_what")}</th><td colSpan={3}>{whatSentence(d, lang)}</td></tr>
        <tr><th>{tr(lang, "p_category")}</th><td>{catLabel(lang, d.category)}</td><th>{tr(lang, "s_dept")}</th><td>{dept}</td></tr>
        <tr><th>{tr(lang, "p_status")}</th><td>{staffStatus(lang, status)}</td><th>{tr(lang, "p_reported")}</th><td>{new Date(d.created_at).toLocaleString(LOCALE[lang], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td></tr>
        <tr><th>{tr(lang, "p_dueBy")}</th><td>{d.due_at ? shortDate(d.due_at, lang) : "—"}{d.overdue ? ` (${tr(lang, "v_overdueToday")})` : ""}</td><th>{tr(lang, "p_citizens")}</th><td>{d.citizens ?? 1}</td></tr>
        <tr><th>{tr(lang, "v_responsible")}</th><td>{trf(lang, "v_areaAuthority", { area: d.area ?? "—" })} · {dept}</td><th>{tr(lang, "p_siteVisit")}</th><td>{d.scheduled_for ? shortDate(d.scheduled_for, lang) : "______"}</td></tr>
        <tr><th>{tr(lang, "v_where")}</th><td colSpan={3}>{[d.where.address, d.where.area].filter(Boolean).join(" · ") || tr(lang, "s_noArea")}<br /><small>{tr(lang, "p_gps")}: {d.where.lat.toFixed(5)}, {d.where.lng.toFixed(5)} · {navigateUrl(d.where.lat, d.where.lng)}</small></td></tr>
      </tbody></table>
      {d.needs_review && <><h4>{tr(lang, "p_reviewNote")}</h4><p>{tr(lang, "rv_title")}: {d.review_reason}</p></>}
      {d.status_reason && (status === "Resolved" || status === "Closed") && <><h4>{tr(lang, "p_resolution")}</h4><p>{d.status_reason}</p></>}
      {d.reasons.length > 0 && <><h4>{tr(lang, "v_why")}</h4><ul>{d.reasons.map((r, k) => <li key={k}>{reasonText(lang, r)} <i>({tr(lang, `v_src_${r.source}` as StrKey)})</i></li>)}</ul></>}
      {d.evidence.length > 0 && <><h4>{tr(lang, "p_reporters")}</h4><ul>{d.evidence.map((e, k) => <li key={k}><b>{e.reporter}</b>, {new Date(e.at).toLocaleString(LOCALE[lang], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{e.description ? `: “${e.description}”` : ""}{e.citizen_message ? ` (${tr(lang, "ad_citizenSays")}: “${e.citizen_message}”)` : ""}</li>)}</ul>
        {d.evidence.some(e => e.photos.length > 0) && <div className="ps-photos">{d.evidence.flatMap(e => e.photos).slice(0, 4).map((ph, k) => <img key={k} src={ph.thumb_url} alt="" />)}</div>}</>}
      <h4>{tr(lang, "p_mlTitle")}</h4><p>{aiLine}</p>
      {d.history_here.count > 0 && <><h4>{tr(lang, "v_histHere")}</h4><p>{trf(lang, "v_histLine", { n: d.history_here.count, category: catLabel(lang, d.category), radius: d.history_here.radius_m, days: d.history_here.days })} {tr(lang, "v_histCheck")}</p><ul>{d.history_here.items.map(h => <li key={h.public_id}>{h.public_id} · {shortDate(h.created_at, lang)} · {staffStatus(lang, h.status)}</li>)}</ul></>}
      {d.nearby_open.count > 0 && <><h4>{tr(lang, "v_nearby")}</h4><p>{trf(lang, "v_nearbyLine", { n: d.nearby_open.count, radius: d.nearby_open.radius_m })} {tr(lang, "v_sameCrew")}</p><ul>{d.nearby_open.items.map(n => <li key={n.id}>{n.public_id} · {catLabel(lang, n.category)} · {n.distance_m} m · {staffStatus(lang, n.status)}</li>)}</ul></>}
      {d.timeline.length > 0 && <><h4>{tr(lang, "v_timeline")}</h4><table className="ps-lines"><tbody>{d.timeline.map((h, k) => <tr key={k}><td>{new Date(h.at).toLocaleString(LOCALE[lang], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td><td>{h.note ? h.reason : staffStatus(lang, h.status)}{!h.note && h.reason ? `: ${h.reason}` : ""}</td><td>{h.by ?? ""}</td></tr>)}</tbody></table></>}
      {d.messages.length > 0 && <><h4>{tr(lang, "v_messages")}</h4><ul>{d.messages.map(m => <li key={m.id}><b>{m.by}</b>: {m.text}</li>)}</ul></>}
      <h4>{tr(lang, "p_workDone")}</h4>
      <div className="ps-box tall">&nbsp;</div>
      <table className="ps-grid"><tbody>
        <tr><th>{tr(lang, "p_material")}</th><td>&nbsp;</td><th>{tr(lang, "p_crew")}</th><td>&nbsp;</td></tr>
        <tr><th>{tr(lang, "p_startedOn")}</th><td>&nbsp;</td><th>{tr(lang, "p_completedOn")}</th><td>&nbsp;</td></tr>
      </tbody></table>
      <div className="ps-sign"><div>{tr(lang, "p_signOfficer")}</div><div>{tr(lang, "p_signSupervisor")}</div><div>{tr(lang, "p_signCitizen")}</div></div>
    </div>
  </div>;
}
