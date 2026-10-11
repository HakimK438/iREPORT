import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "./Icon";
import { analytics, api, downloadCsv, type AnBacklog, type AnSeason, type AnType, type AnWard, type AnOverview } from "./api";
import { AREAS, CATEGORY_NAMES, isOpen } from "./store";
import { MERGED_CATEGORY } from "./brand";
import { tr, trf, type Lang, type StrKey } from "./i18n";
import { catLabel } from "./i18nStaff";
import { LOCALE } from "./facts";

const ProblemMap = lazy(() => import("./ProblemMap"));
type Layer = "open" | "emergency" | "overdue" | "unassigned";
const LAYERS: Layer[] = ["emergency", "overdue", "unassigned", "open"];

/** The same map as the control room (markers coloured by response category, clusters, area names), narrowed to what an officer asks of the analysis:
    what is an emergency, what is overdue, what nobody owns yet. It follows the ward and category filters; clicking a point picks its ward. */
function AnalysisMap({ lang, ward, category, setWard }: { lang: Lang; ward: string; category: string; setWard: (w: string) => void }) {
  const [layer, setLayer] = useState<Layer>("emergency");
  const q = useQuery({ queryKey: ["authority", "map"], queryFn: api.authorityMap, refetchInterval: 30_000 });
  const data = q.data;
  const inScope = (i: { area: string | null; category: string }) => (!ward || i.area === ward) && (!category || (MERGED_CATEGORY[i.category] ?? i.category) === category);
  const incidents = useMemo(() => (data?.incidents ?? []).filter(i => isOpen(i.status) && inScope(i) && (layer === "open" || (layer === "emergency" ? i.response === "Emergency" : layer === "overdue" ? i.overdue : !i.assigned))), [data, ward, category, layer]); // eslint-disable-line react-hooks/exhaustive-deps
  const clusters = useMemo(() => (data?.clusters ?? []).filter(c => (!ward || c.areas.includes(ward))), [data, ward]);
  const count = (l: Layer) => (data?.incidents ?? []).filter(i => isOpen(i.status) && inScope(i) && (l === "open" || (l === "emergency" ? i.response === "Emergency" : l === "overdue" ? i.overdue : !i.assigned))).length;
  return <div className="an-map">
    <div className="chips" role="group" aria-label={tr(lang, "an_layerLabel")}>{LAYERS.map(l => <button key={l} className={`chip-btn${layer === l ? " active" : ""}${l === "overdue" || l === "emergency" ? " red" : ""}`} aria-pressed={layer === l} onClick={() => setLayer(l)}><span>{tr(lang, `an_layer_${l}` as StrKey)}</span><b>{data ? count(l) : "–"}</b></button>)}</div>
    {q.isError && <p className="muted-line" role="alert">{(q.error as Error).message}</p>}
    <Suspense fallback={<div className="pm-map skeleton-block" role="status">{tr(lang, "m_mapLoading")}</div>}>
      <ProblemMap lang={lang} incidents={incidents} clusters={clusters} areas={data?.areas ?? []} selectedId={null} onSelect={id => { const i = data?.incidents.find(x => x.id === id); if (i?.area) setWard(i.area === ward ? "" : i.area); }} fitKey={`${ward}|${category}|${layer}|${data ? "ready" : "wait"}`} showClusters />
    </Suspense>
    <p className="muted-line">{incidents.length === 0 ? tr(lang, "an_layerNone") : trf(lang, "an_layerNote", { n: incidents.length })}</p>
  </div>;
}

/* Every chart: a one-line takeaway as its title (computed from the data), a text summary for screen readers, and the same numbers as a table.
   The charts are small hand-written SVG (no chart library): see README.md (Design decisions). Colours never carry meaning alone; values are printed. */

const COLOURS = { reported: "#c9a400", closed: "#2e7d6b", open: "#5b3fa0" };
const CAT_COLOURS: Record<string, string> = { Pothole: "#b3261e", "Road Damage": "#b3261e", Garbage: "#2e7d6b", Streetlight: "#c9a400", "Water Leakage": "#1f6fb2", Drainage: "#1f6fb2", "Electrical Hazard": "#5b3fa0", Other: "#6b7a72" };

function Chart({ title, summary, table, children, lang }: { title: string; summary: string; table?: ReactNode; children: ReactNode; lang: Lang }) {
  return <figure className="an-chart"><figcaption><h3>{title}</h3></figcaption>
    <div>{children}</div>
    <p className="sr-only">{summary}</p>
    {table && <details className="an-table"><summary>{tr(lang, "an_showTable")}</summary>{table}</details>}
  </figure>;
}

