import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon, type IconName } from "./Icon";
import { AREAS, CATEGORY_NAMES, STATUSES, ago, type Status } from "./store";
import { api, type ApiUser, type Hotspot } from "./api";
import { AiChip, Detail, Tag } from "./IncidentDetail";
import MapDashboard from "./MapDashboard";
import { categoryLabel, MERGED_CATEGORY } from "./brand";

type Sort = "priority" | "newest" | "oldest" | "affected";

const catIcon: Record<string, IconName> = { Pothole: "road", "Road Damage": "road", Streetlight: "light", Garbage: "waste", "Water Leakage": "water", Drainage: "water", "Electrical Hazard": "bolt", Other: "plus" };
const PAGE = 50;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = window.setTimeout(() => setV(value), ms); return () => window.clearTimeout(t); }, [value, ms]);
  return v;
}

/** Plain-language reasons for an area's impact score; every line comes from the hotspot's own counts. */
export function hotspotReasons(h: Hotspot): string[] {
  const why = [`${h.open_incidents} open incident${h.open_incidents === 1 ? "" : "s"} in the area`];
  if (h.categories.length > 1) why.push(`${h.categories.length} problem types`);
  if (h.critical > 0) why.push(`${h.critical} critical`);
  if (h.unique_citizens > 1) why.push(`${h.unique_citizens} citizens reporting`);
  if (h.affected > h.open_incidents) why.push(`${h.affected} people affected`);
  return why;
}

function HotspotCards({ items }: { items: Hotspot[] }) {
  if (items.length === 0) return null;
  return <><h2 className="ad-h">Hotspots <Tag kind="gis" /></h2><div className="hot-grid">{items.map(h => <div className="hot-card" key={h.area}>
    <div className="hot-top"><b>{h.area}</b><span className="hot-score" title="Impact score: this area's summed incident priority relative to the busiest area (100)">{h.impact_score}</span></div>
    <p>{h.open_incidents} open · {h.critical} critical · {h.unique_citizens} citizen{h.unique_citizens === 1 ? "" : "s"} · {h.confirmations} confirmation{h.confirmations === 1 ? "" : "s"}</p>
    <p className="hot-cats">{h.categories.map(c => `${c.category} ×${c.count}`).join(" · ")}</p>
    <p className="hot-why muted-line">Impact {h.impact_score}/100 because: {hotspotReasons(h).join(" · ")}</p>
  </div>)}</div></>;
}

