import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "./Icon";
import { ago } from "./store";
import { api, type AdminAuthority } from "./api";
import MapDashboard from "./MapDashboard";
import AdminPerformance from "./AdminPerformance";
import AdminAudit from "./AdminAudit";
import { tr, type Lang } from "./i18n";
import { deptLabel } from "./i18nStaff";

export default function AdminPanel({ lang = "en" }: { lang?: Lang }) {
  const qc = useQueryClient();
  const pending = useQuery({ queryKey: ["admin", "authorities", "pending"], queryFn: () => api.adminAuthorities("pending"), refetchInterval: 60_000 });
  const approved = useQuery({ queryKey: ["admin", "authorities", "approved"], queryFn: () => api.adminAuthorities("approved") });
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
  return <main className="page section">
    <div className="page-heading"><div><span className="eyebrow">{tr(lang, "adm_eyebrow")}</span><h1>{tr(lang, "adm_title")}</h1><p>{tr(lang, "adm_sub")}</p></div></div>
    <section className="admin-card"><MapDashboard mode="admin" lang={lang} /></section>
    <AdminPerformance lang={lang} />
    <AdminAudit />
    {decide.isError && <div className="form-error" role="alert"><Icon name="alert" size={16} /> {(decide.error as Error).message}</div>}
    <section className="admin-card"><h2>{tr(lang, "adm_waiting")}</h2>
      {list(pending, tr(lang, "a_noPending"), u => <><button className="primary compact" disabled={busy(u.id)} onClick={() => decide.mutate({ id: u.id, decision: "approve" })}><Icon name="check" size={16} /> {tr(lang, "adm_approve")}</button><button className="secondary compact" disabled={busy(u.id)} onClick={() => decide.mutate({ id: u.id, decision: "reject" })}>{tr(lang, "adm_reject")}</button></>)}
    </section>
    <section className="admin-card"><h2>{tr(lang, "adm_approved")}</h2>
      {list(approved, tr(lang, "a_noApproved"), u => <button className="secondary compact" disabled={busy(u.id)} onClick={() => decide.mutate({ id: u.id, decision: "revoke" })}>{tr(lang, "adm_revoke")}</button>)}
    </section>
  </main>;
}