/** Grouped bars per week: reported and closed, with the open backlog as a line. */
function BacklogChart({ weeks, lang }: { weeks: AnBacklog["weeks"]; lang: Lang }) {
  const W = 640, H = 220, pad = { l: 34, r: 10, t: 12, b: 34 };
  const max = Math.max(1, ...weeks.flatMap(w => [w.reported, w.closed, w.open_at_end]));
  const bw = (W - pad.l - pad.r) / weeks.length;
  const y = (v: number) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const label = (iso: string) => new Date(iso).toLocaleDateString(LOCALE[lang], { day: "numeric", month: "short" });
  return <svg viewBox={`0 0 ${W} ${H}`} className="an-svg" aria-hidden="true">
    {[0, 0.5, 1].map(f => <g key={f}><line x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="#dfe5e1" /><text x={pad.l - 6} y={y(max * f) + 4} fontSize="10" textAnchor="end" fill="#5b6a63">{Math.round(max * f)}</text></g>)}
    {weeks.map((w, k) => { const x = pad.l + k * bw; return <g key={w.week}>
      <rect x={x + bw * 0.12} width={bw * 0.36} y={y(w.reported)} height={H - pad.b - y(w.reported)} fill={COLOURS.reported}><title>{`${label(w.week)}: ${w.reported}`}</title></rect>
      <rect x={x + bw * 0.5} width={bw * 0.36} y={y(w.closed)} height={H - pad.b - y(w.closed)} fill={COLOURS.closed}><title>{`${label(w.week)}: ${w.closed}`}</title></rect>
      {k % 2 === 0 && <text x={x + bw / 2} y={H - 14} fontSize="10" textAnchor="middle" fill="#5b6a63">{label(w.week)}</text>}</g>; })}
    <polygon fill="rgba(91,63,160,.10)" points={`${pad.l + bw / 2},${H - pad.b} ${weeks.map((w, k) => `${pad.l + k * bw + bw / 2},${y(w.open_at_end)}`).join(" ")} ${pad.l + (weeks.length - 1) * bw + bw / 2},${H - pad.b}`} />
    {weeks.map((w, k) => <g key={`v${w.week}`}>{w.reported > 0 && <text x={pad.l + k * bw + bw * 0.3} y={y(w.reported) - 4} fontSize="10" fontWeight="700" textAnchor="middle" fill="#6e5400">{w.reported}</text>}{w.closed > 0 && <text x={pad.l + k * bw + bw * 0.68} y={y(w.closed) - 4} fontSize="10" fontWeight="700" textAnchor="middle" fill="#1f5c4d">{w.closed}</text>}</g>)}
    <polyline fill="none" stroke={COLOURS.open} strokeWidth="2.5" points={weeks.map((w, k) => `${pad.l + k * bw + bw / 2},${y(w.open_at_end)}`).join(" ")} />
    {weeks.map((w, k) => <circle key={w.week} cx={pad.l + k * bw + bw / 2} cy={y(w.open_at_end)} r="3" fill={COLOURS.open} />)}
  </svg>;
}

/** Horizontal bars with the value printed at the end of each bar. */
function Bars({ rows, colour = "#2e7d6b" }: { rows: { label: string; value: number; note?: string }[]; colour?: string }) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return <div className="an-bars">{rows.map(r => <div key={r.label} className="an-bar"><span>{r.label}</span><i style={{ width: `${(r.value / max) * 100}%`, background: colour }} /><b>{r.value}{r.note ? ` ${r.note}` : ""}</b></div>)}</div>;
}

function SeasonChart({ items, lang }: { items: AnSeason["items"]; lang: Lang }) {
  const months = [...new Set(items.map(i => i.month))].sort();
  const cats = [...new Set(items.map(i => i.category))];
  const totals = months.map(m => items.filter(i => i.month === m).reduce((a, i) => a + i.n, 0));
  const max = Math.max(1, ...totals);
  const W = 640, H = 200, pad = { l: 30, r: 8, t: 10, b: 28 };
  const bw = (W - pad.l - pad.r) / Math.max(1, months.length);
  return <svg viewBox={`0 0 ${W} ${H}`} className="an-svg" aria-hidden="true">
    {months.map((m, k) => { let acc = 0; const x = pad.l + k * bw; return <g key={m}>
      {cats.map(c => { const n = items.find(i => i.month === m && i.category === c)?.n ?? 0; const h = (n / max) * (H - pad.t - pad.b); acc += h; return n ? <rect key={c} x={x + bw * 0.15} width={bw * 0.7} y={H - pad.b - acc} height={h} fill={CAT_COLOURS[c] ?? "#6b7a72"}><title>{`${catLabel(lang, c)}: ${n}`}</title></rect> : null; })}
      <text x={x + bw / 2} y={H - 10} fontSize="10" textAnchor="middle" fill="#5b6a63">{new Date(`${m}-01`).toLocaleDateString(LOCALE[lang], { month: "short" })}</text></g>; })}
    <text x={pad.l - 6} y={pad.t + 8} fontSize="10" textAnchor="end" fill="#5b6a63">{max}</text>
  </svg>;
}

