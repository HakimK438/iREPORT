import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type AdminDash, type AuthorityRow, type AuthorityStats } from "./api";
import { hotspotReasons } from "./AuthorityDashboard";
import { tr, trf, type Lang } from "./i18n";
import { catLabel, deptLabel } from "./i18nStaff";
import { Icon } from "./Icon";

/** Prints only the report sheet: the page itself is hidden by the `print-perf` rules in index.css. */
function printSheet() {
  document.body.classList.add("print-perf");
  const done = () => { document.body.classList.remove("print-perf"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  window.print();
}

const stamp = (d?: string | Date) => (d ? new Date(d) : new Date()).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const COLOUR = { critical: "#a63d32", high: "#b8651b", moderate: "#a88a2a", routine: "#7b8794", resolved: "#1f8a5b", open: "#4b5d73", reported: "#2563c9", overdue: "#a63d32", other: "#c9a37a" };
const CAT_COLOUR: Record<string, string> = { Pothole: "#b3261e", "Road Damage": "#8a3b2e", Garbage: "#2e7d6b", Streetlight: "#c9a400", "Water Leakage": "#1f6fb2", Drainage: "#1f6fb2", "Electrical Hazard": "#5b3fa0", Other: "#6b7a72" };

function Card({ title, takeaway, children, wide }: { title?: string; takeaway: string; children: React.ReactNode; wide?: boolean }) {
  return <figure className={`ad-chart${wide ? " wide" : ""}`}>{title && <small className="ad-chart-kicker">{title}</small>}<figcaption><h3>{takeaway}</h3></figcaption>{children}</figure>;
}

/** Line chart: weekly complaints reported, complaints finished, and the open backlog at the end of each week. Every point is a count. */
function WeeklyLines({ weeks }: { weeks: AdminDash["weeks"] }) {
  const W = 720, H = 250, pad = { l: 36, r: 16, t: 14, b: 32 };
  const max = Math.max(4, ...weeks.flatMap(w => [w.reported, w.closed]));
  const top = Math.ceil(max / 4) * 4;
  const x = (k: number) => pad.l + (k * (W - pad.l - pad.r)) / Math.max(1, weeks.length - 1);
  const y = (v: number) => H - pad.b - (v / top) * (H - pad.t - pad.b);
  const label = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const line = (key: "reported" | "closed" | "open_at_end", colour: string, dash?: string) => <g key={key}>
    <polyline fill="none" stroke={colour} strokeWidth="2.5" strokeDasharray={dash} strokeLinejoin="round" points={weeks.map((w, k) => `${x(k)},${y(w[key])}`).join(" ")} />
    {weeks.map((w, k) => <circle key={k} cx={x(k)} cy={y(w[key])} r="3.2" fill={colour}><title>{`${label(w.week)}: ${w[key]}`}</title></circle>)}
    <text x={x(weeks.length - 1) - 4} y={y(weeks[weeks.length - 1][key]) - 8} fontSize="11" fontWeight="800" textAnchor="end" fill={colour}>{weeks[weeks.length - 1][key]}</text></g>;
  return <svg viewBox={`0 0 ${W} ${H}`} className="an-svg" role="img" aria-label="Weekly complaints reported, finished and still open">
    {[0, 1, 2, 3, 4].map(i => { const v = (top / 4) * i; return <g key={i}><line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="#e3e8e5" /><text x={pad.l - 6} y={y(v) + 4} fontSize="10" textAnchor="end" fill="#5b6a63">{v}</text></g>; })}
    {weeks.map((w, k) => (k % 2 === (weeks.length - 1) % 2) && <text key={w.week} x={x(k)} y={H - 10} fontSize="10" textAnchor="middle" fill="#5b6a63">{label(w.week)}</text>)}
    {line("reported", COLOUR.reported)}{line("closed", COLOUR.resolved)}
  </svg>;
}

/** Horizontal bars, value printed at the end. */
function Bars({ rows }: { rows: { label: string; value: number; colour: string; note?: string }[] }) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return <div className="ad-bars">{rows.map(r => <div key={r.label} className="ad-bar"><span>{r.label}</span><span className="track"><i style={{ width: `${r.value ? Math.max(2, (r.value / max) * 100) : 0}%`, background: r.colour }} /></span><b>{r.value}</b>{r.note && <em>{r.note}</em>}</div>)}</div>;
}

function Donut({ rows }: { rows: { label: string; value: number; colour: string }[] }) {
  const total = rows.reduce((a, r) => a + r.value, 0);
  const R = 62, C = 2 * Math.PI * R;
  if (total === 0) return <p className="muted-line">No open complaints.</p>;
  let acc = 0;
  return <div className="ad-donut"><svg viewBox="0 0 180 180" aria-hidden="true">
    <circle cx="90" cy="90" r={R} fill="none" stroke="#eef1ee" strokeWidth="26" />
    {rows.map(r => { const len = (r.value / total) * C; const el = <circle key={r.label} cx="90" cy="90" r={R} fill="none" stroke={r.colour} strokeWidth="26" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} transform="rotate(-90 90 90)"><title>{`${r.label}: ${r.value}`}</title></circle>; acc += len; return el; })}
    <text x="90" y="88" textAnchor="middle" fontSize="30" fontWeight="800" fill="#18201d">{total}</text><text x="90" y="108" textAnchor="middle" fontSize="11" fill="#68736e">open</text></svg>
    <ul>{rows.map(r => <li key={r.label}><i style={{ background: r.colour }} /><span>{r.label}</span><b>{r.value}</b><em>{Math.round((100 * r.value) / total)}%</em></li>)}</ul></div>;
}

