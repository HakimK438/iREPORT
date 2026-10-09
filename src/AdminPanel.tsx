import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "./Icon";
import { ago } from "./store";
import { api, type AdminAuthority } from "./api";
import MapDashboard from "./MapDashboard";
import { hotspotReasons } from "./AuthorityDashboard";
import { severityName, tr, type Lang } from "./i18n";
import { catLabel, deptLabel } from "./i18nStaff";
import { CategoryPhoto } from "./brand";

export default function AdminPanel({ lang = "en" }: { lang?: Lang }) {
  const qc = useQueryClient();
  const pending = useQuery({ queryKey: ["admin", "authorities", "pending"], queryFn: () => api.adminAuthorities("pending"), refetchInterval: 60_000 });
  const approved = useQuery({ queryKey: ["admin", "authorities", "approved"], queryFn: () => api.adminAuthorities("approved") });
  const stats = useQuery({ queryKey: ["admin", "stats"], queryFn: api.adminStats, refetchInterval: 60_000 });
  const overview = useQuery({ queryKey: ["admin", "overview"], queryFn: api.adminOverview, refetchInterval: 30_000 });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "reject" | "revoke" }) => api.adminDecide(id, decision),
    onSettled: () => qc.invalidateQueries({ queryKey: ["admin"] }),
  });
  const busy = (id: string) => decide.isPending && decide.variables?.id === id;
  const card = (u: AdminAuthority, actions: React.ReactNode) => <div className="admin-row" key={u.id}><span className="avatar-sm">{u.name.slice(0, 1)}</span><div><b>{u.name}</b><small>{u.email} · {deptLabel(lang, u.department)} · {u.area ?? tr(lang, "a_noArea")} · ID {u.employee_id}</small><small>{tr(lang, "a_requested")} {ago(u.created_at)}</small></div><div className="admin-actions">{actions}</div></div>;
  const list = (q: typeof pending, empty: string, actions: (u: AdminAuthority) => React.ReactNode) => <>
    {q.isPending && <p className="muted-line">{tr(lang, "s_loading")}</p>}
    {q.isError && <div className="empty-note error"><Icon name="alert" /><span><b>{tr(lang, "a_loadFail")}</b><small>{(q.error as Error).message}</small></span><button className="secondary compact" onClick={() => q.refetch()}>{tr(lang, "s_retry")}</button></div>}
    {q.isSuccess && q.data.length === 0 && <p className="muted-line">{empty}</p>}
    {q.data?.map(u => card(u, actions(u)))}
  </>;
  const n = (v: number | undefined) => (v === undefined ? "–" : v);
  return <main className="page section">
    <div className="page-heading"><div><span className="eyebrow">{tr(lang, "adm_eyebrow")}</span><h1>{tr(lang, "adm_title")}</h1><p>{tr(lang, "adm_sub")}</p></div></div>
    <div className="ad-stats">
      <div><small>{tr(lang, "adm_pending")}</small><b>{n(stats.data?.pending)}</b></div>
      <div><small>{tr(lang, "adm_approved")}</small><b>{n(stats.data?.approved)}</b></div>
      <div><small>{tr(lang, "adm_citizens")}</small><b>{n(stats.data?.citizens)}</b></div>
      <div><small>{tr(lang, "ad_total")}</small><b>{n(stats.data?.incidents)}</b></div>
    </div>
    <section className="admin-card"><MapDashboard mode="admin" lang={lang} /></section>
    <section className="admin-card"><h2>{tr(lang, "adm_overview")}</h2>
      {overview.isPending && <p className="muted-line">{tr(lang, "s_loading")}</p>}
      {overview.isError && <div className="empty-note error"><Icon name="alert" /><span><b>{tr(lang, "a_overviewFail")}</b><small>{(overview.error as Error).message}</small></span><button className="secondary compact" onClick={() => overview.refetch()}>{tr(lang, "s_retry")}</button></div>}
      {overview.data && <>
        <div className="ad-stats"><div className="danger"><small>{tr(lang, "adm_critical")}</small><b>{overview.data.unresolved_critical}</b></div></div>
        <h3 className="ad-h">{tr(lang, "adm_workload")}</h3>
        <div className="work-list">{overview.data.departments.map(d => <div key={d.department} className="work-row"><span>{deptLabel(lang, d.department)}</span><i style={{ width: `${Math.min(100, d.open * 12)}%` }} /><b>{d.open} {tr(lang, "a_openWord")}{d.critical ? ` · ${d.critical} ${tr(lang, "a_critWord")}` : ""}</b></div>)}</div>
        <h3 className="ad-h">{tr(lang, "adm_concentration")}</h3>
        <p className="muted-line">{tr(lang, "adm_reco")}</p>
        <ul className="plain cat-list">{overview.data.categories.length === 0 && <li>{tr(lang, "a_noOpen")}</li>}{overview.data.categories.map(c => <li key={c.category}><CategoryPhoto category={c.category} className="cat-photo sm" label={false} /><span><b>{c.share_pct}%</b> {catLabel(lang, c.category)} ({c.open}) · {catLabel(lang, c.category)} → {deptLabel(lang, c.recommended_department)}</span></li>)}</ul>
        <h3 className="ad-h">{tr(lang, "adm_topHot")}</h3>
        <div className="hot-grid">{overview.data.hotspots.map(h => <div className="hot-card" key={h.area}><div className="hot-top"><b>{h.area}</b><span className="hot-score">{h.impact_score}</span></div><p>{h.open_incidents} {tr(lang, "a_openWord")} · {h.critical} {tr(lang, "a_critWord")} · {h.unique_citizens} {tr(lang, "s_citizens")}</p><p className="hot-cats">{h.categories.map(c => <span key={c.category} className="hot-cat"><CategoryPhoto category={c.category} className="cat-dot" label={false} />{catLabel(lang, c.category)} ×{c.count}</span>)}</p><p className="hot-why muted-line">{tr(lang, "s_impact")} {h.impact_score}/100 {tr(lang, "s_because")}: {hotspotReasons(h, lang).join(" · ")}</p></div>)}{overview.data.hotspots.length === 0 && <p className="muted-line">{tr(lang, "a_noHot")}</p>}</div>
      </>}
    </section>
    {decide.isError && <div className="form-error" role="alert"><Icon name="alert" size={16} /> {(decide.error as Error).message}</div>}
    <section className="admin-card"><h2>{tr(lang, "adm_waiting")}</h2>
      {list(pending, tr(lang, "a_noPending"), u => <><button className="primary compact" disabled={busy(u.id)} onClick={() => decide.mutate({ id: u.id, decision: "approve" })}><Icon name="check" size={16} /> {tr(lang, "adm_approve")}</button><button className="secondary compact" disabled={busy(u.id)} onClick={() => decide.mutate({ id: u.id, decision: "reject" })}>{tr(lang, "adm_reject")}</button></>)}
    </section>
    <section className="admin-card"><h2>{tr(lang, "adm_approved")}</h2>
      {list(approved, tr(lang, "a_noApproved"), u => <button className="secondary compact" disabled={busy(u.id)} onClick={() => decide.mutate({ id: u.id, decision: "revoke" })}>{tr(lang, "adm_revoke")}</button>)}
    </section>
  </main>;
}
