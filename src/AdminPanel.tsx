import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "./Icon";
import { ago } from "./store";
import { api, type AdminAuthority } from "./api";
import MapDashboard from "./MapDashboard";
import { hotspotReasons } from "./AuthorityDashboard";

export default function AdminPanel() {
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
  const card = (u: AdminAuthority, actions: React.ReactNode) => <div className="admin-row" key={u.id}><span className="avatar-sm">{u.name.slice(0, 1)}</span><div><b>{u.name}</b><small>{u.email} · {u.department} · {u.area ?? "No area"} · ID {u.employee_id}</small><small>Requested {ago(u.created_at)}</small></div><div className="admin-actions">{actions}</div></div>;
  const list = (q: typeof pending, empty: string, actions: (u: AdminAuthority) => React.ReactNode) => <>
    {q.isPending && <p className="muted-line">Loading…</p>}
    {q.isError && <div className="empty-note error"><Icon name="alert" /><span><b>Could not load accounts.</b><small>{(q.error as Error).message}</small></span><button className="secondary compact" onClick={() => q.refetch()}>Retry</button></div>}
    {q.isSuccess && q.data.length === 0 && <p className="muted-line">{empty}</p>}
    {q.data?.map(u => card(u, actions(u)))}
  </>;
  const n = (v: number | undefined) => (v === undefined ? "–" : v);
  return <main className="page section">
    <div className="page-heading"><div><span className="eyebrow">ADMIN</span><h1>Authority access</h1><p>Approve BMC officers before they can see and act on problems.</p></div></div>
    <div className="ad-stats">
      <div><small>Pending requests</small><b>{n(stats.data?.pending)}</b></div>
      <div><small>Approved authorities</small><b>{n(stats.data?.approved)}</b></div>
      <div><small>Citizens</small><b>{n(stats.data?.citizens)}</b></div>
      <div><small>Total problems</small><b>{n(stats.data?.incidents)}</b></div>
    </div>
    <section className="admin-card"><MapDashboard mode="admin" /></section>
    <section className="admin-card"><h2>City overview</h2>
      {overview.isPending && <p className="muted-line">Loading…</p>}
      {overview.isError && <div className="empty-note error"><Icon name="alert" /><span><b>Could not load the overview.</b><small>{(overview.error as Error).message}</small></span><button className="secondary compact" onClick={() => overview.refetch()}>Retry</button></div>}
      {overview.data && <>
        <div className="ad-stats"><div className="danger"><small>Unresolved critical</small><b>{overview.data.unresolved_critical}</b></div></div>
        <h3 className="ad-h">Open workload per department</h3>
        <div className="work-list">{overview.data.departments.map(d => <div key={d.department} className="work-row"><span>{d.department}</span><i style={{ width: `${Math.min(100, d.open * 12)}%` }} /><b>{d.open} open{d.critical ? ` · ${d.critical} critical` : ""}</b></div>)}</div>
        <h3 className="ad-h">Category concentration (open problems)</h3>
        <p className="muted-line">Recommendation only: nothing is assigned or stored.</p>
        <ul className="plain">{overview.data.categories.length === 0 && <li>No open problems.</li>}{overview.data.categories.map(c => <li key={c.category}><b>{c.share_pct}%</b> {c.category} ({c.open}) · {c.recommendation}</li>)}</ul>
        <h3 className="ad-h">Top hotspots <em className="src-tag src-gis">GIS (PostGIS)</em></h3>
        <div className="hot-grid">{overview.data.hotspots.map(h => <div className="hot-card" key={h.area}><div className="hot-top"><b>{h.area}</b><span className="hot-score">{h.impact_score}</span></div><p>{h.open_incidents} open · {h.critical} critical · {h.unique_citizens} citizens</p><p className="hot-cats">{h.categories.map(c => `${c.category} ×${c.count}`).join(" · ")}</p><p className="hot-why muted-line">Impact {h.impact_score}/100 because: {hotspotReasons(h).join(" · ")}</p></div>)}{overview.data.hotspots.length === 0 && <p className="muted-line">No open problems with a known area.</p>}</div>
      </>}
    </section>
    {decide.isError && <div className="form-error" role="alert"><Icon name="alert" size={16} /> {(decide.error as Error).message}</div>}
    <section className="admin-card"><h2>Waiting for approval</h2>
      {list(pending, "No pending requests.", u => <><button className="primary compact" disabled={busy(u.id)} onClick={() => decide.mutate({ id: u.id, decision: "approve" })}><Icon name="check" size={16} /> Approve</button><button className="secondary compact" disabled={busy(u.id)} onClick={() => decide.mutate({ id: u.id, decision: "reject" })}>Reject</button></>)}
    </section>
    <section className="admin-card"><h2>Approved authorities</h2>
      {list(approved, "No approved authorities yet.", u => <button className="secondary compact" disabled={busy(u.id)} onClick={() => decide.mutate({ id: u.id, decision: "revoke" })}>Revoke access</button>)}
    </section>
  </main>;
}
