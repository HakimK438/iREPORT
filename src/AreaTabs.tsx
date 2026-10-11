import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Session } from "./api";
import { Icon } from "./Icon";

// Development only (the demo accounts from scripts/seed_area_problems.py). In a production build the box stays empty.
const DEMO_PASSWORD = "ward12345";
const emailFor = (area: string) => `ward.${area.toLowerCase().replace(/\s+/g, "")}@bmc.demo`;

/** One tab per area authority ("Dadar Authority"). Your own area is the active tab. Opening another area means signing in as
    that area's authority: officers never see or change another area's complaints without their own login. */
export default function AreaTabs({ onSwitch }: { onSwitch: (s: Session) => void }) {
  const qc = useQueryClient();
  const areas = useQuery({ queryKey: ["authority", "areas"], queryFn: api.authorityAreas, staleTime: 5 * 60_000 });
  const [target, setTarget] = useState<string | null>(null);
  const [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const items = areas.data?.items ?? [];
  if (items.length < 2) return null;

  const pick = (area: string, mine: boolean) => {
    if (mine) { setTarget(null); return; }
    setTarget(area); setEmail(emailFor(area)); setPassword(import.meta.env.DEV ? DEMO_PASSWORD : ""); setError(""); // development: pre-filled so one click signs in
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const session = await api.login(email.trim(), password, "authority");
      qc.clear();           // nothing from the previous area stays on screen
      onSwitch(session);
    } catch (err) {
      setError((err as Error).message || "Could not sign in.");
    } finally {
      setBusy(false);
    }
  };

  return <section className="area-tabs-wrap" aria-label="Area authorities">
    <div className="area-tabs" role="tablist" aria-label="Area authorities">
      {items.map(a => <button key={a.area} role="tab" aria-selected={a.is_mine} className={`${a.is_mine ? "active" : ""}${target === a.area ? " target" : ""}`} onClick={() => pick(a.area, a.is_mine)}>
        {a.is_mine && <Icon name="shield" size={14} />} {a.area} Authority</button>)}
    </div>
    {target && <form className="area-login" onSubmit={e => void submit(e)}>
      <p><b>{target} Authority</b>: sign in with this authority's login to see and manage {target}'s complaints.</p>
      <label className="fld"><span>Email</span><input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required /></label>
      <label className="fld"><span>Password</span><input type={import.meta.env.DEV ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required /></label>
      {error && <div className="form-error" role="alert"><Icon name="alert" size={16} /> {error}</div>}
      <div className="act-row"><button className="primary compact" disabled={busy || !password}>{busy ? "Signing in…" : "Sign in"}</button><button type="button" className="secondary compact" onClick={() => setTarget(null)}>Cancel</button></div>
      {import.meta.env.DEV && <small className="muted-line">Development only: the demo login is filled in for you. Just click Sign in.</small>}
    </form>}
  </section>;
}
