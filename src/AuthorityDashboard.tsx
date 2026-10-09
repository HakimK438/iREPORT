import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon, type IconName } from "./Icon";
import { AREAS, CATEGORY_NAMES, STATUSES, type Status } from "./store";
import { api, type ApiUser, type Hotspot } from "./api";
import { AiChip, Detail, Evidence, Tag, waitText } from "./IncidentDetail";
import MapDashboard from "./MapDashboard";
import { CategoryPhoto, MERGED_CATEGORY } from "./brand";
import { severityName, statusName, tr, trf, type Lang } from "./i18n";
import { catLabel, deptLabel, flagLabel } from "./i18nStaff";
import { actionKey, tone, waitOf } from "./facts";

/** Quick filters for the officer: each maps to a server-side filter so paging stays correct. */
type Quick = "all" | "critical" | "high" | "school" | "hospital" | "new";
const QUICK: { id: Quick; key: "s_qAll" | "s_qCritical" | "s_qHigh" | "s_qSchool" | "s_qHospital" | "s_qNew" }[] = [
  { id: "all", key: "s_qAll" }, { id: "critical", key: "s_qCritical" }, { id: "high", key: "s_qHigh" }, { id: "school", key: "s_qSchool" }, { id: "hospital", key: "s_qHospital" }, { id: "new", key: "s_qNew" },
];

type Sort = "priority" | "newest" | "oldest" | "affected";

const catIcon: Record<string, IconName> = { Pothole: "road", "Road Damage": "road", Streetlight: "light", Garbage: "waste", "Water Leakage": "water", Drainage: "water", "Electrical Hazard": "bolt", Other: "plus" };
const PAGE = 50;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = window.setTimeout(() => setV(value), ms); return () => window.clearTimeout(t); }, [value, ms]);
  return v;
}

/** Plain-language reasons for a hotspot's impact score; every line comes from the hotspot's own counts. */
export function hotspotReasons(h: Hotspot, lang: Lang = "en"): string[] {
  const why = [trf(lang, "s_r_open", { n: h.open_incidents })];
  if (h.categories.length > 1) why.push(trf(lang, "s_r_types", { n: h.categories.length }));
  if (h.critical > 0) why.push(trf(lang, "s_r_crit", { n: h.critical }));
  if (h.unique_citizens > 1) why.push(trf(lang, "s_r_cit", { n: h.unique_citizens }));
  if (h.affected > h.open_incidents) why.push(trf(lang, "s_r_aff", { n: h.affected }));
  return why;
}

function HotspotCards({ items, onPick, lang }: { items: Hotspot[]; onPick: (area: string) => void; lang: Lang }) {
  if (items.length === 0) return null;
  return <><h2 className="ad-h">{tr(lang, "ad_hotspots")} <Tag kind="gis" lang={lang} /></h2><div className="hot-grid">{items.map(h => <div className="hot-card" key={h.id} role="button" tabIndex={0} title={tr(lang, "s_showArea")} onClick={() => onPick(h.area)} onKeyDown={e => { if (e.key === "Enter") onPick(h.area); }}>
    <div className="hot-top"><b>{h.area}</b><span className="hot-score" title={tr(lang, "s_hotTip")}>{h.impact_score}</span></div>
    <p>{h.open_incidents} {tr(lang, "s_open")} · {h.critical} {tr(lang, "s_critical")} · {h.unique_citizens} {tr(lang, "s_citizens")} · {h.confirmations} {tr(lang, "s_confirmations")}</p>
    <p className="hot-cats">{h.categories.map(c => <span key={c.category} className="hot-cat"><CategoryPhoto category={c.category} className="cat-dot" label={false} />{catLabel(lang, c.category)} ×{c.count}</span>)}</p>
    <p className="hot-why muted-line">{tr(lang, "s_impact")} {h.impact_score}/100 {tr(lang, "s_because")}: {hotspotReasons(h, lang).join(" · ")}</p>
  </div>)}</div></>;
}

