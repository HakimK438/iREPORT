// Clean home page, the officer's Analysis tab, and the admin dashboard. Reads the admin login from ../iREPORT_Copy/.env.
import fs from "node:fs";
import { Recorder, handle, login, open, rectOf, settle, sleep } from "./lib.mjs";

const env = Object.fromEntries(fs.readFileSync("../iREPORT_Copy/.env", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const { browser, page } = await open();
const rec = new Recorder("extras");
const top = async () => { await page.evaluate(() => window.scrollTo(0, 0)); await settle(page, 900); };
try {
  await login(page, "aarav@example.com", "citizen123");
  await (await handle(page, "Home", { within: "header" })).click();
  await settle(page, 1500);
  await top();
  const start = await page.evaluateHandle(() => [...document.querySelectorAll("main button, main a")].find((e) => e.innerText.includes("Start a report")));
  await rec.shot(page, "c00-home", { start: await rectOf(start) });
  await (await handle(page, "Log out", { within: "header" })).click();
  await settle(page, 1000);

  await login(page, "ward.andheriwest@bmc.demo", "ward12345", "Authority");
  await settle(page, 2000);
  await top();
  const tab = await page.evaluateHandle(() => [...document.querySelectorAll("button, [role=tab]")].find((e) => e.innerText.trim() === "Analysis"));
  await rec.shot(page, "o00-control-room-top", { analysis: await rectOf(tab) });
  await tab.click();
  await settle(page, 3000);
  await top();
  await rec.shot(page, "o09-analysis", {});
  await page.evaluate(() => window.scrollBy(0, 700));
  await settle(page, 1200);
  await rec.shot(page, "o10-analysis-charts", {});
  await (await handle(page, "Log out", { within: "header" })).click();
  await settle(page, 1000);

  await login(page, env.ADMIN_EMAIL, env.ADMIN_PASSWORD, "Admin");
  await settle(page, 3000);
  await top();
  await rec.shot(page, "a01-admin", {});
  await page.evaluate(() => window.scrollBy(0, 760));
  await settle(page, 1500);
  await rec.shot(page, "a02-admin-more", {});
} finally {
  rec.save();
  await browser.close();
}
