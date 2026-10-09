import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "./Icon";
import { ago, type Status } from "./store";
import { api, type AiSummary } from "./api";
import { CategoryPhoto } from "./brand";
import { severityName, statusName, tr, type Lang } from "./i18n";
import { catLabel, deptLabel, durationLabel, flagLabel, hazardLabel, obstructionLabel, reasonLabel } from "./i18nStaff";
import { actionKey, tone, waitOf } from "./facts";

/** The few incident fields the detail view needs, so the list row and the map card can both open it. */
export interface DetailIssue { id: string; public_id: string; severity: string; status: Status; priority_score: number; thumb_url: string | null }
export interface ClusterInfo { name: string; size: number; eps_m: number }

/** Unique names, at most three, then "+N". Many reports on one problem must not flood the header. */
const names = (all: string[]): string => { const u = [...new Set(all)]; return u.length === 0 ? "—" : u.length <= 3 ? u.join(", ") : `${u.slice(0, 3).join(", ")} +${u.length - 3}`; };

const SOURCE_KEY = { image: "s_srcPhoto", text: "s_srcText", "image+text": "s_srcBoth" } as const;

/** Where a fact came from, in words an officer understands. The hover text says how it was produced. */
export const Tag = ({ kind, lang = "en" }: { kind: "ml" | "rule" | "gis" | "you"; lang?: Lang }) => {
  const key = kind === "ml" ? "tagMl" : kind === "rule" ? "tagRule" : kind === "gis" ? "tagGis" : "tagYou";
  return <em className={`src-tag src-${kind}`}>{tr(lang, key)}</em>;
};

export function AiChip({ ai, lang = "en" }: { ai: AiSummary; lang?: Lang }) {
  if (!ai.category) return <span className="chip muted">{tr(lang, "s_noAi")}</span>;
  const pct = ai.confidence != null ? `${Math.round(ai.confidence * 100)}% ${tr(lang, "s_sure")}` : "";
  const src = ai.source && ai.source in SOURCE_KEY ? tr(lang, SOURCE_KEY[ai.source as keyof typeof SOURCE_KEY]) : "";
  return <span className={`chip${ai.agreement === "disagree" ? " warn" : ""}`} title={tr(lang, "s_g_auto")}>
    {tr(lang, "s_looksLike")}: {catLabel(lang, ai.category)}{pct ? ` · ${pct}` : ""}{src ? ` · ${src}` : ""}
    {ai.agreement === "agree" ? ` · ${tr(lang, "s_agree")}` : ""}{ai.agreement === "disagree" ? ` · ${tr(lang, "s_disagree")}` : ""}{ai.user_corrected ? ` · ${tr(lang, "s_changedCat")}` : ""}</span>;
}

export function mapSrc(lat: number, lng: number) {
  return `https://www.openstreetmap.org/export/embed.html?bbox=${(lng - 0.004).toFixed(4)}%2C${(lat - 0.003).toFixed(4)}%2C${(lng + 0.004).toFixed(4)}%2C${(lat + 0.003).toFixed(4)}&layer=mapnik&marker=${lat.toFixed(5)}%2C${lng.toFixed(5)}`;
}

/** "Open for 3 days" / "Overdue by 2 days" in words, shared by the list cards and the detail. */
export function waitText(lang: Lang, days: number): string {
  if (days < 1) return tr(lang, "s_today");
  const n = Math.floor(days);
  return `${n} ${tr(lang, n === 1 ? "s_day" : "s_days")}`;
}

/** A photo from the citizen when there is one, otherwise the picture of the category, so a card is never blank. */
export function Evidence({ url, category, alt, className }: { url: string | null | undefined; category: string; alt: string; className?: string }) {
  const [bad, setBad] = useState<string | null>(null);
  if (url && bad !== url) return <img className={className} src={url} alt={alt} loading="lazy" onError={() => setBad(url)} />;
  return <CategoryPhoto category={category} className={`cat-photo ${className ?? ""}`} />;
}