/** Area-wise: one bar per area, split into overdue (red) and other open (orange), numbers printed. The clearest answer to "where is the work piling up". */
function AreaBars({ items, lang, selected, onPick }: { items: AnWard["items"]; lang: Lang; selected: string; onPick: (w: string) => void }) {
  const rows = [...items].filter(i => i.open > 0).sort((a, b) => b.open - a.open || b.overdue - a.overdue).slice(0, 12);
  const max = Math.max(1, ...rows.map(r => r.open));
  if (rows.length === 0) return <p className="muted-line">{tr(lang, "an_t_noData")}</p>;
  return <div className="an-area" role="list">
    <ul className="an-legend"><li><i style={{ background: "#b3261e" }} />{tr(lang, "an_overdue")}</li><li><i style={{ background: "#f0a35e" }} />{tr(lang, "r_openNotOverdue")}</li></ul>
    {rows.map(r => <button key={r.ward} role="listitem" className={`an-area-row${r.ward === selected ? " sel" : ""}`} onClick={() => onPick(r.ward)} aria-pressed={r.ward === selected} title={`${r.ward}: ${r.open} ${tr(lang, "an_open")}, ${r.overdue} ${tr(lang, "an_overdue")}`}>
      <span className="nm">{r.ward}</span>
      <span className="track"><i className="od" style={{ width: `${(r.overdue / max) * 100}%` }} /><i className="op" style={{ width: `${((r.open - r.overdue) / max) * 100}%` }} /></span>
      <b>{r.open}{r.overdue > 0 ? <em> · {r.overdue} {tr(lang, "an_overdue").toLowerCase()}</em> : null}</b></button>)}
  </div>;
}

/** Donut of the hazard mix (open complaints by category), centre = total. */
function Donut({ rows, lang }: { rows: { category: string; value: number }[]; lang: Lang }) {
  const total = rows.reduce((a, r) => a + r.value, 0);
  const R0 = 70, C = 2 * Math.PI * R0;
  let acc = 0;
  if (total === 0) return <p className="muted-line">{tr(lang, "an_t_noData")}</p>;
  return <div className="an-donut"><svg viewBox="0 0 200 200" className="an-donut-svg" aria-hidden="true">
    <circle cx="100" cy="100" r={R0} fill="none" stroke="#eef1ee" strokeWidth="30" />
    {rows.map(r => { const len = (r.value / total) * C; const el = <circle key={r.category} cx="100" cy="100" r={R0} fill="none" stroke={CAT_COLOURS[r.category] ?? "#6b7a72"} strokeWidth="30" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} transform="rotate(-90 100 100)"><title>{`${catLabel(lang, r.category)}: ${r.value}`}</title></circle>; acc += len; return el; })}
    <text x="100" y="98" textAnchor="middle" fontSize="34" fontWeight="800" fill="#18201d">{total}</text><text x="100" y="120" textAnchor="middle" fontSize="12" fill="#68736e">{tr(lang, "an_open")}</text>
  </svg>
    <ul className="an-donut-legend">{rows.map(r => <li key={r.category}><i style={{ background: CAT_COLOURS[r.category] ?? "#6b7a72" }} /><span>{catLabel(lang, r.category)}</span><b>{r.value}</b><em>{Math.round((r.value / total) * 100)}%</em></li>)}</ul></div>;
}

/** On-time performance: a bar per department, the percentage printed. */
function PerfBars({ rows }: { rows: { name: string; pct: number; resolved: number }[] }) {
  return <div className="an-perf">{rows.map(r => <div key={r.name} className="an-perf-row"><span>{r.name}</span><span className="track"><i style={{ width: `${r.pct}%`, background: r.pct >= 80 ? "#2e7d6b" : r.pct >= 50 ? "#c9a400" : "#b3261e" }} /></span><b>{r.pct}%</b><small>n={r.resolved}</small></div>)}</div>;
}

const pct = (a: number, b: number) => Math.round(((a - b) / b) * 100);

