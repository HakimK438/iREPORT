import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "./Icon";
import { isOpen } from "./store";
import { api, type MapIncident } from "./api";
import Brief, { DueText, Evidence, ResponseChip, StatusPill } from "./IncidentDetail";
import { MERGED_CATEGORY } from "./brand";
import { tr, trf, type Lang } from "./i18n";
import { catLabel } from "./i18nStaff";
import { areaSlug } from "./facts";

// Leaflet is a separate chunk, loaded only when a map dashboard is shown.
const ProblemMap = lazy(() => import("./ProblemMap"));

const OUTSIDE = "Outside mapped areas";

/** Picture of the area (public/areas/<area>.png); nothing when the area has none, so the card just shrinks back to text. */
function AreaThumb({ area }: { area: string }) {
  const [bad, setBad] = useState(false);
  if (bad) return null;
  return <img className="area-thumb" src={`${import.meta.env.BASE_URL}areas/${areaSlug(area)}.png`} alt="" loading="lazy" onError={() => setBad(true)} />;
}
const SHOWN = 24;

/** Area-wise map of every civic problem. Clicking a card or a point opens the full problem detail.
    mode "authority" can act on the problem; mode "admin" is read-only. */
export default function MapDashboard({ mode, lang = "en" }: { mode: "authority" | "admin"; lang?: Lang }) {
  const readOnly = mode === "admin";
  const q = useQuery({ queryKey: [mode, "map"], queryFn: readOnly ? api.adminMap : api.authorityMap, refetchInterval: 30_000 });
  const [area, setArea] = useState("");
  const [category, setCategory] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [showClusters, setShowClusters] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [more, setMore] = useState(SHOWN);

  const data = q.data;
  const visible = useMemo(() => (data?.incidents ?? []).filter(i =>
    (showResolved || isOpen(i.status)) && (!area || (i.area ?? OUTSIDE) === area) && (!category || (MERGED_CATEGORY[i.category] ?? i.category) === category)), [data, area, category, showResolved]);
  const clusters = useMemo(() => (data?.clusters ?? []).filter(c => (!area || c.areas.includes(area)) && (!category || c.categories.some(x => (MERGED_CATEGORY[x.category] ?? x.category) === category))), [data, area, category]);
  const selected: MapIncident | undefined = data?.incidents.find(i => i.id === selectedId);
  const categories = useMemo(() => [...new Set((data?.incidents ?? []).map(i => MERGED_CATEGORY[i.category] ?? i.category))].sort(), [data]);
  const open = (data?.incidents ?? []).filter(i => isOpen(i.status));

  useEffect(() => { setMore(SHOWN); }, [area, category, showResolved]);
  useEffect(() => { // Esc closes the detail drawer
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  return <section className="md" aria-label="Problem map">
    <div className="md-head"><h2 className="ad-h">{tr(lang, "m_title")} {data && <small className="muted-line">· {open.length} {tr(lang, "m_openOf")} {data.incidents.length} {tr(lang, "m_problems")}{data.truncated ? ` ${tr(lang, "m_truncated")}` : ""}</small>}</h2>
</div>

    {q.isError && <div className="empty-note error"><Icon name="alert" /><span><b>{tr(lang, "m_loadFail")}</b><small>{(q.error as Error).message}</small></span><button className="secondary compact" onClick={() => q.refetch()}>{tr(lang, "s_retry")}</button></div>}

    <div className="md-toolbar">
      <select value={category} onChange={e => setCategory(e.target.value)} aria-label="Filter by category"><option value="">{tr(lang, "m_allCats")}</option>{categories.map(c => <option key={c} value={c}>{catLabel(lang, c)}</option>)}</select>
      <label className="ad-check"><input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)} /> {tr(lang, "m_showResolved")}</label>
      <label className="ad-check"><input type="checkbox" checked={showClusters} onChange={e => setShowClusters(e.target.checked)} /> {tr(lang, "m_showClusters")}</label>
    </div>
    {(data?.areas.length ?? 0) > 1 && <div className="md-areas" role="group" aria-label="Filter by area">
      <button className={!area ? "active" : ""} onClick={() => setArea("")} aria-pressed={!area}><b>{tr(lang, "ad_allAreas")}</b><small>{open.length} {tr(lang, "s_open")}</small></button>
      {data?.areas.map(a => <button key={a.area} className={area === a.area ? "active" : ""} onClick={() => setArea(area === a.area ? "" : a.area)} aria-pressed={area === a.area}>
        <AreaThumb area={a.area} /><span className="area-txt"><b>{a.area}</b><small>{a.open} {tr(lang, "s_open")}{a.critical ? <> · <span className="md-crit">{a.critical} {tr(lang, "s_critical")}</span></> : null}</small></span></button>)}
    </div>}


    <Suspense fallback={<div className="pm-map skeleton-block" role="status">{tr(lang, "m_mapLoading")}</div>}>
      <ProblemMap lang={lang} incidents={visible} clusters={clusters} areas={data?.areas ?? []} selectedId={selectedId} onSelect={setSelectedId} fitKey={`${area}|${category}|${data ? "ready" : "wait"}`} showClusters={showClusters} />
    </Suspense>

    {data && showClusters && <div className="md-ml"><span>{trf(lang, "m_clusterNote", { n: data.method.min_points, m: data.method.eps_m })} {clusters.length === 0 ? tr(lang, "m_noClusters") : `${clusters.length} ${tr(lang, "m_clustersFound")}`}</span></div>}

    {q.isPending && <div className="md-cards">{[0, 1, 2].map(k => <div key={k} className="md-card skeleton-card"><div className="skeleton-line w75" /><div className="skeleton-line w50" /></div>)}</div>}
    {q.isSuccess && visible.length === 0 && <div className="empty-note"><Icon name="check" /><span><b>{tr(lang, "m_noneHere")}</b></span></div>}
    <div className="md-cards">{visible.slice(0, more).map(i => <button key={i.id} className={`md-card lvl-${i.response.toLowerCase()}${selectedId === i.id ? " sel" : ""}${isOpen(i.status) ? "" : " done"}`} onClick={() => setSelectedId(i.id)} aria-label={`${tr(lang, "m_openDetails")}: ${i.title}`}>
      <span className="mc-top">
        <Evidence url={i.thumb_url} category={i.category} alt={i.title} className="cat-photo sm" />
        <span className="mc-title"><b>{i.title}</b><small><Icon name="pin" size={13} /> {i.area ?? OUTSIDE}<i>{i.public_id}</i></small></span>
      </span>
      <span className="mc-foot"><ResponseChip response={i.response} lang={lang} /><DueText row={i} lang={lang} /></span>
      <span className="mc-meta"><StatusPill status={i.status} lang={lang} /><span className="mc-open"><Icon name="reports" size={14} /> {tr(lang, "m_details")}</span></span>
    </button>)}</div>
    {visible.length > more && <button className="secondary load-more" onClick={() => setMore(m => m + SHOWN)}>{tr(lang, "m_showMore")} ({visible.length - more} {tr(lang, "m_left")})</button>}

    {selected && <>
      <div className="md-backdrop" onClick={() => setSelectedId(null)} />
      <aside className="md-drawer" role="dialog" aria-modal="true" aria-label={`${tr(lang, "m_details")}: ${selected.title}`}>
        <Brief key={selected.id} id={selected.id} lang={lang} readOnly={readOnly} onClose={() => setSelectedId(null)} />
      </aside>
    </>}
  </section>;
}
