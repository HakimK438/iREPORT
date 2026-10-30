// Officer journey on the real site for the complaint the citizen script created, then the citizen confirming the fix.
// Run from ireport-video:  node capture/officer.mjs IR-xxxxxxxx-xxxxx
import { Recorder, SITE, clickRect, find, handle, login, open, rectOf, settle, sleep, target } from "./lib.mjs";

const PUBLIC_ID = process.argv[2];
if (!PUBLIC_ID) throw new Error("usage: node capture/officer.mjs <public id>");
const { browser, page } = await open();
const rec = new Recorder("officer");
try {
  await login(page, "ward.andheriwest@bmc.demo", "ward12345", "Authority");
  await settle(page, 2500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(600);
  await rec.shot(page, "o01-control-room", {});

  const card = await handle(page, PUBLIC_ID, { sel: "article.ad-item button.ad-main" });
  await rec.shot(page, "o02-complaint-in-list", { card: await rectOf(card) });
  await card.click();
  await settle(page, 2500);
  const label = () => page.$eval("footer.next-action button.primary", (e) => e.innerText.trim()).catch(() => "");
  const step = async (shotId, expect) => {
    await page.waitForFunction((t) => document.querySelector("footer.next-action button.primary")?.innerText.includes(t), { timeout: 20000 }, expect);
    const b = await handle(page, expect, { within: "footer.next-action", sel: "button.primary" });
    await rec.shot(page, shotId, { action: await rectOf(b) });
    await b.click();
    await settle(page, 2200);
  };
  console.log("FIRST", await label());
  await step("o03-brief", "Acknowledge");
  await step("o04-acknowledged", "Start work");
  console.log("THIRD", await label());
  await step("o05-in-progress", (await label()) || "Resolve");

  const take = await handle(page, "Take photo", { within: "footer.next-action" });
  await rec.shot(page, "o06-resolve-panel", { proof: await rectOf(take) });
  const input = await page.$("footer.next-action input[type=file]");
  await input.uploadFile("capture/assets/site-after.jpg");
  await page.waitForSelector("footer.next-action .proof-ok", { timeout: 30000 });
  await sleep(800);
  const note = await handle(page, "", { within: "footer.next-action", sel: "textarea" });
  await note.click();
  await page.keyboard.type("Pothole filled and the patch resurfaced. Site photo attached.", { delay: 6 });
  await sleep(400);
  const confirm = await handle(page, "", { within: "footer.next-action .act-row", sel: "button.primary" });
  await rec.shot(page, "o07-proof-ready", { note: await rectOf(note), confirm: await rectOf(confirm) });
  await confirm.click();
  await settle(page, 2500);
  await rec.shot(page, "o08-resolved", {});

  // Citizen confirms the fix.
  await page.evaluate(() => localStorage.clear());
  const ctx = browser.defaultBrowserContext();
  for (const c of await page.cookies(SITE, "http://localhost:8000/")) await page.deleteCookie(c);
  await login(page, "aarav@example.com", "citizen123");
  await find(page, "My Reports", { within: "header" });
  await clickRect(page, await target(page, "My Reports", { within: "header", scroll: false }));
  await settle(page, 2500);
  const yes = await handle(page, "", { within: ".resolution-box", sel: "button.primary" });
  await rec.shot(page, "c20-my-reports-resolved", { confirm: await rectOf(yes) });
  await yes.click();
  await settle(page, 2500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);
  await rec.shot(page, "c21-confirmed", {});
} finally {
  rec.save();
  await browser.close();
}