/** One-line takeaways, computed from the numbers the API returned. */
export function backlogTakeaway(lang: Lang, b: AnBacklog): string {
  const w = b.weeks;
  if (w.length < 2) return tr(lang, "an_t_noData");
  const diff = w[w.length - 1].open_at_end - w[0].open_at_end;
  return diff > 0 ? trf(lang, "an_t_backlogUp", { n: diff }) : diff < 0 ? trf(lang, "an_t_backlogDown", { n: -diff }) : trf(lang, "an_t_backlogSame", { n: w[w.length - 1].open_at_end });
}
export function wardTakeaway(lang: Lang, d: AnWard): string {
  const worst = [...d.items].sort((a, b) => b.overdue - a.overdue)[0];
  return worst && worst.overdue > 0 ? trf(lang, "an_t_wardMost", { ward: worst.ward, n: worst.overdue }) : tr(lang, "an_t_wardNone");
}
export function typeTakeaway(lang: Lang, d: AnType, ward: string): string {
  const where = ward || tr(lang, "an_allAreas");
  const top = [...d.trend].filter(t => t.this_month + t.last_month > 0).sort((a, b) => Math.abs(b.this_month - b.last_month) - Math.abs(a.this_month - a.last_month) || b.this_month - a.this_month)[0];
  if (!top) return tr(lang, "an_t_noData");
  const category = catLabel(lang, top.category);
  if (top.last_month === 0) return trf(lang, "an_t_typeNew", { category, where, n: top.this_month });
  if (top.last_month < 5) return trf(lang, "an_t_typeCount", { category, where, n: top.this_month, m: top.last_month }); // a percentage of a handful is misleading
  const p = pct(top.this_month, top.last_month);
  return p === 0 ? trf(lang, "an_t_typeSame", { category, where }) : trf(lang, p > 0 ? "an_t_typeUp" : "an_t_typeDown", { category, where, pct: Math.abs(p) });
}
export function seasonTakeaway(lang: Lang, items: AnSeason["items"]): string {
  const byCat = new Map<string, { month: string; n: number }>();
  const total = new Map<string, number>();
  for (const i of items) total.set(i.category, (total.get(i.category) ?? 0) + i.n);
  for (const i of items) { const cur = byCat.get(i.category); if (!cur || i.n > cur.n) byCat.set(i.category, { month: i.month, n: i.n }); }
  const top = [...total.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) return tr(lang, "an_t_noData");
  const peak = byCat.get(top[0])!;
  return trf(lang, "an_t_season", { category: catLabel(lang, top[0]), month: new Date(`${peak.month}-01`).toLocaleDateString(LOCALE[lang], { month: "long", year: "numeric" }) });
}

const ACTION: Record<string, string> = {
  Pothole: "Send the roads crew with asphalt patch material.", "Road Damage": "Inspect the structure first, then schedule the repair.", Garbage: "Add an extra pickup and check the collection route.",
  Drainage: "Clear the drain before the next rain.", "Water Leakage": "Ask the water department to close the valve and repair the pipe.", "Electrical Hazard": "Make it safe first: isolate the line, then repair.",
  Streetlight: "Replace the lamp or check the feeder.", Other: "Inspect the site and route it to the right department.",
};

