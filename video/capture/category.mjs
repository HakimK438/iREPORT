// Re-shoots only the category step (the modal fully faded in). Opens the report flow and closes it; nothing is submitted.
import fs from "node:fs";
import { handle, login, open, rectOf, settle, sleep } from "./lib.mjs";

const { browser, page } = await open();
try {
  await login(page, "aarav@example.com", "citizen123");
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page, 1000);
  const start = await page.evaluateHandle(() => [...document.querySelectorAll("main button, main a")].find((e) => e.innerText.includes("Start a report")));
  await start.click();
  await settle(page, 2500);
  const pothole = await handle(page, "Potholes", { within: ".report-modal" });
  await sleep(1500);
  const r = await rectOf(pothole);
  await page.screenshot({ path: "public/screens/c02-category.jpg", type: "jpeg", quality: 90 });
  const m = JSON.parse(fs.readFileSync("public/screens/citizen.json", "utf8"));
  m.steps.find((s) => s.id === "c02-category").targets.pothole = r;
  fs.writeFileSync("public/screens/citizen.json", JSON.stringify(m, null, 2));
  console.log("c02 re-shot", r);
} finally {
  await browser.close();
}
