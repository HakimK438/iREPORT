import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Icon, type IconName } from "./Icon";
import { AREAS, AREA_CENTRES, STATUSES } from "./store";
import { api, refreshSession, setSessionLostHandler, setToken, type ApiUser, type IncidentPublic, type Page as ApiPage, type Session } from "./api";
import { Brand, distanceLabel, homeCards, statusLabel } from "./brand";
import { menuText, severityName, statusName, tr, type StrKey } from "./i18n";
import { FAQS, HOW_STEPS, HOW_TIPS, HOW_UI } from "./i18nStaff";
import AuthPage from "./AuthPage";
import AuthorityDashboard from "./AuthorityDashboard";
import AdminPanel from "./AdminPanel";

// The report flow (photo compression, AI step) is a separate chunk, loaded only when a report starts.
const ReportFlow = lazy(() => import("./ReportFlow"));

type Lang = "en" | "hi" | "mr";
type Page = "home" | "community" | "reports" | "profile" | "auth" | "authority" | "admin";
type User = ApiUser;

const media = (file: string) => `${import.meta.env.BASE_URL}media/${file}`;

const bmcMapsUrl = "https://www.google.com/maps/search/?api=1&query=Brihanmumbai+Municipal+Corporation+Headquarters+Mahapalika+Marg+Fort+Mumbai";

const copy = {
  en: {
    nav: ["Home", "Community", "My Reports", "Profile"],
    report: "Report a Problem",
    eyebrow: "BUILT FOR MUMBAI",
    hero: "See it. Report it. Make Mumbai better.",
    trust: "A simpler way to report civic problems, track progress, and see what’s happening around Mumbai.",
    start: "Start a report",
    explore: "Explore your area",
    what: "What civic problems can you report?",
    whatSub: "Choose a category. iREPORT helps with the rest.",
    how: "One clear civic loop",
    howSub: "No department names. No long forms. You stay in control.",
    community: "Civic incidents around you",
    reports: "Your reports",
    profile: "Your civic control centre",
    area: "Select your area",
  },
  hi: {
    nav: ["होम", "समुदाय", "मेरी शिकायतें", "प्रोफ़ाइल"],
    report: "समस्या दर्ज करें",
    eyebrow: "मुंबई के लिए बनाया गया",
    hero: "देखें। शिकायत दर्ज करें। मुंबई को बेहतर बनाएं।",
    trust: "नागरिक समस्याओं की शिकायत, प्रगति की जानकारी और मुंबई के आसपास की स्थिति देखने का आसान तरीका।",
    start: "शिकायत शुरू करें",
    explore: "अपना क्षेत्र देखें",
    what: "आप कौन-सी नागरिक समस्याएँ दर्ज कर सकते हैं?",
    whatSub: "एक श्रेणी चुनें। बाकी में iREPORT आपकी मदद करेगा।",
    how: "एक सरल नागरिक प्रक्रिया",
    howSub: "न विभाग का नाम, न लंबे फॉर्म। नियंत्रण आपके पास है।",
    community: "आपके आसपास नागरिक समस्याएं",
    reports: "आपकी शिकायत",
    profile: "आपका नागरिक नियंत्रण केंद्र",
    area: "अपना क्षेत्र चुनें",
  },
  mr: {
    nav: ["मुख्यपृष्ठ", "समुदाय", "माझ्या तक्रारी", "प्रोफाइल"],
    report: "समस्या नोंदवा",
    eyebrow: "मुंबईसाठी बनवलेले",
    hero: "पाहा. नोंदवा. मुंबई अधिक चांगली करा.",
    trust: "नागरी समस्या नोंदवण्याचा, प्रगती पाहण्याचा आणि मुंबईत काय घडते आहे हे जाणून घेण्याचा सोपा मार्ग.",
    start: "तक्रार सुरू करा",
    explore: "तुमचा परिसर पहा",
    what: "तुम्ही कोणत्या नागरी समस्या नोंदवू शकता?",
    whatSub: "श्रेणी निवडा. पुढे iREPORT मदत करेल.",
    how: "एक स्पष्ट नागरी प्रक्रिया",
    howSub: "विभागांची नावे नाहीत. मोठे फॉर्म नाहीत. नियंत्रण तुमच्याकडे.",
    community: "तुमच्या आसपासच्या नागरी समस्या",
    reports: "तुमच्या तक्रारी",
    profile: "तुमचे नागरी नियंत्रण केंद्र",
    area: "तुमचा परिसर निवडा",
  },
};

const readLang = (): Lang => { try { const v = window.localStorage.getItem("ireport.lang"); return v === "hi" || v === "mr" ? v : "en"; } catch { return "en"; } };
const saveLang = (l: Lang) => { try { window.localStorage.setItem("ireport.lang", l); } catch { /* storage unavailable */ } };