/** "What this means for you": the few findings an officer can act on today, in plain words, each with its number and a next step. */
function Insights({ lang, o, w, t, b, prio }: { lang: Lang; o: AnOverview | undefined; w: AnWard | undefined; t: AnType | undefined; b: AnBacklog | undefined; prio: { critical: number; high: number; moderate: number; routine: number } | undefined }) {
  const cards: { key: string; big: string; line: string; todo: string; tone?: string }[] = [];
  const worst = w ? [...w.items].sort((a, c) => c.open - a.open || c.overdue - a.overdue)[0] : undefined;
  if (worst && worst.open > 0) cards.push({ key: "area", big: String(worst.open), line: `${worst.ward} has the most open complaints${worst.overdue ? `, ${worst.overdue} of them overdue` : ""}.`, todo: "Plan this area's crews first.", tone: worst.overdue ? "danger" : "" });
  const top = t ? [...t.items].sort((a, c) => c.open - a.open)[0] : undefined;
  const openAll = t ? t.items.reduce((a, i) => a + i.open, 0) : 0;
  if (top && top.open > 0 && openAll > 0) cards.push({ key: "type", big: `${Math.round((100 * top.open) / openAll)}%`, line: `of open complaints are ${catLabel(lang, top.category).toLowerCase()} problems (${top.open} of ${openAll}).`, todo: ACTION[top.category] ?? ACTION.Other });
  if (o && o.overdue > 0) cards.push({ key: "overdue", big: String(o.overdue), line: `complaint${o.overdue === 1 ? " is" : "s are"} past the deadline.`, todo: "Clear these before taking new work.", tone: "danger" });
  if (o && o.pct_within_sla !== null && o.pct_within_sla !== undefined) cards.push({ key: "sla", big: `${o.pct_within_sla}%`, line: `of fixed complaints were finished on time${o.median_days_to_close != null ? `; the typical fix takes ${o.median_days_to_close} day${o.median_days_to_close === 1 ? "" : "s"}` : ""}.`, todo: o.pct_within_sla >= 80 ? "Good. Keep the same pace." : "Assign new complaints the same day to win back time.", tone: o.pct_within_sla >= 80 ? "good" : o.pct_within_sla < 50 ? "danger" : "" });
  if (b && b.weeks.length >= 2) {
    const diff = b.weeks[b.weeks.length - 1].open_at_end - b.weeks[0].open_at_end;
    cards.push({ key: "trend", big: diff === 0 ? "=" : diff > 0 ? `+${diff}` : String(diff), line: diff > 0 ? "more open complaints than at the start of this period. The backlog is growing." : diff < 0 ? "fewer open complaints than at the start of this period. The backlog is shrinking." : "open complaints, unchanged over this period.", todo: diff > 0 ? "Close at least as many as arrive each week." : "Keep closing faster than new ones arrive.", tone: diff > 0 ? "danger" : diff < 0 ? "good" : "" });
  }
  const mix = prio ? [{ label: tr(lang, "resp_Emergency"), value: prio.critical, colour: "#b3261e" }, { label: tr(lang, "resp_Urgent"), value: prio.high, colour: "#e8710a" }, { label: tr(lang, "resp_Routine"), value: prio.moderate, colour: "#c9a400" }, { label: tr(lang, "resp_Planned"), value: prio.routine, colour: "#2e7d6b" }] : [];
  const mixMax = Math.max(1, ...mix.map(m => m.value));
  if (cards.length === 0 && mix.length === 0) return null;
  return <section className="an-insights" aria-label="What this means for you">
    <h2 className="ad-h sm">What this means for you</h2>
    <div className="an-cards big">{cards.map(c => <div key={c.key} className={c.tone}><b>{c.big}</b><p>{c.line}</p><small>{c.todo}</small></div>)}</div>
    {mix.length > 0 && <figure className="an-chart"><figcaption><h3>{prio && prio.critical + prio.high > 0 ? `${prio.critical + prio.high} open complaints need attention this week (critical or high risk)` : "No critical or high-risk complaints are open"}</h3></figcaption>
      <div className="an-prio">{mix.map(m => <div key={m.label} className="an-prio-row"><span>{m.label}</span><span className="track"><i style={{ width: `${(m.value / mixMax) * 100}%`, background: m.colour }} /></span><b>{m.value}</b></div>)}</div>
      <p className="sr-only">{mix.map(m => `${m.label}: ${m.value}`).join(", ")}</p></figure>}
  </section>;
}

