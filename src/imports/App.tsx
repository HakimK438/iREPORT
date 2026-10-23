import { useState } from "react";

const photos = {
  hero: "https://images.unsplash.com/photo-1751973399253-3d6051abe2ad?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&q=88&w=1600",
  street: "https://images.unsplash.com/photo-1726412181666-1209c2b65f14?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&q=85&w=1200",
  road: "https://images.unsplash.com/photo-1754229291643-3d909826a460?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&q=85&w=1000",
  traffic: "https://images.unsplash.com/photo-1726412182956-f2fe45cd220d?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&q=85&w=1000",
  worker: "https://images.unsplash.com/photo-1648662594772-786f95b9e58b?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&q=85&w=1000",
};

type IconName =
  | "arrow" | "camera" | "check" | "chevron" | "clock" | "community"
  | "home" | "light" | "location" | "map" | "mic" | "plus" | "profile"
  | "reports" | "search" | "share" | "spark" | "up" | "water" | "waste";

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    camera: <><path d="M14.5 6 13 4H7L5.5 6H3v13h18V6z" /><circle cx="12" cy="12.5" r="4" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    community: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2" /><path d="M3 19c0-3 2.5-5 6-5s6 2 6 5M15 15c3 0 5 1.5 5 4" /></>,
    home: <><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></>,
    light: <><path d="M9 18h6M10 22h4" /><path d="M8.5 14.5A7 7 0 1 1 15.5 14.5L14 17h-4z" /></>,
    location: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z" /><path d="M9 3v15M15 6v15" /></>,
    mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    reports: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></>,
    share: <><circle cx="18" cy="5" r="2" /><circle cx="6" cy="12" r="2" /><circle cx="18" cy="19" r="2" /><path d="m8 11 8-5M8 13l8 5" /></>,
    spark: <><path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z" /><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z" /></>,
    up: <><path d="m12 4 7 8h-4v8H9v-8H5z" /></>,
    water: <path d="M12 3S6 10 6 15a6 6 0 0 0 12 0c0-5-6-12-6-12Z" />,
    waste: <><path d="M5 7h14M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" /></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function Logo() {
  return <button className="logo" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="iREPORT home"><span>i</span>REPORT<i /></button>;
}

const categories = [
  { name: "Pothole", icon: "location" as IconName, image: photos.road },
  { name: "Road damage", icon: "reports" as IconName, image: photos.traffic },
  { name: "Streetlight", icon: "light" as IconName, image: photos.street },
  { name: "Garbage", icon: "waste" as IconName, image: photos.worker },
  { name: "Water leakage", icon: "water" as IconName, image: photos.hero },
  { name: "Drainage", icon: "map" as IconName, image: photos.road },
];

function Header({ page, setPage, openReport }: { page: string; setPage: (p: string) => void; openReport: () => void }) {
  return <header className="topbar">
    <div className="nav-wrap">
      <Logo />
      <nav className="desktop-nav" aria-label="Main navigation">
        {["Home", "Community", "My Reports"].map(item => <button key={item} className={page === item.toLowerCase().replace(" ", "-") ? "active" : ""} onClick={() => setPage(item.toLowerCase().replace(" ", "-"))}>{item}</button>)}
        <button onClick={() => { setPage("home"); setTimeout(() => document.querySelector("#how")?.scrollIntoView({ behavior: "smooth" }), 50); }}>How it works</button>
      </nav>
      <div className="nav-actions"><button className="login">Log in</button><button className="primary compact" onClick={openReport}><Icon name="plus" size={18} /> Report a problem</button></div>
    </div>
  </header>;
}