function Header({ page, go, goSection, open, lang, setLang, user, logout }: { page: Page; go: (p: Page) => void; goSection: (id: string) => void; open: (category?: string) => void; lang: Lang; setLang: (l: Lang) => void; user: User | null; logout: () => void }) {
  const t = copy[lang];
  const staff = user !== null && user.role !== "citizen";
  const nav: [Page, string][] = !staff
    ? [["home", t.nav[0]], ["community", t.nav[1]], ["reports", t.nav[2]], ["profile", t.nav[3]]]
    : user!.role === "authority" ? [["home", "Home"], ["authority", "Control room"]] : [["home", "Home"], ["admin", "Admin"]];
  const initials = user ? user.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase() : "";
  return <header className="topbar"><div className="nav-shell">
    <button className="brand-button" onClick={() => go("home")} aria-label="iREPORT home"><Brand /></button>
    <nav className="desktop-nav" aria-label="Main navigation">{nav.map(([p, label]) => <button className={page === p ? "active" : ""} onClick={() => go(p)} key={p}>{label}</button>)}{!staff && <><button onClick={() => goSection("how")}>{HOW_UI.navHow[lang]}</button><button onClick={() => goSection("help")}>{HOW_UI.navFaq[lang]}</button></>}</nav>
    <div className="nav-actions"><label className="language"><Icon name="language" size={16} /><select aria-label="Language" value={lang} onChange={e => setLang(e.target.value as Lang)}><option value="en">English</option><option value="hi">हिन्दी</option><option value="mr">मराठी</option></select></label>{!staff && <button className="primary compact" onClick={() => open()}><Icon name="plus" /> <span>{t.report}</span></button>}{user ? <div className="user-chip"><span>{initials}</span><b>{user.name.split(" ")[0]}</b><button onClick={logout} aria-label="Log out"><Icon name="logout" size={16} /><em>Log out</em></button></div> : <button className="secondary compact login-link" onClick={() => go("auth")}>Log in</button>}</div>
  </div></header>;
}

function Reveal({ className = "", id, children }: { className?: string; id?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) { setShown(true); return; }
    const io = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setShown(true); io.disconnect(); } }, { threshold: 0.08, rootMargin: "0px 0px -10% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <section ref={ref} id={id} className={`${className} reveal${shown ? " in" : ""}`}>{children}</section>;
}

function Faq({ lang }: { lang: Lang }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  return <div className="faq-panel"><span className="eyebrow">{HOW_UI.faqEyebrow[lang]}</span><h2>{HOW_UI.faqTitle[lang]}</h2><div className="faq-list">{FAQS.map(([q, a], i) => <div key={q.en} className={`faq-item${openIndex === i ? " open" : ""}`}><button aria-expanded={openIndex === i} onClick={() => setOpenIndex(openIndex === i ? null : i)}><span>{q[lang]}</span><Icon name="plus" size={20} /></button><div className="faq-body"><p>{a[lang]}</p></div></div>)}</div></div>;
}

/** Landing-page guide: what to do, in order, plus tips and what happens afterwards. */
function HowItWorks({ lang, open }: { lang: Lang; open: () => void }) {
  return <div className="how-guide"><span className="eyebrow">{HOW_UI.eyebrow[lang]}</span><h2>{HOW_UI.title[lang]}</h2><p className="how-sub">{HOW_UI.sub[lang]}</p>
    <ol className="how-grid">{HOW_STEPS.map(s => <li key={s.title.en}><span className="how-ico"><Icon name={s.icon as IconName} size={22} /></span><b>{s.title[lang]}</b><p>{s.body[lang]}</p></li>)}</ol>
    <div className="how-cols"><div><h3>{HOW_UI.tips[lang]}</h3><ul>{HOW_TIPS.map(t => <li key={t.en}>{t[lang]}</li>)}</ul></div>
      <div><h3>{HOW_UI.after[lang]}</h3><div className="how-status"><span>{HOW_UI.after1[lang]}</span><i /><span>{HOW_UI.after2[lang]}</span><i /><span>{HOW_UI.after3[lang]}</span><i /><span>{HOW_UI.after4[lang]}</span></div><p>{HOW_UI.afterNote[lang]}</p><button className="primary" onClick={open}><Icon name="camera" /> {HOW_UI.start[lang]}</button></div></div></div>;
}

function BmcOffice() {
  return <aside className="bmc-card" aria-label="BMC head office"><img src={media("bmc-headquarters.jpg")} alt="BMC headquarters building at Fort, Mumbai" /><div className="bmc-card-body"><span className="eyebrow">BMC HEAD OFFICE</span><h3>Brihanmumbai Municipal Corporation</h3><div className="bmc-row"><span><Icon name="pin" size={18} /></span><p><b>Headquarters</b>Mahapalika Marg, opposite CSMT, Fort, Mumbai 400001</p></div><div className="bmc-row"><span><Icon name="phone" size={18} /></span><p><b>Civic helpline · 24x7</b>1916 &nbsp;·&nbsp; Head office: 022 2275 4000</p></div><div className="bmc-row"><span><Icon name="map" size={18} /></span><p><b>Ward offices</b>Local complaints are handled by your ward office. Find yours at mcgm.gov.in.</p></div><div className="bmc-actions"><a className="primary" href={bmcMapsUrl} target="_blank" rel="noreferrer"><Icon name="map" size={18} /> Get directions</a><a className="secondary" href="tel:1916"><Icon name="phone" size={18} /> Call 1916</a></div></div></aside>;
}

