import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "./Icon";
import { ago, type Status } from "./store";
import { api, type MapIncident } from "./api";
import { Detail, Tag } from "./IncidentDetail";
import { categoryLabel, MERGED_CATEGORY } from "./brand";

// Leaflet is a separate chunk, loaded only when a map dashboard is shown.
const ProblemMap = lazy(() => import("./ProblemMap"));

const OUTSIDE = "Outside mapped areas";
const LEVELS: [string, string][] = [["Critical", "#b3261e"], ["High", "#e8710a"], ["Medium", "#c9a400"], ["Low", "#2e7d6b"]];
const SHOWN = 24;

/** Area-wise map of every civic problem. Clicking a card or a point opens the full problem detail.
    mode "authority" can act on the problem; mode "admin" is read-only. */
export default function MapDashboard({ mode }: { mode: "authority" | "admin" }) {
  const qc = useQueryClient();
  const readOnly = mode === "admin";
  const q = useQuery({ queryKey: [mode, "map"], queryFn: readOnly ? api.adminMap : api.authorityMap, refetchInterval: 30_000 });
  const [area, setArea] = useState("");
  const [category, setCategory] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [showClusters, setShowClusters] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [more, setMore] = useState(SHOWN);
  const [reply, setReply] = useState("");

  const act = useMutation({
    mutationFn: ({ id, next }: { id: string; next: Status | null }) => api.authorityUpdate(id, { status: next ?? undefined, message: reply.trim() || undefined }),
    onSuccess: (_r, v) => {
      setReply("");
      for (const key of [[mode, "map"], ["authority", "list"], ["authority", "stats"], ["authority", "incident", v.id]]) qc.invalidateQueries({ queryKey: key });
    },
  });

  const data = q.data;
  const visible = useMemo(() => (data?.incidents ?? []).filter(i =>
    (showResolved || i.status !== "Resolved") && (!area || (i.area ?? OUTSIDE) === area) && (!category || (MERGED_CATEGORY[i.category] ?? i.category) === category)), [data, area, category, showResolved]);
  const clusters = useMemo(() => (data?.clusters ?? []).filter(c => (!area || c.areas.includes(area)) && (!category || c.categories.some(x => (MERGED_CATEGORY[x.category] ?? x.category) === category))), [data, area, category]);
  const selected: MapIncident | undefined = data?.incidents.find(i => i.id === selectedId);
  const cluster = selected?.cluster != null ? data?.clusters.find(c => c.id === selected.cluster) : undefined;
  const categories = useMemo(() => [...new Set((data?.incidents ?? []).map(i => MERGED_CATEGORY[i.category] ?? i.category))].sort(), [data]);
  const open = (data?.incidents ?? []).filter(i => i.status !== "Resolved");

  useEffect(() => { setMore(SHOWN); }, [area, category, showResolved]);
  useEffect(() => { // Esc closes the detail drawer
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  return <section className="md" aria-label="Problem map">
    <div className="md-head"><h2 className="ad-h">Problem map {data && <small className="muted-line">· {open.length} open of {data.incidents.length} problems{data.truncated ? " (showing the first 3000)" : ""}</small>}</h2>
      <div className="md-legend" aria-label="Legend">{LEVELS.map(([l, c]) => <span key={l}><i style={{ background: c }} />{l}</span>)}<span><i className="md-resolved" />Resolved</span><span><i className="md-ring" />Cluster <Tag kind="ml" /></span></div></div>

    {q.isError && <div className="empty-note error"><Icon name="alert" /><span><b>Could not load the map.</b><small>{(q.error as Error).message}</small></span><button className="secondary compact" onClick={() => q.refetch()}>Retry</button></div>}

    <div className="md-areas" role="group" aria-label="Filter by area">
      <button className={!area ? "active" : ""} onClick={() => setArea("")} aria-pressed={!area}><b>All areas</b><small>{open.length} open</small></button>
      {data?.areas.map(a => <button key={a.area} className={area === a.area ? "active" : ""} onClick={() => setArea(area === a.area ? "" : a.area)} aria-pressed={area === a.area}>
        <b>{a.area}</b><small>{a.open} open{a.critical ? <> · <span className="md-crit">{a.critical} critical</span></> : null}</small></button>)}
    </div>

    <div className="md-toolbar">
      <select value={category} onChange={e => setCategory(e.target.value)} aria-label="Filter by category"><option value="">All categories</option>{categories.map(c => <option key={c} value={c}>{categoryLabel(c)}</option>)}</select>
      <label className="ad-check"><input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)} /> Show resolved</label>
      <label className="ad-check"><input type="checkbox" checked={showClusters} onChange={e => setShowClusters(e.target.checked)} /> Problem clusters</label>
    </div>

    <Suspense fallback={<div className="pm-map skeleton-block" role="status">Loading map…</div>}>
      <ProblemMap incidents={visible} clusters={clusters} selectedId={selectedId} onSelect={setSelectedId} fitKey={`${area}|${category}|${data ? "ready" : "wait"}`} showClusters={showClusters} />
    </Suspense>

    {data && showClusters && <div className="md-ml"><Tag kind="ml" /> <span>{data.method.name} · {data.method.engine} · rings = at least {data.method.min_points} open problems within {data.method.eps_m} m of each other ({data.method.scope}). {clusters.length === 0 ? "No clusters in this view." : `${clusters.length} cluster${clusters.length === 1 ? "" : "s"} found.`} It shows where problems pile up; it does not predict anything.</span></div>}

    {q.isPending && <div className="md-cards">{[0, 1, 2].map(k => <div key={k} className="md-card skeleton-card"><div className="skeleton-line w75" /><div className="skeleton-line w50" /></div>)}</div>}
    {q.isSuccess && visible.length === 0 && <div className="empty-note"><Icon name="check" /><span><b>No problems in this view.</b></span></div>}
    <div className="md-cards">{visible.slice(0, more).map(i => <button key={i.id} className={`md-card lvl-${i.level.toLowerCase()}${selectedId === i.id ? " sel" : ""}${i.status === "Resolved" ? " done" : ""}`} onClick={() => setSelectedId(i.id)} aria-label={`Open details: ${i.title}`}>
      <span className="md-score"><b>{i.priority_score}</b><small>{i.status === "Resolved" ? "done" : i.level}</small></span>
      <span className="md-card-main"><b>{i.title}</b><small><Icon name="pin" size={13} /> {i.area ?? OUTSIDE} · {categoryLabel(i.category)} · {i.affected_count} affected · {ago(i.created_at)}</small>{i.cluster != null && <em className="src-tag src-ml">in a cluster</em>}</span>
      <Icon name="arrow" size={16} />
    </button>)}</div>
    {visible.length > more && <button className="secondary load-more" onClick={() => setMore(m => m + SHOWN)}>Show more ({visible.length - more} left)</button>}

    {selected && <>
      <div className="md-backdrop" onClick={() => setSelectedId(null)} />
      <aside className="md-drawer" role="dialog" aria-modal="true" aria-label={`Details: ${selected.title}`}>
        <div className="md-drawer-head"><div><span className={`pill st-${selected.status.toLowerCase().replace(" ", "-")}`}>{selected.status}</span><h2>{selected.title}</h2><small>{selected.public_id} · {selected.area ?? OUTSIDE} · {categoryLabel(selected.category)}</small></div><button className="secondary compact" onClick={() => setSelectedId(null)} aria-label="Close details">Close</button></div>
        <Detail key={selected.id} issue={{ ...selected, thumb_url: null }} reply={reply} setReply={setReply} act={(id, next) => act.mutate({ id, next })} acting={act.isPending} readOnly={readOnly}
          cluster={cluster ? { name: cluster.name, size: cluster.size, eps_m: data!.method.eps_m } : null} />
        {act.isError && <div className="form-error" role="alert"><Icon name="alert" size={16} /> {(act.error as Error).message}</div>}
      </aside>
    </>}
  </section>;
}