function Landing({ openReport, setPage }: { openReport: () => void; setPage: (p: string) => void }) {
  return <main>
    <section className="hero section">
      <div className="hero-copy">
        <div className="eyebrow"><Icon name="spark" size={16} /> Made for Mumbai</div>
        <div className="display">See something wrong?<br /><em>Report it in seconds.</em></div>
        <p className="lead">Snap a photo. Tell us what you saw. iREPORT understands the problem and helps you track what happens next.</p>
        <div className="cta-row">
          <button className="primary large" onClick={openReport}><Icon name="camera" /> Report a problem <Icon name="arrow" /></button>
          <button className="secondary large" onClick={() => setPage("community")}>Explore community</button>
        </div>
        <div className="trust-row"><div className="avatars"><span>AK</span><span>NS</span><span>RM</span></div><p><b>1,248 citizens</b><br />making Andheri better</p></div>
      </div>
      <div className="hero-visual">
        <img src={photos.hero} alt="People walking on a Mumbai street during monsoon" />
        <div className="location-pill"><Icon name="location" size={16} /> Andheri West, Mumbai</div>
        <div className="detect-card">
          <div className="detect-top"><span className="ai-icon"><Icon name="spark" size={18} /></span><span>iREPORT found</span><b>87%</b></div>
          <div className="detect-title"><span /> Pothole detected</div>
          <div className="detect-meta"><span>High severity</span><span>Reported</span></div>
        </div>
      </div>
    </section>

    <section className="notice section">
      <div><span className="pulse" /><b>Near you now</b><p>27 active issues in Andheri West</p></div>
      <button onClick={() => setPage("community")}>See what’s happening <Icon name="arrow" size={18} /></button>
    </section>

    <section className="section categories-section">
      <div className="section-head"><div><div className="eyebrow muted">QUICK REPORT</div><div className="title">What did you notice?</div><p>Choose the closest match. You can change it later.</p></div><button className="text-button" onClick={openReport}>See all categories <Icon name="arrow" size={18} /></button></div>
      <div className="category-grid">
        {categories.map((cat, i) => <button className="category-card" key={cat.name} onClick={openReport}>
          <img src={cat.image} alt="" /><span className="shade" /><span className="cat-icon"><Icon name={cat.icon} /></span><span className="cat-label">{cat.name}</span><span className="cat-arrow"><Icon name="arrow" size={18} /></span>{i === 0 && <span className="popular">POPULAR</span>}
        </button>)}
        <button className="category-more" onClick={openReport}><span><Icon name="plus" size={26} /></span><b>Something else</b><small>We’ll help identify it</small></button>
      </div>
    </section>

    <section id="how" className="how-section">
      <div className="section how-inner">
        <div className="how-copy"><div className="eyebrow light">HOW IT WORKS</div><div className="title light-title">From “I saw it”<br />to “It’s reported.”</div><p>Three simple steps. No forms, no departments, no confusing terminology.</p><button className="light-button" onClick={openReport}>Start a report <Icon name="arrow" /></button></div>
        <div className="steps">
          <div className="step active-step"><span>01</span><div className="step-icon"><Icon name="camera" size={28} /></div><div><b>Capture it</b><p>Take a photo or tell us what happened.</p></div></div>
          <div className="step"><span>02</span><div className="step-icon"><Icon name="spark" size={28} /></div><div><b>Confirm it</b><p>Review what iREPORT understood.</p></div></div>
          <div className="step"><span>03</span><div className="step-icon"><Icon name="clock" size={28} /></div><div><b>Track it</b><p>Follow clear updates through resolution.</p></div></div>
        </div>
      </div>
    </section>

    <section className="section community-preview">
      <div className="section-head"><div><div className="eyebrow muted">YOUR NEIGHBOURHOOD</div><div className="title">Mumbai, seen by its people.</div><p>Real issues. Real updates. Right around you.</p></div><button className="secondary" onClick={() => setPage("community")}>Explore community</button></div>
      <div className="community-grid">
        <div className="map-card">
          <div className="map-head"><b>Problems around you</b><span><span className="live-dot" /> Live</span></div>
          <div className="fake-map"><div className="road r1" /><div className="road r2" /><div className="road r3" /><div className="road r4" /><span className="marker red m1"><Icon name="location" /></span><span className="marker amber m2"><Icon name="location" /></span><span className="marker green m3"><Icon name="location" /></span><span className="marker red m4"><Icon name="location" /></span><div className="map-label ml1">Andheri West</div><div className="map-label ml2">Jogeshwari</div></div>
          <button className="map-link" onClick={() => setPage("community")}><Icon name="map" /> Open community map <Icon name="arrow" /></button>
        </div>
        <article className="feed-card"><div className="feed-user"><span className="avatar">AR</span><div><b>Aarav R.</b><p>Andheri West · 2h ago</p></div><span className="status pending">Pending</span></div><img src={photos.road} alt="Wet Mumbai street with a road issue" /><div className="feed-body"><div className="severity">HIGH SEVERITY</div><h3>Large pothole near the main junction</h3><p className="place"><Icon name="location" size={16} /> Link Road, Andheri West</p><div className="feed-actions"><button><Icon name="up" size={18} /> <b>23</b> affected</button><button><Icon name="community" size={18} /> 8</button><button aria-label="Share"><Icon name="share" size={18} /></button></div><button className="same-problem">I have the same problem</button></div></article>
      </div>
    </section>

    <section className="closing"><div className="section closing-inner"><div><div className="title light-title">Your city. Your voice.<br /><em>Your report.</em></div><p>See it. Report it. Track it. Together.</p></div><button className="white-button" onClick={openReport}><Icon name="camera" /> Report a problem</button></div></section>
  </main>;
}

