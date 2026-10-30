// Citizen journey on the real site: home -> report flow (5 steps) -> success -> My Reports.
// Run from ireport-video:  node capture/citizen.mjs   (needs the API on :8000 and the site on :8443)
import { Recorder, clickRect, login, open, settle, sleep, target } from "./lib.mjs";

const DESCRIPTION = "Deep pothole near the bus stop, full of rain water for 4 days. Bikes swerve into traffic to avoid it.";

const { browser, page } = await open();
const rec = new Recorder("citizen");
try {
  await login(page, "aarav@example.com", "citizen123");
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page, 1500);

  // 1. Home
  const start = await target(page, "Start a report", { within: "main" });
  await rec.shot(page, "c01-home", { start });
  await clickRect(page, start);
  await settle(page, 1200);

  // 2. Category
  const M = ".report-modal";
  const pothole = await target(page, "Potholes", { within: M });
  await rec.shot(page, "c02-category", { pothole });
  await clickRect(page, pothole);
  await sleep(600);
  const next1 = await target(page, "Continue", { within: M, sel: "button.primary.full" });
  await rec.shot(page, "c03-category-picked", { next: next1 });
  await clickRect(page, next1);
  await settle(page, 900);

  // 3. Questions: first option of every question, then the description.
  const blocks = await page.$$(`${M} .q-block`);
  const answers = {};
  for (let i = 0; i < blocks.length; i++) {
    const r = await target(page, "", { within: `${M} .q-block:nth-of-type(${i + 1}) .problem-list`, sel: "button", index: 0 });
    if (i === 0) await rec.shot(page, "c04-questions", { answer: r });
    answers[`q${i}`] = r;
    await clickRect(page, r);
    await sleep(350);
  }
  const box = await target(page, "", { within: M, sel: "textarea" });
  await clickRect(page, box);
  await page.keyboard.type(DESCRIPTION, { delay: 8 });
  await sleep(400);
  const next2 = await target(page, "Continue", { within: M, sel: "button.primary.full" });
  await rec.shot(page, "c05-questions-done", { description: box, next: next2 });
  await clickRect(page, next2);
  await settle(page, 900);

  // 4. Photo + location
  const drop = await target(page, "", { within: M, sel: ".upload-drop" });
  await rec.shot(page, "c06-photo", { upload: drop });
  const input = await page.$(`${M} input[type=file]`);
  await input.uploadFile("capture/assets/pothole-report.jpg");
  await settle(page, 2500);
  const preview = await target(page, "", { within: M, sel: ".upload-preview" });
  await rec.shot(page, "c07-photo-added", { preview });
  const gps = await target(page, "", { within: `${M} .location-actions`, sel: "button" });
  await rec.shot(page, "c08-gps", { gps });
  await clickRect(page, gps);
  await settle(page, 3500);
  const details = await target(page, "", { within: M, sel: ".leaflet-container" });
  await rec.shot(page, "c09-location", { map: details });
  const next3 = await target(page, "Continue", { within: M, sel: "button.primary.full" });
  await rec.shot(page, "c10-location-next", { next: next3 });
  await clickRect(page, next3);

  // 5. Review: wait for the analysis to finish.
  await page.waitForFunction(() => !document.querySelector(".ai-loading"), { timeout: 60000 }).catch(() => {});
  await settle(page, 2000);
  const card = await target(page, "", { within: M, sel: ".rv-card" });
  await rec.shot(page, "c11-review", { card });
  const ai = await target(page, "", { within: M, sel: ".rv-ai" });
  await rec.shot(page, "c12-ai", { ai });
  const consent = await target(page, "", { within: M, sel: ".consent input" });
  await page.click(`${M} .consent input`);
  await sleep(800);
  if (!(await page.$eval(`${M} .consent input`, (e) => e.checked))) await page.$eval(`${M} .consent input`, (e) => e.click());
  await sleep(800);
  console.log("STATE", await page.evaluate((m) => ({
    checked: document.querySelector(`${m} .consent input`).checked,
    loading: !!document.querySelector(".ai-loading"),
    disabled: document.querySelector(`${m} button.primary.full`).disabled,
    notes: [...document.querySelectorAll(`${m} [role=status], ${m} .form-error, ${m} .near-card, ${m} .dup-card`)].map((e) => e.innerText.slice(0, 160)),
  }), M));
  await page.waitForFunction((m) => !document.querySelector(".ai-loading") && !document.querySelector(`${m} button.primary.full`).disabled, { timeout: 60000 }, M);
  await sleep(500);
  const submit = await target(page, "", { within: M, sel: "button.primary.full" });
  await rec.shot(page, "c13-submit", { consent, submit });
  await clickRect(page, submit);
  await page.waitForSelector(`${M} .success-screen`, { timeout: 30000 });
  await sleep(2200);
  const id = await target(page, "", { within: M, sel: ".report-id" });
  await rec.shot(page, "c14-success", { id });
  const publicId = await page.$eval(`${M} .report-id b`, (e) => e.textContent);
  console.log("PUBLIC_ID", publicId);
  rec.publicId = publicId;
} finally {
  rec.save();
  await browser.close();
}
