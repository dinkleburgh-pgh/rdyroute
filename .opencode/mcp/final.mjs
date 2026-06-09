import { chromium } from "playwright";
import { writeFileSync } from "fs";
const b = await chromium.launch({ headless: false });
const ctx = await b.newContext();
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
await p.goto("http://192.168.1.132:5180/login", { waitUntil: "networkidle" });
await p.locator("input").nth(0).fill("ready");
await p.locator("input[type=password]").fill("ready");
await p.locator("button").first().click();
await p.waitForTimeout(2000);
await p.goto("http://192.168.1.132:5180/management", { waitUntil: "networkidle" });
await p.waitForTimeout(500);
const btns = await p.locator("button").all();
for (const btn of btns) {
  const txt = (await btn.innerText().catch(() => "")).trim();
  if (txt.startsWith("Advanced")) { await btn.click(); break; }
}
await p.waitForTimeout(400);
const tabs = await p.locator("button").all();
for (const tab of tabs) {
  const txt = (await tab.innerText().catch(() => "")).trim();
  if (txt === "Update") { await tab.click(); break; }
}
await p.waitForTimeout(800);
const updateBtns = await p.locator("button").filter({ hasText: /^Update$/ }).all();
if (updateBtns.length > 0) {
  await updateBtns[0].click();
  console.log("Triggered update — waiting 90s for container pull + restart...");
  await p.waitForTimeout(90000);
  // Try to reconnect and check status
  await p.goto("http://192.168.1.132:5180/login", { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await p.locator("input").nth(0).fill("ready");
  await p.locator("input[type=password]").fill("ready");
  await p.locator("button").first().click();
  await p.waitForTimeout(2000);
  await p.goto("http://192.168.1.132:5180/management", { waitUntil: "networkidle" });
  await p.waitForTimeout(500);
  const b2 = await p.locator("button").all();
  for (const btn of b2) { const t=(await btn.innerText().catch(()=>"")).trim(); if(t.startsWith("Advanced")){await btn.click();break;} }
  await p.waitForTimeout(400);
  const t2 = await p.locator("button").all();
  for (const tab of t2) { const t=(await tab.innerText().catch(()=>"")).trim(); if(t==="Update"){await tab.click();break;} }
  await p.waitForTimeout(2000);
  writeFileSync("C:/Users/DINKLE~1/AppData/Local/Temp/opencode/final_result.png", await p.screenshot({ fullPage: false }));
}
console.log("done");
await b.close();
