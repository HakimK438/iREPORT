// Citizen sees the ward's fix in My Reports and confirms it. Run after officer.mjs.
import { Recorder, handle, login, open, rectOf, settle, sleep } from "./lib.mjs";

const { browser, page } = await open();
const rec = new Recorder("confirm");
try {
  await login(page, "aarav@example.com", "citizen123");
  await (await handle(page, "My Reports", { within: "header" })).click();
  await settle(page, 2500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);
  await rec.shot(page, "c19-my-reports", {});
  const yes = await handle(page, "", { within: ".resolution-box", sel: "button.primary" });
  await rec.shot(page, "c20-my-reports-resolved", { confirm: await rectOf(yes) });
  await yes.click();
  await settle(page, 2500);
  await rec.shot(page, "c21-confirmed", {});
} finally {
  rec.save();
  await browser.close();
}