/** One stacked bar per area: overdue (red), other open (orange), resolved (green). */
function AreaStacks({ areas }: { areas: AdminDash["areas"] }) {
  const rows = areas.filter(a => a.total > 0).slice(0, 12);
  const max = Math.max(1, ...rows.map(a => a.total));
  return <div className="ad-stacks"><ul className="an-legend"><li><i style={{ background: COLOUR.overdue }} />Overdue</li><li><i style={{ background: COLOUR.other }} />Open, on schedule</li><li><i style={{ background: COLOUR.resolved }} />Resolved</li></ul>
    {rows.map(a => { const onTime = a.open - a.overdue; return <div key={a.area} className="ad-stack"><span>{a.area}</span>
      <span className="track" title={`${a.area}: ${a.overdue} overdue, ${onTime} open on schedule, ${a.resolved} resolved`}>
        <i style={{ width: `${(a.overdue / max) * 100}%`, background: COLOUR.overdue }} /><i style={{ width: `${(onTime / max) * 100}%`, background: COLOUR.other }} /><i style={{ width: `${(a.resolved / max) * 100}%`, background: COLOUR.resolved }} /></span>
      <b>{a.open}<small> open</small></b></div>; })}</div>;
}

const delta = (a: number, b: number) => (a === b ? "same as last week" : `${a > b ? "+" : "−"}${Math.abs(a - b)} vs last week`);

