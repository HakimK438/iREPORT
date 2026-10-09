import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "./Icon";
import { AREAS, CATEGORY_NAMES } from "./store";
import { api, type ApiUser, type ChipId, type Hotspot } from "./api";
import Brief, { DueText, Evidence, ResponseChip, StatusPill } from "./IncidentDetail";
import MapDashboard from "./MapDashboard";
import { CategoryPhoto } from "./brand";
import { tr, trf, type Lang, type StrKey } from "./i18n";
import { catLabel, deptLabel } from "./i18nStaff";

const AnalysisTab = lazy(() => import("./AnalysisTab"));

/** The count chips above the list. Each chip's number comes from /authority/stats and equals the list total for the same filters. */
const CHIPS: { id: ChipId; key: StrKey }[] = [
  { id: "all", key: "c_all" }, { id: "new", key: "c_new" }, { id: "acknowledged", key: "c_acknowledged" }, { id: "scheduled", key: "c_scheduled" },
  { id: "in_progress", key: "c_in_progress" }, { id: "resolved", key: "c_resolved" }, { id: "closed", key: "c_closed" }, { id: "overdue", key: "c_overdue" }, { id: "unassigned", key: "c_unassigned" },
];
type Sort = "priority" | "newest" | "oldest" | "affected" | "due";
const PAGE = 50;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = window.setTimeout(() => setV(value), ms); return () => window.clearTimeout(t); }, [value, ms]);
  return v;
}

/** Plain-language lines for a hotspot (used by the admin overview too); every line comes from the hotspot's own counts. */
export function hotspotReasons(h: Hotspot, lang: Lang = "en"): string[] {
  const why = [trf(lang, "s_r_open", { n: h.open_incidents })];
  if (h.categories.length > 1) why.push(trf(lang, "s_r_types", { n: h.categories.length }));
  if (h.critical > 0) why.push(trf(lang, "s_r_crit", { n: h.critical }));
  if (h.unique_citizens > 1) why.push(trf(lang, "s_r_cit", { n: h.unique_citizens }));
  return why;
}

function HotspotCards({ items, onPick, lang }: { items: Hotspot[]; onPick: (area: string) => void; lang: Lang }) {
  if (items.length === 0) return null;
  return <><h3 className="ad-h sm">{tr(lang, "ad_hotspots")}</h3><div className="hot-grid">{items.map(h => <button className="hot-card" key={h.id} title={tr(lang, "s_showArea")} onClick={() => onPick(h.area)}>
    <div className="hot-top"><b>{h.area}</b></div>
    <p>{trf(lang, "v_hotLine", { n: h.open_incidents, m: 400 })}{h.critical > 0 ? ` · ${trf(lang, "v_hotEmergency", { n: h.critical })}` : ""}</p>
    <p className="hot-cats">{h.categories.map(c => <span key={c.category} className="hot-cat"><CategoryPhoto category={c.category} className="cat-dot" label={false} />{catLabel(lang, c.category)} ×{c.count}</span>)}</p>
  </button>)}</div></>;
}