export function Detail({ issue, reply, setReply, act, acting, readOnly = false, cluster = null, lang = "en" }: { issue: DetailIssue; reply: string; setReply: (v: string) => void; act: (id: string, next: Status | null) => void; acting: boolean; readOnly?: boolean; cluster?: ClusterInfo | null; lang?: Lang }) {
  // Photo links are signed for 15 minutes, so refresh the open detail every 10 minutes.
  const detail = useQuery({ queryKey: [readOnly ? "admin" : "authority", "incident", issue.id], queryFn: () => (readOnly ? api.adminIncident(issue.id) : api.authorityDetail(issue.id)), refetchInterval: 10 * 60_000 });
  const d = detail.data;
  const [photo, setPhoto] = useState(0);
  const w = d ? waitOf(d.created_at, d.level, d.status) : null;
  const t = d && w ? tone(d.level, w) : "green";
  const main = d?.images[photo]?.url ?? issue.thumb_url;
  return <div className="ad-detail">
    <div className="ad-detail-media">
      <Evidence url={main} category={d?.category ?? "Other"} alt={tr(lang, "s_evidence")} />
      {d && d.images.length > 1 && <div className="ad-thumbs">{d.images.map((m, k) => <button key={k} className={k === photo ? "on" : ""} onClick={() => setPhoto(k)} aria-label={`${tr(lang, "s_evidence")} ${k + 1}`}><img src={m.thumb_url} alt="" loading="lazy" /></button>)}</div>}
      {d && d.images.length === 0 && !issue.thumb_url && <small>{tr(lang, "s_noPhoto")}</small>}
    </div>
    <div className="ad-detail-body">
      {d?.sample_confidence != null && <p className="sample-badge">{tr(lang, "s_exampleNote")} {tr(lang, "exampleConf")} {Math.round(d.sample_confidence * 100)}%.</p>}
      <small>{issue.public_id} · {d ? `${tr(lang, "s_reportedBy")} ${names(d.reporters.map(r => r.name))}` : tr(lang, "s_loadingReporters")} · {severityName(lang, issue.severity)} {tr(lang, "s_severity")}</small>

      {d && w && <>
        <h3>{tr(lang, "s_atGlance")}</h3>
        <div className="glance">
          <div className={`gl-${t}`}><small>{tr(lang, "s_priority")}</small><b>{d.priority_score}/100</b><span>{severityName(lang, d.level)}</span></div>
          <div className={w.overdueBy > 0 ? "gl-red" : ""}><small>{tr(lang, "s_openFor")}</small><b>{waitText(lang, w.days)}</b><span>{w.closed ? tr(lang, "s_closed") : w.overdueBy > 0 ? `${tr(lang, "s_overdueBy")} ${waitText(lang, w.overdueBy)}` : `${tr(lang, "s_target")}: ${waitText(lang, w.target)}`}</span></div>
          <div><small>{tr(lang, "s_people")}</small><b>{d.affected_count}</b><span>{d.reporters.length} {tr(lang, d.reporters.length === 1 ? "s_citizen" : "s_citizens")}</span></div>
          <div><small>{tr(lang, "s_dept")}</small><b className="small-b">{deptLabel(lang, d.department)}</b><span>{d.area ?? tr(lang, "s_noArea")}</span></div>
        </div>
        {d.flags.length > 0 && <p className="ad-flags">{d.flags.map(f => <em key={f}>{flagLabel(lang, f)}</em>)}</p>}
        <div className={`next-step gl-${t}`}><Icon name="shield" size={18} /><span><small>{tr(lang, "s_action")}</small><b>{tr(lang, actionKey(d.level, d.status))}</b></span></div>
      </>}

      {d?.reporters.some(r => r.description) && <p className="ad-desc">{d.reporters.filter(r => r.description).map(r => `“${r.description}”`).join(" · ")}</p>}
      {d && <div className="ad-intel-grid">
        <div><h3>{tr(lang, "s_location")} <Tag kind="gis" lang={lang} /></h3><p>{d.address_text ? <><b>{d.address_text}</b><br /></> : null}{d.area ?? tr(lang, "s_noArea")} · {d.lat?.toFixed(5)}, {d.lng?.toFixed(5)}<br /><small>{tr(lang, "s_pointSource")}: {d.location_source ?? tr(lang, "s_notRecorded")}</small>{d.lat != null && d.lng != null && <><br /><a href={`https://www.openstreetmap.org/?mlat=${d.lat.toFixed(5)}&mlon=${d.lng.toFixed(5)}#map=17/${d.lat.toFixed(5)}/${d.lng.toFixed(5)}`} target="_blank" rel="noreferrer">{tr(lang, "s_openMap")}</a></>}</p>{d.lat != null && d.lng != null && <iframe className="ad-map" title={tr(lang, "s_location")} loading="lazy" src={mapSrc(d.lat, d.lng)} />}</div>
        <div><h3>{tr(lang, "s_whatSystemThinks")} <Tag kind="ml" lang={lang} /></h3><p><AiChip ai={d.ai} lang={lang} /></p>{d.reporters.some(r => r.ai_disagreement) && <p className="muted-line">{tr(lang, "s_photoSaid")}: {catLabel(lang, d.reporters.find(r => r.ai_disagreement)?.ai_disagreement?.image ?? "")}, {tr(lang, "s_descSaid")}: {catLabel(lang, d.reporters.find(r => r.ai_disagreement)?.ai_disagreement?.text ?? "")}.</p>}</div>
        <div><h3>{tr(lang, "s_textRead")} <Tag kind="rule" lang={lang} /></h3>{d.nlp ? <ul className="plain"><li>{tr(lang, "s_duration")}: {d.nlp.duration?.text ? durationLabel(lang, d.nlp.duration.text) : tr(lang, "s_notStated")}</li><li>{tr(lang, "s_obstruction")}: {d.nlp.obstruction ? obstructionLabel(lang, d.nlp.obstruction) : tr(lang, "s_notStated")}</li><li>{tr(lang, "s_hazard")}: {d.nlp.hazard?.map(h => hazardLabel(lang, h)).join(", ") ?? tr(lang, "s_notStated")}</li><li>{tr(lang, "s_urgency")}: {d.nlp.urgency ? severityName(lang, d.nlp.urgency) : "—"}</li></ul> : <p className="muted-line">{tr(lang, "s_noDesc")}</p>}</div>
        <div><h3>{tr(lang, "s_respDept")}</h3><p>{deptLabel(lang, d.department)}</p>{d.reporters.some(r => r.citizen_message) && <><h3>{tr(lang, "s_citizenMsg")} <Tag kind="you" lang={lang} /></h3>{d.reporters.filter(r => r.citizen_message).map((r, k) => <p className="ad-msg" key={k}>“{r.citizen_message}”</p>)}</>}</div>
      </div>}
      <h3>{tr(lang, "s_whyPriority")} ({issue.priority_score}/100) <Tag kind="rule" lang={lang} /></h3>
      {detail.isPending && <div className="ad-reasons"><span className="skeleton-line w50" /></div>}
      {detail.isError && <p className="muted-line">{tr(lang, "s_loadDetailFail")} <button className="text-button" onClick={() => detail.refetch()}>{tr(lang, "s_retry")}</button></p>}
      {d && <div className="ad-reasons">{d.reasons.slice(0, 6).map(r => <span key={r.label}>{reasonLabel(lang, r.label, s => severityName(lang, s))}<b>+{r.pts}</b></span>)}</div>}

      {d && d.history.length > 0 && <><h3>{tr(lang, "s_timeline")}</h3>
        <ol className="timeline">{d.history.map((h, k) => <li key={k}><b>{statusName(lang, h.status)}</b><small>{ago(h.at)}</small></li>)}</ol></>}

      <h3>{tr(lang, "s_messages")}</h3>
      <div className="thread">{d && d.messages.length === 0 && <p className="muted-line">{tr(lang, "s_noMessages")}</p>}{d?.messages.map(m => <div key={m.id} className={`msg ${m.from}`}><small>{m.by} · {ago(m.at)}</small><p>{m.text}</p></div>)}</div>
      {readOnly ? <p className="muted-line">{tr(lang, "s_readOnly")}</p> : <>
      <textarea value={reply} maxLength={1000} onChange={e => setReply(e.target.value)} placeholder={tr(lang, "s_writeMsg")} rows={3} aria-label={tr(lang, "s_writeMsg")} />
      <div className="ad-actions">
        <button className="secondary" onClick={() => act(issue.id, null)} disabled={!reply.trim() || acting}>{tr(lang, "s_sendMsg")}</button>
        <button className="secondary" onClick={() => act(issue.id, "Under Review")} disabled={issue.status === "Under Review" || acting}>{tr(lang, "s_underReview")}</button>
        <button className="secondary" onClick={() => act(issue.id, "In Progress")} disabled={issue.status === "In Progress" || acting}>{tr(lang, "s_inProgressBtn")}</button>
        <button className="primary" onClick={() => act(issue.id, "Resolved")} disabled={issue.status === "Resolved" || acting}><Icon name="check" size={16} /> {tr(lang, "s_resolve")}</button>
      </div>
      </>}
    </div>
  </div>;
}