export default function AuthorityDashboard({ user, lang = "en" }: { user: ApiUser; lang?: Lang }) {
  const qc = useQueryClient();
  const [cat, setCat] = useState("");
  const [area, setArea] = useState("");
  const [status, setStatus] = useState("");
  const [quick, setQuick] = useState<Quick>("all");
  const [sort, setSort] = useState<Sort>("priority");
  const [search, setSearch] = useState("");
  const [hideResolved, setHideResolved] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkText, setBulkText] = useState("");
  const q = useDebounced(search.trim(), 300);
  const filters = {
    category: cat || undefined, ward: area || undefined, status: status || (quick === "new" ? "Reported" : undefined), q: q || undefined, hide_resolved: hideResolved || undefined, sort,
    min_priority: quick === "critical" ? 65 : quick === "high" ? 48 : undefined,
    flag: quick === "school" ? "Near school" : quick === "hospital" ? "Near hospital" : undefined,
  };

  const list = useInfiniteQuery({
    queryKey: ["authority", "list", filters], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.authorityList({ ...filters, limit: PAGE, cursor: pageParam }),
    getNextPageParam: last => last.next_cursor ?? undefined,
    refetchInterval: 20_000, // live refresh (polling; no WebSocket)
  });
  // Totals and hotspots refresh on the same 20 s cycle.
  const stats = useQuery({ queryKey: ["authority", "stats"], queryFn: api.authorityStats, refetchInterval: 20_000 });
  const hot = useQuery({ queryKey: ["authority", "hotspots"], queryFn: () => api.hotspots(4), refetchInterval: 20_000 });
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick(n => n + 1), 5000); return () => window.clearInterval(t); }, []);
  const updatedAgo = list.dataUpdatedAt ? Math.round((Date.now() - list.dataUpdatedAt) / 1000) : null;

  const rows = list.data?.pages.flatMap(p => p.items) ?? [];
  const overdue = rows.filter(r => waitOf(r.created_at, r.level, r.status).overdueBy > 0).length;
  const total = list.data?.pages[0]?.total ?? rows.length;

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting && list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage(); }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [list.hasNextPage, list.isFetchingNextPage, list.fetchNextPage]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshAfterAction = (ids: string[]) => {
    qc.invalidateQueries({ queryKey: ["authority", "list"] });
    qc.invalidateQueries({ queryKey: ["authority", "stats"] });
    ids.forEach(id => qc.invalidateQueries({ queryKey: ["authority", "incident", id] }));
  };
  const single = useMutation({
    mutationFn: ({ id, next, text }: { id: string; next: Status | null; text: string }) => api.authorityUpdate(id, { status: next ?? undefined, message: text.trim() || undefined }),
    onSuccess: (_r, v) => { setReply(""); refreshAfterAction([v.id]); },
  });
  const bulkMut = useMutation({
    mutationFn: ({ ids, next, text }: { ids: string[]; next: Status | null; text: string }) => api.authorityBulk({ ids, status: next ?? undefined, message: text.trim() || undefined }),
    onSuccess: (_r, v) => { setSelected([]); setBulkText(""); refreshAfterAction(v.ids); },
  });

  const toggle = (id: string) => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));
  const allVisibleSelected = rows.length > 0 && rows.every(r => selected.includes(r.id));
  const toggleAll = () => setSelected(allVisibleSelected ? [] : rows.slice(0, 100).map(r => r.id));
  const act = (id: string, next: Status | null) => single.mutate({ id, next, text: reply });
  const bulk = (next: Status | null) => bulkMut.mutate({ ids: selected.slice(0, 100), next, text: bulkText });
  const s = stats.data;
  const n = (v: number | undefined) => (v === undefined ? "–" : v);

  const filtered = !!(cat || area || status || search || quick !== "all");
  return <main className="page section ad">
    <div className="page-heading"><div><span className="eyebrow">{tr(lang, "ad_eyebrow")}</span><h1>{tr(lang, "ad_title")}</h1><p>{tr(lang, "ad_welcome")}, {user.name} · {deptLabel(lang, user.department)} · {user.employee_id}</p></div></div>

    <section className={`attention${(s?.critical_open ?? 0) + overdue > 0 ? " hot" : ""}`} aria-label={tr(lang, "s_needNow")}>
      <div><h2>{tr(lang, "s_needNow")}</h2><p>{(s?.critical_open ?? 0) + overdue > 0 ? tr(lang, "s_needNowSub") : tr(lang, "s_allClear")}</p></div>
      <button onClick={() => { setQuick("critical"); setHideResolved(true); }} className="att-num"><b>{n(s?.critical_open)}</b><span>{tr(lang, "s_criticalOpen")}</span></button>
      <button onClick={() => { setQuick("all"); setHideResolved(true); setSort("oldest"); }} className="att-num"><b>{overdue}</b><span>{tr(lang, "s_overdueCount")}</span></button>
      <button onClick={() => { setQuick("new"); }} className="att-num"><b>{n(s?.new_24h)}</b><span>{tr(lang, "ad_new24")}</span></button>
    </section>

    <div className="ad-stats">
      <div><small>{tr(lang, "ad_total")}</small><b>{n(s?.total)}</b></div>
      <div><small>{tr(lang, "ad_open")}</small><b>{n(s?.open)}</b></div>
      <div><small>{tr(lang, "ad_inprogress")}</small><b>{n(s?.in_progress)}</b></div>
      <div className="danger"><small>{tr(lang, "ad_critical")}</small><b>{n(s?.critical_open)}</b></div>
      <div className="warn"><small>{tr(lang, "ad_high")}</small><b>{n(s?.high_open)}</b></div>
      <div><small>{tr(lang, "ad_new24")}</small><b>{n(s?.new_24h)}</b></div>
      <div className="good"><small>{tr(lang, "ad_resolved")}</small><b>{n(s?.resolved)}</b></div>
    </div>

    <p className="muted-line ad-updated" aria-live="polite">{updatedAgo === null ? tr(lang, "s_loading") : updatedAgo < 8 ? tr(lang, "ad_justNow") : `${tr(lang, "s_updatedAgo")} ${updatedAgo} ${tr(lang, "s_secAgo")}`} · {tr(lang, "s_refresh")}</p>
    <MapDashboard mode="authority" lang={lang} />
    <HotspotCards lang={lang} items={hot.data?.items ?? []} onPick={a => (AREAS as readonly string[]).includes(a) && setArea(a)} />

    <h2 className="ad-h">{tr(lang, "s_category")}</h2>
    <div className="ad-cats">{CATEGORY_NAMES.map(name => {
      // Legacy Road Damage / Drainage reports are counted under their merged category.
      const c = (s?.per_category ?? []).filter(x => (MERGED_CATEGORY[x.category] ?? x.category) === name).reduce((a, x) => ({ total: a.total + x.total, open: a.open + x.open }), { total: 0, open: 0 });
      return <button key={name} className={cat === name ? "active" : ""} onClick={() => setCat(cat === name ? "" : name)} aria-pressed={cat === name}>
        <CategoryPhoto category={name} className="cat-photo sm" label={false} /><b>{catLabel(lang, name)}</b><strong>{s ? c.total : "–"}</strong><small>{c.open} {tr(lang, "s_open")} · {c.total - c.open} {tr(lang, "s_solved")}</small>
        <i style={{ width: `${c.total ? ((c.total - c.open) / c.total) * 100 : 0}%` }} />
      </button>;
    })}</div>

    <details className="ad-how"><summary><Icon name="shield" size={18} /> {tr(lang, "ad_how")}</summary>
      <p>{tr(lang, "ad_howIntro")}</p>
      <ol className="how-steps"><li>{tr(lang, "ad_how1")}</li><li>{tr(lang, "ad_how2")}</li><li>{tr(lang, "ad_how3")}</li><li>{tr(lang, "ad_how4")}</li></ol>
      <p className="how-ai"><Tag kind="ml" lang={lang} /> {tr(lang, "ad_howAi")}</p>
      <h3>{tr(lang, "s_legendHelp")}</h3>
      <ul className="plain"><li>{tr(lang, "s_g_priority")}</li><li>{tr(lang, "s_g_sla")}</li><li>{tr(lang, "s_g_affected")}</li><li>{tr(lang, "s_g_auto")}</li><li>{tr(lang, "s_g_cluster")}</li></ul>
      <p className="muted-line">{tr(lang, "ad_samples")}</p></details>

    <div className="quick" role="group" aria-label={tr(lang, "s_quick")}><span>{tr(lang, "s_quick")}:</span>{QUICK.map(x => <button key={x.id} className={quick === x.id ? "active" : ""} aria-pressed={quick === x.id} onClick={() => setQuick(x.id)}>{tr(lang, x.key)}</button>)}</div>
    <div className="ad-toolbar">
      <label className="ad-search"><Icon name="search" size={18} /><input value={search} onChange={e => setSearch(e.target.value)} maxLength={100} placeholder={tr(lang, "ad_search")} aria-label={tr(lang, "ad_search")} /></label>
      <select value={area} onChange={e => setArea(e.target.value)} aria-label={tr(lang, "ad_allAreas")}><option value="">{tr(lang, "ad_allAreas")}</option>{AREAS.map(a => <option key={a}>{a}</option>)}</select>
      <select value={status} onChange={e => setStatus(e.target.value)} aria-label={tr(lang, "ad_allStatus")}><option value="">{tr(lang, "ad_allStatus")}</option>{STATUSES.map(x => <option key={x} value={x}>{statusName(lang, x)}</option>)}</select>
      <select value={sort} onChange={e => setSort(e.target.value as Sort)} aria-label={tr(lang, "ad_sortPriority")}><option value="priority">{tr(lang, "ad_sortPriority")}</option><option value="newest">{tr(lang, "ad_sortNew")}</option><option value="oldest">{tr(lang, "ad_sortOld")}</option><option value="affected">{tr(lang, "ad_sortAffected")}</option></select>
      <label className="ad-check"><input type="checkbox" checked={hideResolved} onChange={e => setHideResolved(e.target.checked)} /> {tr(lang, "ad_hideResolved")}</label>
    </div>

    <div className="ad-listhead"><label className="ad-check"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} /> {tr(lang, "s_selectAll")} {rows.length}{total > rows.length ? ` ${tr(lang, "s_of")} ${total}` : ""}</label>{filtered && <button className="text-button" onClick={() => { setCat(""); setArea(""); setStatus(""); setSearch(""); setQuick("all"); }}>{tr(lang, "s_clearFilters")}</button>}</div>

    <h2 className="ad-h">{tr(lang, "ad_list")}</h2>
    <div className="ad-list">
      {list.isPending && [0, 1, 2, 3].map(k => <article key={k} className="ad-item skeleton-card"><div className="ad-row"><span /><div className="prio skeleton-block" /><div className="ad-main"><div className="skeleton-line w75" /><div className="skeleton-line w50" /></div></div></article>)}
      {list.isError && <div className="empty-note error"><Icon name="alert" /><span><b>{tr(lang, "s_loadFail")}</b><small>{(list.error as Error).message}</small></span><button className="secondary compact" onClick={() => list.refetch()}>{tr(lang, "s_retry")}</button></div>}
      {list.isSuccess && rows.length === 0 && <div className="empty-note"><Icon name="check" /><span><b>{tr(lang, "s_noMatch")}</b></span></div>}
      {rows.map(issue => {
        const open = openId === issue.id;
        const w = waitOf(issue.created_at, issue.level, issue.status), t = tone(issue.level, w);
        return <article key={issue.id} className={`ad-item card-${t}${open ? " open" : ""}${issue.status === "Resolved" ? " resolved" : ""}`}>
          <div className="ad-row">
            <input type="checkbox" checked={selected.includes(issue.id)} onChange={() => toggle(issue.id)} aria-label={issue.title} />
            <div className="ad-media"><Evidence url={issue.thumb_url} category={issue.category} alt={catLabel(lang, issue.category)} />
              <div className={`prio lvl-${issue.level.toLowerCase()}`} title={tr(lang, "s_g_priority")}><b>{issue.priority_score}</b><small>{severityName(lang, issue.level)}</small></div></div>
            <button className="ad-main" onClick={() => { setOpenId(open ? null : issue.id); setReply(""); }} aria-expanded={open}>
              <b>{issue.title}</b>
              <span className="ad-meta"><span><Icon name={catIcon[issue.category] ?? "plus"} size={14} /> {catLabel(lang, issue.category)}</span><span><Icon name="pin" size={14} /> {issue.area ?? tr(lang, "s_noArea")}</span><span>{deptLabel(lang, issue.department)}</span></span>
              <span className="facts">
                <span className={`fact ${w.overdueBy > 0 ? "red" : ""}`}><Icon name="clock" size={14} /> {w.closed ? tr(lang, "s_closed") : w.overdueBy > 0 ? `${tr(lang, "s_overdueBy")} ${waitText(lang, w.overdueBy)}` : `${tr(lang, "s_openFor")} ${waitText(lang, w.days)}`}</span>
                <span className="fact"><Icon name="community" size={14} /> {issue.affected_count} {tr(lang, issue.affected_count === 1 ? "s_person" : "s_people")}</span>
                {issue.flags.map(f => <em key={f} className="fact flag">{flagLabel(lang, f)}</em>)}
              </span>
              <span className="next-line"><b>{tr(lang, "s_action")}:</b> {tr(lang, actionKey(issue.level, issue.status))}</span>
              <span className="ad-intel">{issue.sample_confidence != null && <span className="chip sample">{tr(lang, "s_exampleChip")} · {tr(lang, "exampleConf")} {Math.round(issue.sample_confidence * 100)}%</span>}<AiChip ai={issue.ai} lang={lang} />{issue.nlp?.urgency && <span className="chip">{tr(lang, "s_textUrgency")}: {severityName(lang, issue.nlp.urgency)}</span>}</span>
              <span className="ad-where"><Icon name="pin" size={14} /> <b>{tr(lang, "ad_location")}:</b> {issue.address_text ? `${issue.address_text} · ` : ""}{issue.area ?? "—"}</span>
              {issue.citizen_message && <span className="ad-msg">{tr(lang, "ad_citizenSays")}: “{issue.citizen_message}”</span>}
            </button>
            <div className="ad-side">
              <span className={`pill st-${issue.status.toLowerCase().replace(" ", "-")}`}>{statusName(lang, issue.status)}</span>
              {issue.status !== "Resolved" && <div className="quick-act">
                {issue.status !== "In Progress" && <button className="secondary compact" disabled={single.isPending} onClick={() => single.mutate({ id: issue.id, next: "In Progress", text: "" })}>{tr(lang, "s_startWork")}</button>}
                <button className="primary compact" disabled={single.isPending} onClick={() => single.mutate({ id: issue.id, next: "Resolved", text: "" })}><Icon name="check" size={14} /> {tr(lang, "s_resolve")}</button>
              </div>}
              <button className="text-button" onClick={() => { setOpenId(open ? null : issue.id); setReply(""); }}>{open ? tr(lang, "s_hideDetails") : tr(lang, "s_details")}</button>
            </div>
          </div>
          {open && <Detail issue={issue} reply={reply} setReply={setReply} act={act} acting={single.isPending} lang={lang} />}
          {single.isError && single.variables?.id === issue.id && <div className="form-error" role="alert"><Icon name="alert" size={16} /> {(single.error as Error).message}</div>}
        </article>;
      })}
      <div ref={sentinel} />
      {list.hasNextPage && <button className="secondary load-more" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>{list.isFetchingNextPage ? tr(lang, "s_loading") : tr(lang, "s_loadMore")}</button>}
    </div>

    {selected.length > 0 && <div className="ad-bulk" role="region" aria-label="Bulk actions">
      <b>{selected.length} {tr(lang, "s_selected")}</b>
      <input value={bulkText} maxLength={1000} onChange={e => setBulkText(e.target.value)} placeholder={tr(lang, "s_bulkPlaceholder")} aria-label={tr(lang, "s_bulkPlaceholder")} />
      <button className="secondary compact" onClick={() => bulk(null)} disabled={!bulkText.trim() || bulkMut.isPending}>{tr(lang, "s_message")}</button>
      <button className="secondary compact" onClick={() => bulk("In Progress")} disabled={bulkMut.isPending}>{tr(lang, "s_inProgressBtn")}</button>
      <button className="primary compact" onClick={() => bulk("Resolved")} disabled={bulkMut.isPending}>{tr(lang, "s_resolveAll")}</button>
      <button className="text-button" onClick={() => setSelected([])}>{tr(lang, "s_clear")}</button>
      {bulkMut.isError && <small className="err">{(bulkMut.error as Error).message}</small>}
    </div>}
  </main>;
}