/** The admin dashboard. Every number is a count from the complaint, report and user records; the definitions are listed at the bottom. */
export default function AdminPerformance({ lang = "en" }: { lang?: Lang }) {
  const q = useQuery({ queryKey: ["admin", "performance"], queryFn: api.adminPerformance, refetchInterval: 60_000 });
  if (q.isPending) return <section className="admin-card"><p className="muted-line">{tr(lang, "s_loading")}</p></section>;
  if (q.isError) return <section className="admin-card"><div className="empty-note error"><Icon name="alert" /><span><b>{tr(lang, "a_overviewFail")}</b><small>{(q.error as Error).message}</small></span><button className="secondary compact" onClick={() => q.refetch()}>{tr(lang, "s_retry")}</button></div></section>;
  const d = q.data, s = d.summary;
  const kpis: { label: string; value: string | number; sub: string; tone?: string }[] = [
    { label: "Open complaints", value: s.open, sub: `of ${s.total} received` },
    { label: "Critical and high risk", value: s.critical + s.high, sub: `${s.critical} critical · ${s.high} high risk`, tone: s.critical + s.high ? "danger" : "good" },
    { label: "Overdue", value: s.overdue, sub: "open and past the deadline", tone: s.overdue ? "danger" : "good" },
    { label: "Waiting to be acknowledged", value: s.waiting, sub: "new, no officer has acted yet", tone: s.waiting ? "warn" : "good" },
    { label: "Resolved", value: s.resolution_rate === null ? "–" : `${s.resolution_rate}%`, sub: `${s.resolved} resolved · rejected and duplicates not counted`, tone: "good" },
    { label: "Fixed on time", value: s.on_time_pct === null ? "–" : `${s.on_time_pct}%`, sub: s.median_days === null ? "no fixes yet" : `typical fix takes ${s.median_days} day${s.median_days === 1 ? "" : "s"}`, tone: s.on_time_pct !== null && s.on_time_pct < 50 ? "danger" : "good" },
    { label: "New in 7 days", value: s.new_7d, sub: delta(s.new_7d, s.prev_7d) },
    { label: "Waiting for citizen", value: s.awaiting_citizen, sub: "resolved, not yet confirmed" },
  ];
  const people: [string, number][] = [["Citizen reports", s.reports], ["Citizens registered", s.citizens], ["Officers approved", s.officers], ["Officer approvals pending", s.pending_approvals], ["Reports to review", s.needs_review]];
  const first = d.weeks[0], last = d.weeks[d.weeks.length - 1];
  const trend = last.open_at_end - first.open_at_end;
  const weekTitle = `This week: ${last.reported} new complaints received, ${last.closed} finished`;
  const trendTitle = trend > 0 ? `The open backlog grew by ${trend} over 12 weeks` : trend < 0 ? `The open backlog fell by ${-trend} over 12 weeks` : "The open backlog is unchanged over 12 weeks";
  const worstArea = d.areas[0];
  const topCat = d.categories[0];
  const mix = [{ label: tr(lang, "resp_Emergency"), value: s.critical, colour: COLOUR.critical }, { label: tr(lang, "resp_Urgent"), value: s.high, colour: COLOUR.high }, { label: tr(lang, "resp_Routine"), value: s.moderate, colour: COLOUR.moderate }, { label: tr(lang, "resp_Planned"), value: s.routine, colour: COLOUR.routine }];
  const openCats = d.categories.filter(c => c.open > 0).map(c => ({ label: catLabel(lang, c.category), value: c.open, colour: CAT_COLOUR[c.category] ?? "#6b7a72" }));
  const maxImpact = Math.max(1, ...d.hotspots.map(h => h.impact_score));

  return <>
    <section className="admin-card perf">
      <div className="perf-head"><div><h2>City overview</h2><p className="muted-line">Live counts from the complaint records · updated {stamp(d.as_of)}</p></div><button className="secondary compact" onClick={printSheet}>Print report</button></div>
      <div className="ad-kpis">{kpis.map(k => <div key={k.label} className={k.tone ?? ""}><small>{k.label}</small><b>{k.value}</b><span>{k.sub}</span></div>)}</div>
      <div className="ad-people">{people.map(([l, n]) => <span key={l}><b>{n}</b> {l}</span>)}</div>
    </section>

    <section className="admin-card">
      <h2>Situation summary</h2>
      <ul className="ad-insights">
        <li><b>{s.open}</b> complaints are open, and <b>{s.critical + s.high}</b> of them are critical or high risk.</li>
        {worstArea && worstArea.open > 0 && <li><b>{worstArea.area}</b> has the most open complaints ({worstArea.open}){worstArea.overdue ? `, ${worstArea.overdue} past their fix-by time` : ""}.</li>}
        <li>{s.overdue > 0 ? <><b>{s.overdue}</b> complaints are past their fix-by time. Clear these first.</> : "No complaint is past its fix-by time."}</li>
        {s.on_time_pct !== null && <li><b>{s.on_time_pct}%</b> of fixed complaints were finished on time.</li>}
      </ul>
      <div className="ad-grid">
        <Card wide title="Weekly workload" takeaway={weekTitle}>
          <WeeklyLines weeks={d.weeks} />
          <ul className="an-legend"><li><i style={{ background: COLOUR.reported }} />New complaints received</li><li><i style={{ background: COLOUR.resolved }} />Complaints finished</li></ul>
        </Card>
        <Card title="Priority" takeaway={s.critical + s.high > 0 ? `${s.critical + s.high} open complaints are critical or high risk` : "No critical or high-risk complaints are open"}>
          <Bars rows={mix} />
        </Card>
        <Card title="Problem types" takeaway={topCat && topCat.open > 0 ? `${catLabel(lang, topCat.category)} is the most common open problem (${topCat.open} of ${s.open})` : "No open complaints"}>
          <Bars rows={openCats.slice(0, 6)} />
        </Card>
        <Card wide title="Areas" takeaway={worstArea && worstArea.open > 0 ? `${worstArea.area} has the most open complaints (${worstArea.open})` : "No open complaints in any area"}>
          <Bars rows={d.areas.filter(a => a.open > 0).slice(0, 8).map(a => ({ label: a.area, value: a.open, colour: COLOUR.open, note: a.overdue ? `${a.overdue} overdue` : undefined }))} />
        </Card>
      </div>
    </section>

    <section className="admin-card">
      <h2>Departments</h2><p className="muted-line">Open work and how often fixes were finished on time.</p>
      <div className="perf-table dept" role="table">
        <div className="perf-tr head" role="row"><span>Department</span><span>Open</span><span>High risk</span><span>Overdue</span><span>Resolved</span><span>On time</span></div>
        {d.departments.map(x => <div className="perf-tr" role="row" key={x.department}><b>{deptLabel(lang, x.department)}</b><span>{x.open}</span><span>{x.high_risk}</span><span className={x.overdue ? "red" : ""}>{x.overdue}</span><span>{x.resolved}</span><span>{x.on_time_pct === null ? "–" : `${x.on_time_pct}%`}</span></div>)}
      </div>
    </section>

    <section className="admin-card">
      <h2>Where problems pile up</h2><p className="muted-line">Hotspots: three or more open complaints within 400 m of each other in the last 30 days, ranked by impact score.</p>
      {d.hotspots.length === 0 && <p className="muted-line">No hotspots right now.</p>}
      <ol className="ad-hot">{d.hotspots.map((h, k) => { const merged = new Map<string, number>(); h.categories.forEach(c => merged.set(catLabel(lang, c.category), (merged.get(catLabel(lang, c.category)) ?? 0) + c.count)); return <li key={h.id}>
        <i className="rank">{k + 1}</i>
        <div><div className="row"><b>{h.area}</b><span className="track"><i style={{ width: `${(h.impact_score / maxImpact) * 100}%` }} /></span><strong>{h.impact_score}<small>/100</small></strong></div>
          <p>{h.open_incidents} open{h.critical ? `, ${h.critical} critical` : ""} · {[...merged].map(([n, c]) => `${n} ${c}`).join(" · ")}</p></div></li>; })}</ol>
    </section>

    <section className="admin-card">
      <h2>Officers</h2><p className="muted-line">Who is working on what. Red numbers are overdue complaints.</p>
      <div className="perf-table off" role="table">
        <div className="perf-tr head" role="row"><span>Officer</span><span>Open</span><span>Overdue</span><span>Resolved</span><span>Typical fix</span></div>
        {d.officers.length === 0 && <p className="muted-line">No approved officers yet.</p>}
        {d.officers.map(o => <div className="perf-tr" role="row" key={o.id}><span><b>{o.name}</b><small>{deptLabel(lang, o.department)} · {o.area ?? "whole city"}</small></span><span>{o.open}</span><span className={o.overdue ? "red" : ""}>{o.overdue}</span><span>{o.resolved}</span><span>{o.median_fix_hours != null ? `${o.median_fix_hours} h` : "–"}</span></div>)}
      </div>
    </section>

    <section className="admin-card">
      <details className="ad-defs"><summary>How these numbers are counted</summary>
        <ul>
          <li><b>Open:</b> status is Reported, Acknowledged, Scheduled, In progress, Reopened or On hold.</li>
          <li><b>Overdue:</b> open, and the deadline (set from the priority) has passed.</li>
          <li><b>Critical / high risk:</b> the risk score from the complaint's problem type, people affected and location. It is a fixed formula, not a prediction.</li>
          <li><b>Resolved:</b> an officer marked it resolved, as a share of complaints that were not rejected or duplicates.</li>
          <li><b>Fixed on time:</b> resolved on or before the deadline, as a share of resolved complaints.</li>
          <li><b>Typical fix:</b> the median time from report to resolved.</li>
          <li><b>Complaints vs reports:</b> several citizens reporting the same problem become one complaint with several reports.</li>
          <li><b>Weekly chart:</b> weeks run Monday to Sunday, India time.</li>
        </ul></details>
    </section>

    {createPortal(<div className="perf-sheet" aria-hidden="true">
      <div className="ps-head"><div><b>iREPORT</b><span>City overview</span></div><div className="ps-no"><small>{stamp(d.as_of)}</small></div></div>
      <table className="ps-grid"><tbody>
        <tr><th>Complaints received</th><td>{s.total}</td><th>Open</th><td>{s.open}</td></tr>
        <tr><th>Critical + high risk</th><td>{s.critical + s.high}</td><th>Overdue</th><td>{s.overdue}</td></tr>
        <tr><th>Resolved</th><td>{s.resolution_rate ?? "–"}%</td><th>Fixed on time</th><td>{s.on_time_pct ?? "–"}%</td></tr>
        <tr><th>Not assigned</th><td>{s.unassigned}</td><th>Typical fix (days)</th><td>{s.median_days ?? "–"}</td></tr>
      </tbody></table>
      <h4>Open complaints by priority</h4>
      <table className="ps-lines"><tbody>{mix.map(m => <tr key={m.label}><td>{m.label}</td><td>{m.value}</td></tr>)}</tbody></table>
      <h4>By area</h4>
      <table className="ps-lines"><thead><tr><th>Area</th><th>Open / total</th><th>High risk</th><th>Overdue</th><th>Resolved</th></tr></thead>
        <tbody>{d.areas.map(a => <tr key={a.area}><td>{a.area}</td><td>{a.open}/{a.total}</td><td>{a.high_risk}</td><td>{a.overdue}</td><td>{a.resolved}</td></tr>)}</tbody></table>
      <h4>By department</h4>
      <table className="ps-lines"><thead><tr><th>Department</th><th>Open</th><th>Overdue</th><th>Resolved</th><th>On time</th></tr></thead>
        <tbody>{d.departments.map(x => <tr key={x.department}><td>{x.department}</td><td>{x.open}</td><td>{x.overdue}</td><td>{x.resolved}</td><td>{x.on_time_pct ?? "–"}{x.on_time_pct === null ? "" : "%"}</td></tr>)}</tbody></table>
      <h4>Officers</h4>
      <table className="ps-lines"><thead><tr><th>Officer</th><th>Area</th><th>Open</th><th>Overdue</th><th>Resolved</th></tr></thead>
        <tbody>{d.officers.map(o => <tr key={o.id}><td>{o.name}</td><td>{o.area ?? "whole city"}</td><td>{o.open}</td><td>{o.overdue}</td><td>{o.resolved}</td></tr>)}</tbody></table>
    </div>, document.body)}
  </>;
}

