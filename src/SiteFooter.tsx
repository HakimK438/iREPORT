import { Brand } from "./brand";

type Page = "home" | "community" | "reports" | "profile" | "auth" | "authority" | "admin" | "how";

/** The site footer: what iREPORT is, where to go, who to call in an emergency, and the data credits. Links depend on who is signed in. */
export default function SiteFooter({ go, goSection, role }: { go: (p: Page) => void; goSection: (id: string) => void; role: "citizen" | "authority" | "admin" | null }) {
  const staff = role === "authority" || role === "admin";
  const links: [string, () => void][] = staff
    ? [["Home", () => go("home")], [role === "admin" ? "Admin dashboard" : "Control room", () => go(role === "admin" ? "admin" : "authority")], ["How it works", () => go("how")]]
    : [["Home", () => go("home")], ["Community", () => go("community")], ["My reports", () => go("reports")], ["How it works", () => goSection("how")], ["Help and FAQ", () => goSection("help")]];
  return <footer className="site-footer">
    <div className="section site-footer-grid">
      <div className="sf-about"><Brand /><p>Report a civic problem in Mumbai in under a minute. Every complaint is sent to the ward and department responsible, with a clear deadline, and you can follow it until it is fixed.</p></div>
      <nav aria-label="Footer"><h4>Explore</h4><ul>{links.map(([label, fn]) => <li key={label}><button className="text-button" onClick={fn}>{label}</button></li>)}</ul></nav>
      <div><h4>Emergency</h4><ul><li>Police, fire, ambulance: <b>112</b></li><li>Live wire or injury: call 112 first, then report here.</li></ul></div>
      <div><h4>About the data</h4><ul><li>Map data © OpenStreetMap contributors</li><li>Priority and deadlines follow fixed, published rules</li><li>Photo suggestions are labelled as unverified</li></ul></div>
    </div>
    <div className="site-footer-bar"><div className="section"><span>© {new Date().getFullYear()} iREPORT · Independent civic platform for Metropolitan Mumbai</span><span>Not an official BMC website</span></div></div>
  </footer>;
}
