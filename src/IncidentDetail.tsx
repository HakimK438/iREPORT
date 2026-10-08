import { useQuery } from "@tanstack/react-query";
import { Icon } from "./Icon";
import { ago, type Status } from "./store";
import { api, type AiSummary } from "./api";

/** The few incident fields the detail view needs, so the list row and the map card can both open it. */
export interface DetailIssue { id: string; public_id: string; severity: string; status: Status; priority_score: number; thumb_url: string | null }
export interface ClusterInfo { name: string; size: number; eps_m: number }

const SOURCE_TEXT: Record<string, string> = { image: "photo", text: "description", "image+text": "photo + description" };
export const Tag = ({ kind }: { kind: "ml" | "rule" | "gis" | "you" }) => <em className={`src-tag src-${kind}`}>{kind === "ml" ? "ML model" : kind === "rule" ? "Rule-based" : kind === "gis" ? "GIS (PostGIS)" : "From citizen"}</em>;

export function AiChip({ ai }: { ai: AiSummary }) {
  if (!ai.category) return <span className="chip muted">No AI result · category chosen by the citizen</span>;
  const pct = ai.confidence != null ? `${Math.round(ai.confidence * 100)}%` : "";
  return <span className={`chip${ai.agreement === "disagree" ? " warn" : ""}`}>AI: {ai.category} {pct} · {SOURCE_TEXT[ai.source ?? ""] ?? "—"}{ai.agreement === "agree" ? " · photo and text agree" : ""}{ai.agreement === "disagree" ? " · needs verification (photo and text disagree)" : ""}{ai.user_corrected ? " · citizen changed the category" : ""}</span>;
}

export function mapSrc(lat: number, lng: number) {
  return `https://www.openstreetmap.org/export/embed.html?bbox=${(lng - 0.004).toFixed(4)}%2C${(lat - 0.003).toFixed(4)}%2C${(lng + 0.004).toFixed(4)}%2C${(lat + 0.003).toFixed(4)}&layer=mapnik&marker=${lat.toFixed(5)}%2C${lng.toFixed(5)}`;
}

