import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon, type IconName } from "./Icon";
import { AREAS, CATEGORY_NAMES, STATUSES, ago, type Status } from "./store";
import { api, type ApiUser, type AuthorityRow } from "./api";

type Sort = "priority" | "newest" | "oldest" | "affected";

const catIcon: Record<string, IconName> = { Pothole: "road", "Road Damage": "reports", Streetlight: "light", Garbage: "waste", "Water Leakage": "water", Drainage: "map", "Electrical Hazard": "bolt", Other: "plus" };
const PAGE = 50;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = window.setTimeout(() => setV(value), ms); return () => window.clearTimeout(t); }, [value, ms]);
  return v;
}

function Detail({ issue, reply, setReply, act, acting }: { issue: AuthorityRow; reply: string; setReply: (v: string) => void; act: (id: string, next: Status | null) => void; acting: boolean }) {
  const detail = useQuery({ queryKey: ["authority", "incident", issue.id], queryFn: () => api.authorityDetail(issue.id) });
  const d = detail.data;
  return <div className="ad-detail">
    {d?.images[0] ? <img src={d.images[0].url} alt="Evidence photo" loading="lazy" /> : issue.thumb_url ? <img src={issue.thumb_url} alt="Evidence photo" loading="lazy" /> : <div className="no-photo"><Icon name="camera" size={28} /><small>No photo</small></div>}
    <div className="ad-detail-body">
      <small>{issue.public_id} · {d ? `reported by ${d.reporters.map(r => r.name).join(", ") || "—"}` : "loading reporters…"} · {issue.severity} severity</small>
      {d && d.images.length > 1 && <div className="ad-thumbs">{d.images.map((m, k) => <a key={k} href={m.url} target="_blank" rel="noreferrer"><img src={m.thumb_url} alt={`Evidence photo ${k + 1}`} loading="lazy" /></a>)}</div>}
      {d?.reporters.some(r => r.description) && <p className="ad-desc">{d.reporters.filter(r => r.description).map(r => `“${r.description}”`).join(" · ")}</p>}
      <h3>Why this priority ({issue.priority_score}/100)</h3>
      {detail.isPending && <div className="ad-reasons"><span className="skeleton-line w50" /></div>}
      {detail.isError && <p className="muted-line">Could not load the detail. <button className="text-button" onClick={() => detail.refetch()}>Retry</button></p>}
      {d && <div className="ad-reasons">{d.reasons.slice(0, 6).map(r => <span key={r.label}>{r.label}<b>+{r.pts}</b></span>)}</div>}
      <h3>Messages</h3>
      <div className="thread">{d && d.messages.length === 0 && <p className="muted-line">No messages yet.</p>}{d?.messages.map(m => <div key={m.id} className={`msg ${m.from}`}><small>{m.by} · {ago(m.at)}</small><p>{m.text}</p></div>)}</div>
      <textarea value={reply} maxLength={1000} onChange={e => setReply(e.target.value)} placeholder="Write a message to the citizen (optional)" rows={3} aria-label="Message to citizen" />
      <div className="ad-actions">
        <button className="secondary" onClick={() => act(issue.id, null)} disabled={!reply.trim() || acting}>Send message</button>
        <button className="secondary" onClick={() => act(issue.id, "Under Review")} disabled={issue.status === "Under Review" || acting}>Under review</button>
        <button className="secondary" onClick={() => act(issue.id, "In Progress")} disabled={issue.status === "In Progress" || acting}>In progress</button>
        <button className="primary" onClick={() => act(issue.id, "Resolved")} disabled={issue.status === "Resolved" || acting}><Icon name="check" size={16} /> Mark resolved</button>
      </div>
    </div>
  </div>;
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
  const [baseline, setBaseline] = useState<number | null>(null);
  const q = useDebounced(search.trim(), 300);
  const filters = { category: cat || undefined, ward: area || undefined, status: status || undefined, q: q || undefined, hide_resolved: hideResolved || undefined, sort };

  const list = useInfiniteQuery({
    queryKey: ["authority", "list", filters], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.authorityList({ ...filters, limit: PAGE, cursor: pageParam }),
    getNextPageParam: last => last.next_cursor ?? undefined,
  });
  // Poll only the cheap totals; the list is not refreshed under the officer's cursor.
  const stats = useQuery({ queryKey: ["authority", "stats"], queryFn: api.authorityStats, refetchInterval: 30_000 });
  useEffect(() => { if (stats.data && baseline === null) setBaseline(stats.data.total); }, [stats.data, baseline]);
  const newCount = stats.data && baseline !== null ? Math.max(0, stats.data.total - baseline) : 0;
  const showNew = () => { setBaseline(stats.data?.total ?? null); list.refetch(); };

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
      <div className="good"><small>Resolved</small><b>{n(s?.resolved)}</b></div>
    </div>

    <h2 className="ad-h">By category</h2>
    <div className="ad-cats">{CATEGORY_NAMES.map(name => {
      const c = s?.per_category.find(x => x.category === name) ?? { total: 0, open: 0 };
      return <button key={name} className={cat === name ? "active" : ""} onClick={() => setCat(cat === name ? "" : name)} aria-pressed={cat === name}>
        <span><Icon name={catIcon[name] ?? "plus"} size={20} /></span><b>{name}</b><strong>{s ? c.total : "–"}</strong><small>{c.open} open · {c.total - c.open} solved</small>
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

    {newCount > 0 && <button className="new-banner" onClick={showNew}><Icon name="bell" size={16} /> {newCount} new problem{newCount > 1 ? "s" : ""} reported · Show</button>}

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
              <span className="ad-meta"><span><Icon name={catIcon[issue.category] ?? "plus"} size={14} /> {issue.category}</span><span><Icon name="pin" size={14} /> {issue.area ?? "Unknown area"}</span><span><Icon name="community" size={14} /> {issue.affected_count} affected</span><span><Icon name="clock" size={14} /> {ago(issue.created_at)}</span></span>
              {issue.flags.length > 0 && <span className="ad-flags">{issue.flags.map(f => <em key={f}>{f}</em>)}</span>}
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