export default function AuthorityDashboard({ user, lang = "en" }: { user: ApiUser; lang?: Lang }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"complaints" | "analysis">("complaints");
  const [cat, setCat] = useState("");
  const [area, setArea] = useState("");
  const [view, setView] = useState<ChipId>("all");
  const [response, setResponse] = useState("");
  const [sort, setSort] = useState<Sort>("priority");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [mapOpen, setMapOpen] = useState(true);
  const q = useDebounced(search.trim(), 300);
  const base = { category: cat || undefined, ward: area || undefined, q: q || undefined };
  const filters = { ...base, response: response || undefined, view: view === "all" ? undefined : view, sort };

  const list = useInfiniteQuery({
    queryKey: ["authority", "list", filters], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.authorityList({ ...filters, limit: PAGE, cursor: pageParam }),
    getNextPageParam: last => last.next_cursor ?? undefined,
    refetchInterval: 20_000, // live refresh (polling; no WebSocket)
  });
  // Chip counts use the same ward / category / search filters as the list, so a chip's number equals the list total.
  const stats = useQuery({ queryKey: ["authority", "stats", base], queryFn: () => api.authorityStats(base), refetchInterval: 20_000 });
  const hot = useQuery({ queryKey: ["authority", "hotspots"], queryFn: () => api.hotspots(4), refetchInterval: 20_000, enabled: tab === "complaints" });
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick(n => n + 1), 5000); return () => window.clearInterval(t); }, []);
  const updatedAgo = list.dataUpdatedAt ? Math.round((Date.now() - list.dataUpdatedAt) / 1000) : null;

  const rows = list.data?.pages.flatMap(p => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? rows.length;

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting && list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage(); }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [list.hasNextPage, list.isFetchingNextPage, list.fetchNextPage]); // eslint-disable-line react-hooks/exhaustive-deps

  const [bulkPanel, setBulkPanel] = useState<null | "assign" | "schedule" | "message">(null);
  const [bulkText, setBulkText] = useState(""), [bulkDate, setBulkDate] = useState(""), [bulkOfficer, setBulkOfficer] = useState("");
  const officers = useQuery({ queryKey: ["authority", "officers"], queryFn: api.officers, enabled: bulkPanel === "assign", staleTime: 5 * 60_000 });
  const bulkMut = useMutation({
    mutationFn: (body: Parameters<typeof api.authorityBulk>[0]) => api.authorityBulk(body),
    onSuccess: () => { setSelected([]); setBulkPanel(null); setBulkText(""); qc.invalidateQueries({ queryKey: ["authority"] }); },
  });
  const ids = selected.slice(0, 100);
  const toggle = (id: string) => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));
  const allVisibleSelected = rows.length > 0 && rows.every(r => selected.includes(r.id));
  const toggleAll = () => setSelected(allVisibleSelected ? [] : rows.slice(0, 100).map(r => r.id));
  const s = stats.data;
  const filtered = !!(cat || area || search || response || view !== "all");
  const clearFilters = () => { setCat(""); setArea(""); setSearch(""); setResponse(""); setView("all"); };

  return <main className="page section ad">
    <div className="page-heading"><div><span className="eyebrow">{tr(lang, "ad_eyebrow")}</span><h1>{tr(lang, "ad_title")}</h1><p>{tr(lang, "ad_welcome")}, {user.name} · {deptLabel(lang, user.department)} · {user.employee_id}</p></div></div>

    <div className="ad-tabs" role="tablist" aria-label={tr(lang, "ad_title")}>
      <button role="tab" id="tab-complaints" aria-selected={tab === "complaints"} aria-controls="panel-complaints" className={tab === "complaints" ? "active" : ""} onClick={() => setTab("complaints")}>{tr(lang, "an_tabComplaints")}</button>
      <button role="tab" id="tab-analysis" aria-selected={tab === "analysis"} aria-controls="panel-analysis" className={tab === "analysis" ? "active" : ""} onClick={() => setTab("analysis")}>{tr(lang, "an_tabAnalysis")}</button>
    </div>

    {tab === "analysis" && <div role="tabpanel" id="panel-analysis" aria-labelledby="tab-analysis"><Suspense fallback={<p className="muted-line" role="status">{tr(lang, "s_loading")}</p>}>
      <AnalysisTab lang={lang} ward={area} category={cat} setWard={w => setArea(w)} setCategory={setCat} openList={() => setTab("complaints")} /></Suspense></div>}

    {tab === "complaints" && <div role="tabpanel" id="panel-complaints" aria-labelledby="tab-complaints">
      <div className="ad-toolbar">
        <label className="ad-search"><Icon name="search" size={18} /><input value={search} onChange={e => setSearch(e.target.value)} maxLength={100} placeholder={tr(lang, "ad_search")} aria-label={tr(lang, "ad_search")} /></label>
        <select value={area} onChange={e => setArea(e.target.value)} aria-label={tr(lang, "ad_allAreas")}><option value="">{tr(lang, "ad_allAreas")}</option>{AREAS.map(a => <option key={a}>{a}</option>)}</select>
        <select value={cat} onChange={e => setCat(e.target.value)} aria-label={tr(lang, "s_category")}><option value="">{tr(lang, "m_allCats")}</option>{CATEGORY_NAMES.map(c => <option key={c} value={c}>{catLabel(lang, c)}</option>)}</select>
        <select value={response} onChange={e => setResponse(e.target.value)} aria-label={tr(lang, "v_responseFilter")}><option value="">{tr(lang, "v_allResponses")}</option>{(["Emergency", "Urgent", "Routine", "Planned"] as const).map(r => <option key={r} value={r}>{tr(lang, `resp_${r}` as StrKey)}</option>)}</select>
        <select value={sort} onChange={e => setSort(e.target.value as Sort)} aria-label={tr(lang, "v_sort")}><option value="priority">{tr(lang, "v_sortUrgent")}</option><option value="due">{tr(lang, "v_sortDue")}</option><option value="newest">{tr(lang, "ad_sortNew")}</option><option value="oldest">{tr(lang, "ad_sortOld")}</option><option value="affected">{tr(lang, "v_sortCitizens")}</option></select>
      </div>

      <details className="ad-fold" open onToggle={e => { if ((e.currentTarget as HTMLDetailsElement).open) setMapOpen(true); }}>
        <summary><Icon name="map" size={16} /> {tr(lang, "v_mapSummary")}</summary>
        {mapOpen && <><MapDashboard mode="authority" lang={lang} />
          <HotspotCards lang={lang} items={hot.data?.items ?? []} onPick={a => { if ((AREAS as readonly string[]).includes(a)) { setArea(a); } }} /></>}
      </details>

      <div className="chips" role="group" aria-label={tr(lang, "c_label")}><div className="chip-grp">{CHIPS.filter(c => c.id !== "overdue" && c.id !== "unassigned").map(c => <button key={c.id} className={`chip-btn${view === c.id ? " active" : ""}${c.id === "overdue" ? " red" : ""}${c.id === "unassigned" ? " amber" : ""}`} aria-pressed={view === c.id} onClick={() => setView(c.id)}>
          <span>{tr(lang, c.key)}</span><b>{s ? s.chips[c.id] : "–"}</b></button>)}</div>
      <div className="chip-grp attn">{CHIPS.filter(c => c.id === "overdue" || c.id === "unassigned").map(c => <button key={c.id} className={`chip-btn${view === c.id ? " active" : ""}${c.id === "overdue" ? " red" : ""}${c.id === "unassigned" ? " amber" : ""}`} aria-pressed={view === c.id} onClick={() => setView(c.id)}>
          <span>{tr(lang, c.key)}</span><b>{s ? s.chips[c.id] : "–"}</b></button>)}</div></div>
      <p className="muted-line ad-updated" aria-live="polite">{s ? `${trf(lang, "v_emergencyOpen", { n: s.emergency_open })} · ${trf(lang, "v_dueToday", { n: s.due_today })} · ` : ""}{updatedAgo === null ? tr(lang, "s_loading") : updatedAgo < 8 ? tr(lang, "ad_justNow") : `${tr(lang, "s_updatedAgo")} ${updatedAgo} ${tr(lang, "s_secAgo")}`}</p>

      <h2 className="ad-h sm">{tr(lang, "ad_list")}</h2>
      <div className="ad-listhead"><label className="ad-check"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} aria-label={trf(lang, "v_selectAllAria", { n: Math.min(rows.length, 100) })} /> {tr(lang, "s_selectAll")} {rows.length}{total > rows.length ? ` ${tr(lang, "s_of")} ${total}` : ""}</label>{filtered && <button className="text-button" onClick={clearFilters}>{tr(lang, "s_clearFilters")}</button>}</div>

      <div className="ad-list">
        {list.isPending && [0, 1, 2, 3].map(k => <article key={k} className="ad-item skeleton-card"><div className="ad-row"><span /><div className="prio skeleton-block" /><div className="ad-main"><div className="skeleton-line w75" /><div className="skeleton-line w50" /></div></div></article>)}
        {list.isError && <div className="empty-note error"><Icon name="alert" /><span><b>{tr(lang, "s_loadFail")}</b><small>{(list.error as Error).message}</small></span><button className="secondary compact" onClick={() => list.refetch()}>{tr(lang, "s_retry")}</button></div>}
        {list.isSuccess && rows.length === 0 && <div className="empty-note"><Icon name="check" /><span><b>{tr(lang, "s_noMatch")}</b></span></div>}
        {rows.map(issue => {
          const open = openId === issue.id;
          return <article key={issue.id} className={`ad-item card-${issue.response.toLowerCase()}${open ? " open" : ""}${issue.status === "Resolved" || issue.status === "Closed" ? " resolved" : ""}`}>
            <div className="ad-row">
              <input type="checkbox" checked={selected.includes(issue.id)} onChange={() => toggle(issue.id)} aria-label={trf(lang, "v_selectOneAria", { no: issue.public_id })} />
              <div className="ad-media"><Evidence url={issue.thumb_url} category={issue.category} alt={catLabel(lang, issue.category)} /></div>
              <button className="ad-main" onClick={() => setOpenId(open ? null : issue.id)} aria-expanded={open}>
                <b>{issue.title}</b>
                <span className="ad-meta"><span className="loc"><Icon name="pin" size={14} /> {issue.area ?? tr(lang, "s_noArea")}</span><span className="tag">{issue.public_id}</span><span className={`who${issue.assignee ? "" : " none"}`}><Icon name="profile" size={14} /> {issue.assignee ? issue.assignee.name : tr(lang, "v_unassigned")}</span></span>
              </button>
              <div className="ad-side">
                <span className="ad-urgency"><ResponseChip response={issue.response} lang={lang} /><DueText row={issue} lang={lang} /></span>
                <StatusPill status={issue.status} lang={lang} />
              </div>
            </div>
            {open && <Brief id={issue.id} lang={lang} onClose={() => setOpenId(null)} />}
          </article>;
        })}
        <div ref={sentinel} />
        {list.hasNextPage && <button className="secondary load-more" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>{list.isFetchingNextPage ? tr(lang, "s_loading") : tr(lang, "s_loadMore")}</button>}
      </div>

      {selected.length > 0 && <div className="ad-bulk" role="region" aria-label={tr(lang, "v_bulkRegion")}>
        <b>{selected.length} {tr(lang, "s_selected")}</b>
        <button className="secondary compact" disabled={bulkMut.isPending} onClick={() => bulkMut.mutate({ ids, status: "Acknowledged" })}>{tr(lang, "v_a_acknowledge")}</button>
        <button className="secondary compact" disabled={bulkMut.isPending} onClick={() => bulkMut.mutate({ ids, status: "Resolved" })}>{tr(lang, "v_a_resolve")}</button>
        <button className="secondary compact" onClick={() => setBulkPanel(bulkPanel === "assign" ? null : "assign")}>{tr(lang, "v_a_assign")}</button>
        <button className="secondary compact" onClick={() => setBulkPanel(bulkPanel === "schedule" ? null : "schedule")}>{tr(lang, "v_a_schedule")}</button>
        <button className="secondary compact" onClick={() => setBulkPanel(bulkPanel === "message" ? null : "message")}>{tr(lang, "s_message")}</button>
        <button className="text-button" onClick={() => { setSelected([]); setBulkPanel(null); }}>{tr(lang, "s_clear")}</button>
        {bulkPanel === "assign" && <span className="bulk-row"><select value={bulkOfficer} onChange={e => setBulkOfficer(e.target.value)} aria-label={tr(lang, "v_a_assign")}>{officers.data?.items.map(o => <option key={o.id} value={o.id}>{o.name}{o.is_me ? ` (${tr(lang, "v_me")})` : ""}</option>)}</select>
          <button className="primary compact" disabled={bulkMut.isPending || !(bulkOfficer || officers.data?.items.length)} onClick={() => bulkMut.mutate({ ids, assigned_to: bulkOfficer || officers.data?.items[0]?.id })}>{tr(lang, "v_confirm")}</button></span>}
        {bulkPanel === "schedule" && <span className="bulk-row"><input type="date" value={bulkDate} onChange={e => setBulkDate(e.target.value)} aria-label={tr(lang, "v_visitDate")} />
          <button className="primary compact" disabled={bulkMut.isPending || !bulkDate} onClick={() => bulkMut.mutate({ ids, status: "Scheduled", scheduled_for: bulkDate })}>{tr(lang, "v_confirm")}</button></span>}
        {bulkPanel === "message" && <span className="bulk-row"><input value={bulkText} maxLength={1000} onChange={e => setBulkText(e.target.value)} placeholder={tr(lang, "s_bulkPlaceholder")} aria-label={tr(lang, "s_bulkPlaceholder")} />
          <button className="primary compact" disabled={bulkMut.isPending || !bulkText.trim()} onClick={() => bulkMut.mutate({ ids, message: bulkText.trim() })}>{tr(lang, "s_message")}</button></span>}
        {bulkMut.isError && <small className="err">{(bulkMut.error as Error).message}</small>}
        {bulkMut.data && bulkMut.data.skipped.length > 0 && <small className="err">{trf(lang, "v_bulkSkipped", { n: bulkMut.data.skipped.length })}</small>}
      </div>}
    </div>}
  </main>;
}
