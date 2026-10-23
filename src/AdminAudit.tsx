import { useQuery } from "@tanstack/react-query";
import { Icon } from "./Icon";
import { api, type AuditFlagged } from "./api";

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "–");
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Why a resolution is on the "check these" list, in plain words. */
function why(f: AuditFlagged): string[] {
  const out: string[] = [];
  if (f.no_proof) out.push("No site photo");
  if (f.flags?.includes("too_fast")) out.push("Resolved right after the last action");
  if (f.flags?.includes("no_prior_action")) out.push("No earlier action by the officer");
  if (f.reopened) out.push("Reopened by the citizen");
  return out;
}

/** Officer accountability for the admin: every number is counted from the status history and the site-photo records (nothing estimated). */
export default function AdminAudit() {
  const q = useQuery({ queryKey: ["admin", "audit"], queryFn: () => api.adminAudit(90), refetchInterval: 5 * 60_000 });
  const a = q.data;
  return <section className="admin-card audit" aria-label="Officer accountability">
    <h2 className="ad-h">Are fixes real? Officer accountability <small className="muted-line">· last {a?.days ?? 90} days</small></h2>
    {q.isPending && <p className="muted-line">Loading…</p>}
    {q.isError && <div className="empty-note error"><Icon name="alert" /><span><b>Could not load the audit.</b><small>{(q.error as Error).message}</small></span><button className="secondary compact" onClick={() => q.refetch()}>Retry</button></div>}
    {a && <>
      <p className="muted-line">{a.proof_required
        ? `A fix can only be marked resolved with a photo taken at the site (phone within ${a.proof_radius_m} m of the complaint). The citizen sees that photo and confirms or reopens. A fix marked resolved less than ${a.min_work_minutes} minutes after the officer's last action is flagged.`
        : "Site-photo proof is switched OFF (REQUIRE_RESOLUTION_PROOF=false), so fixes below show as having no site photo. Switch it on before real use."}</p>
      <div className="ad-kpis">
        <div className={a.proof_required && a.totals.with_proof < a.totals.resolved ? "danger" : "good"}><small>Fixes with a site photo</small><b>{pct(a.totals.with_proof, a.totals.resolved)}</b><span>{a.totals.with_proof} of {a.totals.resolved} marked resolved</span></div>
        <div className="good"><small>Confirmed by the citizen</small><b>{a.totals.confirmed}</b><span>closed because the reporter said "fixed"</span></div>
        <div className={a.totals.reopened ? "warn" : "good"}><small>Reopened by citizens</small><b>{a.totals.reopened}</b><span>the fix did not hold ({pct(a.totals.reopened, a.totals.resolved)} of fixes)</span></div>
        <div className={a.totals.auto_closed > a.totals.confirmed ? "warn" : ""}><small>Closed by timeout</small><b>{a.totals.auto_closed}</b><span>nobody confirmed them: do not count as proven</span></div>
        <div><small>Holds and rejections</small><b>{a.totals.holds + a.totals.rejects}</b><span>{a.totals.holds} on hold, {a.totals.rejects} rejected</span></div>
        <div className={a.reporters.paused ? "danger" : a.reporters.in_review ? "warn" : "good"}><small>Citizens with fake-report strikes</small><b>{a.reporters.with_strikes}</b><span>{a.reporters.in_review} in review, {a.reporters.paused} paused (at {a.reporters.review_at} / {a.reporters.pause_at} strikes in {a.reporters.window_days} days)</span></div>
      </div>

      <h3 className="ad-h">Per officer</h3>
      {a.officers.length === 0 ? <p className="muted-line">No approved officers yet.</p> : <div className="audit-scroll"><table className="ps-lines audit-table"><thead><tr>
        <th>Officer</th><th>Area</th><th>Fixes</th><th>With photo</th><th>Confirmed</th><th>Reopened</th><th>By timeout</th><th>Holds</th><th>Rejects</th><th>Look at</th></tr></thead>
        <tbody>{a.officers.map(o => <tr key={o.id} className={o.attention.length ? "attn" : ""}>
          <td>{o.name}</td><td>{o.area ?? "All areas"}</td><td>{o.resolved}</td><td>{o.with_proof}</td><td>{o.confirmed}</td><td>{o.reopened}</td><td>{o.auto_closed}</td><td>{o.holds}</td><td>{o.rejects}</td>
          <td>{o.attention.length ? <ul className="attn-list">{o.attention.map(t => <li key={t}>{t}</li>)}</ul> : <span className="muted-line">Nothing unusual</span>}</td></tr>)}</tbody></table></div>}

      <h3 className="ad-h">Resolutions to check</h3>
      {a.flagged.length === 0 ? <p className="muted-line">No suspicious resolutions in this period.</p> : <ul className="flag-list">{a.flagged.map(f => <li key={`${f.id}-${f.resolved_at}`}>
        <b>{f.public_id}</b> <span>{f.area ?? "Outside mapped areas"} · {f.officer} · {when(f.resolved_at)}{f.distance_m != null ? ` · photo ${Math.round(f.distance_m)} m from the complaint` : ""}</span>
        <em>{why(f).join(" · ")}</em></li>)}</ul>}
    </>}
  </section>;
}
