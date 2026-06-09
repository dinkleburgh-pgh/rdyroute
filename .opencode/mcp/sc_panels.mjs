import { chromium } from "playwright";
import { writeFileSync } from "fs";
const b = await chromium.launch({ headless: false });
const ctx = await b.newContext();
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
await p.goto("http://192.168.1.212:5180/login", { waitUntil: "networkidle" });
await p.locator("input").nth(0).fill("ready");
await p.locator("input[type=password]").fill("ready");
await p.locator("button").first().click();
await p.waitForTimeout(2000);
await p.goto("http://192.168.1.212:5180/management", { waitUntil: "networkidle" });
await p.waitForTimeout(600);
// Fleet > Bulk Status
await p.locator("button").filter({ hasText: /^Fleet$/ }).first().click();
await p.waitForTimeout(500);
await p.locator("button").filter({ hasText: /Bulk Status/ }).first().click();
await p.waitForTimeout(800);
writeFileSync("C:/Users/DINKLE~1/AppData/Local/Temp/opencode/bulk_status.png", await p.screenshot({ fullPage: false }));
// Operations > Recovery
await p.locator("button").filter({ hasText: /^Operations$/ }).first().click();
await p.waitForTimeout(500);
await p.locator("button").filter({ hasText: /^Recovery$/ }).first().click();
await p.waitForTimeout(800);
writeFileSync("C:/Users/DINKLE~1/AppData/Local/Temp/opencode/recovery.png", await p.screenshot({ fullPage: false }));
console.log("done");
await b.close();