export default function AuthorityDashboard({ user }: { user: ApiUser }) {
  const qc = useQueryClient();
  const [cat, setCat] = useState("");
  const [area, setArea] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<Sort>("priority");
  const [search, setSearch] = useState("");
  const [hideResolved, setHideResolved] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkText, setBulkText] = useState("");
  const q = useDebounced(search.trim(), 300);
  const filters = { category: cat || undefined, ward: area || undefined, status: status || undefined, q: q || undefined, hide_resolved: hideResolved || undefined, sort };

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

  return <main className="page section ad">
    <div className="page-heading"><div><span className="eyebrow">AUTHORITY CONTROL ROOM</span><h1>Every problem in Mumbai</h1><p>Welcome, {user.name} · {user.department} · {user.employee_id}</p></div></div>

    <div className="ad-stats">
      <div><small>Total problems</small><b>{n(s?.total)}</b></div>
      <div><small>Open</small><b>{n(s?.open)}</b></div>
      <div><small>In progress</small><b>{n(s?.in_progress)}</b></div>
      <div className="danger"><small>Critical and open</small><b>{n(s?.critical_open)}</b></div>
      <div className="warn"><small>High and open</small><b>{n(s?.high_open)}</b></div>
      <div><small>New in 24 h</small><b>{n(s?.new_24h)}</b></div>
      <div className="good"><small>Resolved</small><b>{n(s?.resolved)}</b></div>
    </div>

    <p className="muted-line ad-updated" aria-live="polite">{updatedAgo === null ? "Loading…" : updatedAgo < 8 ? "Updated just now" : `Updated ${updatedAgo} s ago`} · refreshes every 20 s</p>
    <MapDashboard mode="authority" />
    <HotspotCards items={hot.data?.items ?? []} />

    <h2 className="ad-h">By category</h2>
    <div className="ad-cats">{CATEGORY_NAMES.map(name => {
      // Legacy Road Damage / Drainage reports are counted under their merged category.
      const c = (s?.per_category ?? []).filter(x => (MERGED_CATEGORY[x.category] ?? x.category) === name).reduce((a, x) => ({ total: a.total + x.total, open: a.open + x.open }), { total: 0, open: 0 });
      return <button key={name} className={cat === name ? "active" : ""} onClick={() => setCat(cat === name ? "" : name)} aria-pressed={cat === name}>
        <span><Icon name={catIcon[name] ?? "plus"} size={20} /></span><b>{categoryLabel(name)}</b><strong>{s ? c.total : "–"}</strong><small>{c.open} open · {c.total - c.open} solved</small>
        <i style={{ width: `${c.total ? ((c.total - c.open) / c.total) * 100 : 0}%` }} />
      </button>;
    })}</div>

    <div className="ad-note"><Icon name="alert" size={18} /><p><b>Sorted by priority, not by votes.</b> The score combines how dangerous the problem is, its type, risk nearby (school, hospital, main road, live wiring), how long it has been open, and how many citizens are affected. Votes are only a small part, so a dangerous problem with few votes still rises to the top.</p></div>

    <div className="ad-toolbar">
      <label className="ad-search"><Icon name="search" size={18} /><input value={search} onChange={e => setSearch(e.target.value)} maxLength={100} placeholder="Search problem, area or report ID" aria-label="Search problems" /></label>
      <select value={area} onChange={e => setArea(e.target.value)} aria-label="Filter by area"><option value="">All areas</option>{AREAS.map(a => <option key={a}>{a}</option>)}</select>
      <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by status"><option value="">All statuses</option>{STATUSES.map(x => <option key={x}>{x}</option>)}</select>
      <select value={sort} onChange={e => setSort(e.target.value as Sort)} aria-label="Sort problems"><option value="priority">Priority (recommended)</option><option value="newest">Newest first</option><option value="oldest">Longest open</option><option value="affected">Most citizens affected</option></select>
      <label className="ad-check"><input type="checkbox" checked={hideResolved} onChange={e => setHideResolved(e.target.checked)} /> Hide resolved</label>
    </div>

    <div className="ad-listhead"><label className="ad-check"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} /> Select all {rows.length}{total > rows.length ? ` of ${total}` : ""}</label>{(cat || area || status || search) && <button className="text-button" onClick={() => { setCat(""); setArea(""); setStatus(""); setSearch(""); }}>Clear filters</button>}</div>

    <div className="ad-list">
      {list.isPending && [0, 1, 2, 3].map(k => <article key={k} className="ad-item skeleton-card"><div className="ad-row"><span /><div className="prio skeleton-block" /><div className="ad-main"><div className="skeleton-line w75" /><div className="skeleton-line w50" /></div></div></article>)}
      {list.isError && <div className="empty-note error"><Icon name="alert" /><span><b>Could not load problems.</b><small>{(list.error as Error).message}</small></span><button className="secondary compact" onClick={() => list.refetch()}>Retry</button></div>}
      {list.isSuccess && rows.length === 0 && <div className="empty-note"><Icon name="check" /><span><b>No problems match these filters.</b></span></div>}
      {rows.map(issue => {
        const open = openId === issue.id;
        return <article key={issue.id} className={`ad-item${open ? " open" : ""}${issue.status === "Resolved" ? " resolved" : ""}`}>
          <div className="ad-row">
            <input type="checkbox" checked={selected.includes(issue.id)} onChange={() => toggle(issue.id)} aria-label={`Select ${issue.title}`} />
            <div className={`prio lvl-${issue.level.toLowerCase()}`} title="Priority score out of 100"><b>{issue.priority_score}</b><small>{issue.level}</small></div>
            <button className="ad-main" onClick={() => { setOpenId(open ? null : issue.id); setReply(""); }} aria-expanded={open}>
              <b>{issue.title}</b>
              <span className="ad-meta"><span><Icon name={catIcon[issue.category] ?? "plus"} size={14} /> {categoryLabel(issue.category)}</span><span><Icon name="pin" size={14} /> {issue.area ?? "Unknown area"}</span><span><Icon name="community" size={14} /> {issue.affected_count} affected</span><span><Icon name="clock" size={14} /> {ago(issue.created_at)}</span></span>
              {issue.flags.length > 0 && <span className="ad-flags">{issue.flags.map(f => <em key={f}>{f}</em>)}</span>}
              <span className="ad-intel"><AiChip ai={issue.ai} />{issue.department && <span className="chip">{issue.department}</span>}{issue.nlp?.urgency && <span className="chip">text urgency: {issue.nlp.urgency}</span>}{issue.lat != null && issue.lng != null && <span className="chip">{issue.lat.toFixed(4)}, {issue.lng.toFixed(4)}</span>}</span>
              <span className="ad-why">Priority: {issue.reasons.slice(0, 3).map(r => `${r.label} +${r.pts}`).join(" · ")}</span>
              {issue.citizen_message && <span className="ad-msg">Citizen: “{issue.citizen_message}”</span>}
            </button>
            <span className={`pill st-${issue.status.toLowerCase().replace(" ", "-")}`}>{issue.status}</span>
          </div>
          {open && <Detail issue={issue} reply={reply} setReply={setReply} act={act} acting={single.isPending} />}
          {open && single.isError && <div className="form-error" role="alert"><Icon name="alert" size={16} /> {(single.error as Error).message}</div>}
        </article>;
      })}
      <div ref={sentinel} />
      {list.hasNextPage && <button className="secondary load-more" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>{list.isFetchingNextPage ? "Loading…" : "Load more"}</button>}
    </div>

    {selected.length > 0 && <div className="ad-bulk" role="region" aria-label="Bulk actions">
      <b>{selected.length} selected</b>
      <input value={bulkText} maxLength={1000} onChange={e => setBulkText(e.target.value)} placeholder="Message to all selected citizens (optional)" aria-label="Bulk message" />
      <button className="secondary compact" onClick={() => bulk(null)} disabled={!bulkText.trim() || bulkMut.isPending}>Message</button>
      <button className="secondary compact" onClick={() => bulk("In Progress")} disabled={bulkMut.isPending}>In progress</button>
      <button className="primary compact" onClick={() => bulk("Resolved")} disabled={bulkMut.isPending}>Resolve all</button>
      <button className="text-button" onClick={() => setSelected([])}>Clear</button>
      {bulkMut.isError && <small className="err">{(bulkMut.error as Error).message}</small>}
    </div>}
  </main>;
}