/** Officer: one-page report for their own area, from the counts and the complaints already on screen. */
export function AreaReport({ lang = "en", area, department, stats, rows }: { lang?: Lang; area: string | null; department: string | null; stats: AuthorityStats | undefined; rows: AuthorityRow[] }) {
  if (!stats) return null;
  const open = rows.filter(r => !["Resolved", "Closed", "Rejected", "Duplicate", "Transferred"].includes(r.status)).slice(0, 25);
  const resolved = (stats.by_status["Resolved"] ?? 0) + (stats.by_status["Closed"] ?? 0);
  return <>
    <button className="secondary compact" onClick={printSheet}>Print report</button>
    {createPortal(<div className="perf-sheet" aria-hidden="true">
      <div className="ps-head"><div><b>iREPORT</b><span>{trf(lang, "ad_scopeLine", { area: area ?? tr(lang, "ad_scopeAll"), dept: deptLabel(lang, department) })}</span></div><div className="ps-no"><small>{stamp()}</small></div></div>
      <table className="ps-grid"><tbody>
        <tr><th>Total</th><td>{stats.total}</td><th>Open</th><td>{stats.open}</td></tr>
        <tr><th>Overdue</th><td>{stats.overdue}</td><th>Not assigned</th><td>{stats.unassigned}</td></tr>
        <tr><th>Resolved</th><td>{resolved}</td><th>Resolved share</th><td>{stats.total ? Math.round((100 * resolved) / stats.total) : 0}%</td></tr>
      </tbody></table>
      <h4>Open complaints</h4>
      <table className="ps-lines"><thead><tr><th>No.</th><th>Category</th><th>Priority</th><th>Status</th><th>Assigned to</th></tr></thead>
        <tbody>{open.map(r => <tr key={r.id}><td>{r.public_id}</td><td>{catLabel(lang, r.category)}</td><td>{tr(lang, `resp_${r.response}` as Parameters<typeof tr>[1])}</td><td>{r.status}</td><td>{r.assignee?.name ?? tr(lang, "v_unassigned")}</td></tr>)}</tbody></table>
    </div>, document.body)}
  </>;
}