function CategoryCard({ card, lang, onClick, i }: { card: (typeof homeCards)[number]; lang: Lang; onClick: () => void; i: number }) {
  const [ok, setOk] = useState(true);
  const label = tr(lang, card.key), desc = tr(lang, card.key.replace("cat_", "catd_") as StrKey);
  // The artwork is mixed (photos and illustrations): each sits in a tinted panel and is blended into it so the set looks uniform.
  return <button onClick={onClick} className={`cat-card tone-${card.tone}`} style={{ "--i": i } as React.CSSProperties} aria-label={`${tr(lang, "catReport")}: ${label}`}>
    <span className="cat-media">
      {ok ? <img src={`${import.meta.env.BASE_URL}categories/${card.file}`} alt="" loading="lazy" width={400} height={250} onError={() => setOk(false)} /> : <span className="cat-fallback" aria-hidden="true"><Icon name={card.icon} size={44} /></span>}
      <span className="cat-badge" aria-hidden="true"><Icon name={card.icon} size={20} /></span>
    </span>
    <span className="cat-body">
      <span className="cat-text"><b>{label}</b><small>{desc}</small></span>
      <span className="cat-cta" aria-hidden="true"><Icon name="arrow" size={18} /></span>
    </span>
  </button>;
}

function Home({ open, go, lang }: { open: (category?: string) => void; go: (p: Page) => void; lang: Lang }) {
  const t = copy[lang];
  return <main>
    <section className="section hero">
      <div className="hero-copy"><h1>{t.hero}</h1><div className="cta-row"><button className="primary large" onClick={() => open()}><Icon name="camera" />{t.start}<Icon name="arrow" /></button><button className="secondary large" onClick={() => go("community")}>{t.explore}</button></div></div>
      <div className="hero-visual"><img src={media("bmc-headquarters.jpg")} alt="Brihanmumbai Municipal Corporation headquarters, Fort, Mumbai" /><div className="location-pill"><Icon name="pin" size={16} /> Fort, Mumbai</div></div>
    </section>
    <Reveal className="section category-section"><div className="section-heading cat-heading"><div><span className="eyebrow">{tr(lang, "catEyebrow")}</span><h2>{t.what}</h2></div><p>{t.whatSub}</p></div><div className="cat-grid" role="list">{homeCards.map((c, i) => <CategoryCard key={c.key} card={c} i={i} lang={lang} onClick={() => open(c.flow)} />)}</div></Reveal>
    <Reveal id="how" className="section how-section"><HowItWorks lang={lang} open={() => open()} /></Reveal>
    <Reveal id="help" className="section help-section"><Faq lang={lang} /><BmcOffice /></Reveal>
    <Reveal className="section final-cta"><div><span>READY WHEN YOU ARE</span><h2>Help Mumbai notice what matters.</h2></div><button className="primary large" onClick={() => open()}>Report a problem <Icon name="arrow" /></button></Reveal>
  </main>;
}

/** A real incident from the community feed. */
function IncidentCard({ title, area, type, affected, image, severity, status, confirmed = false, busy = false, onConfirm, sample = null, lang = "en" }: { title: string; area: string; type: string; affected: number; image: string | null; severity: string; status: string; confirmed?: boolean; busy?: boolean; onConfirm?: () => void; sample?: number | null; lang?: Lang }) {
  const share = () => { const text = `${title} · ${area}`; if (navigator.share) navigator.share({ title: "iREPORT", text }).catch(() => {}); else navigator.clipboard?.writeText(text).catch(() => {}); };
  return <article className="incident-card">{image ? <img src={image} alt="Civic incident evidence" loading="lazy" /> : <div className="no-photo"><Icon name="camera" size={26} /><small>No photo</small></div>}<div className="incident-body">{sample != null && <span className="sample-badge" title={tr(lang, "exampleBadge")}>{tr(lang, "exampleBadge")} · {tr(lang, "exampleConf")} {Math.round(sample * 100)}%</span>}<div className="incident-top"><span>{type}</span><b>{severity}</b></div><h3>{title}</h3><p><Icon name="pin" size={16} /> {area}</p><div className="signal"><strong>{affected}</strong><span>citizens affected</span><b>{status}</b></div><div className="incident-actions"><button className={confirmed ? "confirmed" : ""} disabled={busy} onClick={onConfirm}><Icon name={confirmed ? "check" : "heart"} /> {confirmed ? "Confirmed" : "Like / Confirm"}</button><button onClick={share}><Icon name="share" /> Share</button></div></div></article>;
}