function Community() {
  const [tab, setTab] = useState("Nearby");
  return <main className="page section">
    <div className="page-heading"><div><div className="eyebrow muted">COMMUNITY</div><div className="title">See what’s happening around you.</div><p>Local reports, updates and progress from your neighbourhood.</p></div><button className="location-select"><Icon name="location" /> Andheri West <Icon name="chevron" /></button></div>
    <div className="search"><Icon name="search" /><input aria-label="Search problems" placeholder="Search problems near you…" /><span>Try “potholes near me”</span></div>
    <div className="community-layout">
      <aside className="area-panel"><b>Your areas</b>{["Andheri West", "Malad West", "Goregaon", "Borivali"].map((x, i) => <button className={i === 0 ? "selected" : ""} key={x}><span>{x.slice(0, 2).toUpperCase()}</span><div><b>{x}</b><small>{27 - i * 4} active issues</small></div><Icon name="chevron" size={17} /></button>)}</aside>
      <section className="feed">
        <div className="tabs">{["Nearby", "Trending", "Unresolved", "Resolved"].map(x => <button className={tab === x ? "active" : ""} onClick={() => setTab(x)} key={x}>{x}</button>)}</div>
        {[{ name: "Aarav R.", time: "2h", title: "Large pothole near the main junction", img: photos.road, count: 23, status: "Pending" }, { name: "Neha S.", time: "5h", title: "Waterlogging outside metro entrance", img: photos.hero, count: 41, status: "In progress" }].map((post, i) => <article className="post" key={post.title}><div className="feed-user"><span className="avatar">{post.name.split(" ").map(x => x[0]).join("")}</span><div><b>{post.name}</b><p>Andheri West · {post.time} ago</p></div><span className={`status ${i ? "progress" : "pending"}`}>{post.status}</span></div><img src={post.img} alt={post.title} /><div className="feed-body"><div className={i ? "warning-label" : "severity"}>{i ? "WATER" : "HIGH SEVERITY"}</div><h3>{post.title}</h3><p className="place"><Icon name="location" size={16} /> Andheri West, Mumbai</p><div className="feed-actions"><button className="voted"><Icon name="up" size={18} /> <b>{post.count}</b> affected</button><button><Icon name="community" size={18} /> {8 + i * 6} comments</button><button aria-label="Share"><Icon name="share" size={18} /></button></div><button className="same-problem">I have the same problem</button></div></article>)}
      </section>
      <aside className="nearby"><div className="map-card mini"><div className="map-head"><b>Nearby map</b><span><span className="live-dot" /> Live</span></div><div className="fake-map"><div className="road r1" /><div className="road r3" /><span className="marker red m1"><Icon name="location" /></span><span className="marker amber m2"><Icon name="location" /></span><span className="marker green m3"><Icon name="location" /></span></div></div><div className="area-stats"><b>Andheri West</b><div><span><strong>27</strong> Active</span><span><strong>8</strong> Resolved this week</span></div></div></aside>
    </div>
  </main>;
}