export function Detail({ issue, reply, setReply, act, acting, readOnly = false, cluster = null }: { issue: DetailIssue; reply: string; setReply: (v: string) => void; act: (id: string, next: Status | null) => void; acting: boolean; readOnly?: boolean; cluster?: ClusterInfo | null }) {
  // Photo links are signed for 15 minutes, so refresh the open detail every 10 minutes.
  const detail = useQuery({ queryKey: [readOnly ? "admin" : "authority", "incident", issue.id], queryFn: () => (readOnly ? api.adminIncident(issue.id) : api.authorityDetail(issue.id)), refetchInterval: 10 * 60_000 });
  const d = detail.data;
  return <div className="ad-detail">
    {d?.images[0] ? <img src={d.images[0].url} alt="Evidence photo" loading="lazy" /> : issue.thumb_url ? <img src={issue.thumb_url} alt="Evidence photo" loading="lazy" /> : <div className="no-photo"><Icon name="camera" size={28} /><small>No photo</small></div>}
    <div className="ad-detail-body">
      <small>{issue.public_id} · {d ? `reported by ${d.reporters.map(r => r.name).join(", ") || "—"}` : "loading reporters…"} · {issue.severity} severity</small>
      {d && d.images.length > 1 && <div className="ad-thumbs">{d.images.map((m, k) => <a key={k} href={m.url} target="_blank" rel="noreferrer"><img src={m.thumb_url} alt={`Evidence photo ${k + 1}`} loading="lazy" /></a>)}</div>}
      {d?.reporters.some(r => r.description) && <p className="ad-desc">{d.reporters.filter(r => r.description).map(r => `“${r.description}”`).join(" · ")}</p>}
      {d && <div className="ad-intel-grid">
        <div><h3>Location <Tag kind="gis" /></h3><p>{d.area ?? "Unknown area"} · {d.lat?.toFixed(5)}, {d.lng?.toFixed(5)}<br /><small>point source: {d.location_source ?? "not recorded"}</small>{d.lat != null && d.lng != null && <><br /><a href={`https://www.openstreetmap.org/?mlat=${d.lat.toFixed(5)}&mlon=${d.lng.toFixed(5)}#map=17/${d.lat.toFixed(5)}/${d.lng.toFixed(5)}`} target="_blank" rel="noreferrer">Open in Map</a></>}</p>{d.lat != null && d.lng != null && <iframe className="ad-map" title="Incident location" loading="lazy" src={mapSrc(d.lat, d.lng)} />}</div>
        <div><h3>AI classification <Tag kind="ml" /></h3><p><AiChip ai={d.ai} /></p>{d.reporters.some(r => r.ai_disagreement) && <p className="muted-line">Photo said {d.reporters.find(r => r.ai_disagreement)?.ai_disagreement?.image}, description said {d.reporters.find(r => r.ai_disagreement)?.ai_disagreement?.text}.</p>}</div>
        <div><h3>Reading of the citizen's text <Tag kind="rule" /></h3>{d.nlp ? <ul className="plain"><li>Duration: {d.nlp.duration?.text ?? "not stated"}</li><li>Obstruction: {d.nlp.obstruction ?? "not stated"}</li><li>Hazard: {d.nlp.hazard?.join(", ") ?? "not stated"}</li><li>Urgency: {d.nlp.urgency ?? "—"}</li></ul> : <p className="muted-line">No description was written.</p>}</div>
        <div><h3>Responsible department</h3><p>{d.department ?? "—"}</p>{d.reporters.some(r => r.citizen_message) && <><h3>Citizen message <Tag kind="you" /></h3>{d.reporters.filter(r => r.citizen_message).map((r, k) => <p className="ad-msg" key={k}>“{r.citizen_message}”</p>)}</>}</div>
      </div>}
      {cluster && <><h3>Problem cluster <Tag kind="ml" /></h3><p className="plain">{cluster.name}: {cluster.size} open problems within {cluster.eps_m} m of each other (unsupervised DBSCAN on the PostGIS points). Several nearby problems usually share a cause, so one visit may cover all of them.</p></>}
      <h3>Why this priority ({issue.priority_score}/100) <Tag kind="rule" /></h3>
      {detail.isPending && <div className="ad-reasons"><span className="skeleton-line w50" /></div>}
      {detail.isError && <p className="muted-line">Could not load the detail. <button className="text-button" onClick={() => detail.refetch()}>Retry</button></p>}
      {d && <div className="ad-reasons">{d.reasons.slice(0, 6).map(r => <span key={r.label}>{r.label}<b>+{r.pts}</b></span>)}</div>}
      <h3>Messages</h3>
      <div className="thread">{d && d.messages.length === 0 && <p className="muted-line">No messages yet.</p>}{d?.messages.map(m => <div key={m.id} className={`msg ${m.from}`}><small>{m.by} · {ago(m.at)}</small><p>{m.text}</p></div>)}</div>
      {readOnly ? <p className="muted-line">Read-only view. Status changes and messages are handled by the authority control room.</p> : <>
      <textarea value={reply} maxLength={1000} onChange={e => setReply(e.target.value)} placeholder="Write a message to the citizen (optional)" rows={3} aria-label="Message to citizen" />
      <div className="ad-actions">
        <button className="secondary" onClick={() => act(issue.id, null)} disabled={!reply.trim() || acting}>Send message</button>
        <button className="secondary" onClick={() => act(issue.id, "Under Review")} disabled={issue.status === "Under Review" || acting}>Under review</button>
        <button className="secondary" onClick={() => act(issue.id, "In Progress")} disabled={issue.status === "In Progress" || acting}>In progress</button>
        <button className="primary" onClick={() => act(issue.id, "Resolved")} disabled={issue.status === "Resolved" || acting}><Icon name="check" size={16} /> Mark resolved</button>
      </div>
      </>}
    </div>
  </div>;
}

