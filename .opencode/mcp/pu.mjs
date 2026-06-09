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
await p.waitForTimeout(600);
// Click Advanced card
const advCard = p.locator("button").filter({ hasText: /^Advanced\n/ });
await advCard.first().click();
await p.waitForTimeout(600);
// Click Update tab
const updateTab = p.locator("button").filter({ hasText: /^Update$/ });
await updateTab.first().click();
await p.waitForTimeout(1500);
writeFileSync("C:/Users/DINKLE~1/AppData/Local/Temp/opencode/prod_update.png", await p.screenshot({ fullPage: false }));
console.log("done");
await b.close();
