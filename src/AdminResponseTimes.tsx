import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "./Icon";
import { api, type ResponseTimes } from "./api";

type Key = "emergency" | "urgent" | "routine" | "planned";
const KEY: Record<string, Key> = { Emergency: "emergency", Urgent: "urgent", Routine: "routine", Planned: "planned" };
const COLOR: Record<string, string> = { Emergency: "#b3261e", Urgent: "#e8710a", Routine: "#b88a00", Planned: "#2e7d32" };
const dayText = (d: number) => `${d} ${d === 1 ? "day" : "days"}`;

/** The admin's knobs: how many days each priority level has before a complaint counts as overdue. */
export default function AdminResponseTimes() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "response-times"], queryFn: api.adminResponseTimes });
  const [days, setDays] = useState<Record<Key, number> | null>(null);
  useEffect(() => {
    if (q.data) setDays(Object.fromEntries(q.data.items.map(i => [KEY[i.name], i.days])) as Record<Key, number>);
  }, [q.data]);
  const save = useMutation({
    mutationFn: (d: Record<Key, number>) => api.adminSetResponseTimes(d),
    onSuccess: (data: ResponseTimes) => { qc.setQueryData(["admin", "response-times"], data); void qc.invalidateQueries({ predicate: x => x.queryKey[0] !== "admin" || x.queryKey[1] !== "response-times" }); },
  });
  const r = q.data;
  const saved = r ? Object.fromEntries(r.items.map(i => [KEY[i.name], i.days])) as Record<Key, number> : null;
  const dirty = !!(days && saved && (Object.keys(days) as Key[]).some(k => days[k] !== saved[k]));
  const ordered = !!days && days.emergency <= days.urgent && days.urgent <= days.routine && days.routine <= days.planned;
  const set = (k: Key, v: number) => setDays(d => (d ? { ...d, [k]: v } : d));

  return <section className="admin-card rt" aria-label="Response times">
    <h2 className="ad-h">How many days does each priority get?</h2>
    <p className="muted-line">A complaint is shown as overdue once it is older than the days for its level. Turn a knob to change it; saving recalculates the due date of every open complaint, counted from when it was reported.</p>
    {q.isPending && <p className="muted-line">Loading…</p>}
    {q.isError && <div className="empty-note error"><Icon name="alert" /><span><b>Could not load the response times.</b><small>{(q.error as Error).message}</small></span><button className="secondary compact" onClick={() => q.refetch()}>Retry</button></div>}
    {r && days && <>
      <div className="rt-grid">
        {r.items.map(i => {
          const k = KEY[i.name];
          return <label key={i.name} className="rt-knob" style={{ borderTopColor: COLOR[i.name] }}>
            <span className="rt-name">{i.label}<small>{i.band}</small></span>
            <b className="rt-val">{dayText(days[k])}</b>
            <input type="range" min={r.min_days} max={r.max_days} step={0.5} value={days[k]} onChange={e => set(k, Number(e.target.value))} aria-label={`${i.label}: days allowed`} />
            <small>Default {dayText(r.defaults_days[i.name])}</small>
          </label>;
        })}
      </div>
      {!ordered && <div className="form-error" role="alert"><Icon name="alert" size={16} /> A more serious level cannot get more days than a less serious one.</div>}
      {save.isError && <div className="form-error" role="alert"><Icon name="alert" size={16} /> {(save.error as Error).message}</div>}
      {save.isSuccess && !dirty && <div className="form-notice" role="status"><Icon name="check" size={16} /> Saved. Open complaints now use these days.</div>}
      <div className="act-row">
        <button className="primary compact" disabled={!dirty || !ordered || save.isPending} onClick={() => save.mutate(days)}>{save.isPending ? "Saving…" : "Save response times"}</button>
        <button className="secondary compact" disabled={save.isPending} onClick={() => setDays(Object.fromEntries(r.items.map(i => [KEY[i.name], r.defaults_days[i.name]])) as Record<Key, number>)}>Reset to defaults</button>
      </div>
    </>}
  </section>;
}