function MyReports() {
  const [selected, setSelected] = useState(0);
  const reports = [
    { title: "Pothole on Link Road", place: "Andheri West", state: "In progress", age: "2 days ago", img: photos.road },
    { title: "Broken streetlight", place: "Lokhandwala", state: "Pending", age: "5 days ago", img: photos.street },
    { title: "Waterlogged footpath", place: "DN Nagar", state: "Resolved", age: "12 days ago", img: photos.hero },
  ];
  const active = reports[selected];
  return <main className="page section">
    <div className="page-heading"><div><div className="eyebrow muted">YOUR ACTIVITY</div><div className="title">My Reports</div><p>Track every report from submission to resolution.</p></div></div>
    <div className="stat-row"><div><span className="stat-icon dark"><Icon name="reports" /></span><p>Active</p><b>3</b></div><div><span className="stat-icon amber"><Icon name="clock" /></span><p>In progress</p><b>2</b></div><div><span className="stat-icon green"><Icon name="check" /></span><p>Resolved</p><b>5</b></div></div>
    <div className="reports-layout"><div className="report-list">{reports.map((r, i) => <button key={r.title} className={`report-item ${selected === i ? "selected" : ""}`} onClick={() => setSelected(i)}><img src={r.img} alt="" /><div><span className={`status ${r.state === "Resolved" ? "resolved" : r.state === "Pending" ? "pending" : "progress"}`}>{r.state}</span><b>{r.title}</b><p><Icon name="location" size={14} /> {r.place}</p><small>Reported {r.age}</small></div><Icon name="chevron" /></button>)}</div>
      <section className="report-detail"><div className="detail-image"><img src={active.img} alt={active.title} /><span className="severity">HIGH SEVERITY</span></div><div className="detail-body"><div><span className="status progress">{active.state}</span><h2>{active.title}</h2><p><Icon name="location" size={16} /> {active.place}, Mumbai</p></div><div className="timeline"><b>Report timeline</b>{[["Report submitted", "Oct 7, 10:32 AM"], ["AI analysis completed", "Oct 7, 10:33 AM"], ["Report reviewed", "Oct 7, 11:15 AM"], ["In progress", "Oct 8, 09:10 AM"], ["Resolved", "Waiting for update"]].map((x, i) => <div className={i < 3 ? "done" : i === 3 ? "current" : ""} key={x[0]}><span>{i < 3 ? <Icon name="check" size={15} /> : ""}</span><p><b>{x[0]}</b><small>{x[1]}</small></p></div>)}</div><button className="secondary full">View full report <Icon name="arrow" /></button></div></section>
    </div>
  </main>;
}

function Profile() {
  return <main className="page section narrow"><div className="profile-card"><div className="profile-cover" /><div className="profile-main"><span className="profile-avatar">HK</span><button className="secondary compact">Edit profile</button><h1>Hakim Khan</h1><p><Icon name="location" size={16} /> Andheri West, Mumbai</p><div className="profile-stats"><span><b>12</b> Reports</span><span><b>7</b> Resolved</span><span><b>28</b> Confirmations</span></div></div></div><div className="settings-list">{[["reports", "My reports", "View your submitted reports"], ["community", "Saved issues", "Reports you want to follow"], ["clock", "Notifications", "Updates from your neighbourhood"], ["profile", "Account & settings", "Language, privacy and preferences"]].map(x => <button key={x[1]}><span><Icon name={x[0] as IconName} /></span><div><b>{x[1]}</b><p>{x[2]}</p></div><Icon name="chevron" /></button>)}</div></main>;
}