const COMMUNITY_FILTERS: Record<string, { category?: string; status?: string; radius: number }> = {
  Nearby: { radius: 2000 }, All: { radius: 50000 }, Potholes: { category: "Pothole", radius: 25000 },
  Streetlights: { category: "Streetlight", radius: 25000 }, Garbage: { category: "Garbage", radius: 25000 }, Water: { category: "Water Leakage", radius: 25000 },
  Electrical: { category: "Electrical Hazard", radius: 25000 },
  Pending: { status: "Reported,Under Review", radius: 25000 }, "In Progress": { status: "In Progress", radius: 25000 }, Resolved: { status: "Resolved", radius: 25000 },
};
const COMMUNITY_SORT: Record<string, string> = { Nearest: "nearest", Recent: "recent", "Most affected": "affected", "High severity": "severity" };

function Community({ lang, user, go, defaultArea }: { lang: Lang; user: User | null; go: (p: Page) => void; defaultArea: string }) {
  const t = copy[lang]; const qc = useQueryClient();
  const [area, setArea] = useState(defaultArea); const [filter, setFilter] = useState("Nearby"); const [sort, setSort] = useState("Nearest");
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null); const [locNote, setLocNote] = useState("");
  const centre = here ?? AREA_CENTRES[area] ?? null;
  const f = COMMUNITY_FILTERS[filter];
  const key = ["community", centre?.lat, centre?.lng, filter, sort, user?.id ?? "guest"];
  const feed = useInfiniteQuery({
    queryKey: key, enabled: !!centre, initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.nearby({ lat: centre!.lat, lng: centre!.lng, radius: f.radius, category: f.category, status: f.status, sort: COMMUNITY_SORT[sort], cursor: pageParam }),
    getNextPageParam: last => last.next_cursor ?? undefined,
  });
  const confirm = useMutation({
    mutationFn: (i: IncidentPublic) => (i.confirmed_by_me ? api.unconfirm(i.id) : api.confirm(i.id)),
    onMutate: async (i: IncidentPublic) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<InfiniteData<ApiPage<IncidentPublic>>>(key);
      qc.setQueryData<InfiniteData<ApiPage<IncidentPublic>>>(key, d => d && { ...d, pages: d.pages.map(p => ({ ...p, items: p.items.map(x => x.id === i.id ? { ...x, confirmed_by_me: !x.confirmed_by_me, affected_count: x.affected_count + (x.confirmed_by_me ? -1 : 1) } : x) })) });
      return { previous };
    },
    onError: (_e, _i, ctx) => { if (ctx?.previous) qc.setQueryData(key, ctx.previous); },
    onSuccess: (res, i) => qc.setQueryData<InfiniteData<ApiPage<IncidentPublic>>>(key, d => d && { ...d, pages: d.pages.map(p => ({ ...p, items: p.items.map(x => x.id === i.id ? { ...x, confirmed_by_me: res.confirmed, affected_count: res.affected_count } : x) })) }),
  });
  const locate = () => {
    if (!navigator.geolocation) { setLocNote(tr(lang, "cmNoLocation")); return; }
    setLocNote(tr(lang, "cmLocating"));
    navigator.geolocation.getCurrentPosition(p => { setHere({ lat: p.coords.latitude, lng: p.coords.longitude }); setLocNote(""); }, () => setLocNote("Could not get your location. Choose an area instead."), { timeout: 10000, maximumAge: 60000 });
  };
  const pickArea = (v: string) => { setArea(v); setHere(null); };
  const items = feed.data?.pages.flatMap(p => p.items) ?? [];
  const onConfirm = (i: IncidentPublic) => { if (!user) { go("auth"); return; } if (user.role !== "citizen" || i.reported_by_me) return; confirm.mutate(i); };
  const where = here ? "your location" : area;
  return <main className="page section"><div className="page-heading"><div><span className="eyebrow">COMMUNITY</span><h1>{t.community}</h1><p>Location → incident → evidence → community signal → authority action.</p></div></div>
    <div className="area-bar"><div><small>{t.area}</small><label><Icon name="search" /><input aria-label="Search area" list="area-list" value={here ? "Your location" : area} onChange={e => pickArea(AREAS.find(a => a.toLowerCase() === e.target.value.trim().toLowerCase()) ?? e.target.value)} /><datalist id="area-list">{AREAS.map(a => <option key={a} value={a} />)}</datalist></label></div><button className="secondary" onClick={locate}><Icon name="pin" /> Use my location</button><select value={AREAS.includes(area) ? area : ""} onChange={e => pickArea(e.target.value)}>{!AREAS.includes(area) && <option value="">Choose an area</option>}{AREAS.map(a => <option key={a}>{a}</option>)}</select></div>
    {locNote && <p className="muted-line">{locNote}</p>}
    <div className="filter-row"><div>{Object.keys(COMMUNITY_FILTERS).map(x => <button key={x} className={filter === x ? "active" : ""} onClick={() => setFilter(x)}>{x}</button>)}</div><select aria-label="Sort incidents" value={sort} onChange={e => setSort(e.target.value)}>{Object.keys(COMMUNITY_SORT).map(s => <option key={s}>{s}</option>)}</select></div>
    {!centre && <div className="empty-note"><Icon name="search" /><span><b>{tr(lang, "cmChoose")}</b><small>{tr(lang, "cmChooseHelp")}</small></span></div>}
    {feed.isPending && centre && <div className="incident-grid">{[0, 1, 2].map(k => <div key={k} className="incident-card skeleton-card"><div className="skeleton-block tall" /><div className="incident-body"><div className="skeleton-line w50" /><div className="skeleton-line w90" /><div className="skeleton-line w60" /></div></div>)}</div>}
    {feed.isError && <div className="empty-note error"><Icon name="alert" /><span><b>{tr(lang, "cmLoadError")}</b><small>{(feed.error as Error).message}</small></span><button className="secondary compact" onClick={() => feed.refetch()}>{tr(lang, "rpRetry")}</button></div>}
    {items.length > 0 && <div className="incident-grid">{items.map(i => <IncidentCard key={i.id} title={i.title} area={[i.area ?? "Mumbai", distanceLabel(i.distance_m)].filter(Boolean).join(" · ")} type={i.category.toUpperCase()} affected={i.affected_count} image={i.thumb_url} severity={`${severityName(lang, i.severity).toUpperCase()} ${tr(lang, "rpSeverity").toUpperCase()}`} status={statusLabel(i.status)} confirmed={!!i.confirmed_by_me || !!i.reported_by_me} busy={confirm.isPending && confirm.variables?.id === i.id} onConfirm={() => onConfirm(i)} sample={i.sample_confidence ?? null} lang={lang} />)}</div>}
    {feed.hasNextPage && <button className="secondary load-more" onClick={() => feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>{feed.isFetchingNextPage ? tr(lang, "rpLoading") : tr(lang, "cmMore")}</button>}
    {confirm.isError && <div className="form-error" role="alert"><Icon name="alert" size={16} /> {(confirm.error as Error).message}</div>}
    {items.some(i => i.sample_confidence != null) && <p className="muted-line sample-note">{tr(lang, "ad_samples")}</p>}
    {feed.isSuccess && <div className="empty-note"><Icon name="check" /><span><b>{items.length ? `Showing civic incidents for ${where}.` : `No civic incidents found for ${where}.`}</b><small>{tr(lang, "cmChangeFilters")}</small></span></div>}
  </main>;
}

