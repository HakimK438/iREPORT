// Quick look at a page: screenshot + list of clickable texts. Usage: node capture/explore.mjs <step>
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const exe = fs.readdirSync("node_modules/.remotion/chrome-headless-shell").map(d => `node_modules/.remotion/chrome-headless-shell/${d}/chrome-headless-shell-win64/chrome-headless-shell.exe`).find(fs.existsSync);
const out = process.argv[2] ?? "C:/tmp";
const browser = await puppeteer.launch({ executablePath: exe, defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 } });
const page = await browser.newPage();
await page.goto("http://localhost:8443/", { waitUntil: "networkidle0" });
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: `${out}/home.jpg`, fullPage: true, type: "jpeg", quality: 70 });
const btns = await page.$$eval("button, a", els => els.map(e => e.innerText.trim().replace(/\s+/g, " ")).filter(Boolean).slice(0, 60));
console.log(JSON.stringify(btns));
console.log("height", await page.evaluate(() => document.body.scrollHeight));
await browser.close();
