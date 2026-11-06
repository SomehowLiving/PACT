import { chromium } from "playwright-core";
import { homedir } from "node:os";
import { join } from "node:path";
// Navigation, URL state and layout checks for the trading shell (PACT_UI_DESIGN_RULES.md).
//   npm run dev  &&  node e2e/ui.e2e.mjs      (PACT_URL, E2E_OUT and CHROME_PATH optional)
// Needs the demo scenario loaded (POST /api/demo) so leaders and plans exist.
import { mkdirSync } from "node:fs";
const BASE = process.env.PACT_URL ?? "http://localhost:3000";
const OUT = (process.env.E2E_OUT ?? join(process.cwd(), "e2e", "out", "ui")) + "/";
mkdirSync(OUT, { recursive: true });
const ok = [];
const check = (name, pass, detail = "") => { ok.push(pass); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? join(homedir(), ".cache/ms-playwright/chromium-1248/chrome-linux64/chrome"), args: ["--no-sandbox"] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addInitScript(() => localStorage.setItem("pact.viewAs", "0x7777777777777777777777777777777777777777"));
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(`${p.url()}: ${e.message}`));
p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon/.test(m.text())) errs.push(`${p.url()}: ${m.text().slice(0, 160)}`); });

await p.goto(`${BASE}/discover`, { waitUntil: "networkidle" });
await p.getByText("Leader table").waitFor();
check("no sidebar navigation", (await p.locator("aside").count()) === 0);
const headerNav = p.locator('nav[aria-label="Workspaces"] a');
const labels = (await headerNav.allInnerTexts()).map((x) => x.replace(/\s*\d+$/, "").trim());
check("header has exactly the five workspaces", JSON.stringify(labels) === JSON.stringify(["Trade", "Discover", "Plans", "Portfolio", "Orders"]), JSON.stringify(labels));
check("Discover shows its local tabs", (await p.locator('nav[aria-label="Discover views"]').innerText()).includes("All leaders"));
await p.screenshot({ path: OUT + "1-discover-desktop.png" });

await p.getByRole("tab", { name: /Disciplined/ }).click().catch(async () => p.getByText("Disciplined").first().click());
await p.waitForTimeout(300);
check("filter chip writes the URL", p.url().includes("view=disciplined"), p.url());
await p.reload({ waitUntil: "networkidle" });
await p.getByText("Leader table").waitFor();
await p.waitForTimeout(400);
check("filter survives a refresh", p.url().includes("view=disciplined") && (await p.locator('[role="tab"][aria-selected="true"]').first().innerText()).includes("Disciplined"), await p.locator('[role="tab"][aria-selected="true"]').first().innerText().catch(() => "?"));

const leaderLink = p.locator('table a[href^="/leaders/"]').first();
const href = await leaderLink.getAttribute("href");
await leaderLink.click();
await p.waitForURL(/\/leaders\//);
await p.getByText("Copyability for your desk").waitFor({ timeout: 15000 });
check("leader name opens the canonical profile", p.url().endsWith(href), p.url());
check("profile is in the Discover workspace", (await p.locator('nav[aria-label="Discover views"]').count()) === 1);
await p.screenshot({ path: OUT + "2-leader-overview.png" });
await p.locator('main [role="tab"]', { hasText: "Plans" }).first().click();
await p.waitForTimeout(400);
check("profile tab writes the URL", p.url().includes("tab=plans"), p.url());
await p.screenshot({ path: OUT + "3-leader-plans.png" });
const planLink = p.locator('table a[href^="/plans/"]').first();
check("plan rows link to plan detail", (await planLink.count()) > 0);

await p.goBack({ waitUntil: "networkidle" });
await p.waitForTimeout(500);
check("browser back returns to Discover with its filter", p.url().includes("/discover") && p.url().includes("view=disciplined"), p.url());
await p.goForward({ waitUntil: "networkidle" });
await p.waitForTimeout(500);
check("browser forward returns to the profile", p.url().includes("/leaders/"), p.url());

await p.getByRole("button", { name: /Demo desk|Account|0x/ }).first().click();
await p.getByRole("menu").waitFor();
const menu = await p.getByRole("menu").innerText();
check("account menu holds wallet value, desk and settings", ["Demo desk", "Mandate & risk", "Wallet & Autopilot", "Desk overview", "Demo lab"].every((t) => menu.includes(t)));
await p.screenshot({ path: OUT + "4-account-menu.png" });
await p.keyboard.press("Escape");

await p.locator('button', { hasText: /^(Copy|Edit)$/ }).first().click();
await p.waitForTimeout(600);
check("Follow opens the copy configuration drawer", (await p.getByText(/Sizing|sizing/).count()) > 0);
await p.screenshot({ path: OUT + "5-follow-drawer.png" });
await p.keyboard.press("Escape");

// every route renders
const routes = ["/", "/trade", "/discover", "/following", "/proposals", "/assist", "/leader", "/portfolio", "/execution", "/history", "/settings/mandate", "/settings/wallet", "/settings/preferences", "/lab", "/follower", "/leader/classic"];
const bad = [];
for (const r of routes) {
  const res = await p.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded" });
  if (!res || res.status() !== 200) bad.push(`${r} ${res?.status()}`);
}
check("every existing route still loads", bad.length === 0, bad.join(", ") || `${routes.length} routes`);
await p.goto(`${BASE}/proposals`, { waitUntil: "networkidle" });
check("Plans workspace tabs on the inbox", (await p.locator('nav[aria-label="Plans views"]').innerText()).includes("My published plans"));
await p.screenshot({ path: OUT + "6-plans-inbox.png" });

const tab = await b.newContext({ viewport: { width: 900, height: 1100 } });
await tab.addInitScript(() => localStorage.setItem("pact.viewAs", "0x7777777777777777777777777777777777777777"));
const t = await tab.newPage();
await t.goto(`${BASE}/discover`, { waitUntil: "networkidle" });
await t.screenshot({ path: OUT + "7-discover-tablet.png" });
await t.getByRole("button", { name: "Open navigation" }).click();
await t.getByRole("dialog", { name: "Navigation" }).waitFor();
check("tablet: one navigation, in a drawer", (await t.getByRole("dialog", { name: "Navigation" }).innerText()).includes("Orders & receipts"));
await t.screenshot({ path: OUT + "8-tablet-drawer.png" });
const overflow = await t.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
check("tablet: no horizontal page scroll", !overflow);

check("no console errors", errs.length === 0, errs.slice(0, 4).join(" | "));
console.log(`${ok.filter(Boolean).length}/${ok.length}`);
await b.close();
process.exit(ok.every(Boolean) ? 0 : 1);