function ReplyBox({ incidentId }: { incidentId: string }) {
  const qc = useQueryClient(); const [text, setText] = useState("");
  const send = useMutation({ mutationFn: () => api.reply(incidentId, text.trim()), onSuccess: () => { setText(""); qc.invalidateQueries({ queryKey: ["reports", "mine"] }); } });
  return <div className="reply-box"><textarea value={text} maxLength={1000} rows={2} onChange={e => setText(e.target.value)} placeholder="Reply to the authority (optional)" aria-label="Reply to the authority" /><button className="secondary compact" disabled={!text.trim() || send.isPending} onClick={() => send.mutate()}>{send.isPending ? "Sending…" : "Send reply"}</button>{send.isError && <small className="err">{(send.error as Error).message}</small>}</div>;
}

function Reports({ lang, user, open, go }: { lang: Lang; user: User | null; open: (category?: string) => void; go: (p: Page) => void }) {
  const mine = useInfiniteQuery({
    queryKey: ["reports", "mine", user?.id], enabled: user?.role === "citizen", initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.myReports(pageParam), getNextPageParam: last => last.next_cursor ?? undefined,
    refetchInterval: 60_000,
  });
  const items = mine.data?.pages.flatMap(p => p.items) ?? [];
  const fmt = (ts: string) => new Date(ts).toLocaleString(lang === "en" ? "en-IN" : lang === "hi" ? "hi-IN" : "mr-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return <main className="page section"><div className="page-heading"><div><span className="eyebrow">MY REPORTS</span><h1>{copy[lang].reports}</h1><p>{tr(lang, "rpOnlyYours")}</p></div><button className="primary" onClick={() => open()}><Icon name="plus" /> {tr(lang, "rpNewReport")}</button></div>
    {!user && <div className="empty-note"><Icon name="shield" /><span><b>{tr(lang, "rpLogin")}</b><small>{tr(lang, "rpLoginHelp")}</small></span><button className="primary compact" onClick={() => go("auth")}>{tr(lang, "rpLoginBtn")}</button></div>}
    {user && mine.isPending && [0, 1].map(k => <div className="report-shell skeleton-card" key={k} style={{ marginBottom: 18 }}><div className="report-summary"><div className="skeleton-block thumb" /><div style={{ flex: 1 }}><div className="skeleton-line w50" /><div className="skeleton-line w90" /><div className="skeleton-line w60" /></div></div></div>)}
    {user && mine.isError && <div className="empty-note error"><Icon name="alert" /><span><b>{tr(lang, "rpLoadError")}</b><small>{(mine.error as Error).message}</small></span><button className="secondary compact" onClick={() => mine.refetch()}>{tr(lang, "rpRetry")}</button></div>}
    {user && mine.isSuccess && items.length === 0 && <div className="empty-note"><Icon name="check" /><span><b>{tr(lang, "rpEmpty")}</b><small>{tr(lang, "rpEmptyHelp")}</small></span></div>}
    {items.map(i => <div className="report-shell" key={i.report_id} style={{ marginBottom: 18 }}><div className="report-summary">{i.thumb_url ? <img src={i.thumb_url} alt="Report evidence" loading="lazy" /> : <div className="no-photo"><Icon name="camera" size={22} /><small>{tr(lang, "rpNoPhoto")}</small></div>}<div><span className={`pill st-${i.status.toLowerCase().replace(" ", "-")}`}>{statusName(lang, i.status).toUpperCase()}</span><h3>{i.title}</h3><p><Icon name="pin" size={15} /> {i.area ?? "Mumbai"}{i.department ? ` · ${i.department}` : ""}{i.affected_count > 1 ? ` · ${i.affected_count} ${tr(lang, "rpAffected")}` : ""}</p><small>{i.public_id} · {fmt(i.created_at)} · {severityName(lang, i.severity)} {tr(lang, "rpSeverity")}</small></div></div>
      <div className="timeline t4">{STATUSES.map((x, k) => { const reached = k <= STATUSES.indexOf(i.status); const at = [...i.history].reverse().find(h => h.status === x)?.at; return <div className={reached ? "done" : ""} key={x}><span>{reached && <Icon name="check" size={14} />}</span><b>{statusName(lang, x)}</b><small>{reached && at ? fmt(at) : reached ? tr(lang, "rpDone") : tr(lang, "rpWaiting")}</small></div>; })}</div>
      {i.messages.length > 0 && <div className="thread">{i.messages.map(m => <div key={m.id} className={`msg ${m.from}`}><small>{m.from === "authority" ? `${tr(lang, "rpFromAuthority")} ${m.by}` : m.by === "You" ? tr(lang, "rpYourReply") : m.by}</small><p>{m.text}</p></div>)}</div>}
      {i.messages.some(m => m.from === "authority") && <ReplyBox incidentId={i.incident_id} />}
      <div className="resolution-note"><Icon name="shield" /><p><b>{tr(lang, "rpResolvedNote")}</b><br />{tr(lang, "rpResolvedHelp")}</p></div></div>)}
    {mine.hasNextPage && <button className="secondary load-more" onClick={() => mine.fetchNextPage()} disabled={mine.isFetchingNextPage}>{mine.isFetchingNextPage ? tr(lang, "rpLoading") : tr(lang, "rpOlder")}</button>}
  </main>;
}

function PrivacyPanel({ onDeleted }: { onDeleted: () => void }) {
  const [msg, setMsg] = useState("");
  const download = async () => {
    setMsg("");
    try {
      const data = await api.exportMe();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = "ireport-my-data.json"; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setMsg((e as Error).message); }
  };
  const remove = async () => {
    if (!window.confirm("Delete your account? Your name, email and phone are removed. Reports stay, without your identity. This cannot be undone.")) return;
    try { await api.deleteMe(); onDeleted(); } catch (e) { setMsg((e as Error).message); }
  };
  return <div className="privacy-panel"><p>iREPORT keeps your name, email, optional phone and area so authorities can act on your reports. Photos are stored compressed with location metadata removed.</p><div className="admin-actions"><button className="secondary compact" onClick={download}>Download my data</button><button className="secondary compact danger" onClick={remove}>Delete my account</button></div>{msg && <small className="err">{msg}</small>}</div>;
}

function Profile({ lang, setLang, go, goFaq, user, logout }: { lang: Lang; setLang: (l: Lang) => void; go: (p: Page) => void; goFaq: () => void; user: User | null; logout: () => void }) {
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const unread = useQuery({ queryKey: ["messages", "unread", user?.id], queryFn: api.unread, enabled: user?.role === "citizen", refetchInterval: 60_000 });
  const contrib = useQuery({ queryKey: ["summary", user?.id], queryFn: api.summary, enabled: user?.role === "citizen", refetchInterval: 60_000 });
  const latest = useQuery({ queryKey: ["reports", "latest", user?.id], queryFn: () => api.myReports(), enabled: user?.role === "citizen", refetchInterval: 60_000 });
  const items: [IconName, string, string][] = [["reports", "My Reports", "View your submissions"], ["logout", user ? "Log out" : "Log in / Register", user ? user.email : "Citizen, authority or admin"], ["heart", "Saved / Followed Issues", "Coming soon"], ["bell", "Notifications", unread.data ? (unread.data.unread ? `${unread.data.unread} new message${unread.data.unread > 1 ? "s" : ""}` : "No new messages") : "On"], ["language", "Language", lang === "en" ? "English" : lang === "hi" ? "हिन्दी" : "मराठी"], ["shield", "Privacy & Account", "Manage your data"], ["help", "Help & FAQ", "Get clear answers"]];
  const click = (title: string) => {
    if (title === "Help & FAQ") goFaq(); else if (title === "My Reports" || title === "Notifications") go("reports"); else if (title === "Log out") logout(); else if (title === "Log in / Register") go("auth");
    else if (title === "Privacy & Account") { if (user) setPrivacyOpen(o => !o); else go("auth"); }
  };
  return <main className="page section"><div className="page-heading"><div><span className="eyebrow">{tr(lang, "pfEyebrow")}</span><h1>{copy[lang].profile}</h1><p>{tr(lang, "pfIntro")}</p></div></div><div className="profile-layout"><section className="profile-card"><div className="person"><span>{user ? user.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase() : "?"}</span><div><h3>{user ? user.name : "Guest"}</h3><p>{user ? user.email : "You are not logged in"}</p>{user && <p>{tr(lang, "homeArea")}: <b>{user.area ?? "—"}</b></p>}</div></div>
    {user?.role === "citizen" && <div className="contrib-card"><h3>{tr(lang, "contribution")}</h3>{contrib.isPending ? <p className="muted-line">…</p> : contrib.isError ? <p className="muted-line">{(contrib.error as Error).message} <button className="text-button" onClick={() => contrib.refetch()}>Retry</button></p> : <div className="contrib-grid"><div><b>{contrib.data.reports_submitted}</b><small>{tr(lang, "submitted")}</small></div><div><b>{contrib.data.incidents_resolved}</b><small>{tr(lang, "resolvedCount")}</small></div><div><b>{contrib.data.confirmations_received}</b><small>{tr(lang, "confirmsReceived")}</small></div></div>}{contrib.data?.level && <p className="contrib-label"><Icon name="shield" size={15} /> {tr(lang, contrib.data.level === "trusted" ? "levelTrusted" : "levelContributor")}</p>}</div>}
    {user?.role === "citizen" && <div className="contrib-card"><h3>{tr(lang, "myLatest")}</h3>{latest.isPending && <p className="muted-line">…</p>}{latest.isError && <p className="muted-line">{(latest.error as Error).message} <button className="text-button" onClick={() => latest.refetch()}>Retry</button></p>}{latest.isSuccess && latest.data.items.length === 0 && <p className="muted-line">{tr(lang, "noReports")}</p>}{latest.data?.items.slice(0, 3).map(r => <button className="mini-report" key={r.report_id} onClick={() => go("reports")}>{r.thumb_url ? <img src={r.thumb_url} alt="Report evidence" loading="lazy" /> : <span className="mini-nophoto"><Icon name="camera" size={16} /></span>}<span><b>{r.title}</b><small>{r.public_id} · {r.area ?? "Mumbai"}</small></span><span className={`pill st-${r.status.toLowerCase().replace(" ", "-")}`}>{statusName(lang, r.status).toUpperCase()}</span></button>)}</div>}{items.map(([icon, title, meta]) => <div key={title}><button onClick={() => click(title)}><span><Icon name={icon} /></span><b>{menuText(lang, title)}</b><small>{menuText(lang, meta)}</small><Icon name="arrow" /></button>{title === "Privacy & Account" && privacyOpen && user && <PrivacyPanel onDeleted={logout} />}</div>)}<div className="inline-language"><button className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>English</button><button className={lang === "hi" ? "active" : ""} onClick={() => setLang("hi")}>हिन्दी</button><button className={lang === "mr" ? "active" : ""} onClick={() => setLang("mr")}>मराठी</button></div></section><section className="utility"><div className="service-card"><div><span className="eyebrow">NEARBY CIVIC SERVICES</span><h2>Find official help nearby</h2><p>Verified listings appear only when connected to an official data source.</p></div><button className="secondary"><Icon name="pin" /> Use my location</button><div className="service-row"><span><Icon name="phone" /></span><div><b>Emergency services</b><small>National emergency response · Official</small></div><strong>112</strong><button>Call</button></div></div></section></div></main>;
}

function MobileNav({ page, go, open, lang, user, logout }: { page: Page; go: (p: Page) => void; open: (category?: string) => void; lang: Lang; user: User | null; logout: () => void }) {
  if (user && user.role !== "citizen") {
    const dash: Page = user.role === "admin" ? "admin" : "authority";
    return <nav className="mobile-nav staff"><button className={page === "home" ? "active" : ""} onClick={() => go("home")}><Icon name="home" /><span>Home</span></button><button className={page === dash ? "active" : ""} onClick={() => go(dash)}><Icon name="reports" /><span>{user.role === "admin" ? "Admin" : "Control room"}</span></button><button onClick={logout}><Icon name="logout" /><span>Log out</span></button></nav>;
  }
  const pages: [Page, IconName, string][] = [["home", "home", copy[lang].nav[0]], ["community", "community", copy[lang].nav[1]], ["reports", "reports", copy[lang].nav[2]], ["profile", "profile", copy[lang].nav[3]]];
  return <nav className="mobile-nav">{pages.slice(0, 2).map(([p, icon, label]) => <button className={page === p ? "active" : ""} key={p} onClick={() => go(p)}><Icon name={icon} /><span>{label}</span></button>)}<button className="mobile-report" onClick={() => open()}><i><Icon name="plus" /></i><b>Report</b></button>{pages.slice(2).map(([p, icon, label]) => <button className={page === p ? "active" : ""} key={p} onClick={() => go(p)}><Icon name={icon} /><span>{label}</span></button>)}</nav>;
}

export default function App() {
  const qc = useQueryClient();
  const [page, setPage] = useState<Page>("home"), [lang, setLangState] = useState<Lang>(readLang);
  // The report flow stays mounted while hidden, so closing it (or pressing Escape) never loses the draft.
  const [flow, setFlow] = useState<"none" | "open" | "hidden">("none"), [flowCategory, setFlowCategory] = useState<string | undefined>(undefined), [flowKey, setFlowKey] = useState(0);
  const [user, setUser] = useState<User | null>(null), [booting, setBooting] = useState(true);
  const [afterLogin, setAfterLogin] = useState(false);
  const go = (p: Page) => { setPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const goSection = (id: string) => { setPage("home"); window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80); };
  const goFaq = () => { setPage("home"); window.setTimeout(() => document.getElementById("help")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80); };

  const endSession = useCallback(() => { setToken(null); setUser(null); setFlow("none"); qc.clear(); }, [qc]);
  useEffect(() => {
    setSessionLostHandler(() => { endSession(); setPage("auth"); });
    refreshSession().then(s => { if (s) setUser(s.user); }).finally(() => setBooting(false)); // restore the session from the refresh cookie
  }, [endSession]);

  const setLang = (l: Lang) => { setLangState(l); saveLang(l); if (user) api.patchMe({ lang: l }).then(setUser).catch(() => {}); };
  const openReport = (category?: string) => {
    if (!user) { setAfterLogin(true); go("auth"); return; }
    if (user.role !== "citizen") { go(user.role === "admin" ? "admin" : "authority"); return; }
    if (flow === "none") { setFlowCategory(category); setFlowKey(k => k + 1); } // a hidden draft is resumed as it was
    setFlow("open");
  };
  const handleLogin = (s: Session) => {
    setToken(s.access_token); setUser(s.user);
    if (s.user.lang && s.user.lang !== lang) { setLangState(s.user.lang); saveLang(s.user.lang); }
    if (s.user.role === "admin") go("admin");
    else if (s.user.role === "authority") go("authority");
    else if (afterLogin) { go("home"); setFlowCategory(undefined); setFlowKey(k => k + 1); setFlow("open"); }
    else go("home");
    setAfterLogin(false);
  };
  const logout = () => { api.logout(); endSession(); go("home"); };
  const view: Page = !booting && ((page === "authority" && user?.role !== "authority") || (page === "admin" && user?.role !== "admin")) ? "auth" : page;
  const area = user?.area ?? AREAS[0]; // home area: only the starting point of the Community feed, never a report location
  return <div><Header page={view} go={go} goSection={goSection} open={openReport} lang={lang} setLang={setLang} user={user} logout={logout} />
    {view === "home" && <Home open={openReport} go={go} lang={lang} />}
    {view === "community" && <Community lang={lang} user={user} go={go} defaultArea={area} />}
    {view === "reports" && <Reports lang={lang} user={user} open={openReport} go={go} />}
    {view === "profile" && <Profile lang={lang} setLang={setLang} go={go} goFaq={goFaq} user={user} logout={logout} />}
    {view === "auth" && <AuthPage onLogin={handleLogin} bmcImage={`${import.meta.env.BASE_URL}media/bmc-headquarters.jpg`} />}
    {view === "authority" && user && <AuthorityDashboard user={user} lang={lang} />}
    {view === "admin" && user && <AdminPanel lang={lang} />}
    <MobileNav page={view} go={go} open={openReport} lang={lang} user={user} logout={logout} />
    {flow !== "none" && user && <Suspense fallback={<div className="modal-backdrop"><div className="report-modal loading-modal" role="status">Loading…</div></div>}><ReportFlow key={flowKey} open={flow === "open"} initialCategory={flowCategory} lang={lang} close={() => setFlow("hidden")} discard={() => { setFlow("none"); }} done={() => { setFlow("none"); qc.invalidateQueries({ queryKey: ["reports"] }); qc.invalidateQueries({ queryKey: ["contribution"] }); qc.invalidateQueries({ queryKey: ["community"] }); go("reports"); }} /></Suspense>}
    <footer><div className="section"><Brand /><p>See it → Select it → Capture it → Locate it → Confirm it → Report it → Track it.</p><small>Independent civic platform for Metropolitan Mumbai · Not an official BMC website</small></div></footer></div>;
}

