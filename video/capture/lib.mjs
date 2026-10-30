// Shared helpers for driving the real iREPORT site and recording screenshots + click targets.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

export const SITE = "http://localhost:8443/";
export const VIEW = { width: 1600, height: 900, deviceScaleFactor: 2 };
export const OUT = "public/screens";
export const SPOT = { latitude: 19.141, longitude: 72.829, accuracy: 8 }; // Andheri West, no reports within 300 m

const exe = () =>
  fs.readdirSync("node_modules/.remotion/chrome-headless-shell")
    .map((d) => `node_modules/.remotion/chrome-headless-shell/${d}/chrome-headless-shell-win64/chrome-headless-shell.exe`)
    .find(fs.existsSync);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function open() {
  const browser = await puppeteer.launch({ executablePath: exe(), defaultViewport: VIEW, args: ["--lang=en-IN"] });
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(SITE, ["geolocation"]);
  const page = await browser.newPage();
  await page.setGeolocation(SPOT);
  await page.goto(SITE, { waitUntil: "networkidle0" });
  await settle(page, 1200);
  return { browser, page };
}

export async function settle(page, ms = 700) {
  try { await page.waitForNetworkIdle({ idleTime: 400, timeout: 8000 }); } catch {}
  // Brand fonts and map tiles must be in before a screenshot.
  await page.waitForFunction(() => document.fonts.status === "loaded" && document.fonts.check('800 20px "Manrope"') &&
    [...document.querySelectorAll(".leaflet-tile")].every((t) => t.complete), { timeout: 20000 }).catch(() => console.log("  (fonts/tiles wait timed out)"));
  await sleep(ms);
}

/** Visible element whose text contains `text` (shortest match wins), optionally inside `within`. */
export async function find(page, text, { sel = "button, a, label, [role=button], summary", within = "body", index = 0 } = {}) {
  return page.evaluate(({ text, sel, within, index }) => {
    const root = document.querySelector(within) ?? document.body;
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; };
    const all = [...root.querySelectorAll(sel)].filter(vis);
    const hits = text ? all.filter((e) => (e.innerText || e.value || e.getAttribute("aria-label") || "").replace(/\s+/g, " ").toLowerCase().includes(text.toLowerCase())) : all;
    hits.sort((a, b) => (a.innerText || "").length - (b.innerText || "").length);
    const el = text ? hits[index] : all[index];
    if (!el) return null;
    el.setAttribute("data-cap", "1");
    return true;
  }, { text, sel, within, index });
}

async function rectOfMarked(page, center = true) {
  return page.evaluate((center) => {
    const el = document.querySelector("[data-cap]");
    if (center) el.scrollIntoView({ block: "center", inline: "nearest" });
    const r = el.getBoundingClientRect();
    el.removeAttribute("data-cap");
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }, center);
}

/** Locate a target, scroll it into view, and return its rect (CSS px in the 1600x900 viewport). */
export async function target(page, text, opts = {}) {
  const ok = await find(page, text, opts);
  if (!ok) throw new Error(`target not found: ${text} (${opts.sel ?? "buttons"})`);
  const r = await rectOfMarked(page, opts.scroll !== false);
  await sleep(450);
  // Re-measure after the smooth scroll settles.
  await find(page, text, opts);
  return rectOfMarked(page, false);
}

export async function clickRect(page, r) {
  await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
}

export class Recorder {
  constructor(name) { this.name = name; this.steps = []; fs.mkdirSync(OUT, { recursive: true }); }
  async shot(page, id, targets = {}, note = "") {
    const file = `${id}.jpg`;
    await page.screenshot({ path: path.join(OUT, file), type: "jpeg", quality: 90 });
    this.steps.push({ id, file, targets, note });
    console.log("shot", id, Object.keys(targets).join(","));
  }
  save() {
    fs.writeFileSync(path.join(OUT, `${this.name}.json`), JSON.stringify({ viewport: VIEW, steps: this.steps }, null, 2));
  }
}

export async function login(page, email, password, roleTab) {
  await page.goto(SITE, { waitUntil: "networkidle0" });
  await settle(page, 600);
  await find(page, "Log in", { within: "header" });
  await clickRect(page, await rectOfMarked(page, false));
  await settle(page, 600);
  if (roleTab) {
    await find(page, roleTab, { sel: "button, [role=tab]" });
    await clickRect(page, await rectOfMarked(page, false));
    await sleep(400);
  }
  await page.type('input[type="email"]', email);
  await page.type('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await settle(page, 1500);
}

/** ElementHandle for the same lookup as find(); clicking a handle never hits a stale position. */
export async function handle(page, text, opts = {}) {
  const ok = await find(page, text, opts);
  if (!ok) throw new Error(`handle not found: ${text} (${opts.sel ?? "buttons"})`);
  const h = await page.$("[data-cap]");
  await h.evaluate((e) => { e.removeAttribute("data-cap"); e.scrollIntoView({ block: "center" }); });
  await sleep(600);
  return h;
}

export async function rectOf(h) {
  return h.evaluate((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; });
}