export default function AnalysisTab({ lang, ward, category, setWard, setCategory, openList }: { lang: Lang; ward: string; category: string; setWard: (w: string) => void; setCategory: (c: string) => void; openList: () => void }) {
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [exporting, setExporting] = useState(false), [exportError, setExportError] = useState("");
  const f = { ward: ward || undefined, category: category || undefined, date_from: from || undefined, date_to: to || undefined };
  const fixed = { ward: f.ward, category: f.category };
  const stale = 60_000;
  const today = useQuery({ queryKey: ["authority", "analytics", "today", fixed], queryFn: () => analytics.today(fixed), staleTime: stale });
  const overview = useQuery({ queryKey: ["authority", "analytics", "overview", f], queryFn: () => analytics.overview(f), staleTime: stale });
  const backlog = useQuery({ queryKey: ["authority", "analytics", "backlog", fixed], queryFn: () => analytics.backlog(fixed), staleTime: stale });
  const byWard = useQuery({ queryKey: ["authority", "analytics", "by-ward", f], queryFn: () => analytics.byWard(f), staleTime: stale });
  const byType = useQuery({ queryKey: ["authority", "analytics", "by-type", f], queryFn: () => analytics.byType(f), staleTime: stale });
  const perf = useQuery({ queryKey: ["authority", "analytics", "performance", f], queryFn: () => analytics.performance(f), staleTime: stale });
  const season = useQuery({ queryKey: ["authority", "analytics", "season", fixed], queryFn: () => analytics.season(fixed), staleTime: stale });
  const stats = useQuery({ queryKey: ["authority", "stats", { analysis: true }], queryFn: () => api.authorityStats({}), staleTime: stale });
  const failed = [today, overview, backlog, byWard, byType, perf, season].find(q => q.isError);
  const na = (v: number | null | undefined, suffix = "") => (v === null || v === undefined ? "—" : `${v}${suffix}`);
  const tbl = (head: string[], rows: (string | number)[][]) => <div className="table-wrap"><table><thead><tr>{head.map(h => <th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>;
  const pickWard = (w: string) => { setWard(w === ward ? "" : w); };

  const doExport = async () => {
    setExporting(true); setExportError("");
    try { await downloadCsv({ ward: f.ward, category: f.category }); } catch (e) { setExportError((e as Error).message); } finally { setExporting(false); }
  };

  const b = backlog.data, w = byWard.data, t = byType.data, p = perf.data, s = season.data, o = overview.data;
  return <div className="an">
    <div className="an-filters" role="group" aria-label={tr(lang, "an_filters")}>
      <label>{tr(lang, "an_from")}<input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} /></label>
      <label>{tr(lang, "an_to")}<input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></label>
      <label>{tr(lang, "ad_allAreas")}<select value={ward} onChange={e => setWard(e.target.value)}><option value="">{tr(lang, "ad_allAreas")}</option>{AREAS.map(a => <option key={a}>{a}</option>)}</select></label>
      <label>{tr(lang, "s_category")}<select value={category} onChange={e => setCategory(e.target.value)}><option value="">{tr(lang, "m_allCats")}</option>{CATEGORY_NAMES.map(c => <option key={c} value={c}>{catLabel(lang, c)}</option>)}</select></label>
      {(ward || category || from || to) && <button className="text-button" onClick={() => { setWard(""); setCategory(""); setFrom(""); setTo(""); }}>{tr(lang, "s_clearFilters")}</button>}
      <span className="grow" />
      <button className="secondary compact" onClick={() => void doExport()} disabled={exporting}>{exporting ? tr(lang, "s_loading") : tr(lang, "an_export")}</button>
      <button className="secondary compact" onClick={openList}>{tr(lang, "an_openList")}</button>
      <button className="primary compact" onClick={() => window.print()}><Icon name="reports" size={15} /> {tr(lang, "r_print")}</button>
    </div>
    {exportError && <div className="form-error" role="alert"><Icon name="alert" size={16} /> {exportError}</div>}
    {failed && <div className="empty-note error"><Icon name="alert" /><span><b>{tr(lang, "s_loadFail")}</b><small>{(failed.error as Error).message}</small></span><button className="secondary compact" onClick={() => failed.refetch()}>{tr(lang, "s_retry")}</button></div>}

    <Insights lang={lang} o={o} w={w} t={t} b={b} prio={stats.data ? { critical: stats.data.emergency_open, high: stats.data.urgent_open, moderate: stats.data.moderate_open, routine: stats.data.routine_open } : undefined} />

    <section className="an-today" aria-label={tr(lang, "an_today")}><h2 className="ad-h sm">{ward ? trf(lang, "an_todayWard", { ward }) : tr(lang, "an_today")}</h2>
      <div className="an-cards"><div><small>{tr(lang, "an_newToday")}</small><b>{na(today.data?.new_today)}</b></div><div><small>{tr(lang, "an_closedToday")}</small><b>{na(today.data?.closed_today)}</b></div><div className="danger"><small>{tr(lang, "an_nowOverdue")}</small><b>{na(today.data?.overdue)}</b></div></div></section>

    <section aria-label={tr(lang, "an_overview")}><h2 className="ad-h sm">{tr(lang, "an_overview")}</h2>
      <div className="an-cards">
        <div><small>{tr(lang, "an_open")}</small><b>{na(o?.open)}</b></div>
        <div className="danger"><small>{tr(lang, "an_overdue")}</small><b>{na(o?.overdue)}</b></div>
        <div><small>{tr(lang, "an_resolvedWeek")}</small><b>{na(o?.resolved_week)}</b></div>
        <div><small>{tr(lang, "an_median")}</small><b>{na(o?.median_days_to_close)}</b><em>{tr(lang, "s_days")}</em></div>
        <div><small>{tr(lang, "an_withinSla")}</small><b>{na(o?.pct_within_sla, "%")}</b></div>
        <div><small>{tr(lang, "an_reopened")}</small><b>{na(o?.pct_reopened, "%")}</b></div>
      </div></section>

    {b && <Chart lang={lang} title={backlogTakeaway(lang, b)} summary={`${backlogTakeaway(lang, b)}. ${trf(lang, "an_s_backlog", { reported: b.weeks.reduce((a, x) => a + x.reported, 0), closed: b.weeks.reduce((a, x) => a + x.closed, 0), open: b.weeks[b.weeks.length - 1]?.open_at_end ?? 0 })}`}
      table={tbl([tr(lang, "an_week"), tr(lang, "an_reported"), tr(lang, "an_closed"), tr(lang, "an_openAtEnd")], b.weeks.map(x => [new Date(x.week).toLocaleDateString(LOCALE[lang], { day: "numeric", month: "short" }), x.reported, x.closed, x.open_at_end]))}>
      <BacklogChart weeks={b.weeks} lang={lang} />
      <ul className="an-legend"><li><i style={{ background: COLOURS.reported }} />{tr(lang, "an_reported")}</li><li><i style={{ background: COLOURS.closed }} />{tr(lang, "an_closed")}</li><li><i style={{ background: COLOURS.open }} />{tr(lang, "an_openAtEnd")}</li></ul>
    </Chart>}

    {w && <Chart lang={lang} title={wardTakeaway(lang, w)} summary={`${wardTakeaway(lang, w)}. ${w.items.map(i => `${i.ward}: ${i.open} ${tr(lang, "an_open")}, ${i.overdue} ${tr(lang, "an_overdue")}`).join("; ")}`}
>
      <AreaBars items={w.items} lang={lang} selected={ward} onPick={pickWard} />
      <div className="an-ward">
        <AnalysisMap lang={lang} ward={ward} category={category} setWard={setWard} />
        <div className="table-wrap"><table><caption className="sr-only">{wardTakeaway(lang, w)}</caption><thead><tr><th scope="col">{tr(lang, "an_ward")}</th><th scope="col">{tr(lang, "an_open")}</th><th scope="col">{tr(lang, "an_overdue")}</th><th scope="col">{tr(lang, "an_median")}</th></tr></thead>
          <tbody>{w.items.map(i => <tr key={i.ward} className={i.ward === ward ? "sel" : ""}><th scope="row"><button className="text-button" aria-pressed={i.ward === ward} onClick={() => pickWard(i.ward)}>{i.ward}</button></th><td>{i.open}</td><td className={i.overdue ? "red" : ""}>{i.overdue}</td><td>{na(i.median_days_to_close)}</td></tr>)}</tbody></table></div>
      </div>
    </Chart>}

    {t && <Chart lang={lang} title={typeTakeaway(lang, t, ward)} summary={`${typeTakeaway(lang, t, ward)}. ${t.items.map(i => `${catLabel(lang, i.category)}: ${i.total}`).join("; ")}`}
>
      <Donut rows={t.items.filter(i => i.open > 0).map(i => ({ category: i.category, value: i.open }))} lang={lang} />
      <div className="table-wrap"><table><thead><tr><th scope="col">{tr(lang, "s_category")}</th><th scope="col">{tr(lang, "an_total")}</th><th scope="col">{tr(lang, "an_open")}</th><th scope="col">{tr(lang, "an_median")}</th><th scope="col">{tr(lang, "an_repeat")}</th></tr></thead>
        <tbody>{t.items.map(i => <tr key={i.category}><th scope="row">{catLabel(lang, i.category)}</th><td>{i.total}</td><td>{i.open}</td><td>{na(i.median_days_to_close)}</td><td className={i.repeat_spots ? "red" : ""}>{i.repeat_spots}</td></tr>)}</tbody></table></div>
      <p className="muted-line">{trf(lang, "an_repeatNote", { m: t.repeat_radius_m, days: t.repeat_days })}</p>
      {t.repeats.length > 0 && <ul className="plain">{t.repeats.slice(0, 5).map(r => <li key={r.public_id}>{r.public_id} · {catLabel(lang, r.category)} · {r.ward ?? "—"} · {trf(lang, "an_repeatLine", { prev: r.previous, n: r.days_after })}</li>)}</ul>}
    </Chart>}

    {p && (p.departments.length > 0 || p.wards.length > 0) && <Chart lang={lang} title={(() => { const all = p.departments; const tot = all.reduce((a, d) => a + d.resolved, 0); const within = tot ? Math.round(all.reduce((a, d) => a + d.pct_within_sla * d.resolved, 0) / tot) : 0; const low = [...all].sort((a, b) => a.pct_within_sla - b.pct_within_sla)[0]; return low && all.length > 1 ? trf(lang, "an_t_perfLow", { pct: within, name: low.name, low: low.pct_within_sla }) : trf(lang, "an_t_perf", { pct: within }); })()}
      summary={`${tr(lang, "an_performance")}: ${p.departments.map(d => `${d.name} ${d.pct_within_sla}% ${tr(lang, "an_withinSla")}, ${d.reopen_rate}% ${tr(lang, "an_reopened")}`).join("; ")}`}>
      <PerfBars rows={p.departments.map(d => ({ name: d.name, pct: d.pct_within_sla, resolved: d.resolved }))} />
      <div className="table-wrap"><table><thead><tr><th scope="col">{tr(lang, "an_deptWard")}</th><th scope="col">{tr(lang, "an_resolvedN")}</th><th scope="col">{tr(lang, "an_withinSla")}</th><th scope="col">{tr(lang, "an_reopened")}</th></tr></thead>
        <tbody>{[...p.departments, ...p.wards.map(x => ({ ...x, name: `${x.name} (${tr(lang, "an_ward")})` }))].map(r => <tr key={r.name}><th scope="row">{r.name}</th><td>{r.resolved}</td><td className={r.pct_within_sla < 50 ? "red" : ""}>{r.pct_within_sla}%</td><td>{r.reopen_rate}%</td></tr>)}</tbody></table></div>
    </Chart>}

    {s && s.items.length > 0 && <details className="an-more"><summary>More detail: problems by month</summary><Chart lang={lang} title={seasonTakeaway(lang, s.items)} summary={`${seasonTakeaway(lang, s.items)}. ${trf(lang, "an_s_season", { n: s.items.reduce((a, i) => a + i.n, 0) })}`}
      table={tbl([tr(lang, "an_month"), tr(lang, "s_category"), tr(lang, "an_total")], s.items.map(i => [i.month, catLabel(lang, i.category), i.n]))}>
      <SeasonChart items={s.items} lang={lang} />
      <ul className="an-legend">{[...new Set(s.items.map(i => i.category))].map(c => <li key={c}><i style={{ background: CAT_COLOURS[c] ?? "#6b7a72" }} />{catLabel(lang, c)}</li>)}</ul>
    </Chart></details>}

    <div className="report-sheet" aria-hidden="true">
      <div className="rp-head"><div><b>iREPORT</b><span>{tr(lang, "r_title")}</span></div><small>{tr(lang, "r_generated")}: {new Date().toLocaleString(LOCALE[lang], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</small></div>
      <p className="rp-filters"><b>{tr(lang, "r_scope")}:</b> {ward || tr(lang, "an_allAreas")} · {category ? catLabel(lang, category) : tr(lang, "m_allCats")} · {from || to ? `${from || "…"} – ${to || "…"}` : tr(lang, "r_allDates")}</p>
      {o && <table className="rp-kpi"><tbody><tr><th>{tr(lang, "an_open")}</th><th>{tr(lang, "an_overdue")}</th><th>{tr(lang, "an_resolvedWeek")}</th><th>{tr(lang, "an_median")}</th><th>{tr(lang, "an_withinSla")}</th><th>{tr(lang, "an_reopened")}</th></tr>
        <tr><td>{o.open}</td><td>{o.overdue}</td><td>{o.resolved_week}</td><td>{na(o.median_days_to_close)}</td><td>{na(o.pct_within_sla, "%")}</td><td>{na(o.pct_reopened, "%")}</td></tr></tbody></table>}
      {w && <><h4>{tr(lang, "r_areaWise")}</h4><p className="rp-take">{wardTakeaway(lang, w)}</p>{tbl([tr(lang, "an_ward"), tr(lang, "an_total"), tr(lang, "an_open"), tr(lang, "an_overdue"), tr(lang, "an_median")], w.items.map(i => [i.ward, i.total, i.open, i.overdue, na(i.median_days_to_close)]))}</>}
      {t && <><h4>{tr(lang, "r_byCategory")}</h4><p className="rp-take">{typeTakeaway(lang, t, ward)}</p>{tbl([tr(lang, "s_category"), tr(lang, "an_total"), tr(lang, "an_open"), tr(lang, "an_median"), tr(lang, "an_repeat")], t.items.map(i => [catLabel(lang, i.category), i.total, i.open, na(i.median_days_to_close), i.repeat_spots]))}</>}
      {p && p.departments.length > 0 && <><h4>{tr(lang, "an_performance")}</h4>{tbl([tr(lang, "an_deptWard"), tr(lang, "an_resolvedN"), tr(lang, "an_withinSla"), tr(lang, "an_reopened")], [...p.departments, ...p.wards.map(x => ({ ...x, name: `${x.name} (${tr(lang, "an_ward")})` }))].map(r => [r.name, r.resolved, `${r.pct_within_sla}%`, `${r.reopen_rate}%`]))}</>}
      {b && <><h4>{tr(lang, "r_trend")}</h4><p className="rp-take">{backlogTakeaway(lang, b)}</p>{tbl([tr(lang, "an_week"), tr(lang, "an_reported"), tr(lang, "an_closed"), tr(lang, "an_openAtEnd")], b.weeks.map(x => [new Date(x.week).toLocaleDateString(LOCALE[lang], { day: "numeric", month: "short" }), x.reported, x.closed, x.open_at_end]))}</>}
      {t && t.repeats.length > 0 && <><h4>{tr(lang, "an_repeat")}</h4><p className="rp-take">{trf(lang, "an_repeatNote", { m: t.repeat_radius_m, days: t.repeat_days })}</p><ul>{t.repeats.map(r => <li key={r.public_id}>{r.public_id} · {catLabel(lang, r.category)} · {r.ward ?? "—"} · {trf(lang, "an_repeatLine", { prev: r.previous, n: r.days_after })}</li>)}</ul></>}
      <div className="rp-sign"><div>{tr(lang, "r_preparedBy")}</div><div>{tr(lang, "r_reviewedBy")}</div></div>
    </div>
  </div>;
}