function ReportFlow({ close }: { close: () => void }) {
  const [step, setStep] = useState(0);
  const [category, setCategory] = useState("Pothole");
  const [size, setSize] = useState("Large");
  const labels = ["Capture", "Location", "Understand", "Confirm", "Submitted"];
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Report a problem">
    <div className="report-modal">
      <div className="report-top"><Logo /><button className="close" onClick={close} aria-label="Close">×</button></div>
      <div className="progress">{labels.map((x, i) => <div key={x} className={step >= i ? "active" : ""}><span>{step > i ? <Icon name="check" size={14} /> : `0${i + 1}`}</span><b>{x}</b></div>)}</div>
      <div className="flow-body">
        {step === 0 && <><div className="flow-eyebrow">STEP 1 OF 4</div><h2>What did you see?</h2><p>Take a clear photo of the problem. We’ll help with the rest.</p><button className="upload-area" onClick={() => setStep(1)}><span><Icon name="camera" size={34} /></span><b>Take a photo</b><small>or upload from your device</small></button><div className="or"><span /> OR <span /></div><button className="voice-button"><span><Icon name="mic" /></span><div><b>Tell us what happened</b><small>Speak naturally in English, हिन्दी or मराठी</small></div><Icon name="chevron" /></button></>}
        {step === 1 && <><div className="flow-eyebrow">STEP 2 OF 4</div><h2>Where did you see it?</h2><p>Check that the pin is on the exact location.</p><div className="location-map"><div className="road r1" /><div className="road r2" /><div className="road r4" /><span className="big-pin"><Icon name="location" size={32} /></span><button><Icon name="location" size={18} /> Use my location</button></div><div className="location-result"><span><Icon name="location" /></span><div><small>REPORT LOCATION</small><b>Link Road, Andheri West</b><p>Mumbai, Maharashtra 400053</p></div><button>Change</button></div><button className="primary full" onClick={() => setStep(2)}>Confirm location <Icon name="arrow" /></button></>}
        {step === 2 && <><div className="flow-eyebrow ai"><Icon name="spark" size={16} /> iREPORT UNDERSTOOD</div><h2>We think this is a pothole.</h2><p>Review our suggestion—you’re always in control.</p><div className="analysis-card"><div className="analysis-img"><img src={photos.road} alt="Road issue preview" /><span className="bounding"><i>Possible pothole · 87%</i></span></div><div className="analysis-copy"><div><span className="ai-icon"><Icon name="spark" size={18} /></span><p><small>POSSIBLE ISSUE</small><b>{category}</b></p><strong>87%</strong></div><p>Your photo shows a road-surface depression that looks consistent with a pothole.</p></div></div><div className="choice-label">Does this look right?</div><div className="two-actions"><button className="primary" onClick={() => setStep(3)}><Icon name="check" /> Yes, looks right</button><button className="secondary" onClick={() => setCategory(category === "Pothole" ? "Road damage" : "Pothole")}>Change category</button></div></>}
        {step === 3 && <><div className="flow-eyebrow">FINAL CHECK</div><h2>Your report is ready.</h2><p>One quick review before you submit it.</p><div className="review-card"><img src={photos.road} alt="Report evidence" /><div className="review-info"><div><small>PROBLEM</small><b>{category}</b></div><div><small>LOCATION</small><b>Andheri West</b></div><div><small>APPROXIMATE SIZE</small><span className="size-choices">{["Small", "Medium", "Large"].map(x => <button onClick={() => setSize(x)} className={size === x ? "selected" : ""} key={x}>{x}</button>)}</span></div><div><small>SEVERITY</small><b className="high">High · Traffic risk</b></div><div><small>EVIDENCE</small><b>Photo attached</b></div></div></div><button className="transparency"><Icon name="spark" size={17} /> How did iREPORT decide this?</button><button className="primary full" onClick={() => setStep(4)}>Submit report <Icon name="arrow" /></button></>}
        {step === 4 && <div className="success-screen"><div className="success-icon"><Icon name="check" size={38} /></div><div className="flow-eyebrow">REPORT SUBMITTED</div><h2>Your report is on its way.</h2><p>You’ll receive updates as its status changes.</p><div className="report-id"><small>REPORT ID</small><b>IR-20261007-00142</b><span className="status pending">Reported</span></div><div className="success-list"><span><Icon name="check" /> Report submitted</span><span><Icon name="check" /> Location saved</span><span><Icon name="check" /> Evidence attached</span></div><button className="primary full" onClick={close}>Track report <Icon name="arrow" /></button><button className="text-button" onClick={close}>Return home</button></div>}
      </div>
      {step > 0 && step < 4 && <button className="back-button" onClick={() => setStep(step - 1)}>← Back</button>}
    </div>
  </div>;
}

function MobileNav({ page, setPage, openReport }: { page: string; setPage: (p: string) => void; openReport: () => void }) {
  return <nav className="mobile-nav">{[["home", "home", "Home"], ["community", "community", "Community"]].map(x => <button key={x[0]} className={page === x[0] ? "active" : ""} onClick={() => setPage(x[0])}><Icon name={x[1] as IconName} /><span>{x[2]}</span></button>)}<button className="mobile-report" onClick={openReport}><span><Icon name="plus" /></span><b>Report</b></button>{[["my-reports", "reports", "My reports"], ["profile", "profile", "Profile"]].map(x => <button key={x[0]} className={page === x[0] ? "active" : ""} onClick={() => setPage(x[0])}><Icon name={x[1] as IconName} /><span>{x[2]}</span></button>)}</nav>;
}

export default function App() {
  const [page, setPage] = useState("home");
  const [reportOpen, setReportOpen] = useState(false);
  const go = (p: string) => { setPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); };
  return <div className="app"><Header page={page} setPage={go} openReport={() => setReportOpen(true)} />{page === "home" && <Landing openReport={() => setReportOpen(true)} setPage={go} />}{page === "community" && <Community />}{page === "my-reports" && <MyReports />}{page === "profile" && <Profile />}<MobileNav page={page} setPage={go} openReport={() => setReportOpen(true)} />{reportOpen && <ReportFlow close={() => setReportOpen(false)} />}<footer><div className="section"><Logo /><p>See it. Report it. Track it. Together.</p><span>© 2026 iREPORT Mumbai</span></div></footer></div>;
}
