import { useState, type ChangeEvent, type FormEvent } from "react";
import { Icon } from "./Icon";
import { AREAS, DEPARTMENTS, type Role } from "./store";
import { api, ApiError, type Session } from "./api";

const roleInfo: Record<Role, { label: string; blurb: string }> = {
  citizen: { label: "Citizen", blurb: "Report problems and track every update." },
  authority: { label: "Authority", blurb: "BMC officers who review and solve problems." },
  admin: { label: "Admin", blurb: "Approves authority accounts." },
};

const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export default function AuthPage({ onLogin, bmcImage }: { onLogin: (s: Session) => void; bmcImage: string }) {
  const [role, setRole] = useState<Role>("citizen");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ name: "", email: "", phone: "", area: AREAS[0], department: DEPARTMENTS[0], employeeId: "", password: "", confirm: "" });
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [key]: e.target.value }));
  const pickRole = (r: Role) => { setRole(r); if (r === "admin") setMode("login"); setError(""); setNotice(""); };
  const pickMode = (m: "login" | "register") => { setMode(m); setError(""); setNotice(""); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(""); setNotice("");
    const email = form.email.trim().toLowerCase();
    if (!emailOk(email)) return setError("Enter a valid email address.");
    if (mode === "register") {
      if (!form.name.trim()) return setError("Enter your full name.");
      if (form.password.length < 8) return setError("Use a password with at least 8 characters.");
      if (form.password !== form.confirm) return setError("The two passwords do not match.");
      if (role === "authority" && !form.employeeId.trim()) return setError("Enter your official employee ID.");
      if (!consent) return setError("Please accept the data use notice to continue.");
    } else if (!form.password) return setError("Enter your password.");
    setBusy(true);
    try {
      if (mode === "login") return onLogin(await api.login(email, form.password, role));
      const res = await api.register({
        role, name: form.name.trim(), email, phone: form.phone.trim() || undefined, password: form.password, area: form.area, consent,
        department: role === "authority" ? form.department : undefined, employee_id: role === "authority" ? form.employeeId.trim() : undefined,
      });
      if ("pending" in res) {
        setNotice(res.message);
        setMode("login");
        setForm(f => ({ ...f, password: "", confirm: "" }));
        return;
      }
      onLogin(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const isRegister = mode === "register";
  return <main className="auth-wrap section">
    <aside className="auth-aside" style={{ backgroundImage: `linear-gradient(180deg, rgba(14,40,31,.55), rgba(14,40,31,.92)), url(${bmcImage})` }}>
      <span className="eyebrow light">iREPORT · METROPOLITAN MUMBAI</span>
      <h1>One platform for citizens and the city.</h1>
      <p>Citizens report problems. Authorities see every problem in the city, ranked by how urgent it really is, then message the citizen and fix it.</p>
      <ul><li><Icon name="shield" size={18} /> Authority accounts are verified by an admin</li><li><Icon name="alert" size={18} /> Dangerous problems rise, even with few votes</li><li><Icon name="check" size={18} /> Citizens see every update on their report</li></ul>
    </aside>
    <section className="auth-card">
      <div className="role-tabs" role="tablist" aria-label="Account type">{(Object.keys(roleInfo) as Role[]).map(r => <button key={r} role="tab" aria-selected={role === r} className={role === r ? "active" : ""} onClick={() => pickRole(r)}>{roleInfo[r].label}</button>)}</div>
      <p className="role-blurb">{roleInfo[role].blurb}</p>
      {role !== "admin" && <div className="mode-switch"><button className={!isRegister ? "active" : ""} onClick={() => pickMode("login")}>Log in</button><button className={isRegister ? "active" : ""} onClick={() => pickMode("register")}>Register</button></div>}
      <form onSubmit={submit} noValidate>
        {isRegister && <label className="field"><span>Full name</span><input value={form.name} onChange={set("name")} autoComplete="name" maxLength={100} /></label>}
        <label className="field"><span>{role === "authority" ? "Official email" : "Email"}</span><input type="email" value={form.email} onChange={set("email")} autoComplete="email" /></label>
        {isRegister && <label className="field"><span>Phone (optional)</span><input type="tel" value={form.phone} onChange={set("phone")} autoComplete="tel" maxLength={20} /></label>}
        {isRegister && role === "citizen" && <label className="field"><span>Your area</span><select value={form.area} onChange={set("area")}>{AREAS.map(a => <option key={a}>{a}</option>)}</select></label>}
        {isRegister && role === "authority" && <>
          <label className="field"><span>Employee ID</span><input value={form.employeeId} onChange={set("employeeId")} maxLength={40} /></label>
          <label className="field"><span>Department</span><select value={form.department} onChange={set("department")}>{DEPARTMENTS.map(d => <option key={d}>{d}</option>)}</select></label>
          <label className="field"><span>Ward / area office</span><select value={form.area} onChange={set("area")}>{AREAS.map(a => <option key={a}>{a}</option>)}</select></label>
        </>}
        <label className="field"><span>Password</span><input type="password" value={form.password} onChange={set("password")} autoComplete={isRegister ? "new-password" : "current-password"} /></label>
        {isRegister && <label className="field"><span>Confirm password</span><input type="password" value={form.confirm} onChange={set("confirm")} autoComplete="new-password" /></label>}
        {isRegister && <label className="consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> I agree that iREPORT stores my name, email, optional phone and area to handle my reports. I can download or delete my data from Profile.</label>}
        {error && <div className="form-error" role="alert"><Icon name="alert" size={16} /> {error}</div>}
        {notice && <div className="form-notice" role="status"><Icon name="check" size={16} /> {notice}</div>}
        <button className="primary full large" type="submit" disabled={busy}>{busy ? "Please wait…" : isRegister ? (role === "authority" ? "Request authority access" : "Create account") : "Log in"} <Icon name="arrow" /></button>
      </form>
      {role === "authority" && isRegister && <p className="auth-note">Authority accounts are reviewed by an admin before access is given.</p>}
      {import.meta.env.DEV && <div className="demo-box"><b>Demo accounts</b><span>Citizen: aarav@example.com / citizen123</span><span>Authority: officer@bmc.demo / bmc12345</span><span>Admin: ADMIN_EMAIL / ADMIN_PASSWORD from your .env</span><small>Development only. Create them with: python -m scripts.seed_demo</small></div>}
    </section>
  </main>;
}
