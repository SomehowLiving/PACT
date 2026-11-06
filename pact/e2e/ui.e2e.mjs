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
await p.locator("main table").first().waitFor();
const rail = p.locator('nav[aria-label="Workspace"]');
const railText = await rail.innerText();
check("left rail holds the follower sections", ["Leaders", "Following", "Watchlist", "My Plans", "Mandate", "Settings"].every((t) => railText.includes(t)), railText);
const headerNav = p.locator('nav[aria-label="Workspaces"] a');
const labels = (await headerNav.allInnerTexts()).map((x) => x.replace(/\s*\d+$/, "").trim());
check("header has exactly the five workspaces", JSON.stringify(labels) === JSON.stringify(["Trade", "Discover", "Proposals", "Portfolio", "Orders"]), JSON.stringify(labels));
check("Discover marks Leaders in the rail", (await rail.locator('a[aria-current="page"]').innerText()).includes("Leaders"));
await p.screenshot({ path: OUT + "1-discover-desktop.png" });

await p.getByRole("tab", { name: /Disciplined/ }).click().catch(async () => p.getByText("Disciplined").first().click());
await p.waitForTimeout(300);
check("filter chip writes the URL", p.url().includes("view=disciplined"), p.url());
await p.reload({ waitUntil: "networkidle" });
await p.locator("main table").first().waitFor();
await p.waitForTimeout(400);
check("filter survives a refresh", p.url().includes("view=disciplined") && (await p.locator('[role="tab"][aria-selected="true"]').first().innerText()).includes("Disciplined"), await p.locator('[role="tab"][aria-selected="true"]').first().innerText().catch(() => "?"));

const leaderLink = p.locator('table a[href^="/leaders/"]').first();
const href = await leaderLink.getAttribute("href");
await leaderLink.click();
await p.waitForURL(/\/leaders\//);
await p.getByText("Copyability for your desk").waitFor({ timeout: 15000 });
check("leader name opens the canonical profile", p.url().endsWith(href), p.url());
check("profile is in the Leaders section", (await rail.locator('a[aria-current="page"]').innerText()).includes("Leaders"));
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

await p.getByRole("button", { name: /Account menu|0x/ }).first().click();
await p.getByRole("menu").waitFor();
const menu = await p.getByRole("menu").innerText();
check("account menu holds settings, activity and tools", ["Desk overview", "Activity log", "Mandate & risk", "Wallet & Autopilot", "Preferences", "Demo lab", "Classic desk"].every((t) => menu.includes(t)), menu.replace(/\n/g, " · "));
check("desk picker is in the header", (await p.locator('header select[aria-label="Desk to view"]').count()) === 1);
await p.screenshot({ path: OUT + "4-account-menu.png" });
await p.keyboard.press("Escape");

await p.locator('main button', { hasText: /^(Follow|Edit mandate)$/ }).first().click();
await p.waitForTimeout(600);
check("Follow opens the copy configuration drawer", (await p.getByText(/Sizing|sizing/).count()) > 0);
await p.screenshot({ path: OUT + "5-follow-drawer.png" });
await p.keyboard.press("Escape");

// watchlist: star a leader in Discover, it shows in /watchlist and survives a reload
await p.goto(`${BASE}/discover`, { waitUntil: "networkidle" });
await p.locator("main table").first().waitFor();
const firstLeader = await p.locator('main table a[href^="/leaders/"]').first().getAttribute("href");
await p.locator('main table button[aria-label="Add to watchlist"]').first().click();
await p.locator('nav[aria-label="Workspace"] a', { hasText: "Watchlist" }).click();
await p.waitForURL(/\/watchlist/);
await p.locator("main table").first().waitFor();
check("starred leader appears in the watchlist", (await p.locator(`main table a[href="${firstLeader}"]`).count()) > 0 && (await p.locator("main table tbody tr").count()) === 1);
await p.reload({ waitUntil: "networkidle" });
await p.locator("main table").first().waitFor();
check("watchlist survives a reload", (await p.locator("main table tbody tr").count()) === 1);
await p.screenshot({ path: OUT + "11-watchlist.png" });
await p.locator('main table button[aria-label="Remove from watchlist"]').first().click();
await p.waitForTimeout(300);
check("unstarring empties the watchlist", (await p.getByText("Your watchlist is empty").count()) === 1);

// World ID: config is public and never carries the key; the verify panel is on Wallet settings
const world = await (await p.request.get(`${BASE}/api/world`)).json();
check("World ID config is public and keyless", typeof world.enabled === "boolean" && !JSON.stringify(world).match(/private|signing_key/i), JSON.stringify({ enabled: world.enabled, missing: world.missing }));
await p.goto(`${BASE}/settings/wallet`, { waitUntil: "networkidle" });
check("Wallet settings shows the World ID panel", (await p.getByText("one unique human per leader address").count()) > 0);
await p.goto(`${BASE}/settings/mandate`, { waitUntil: "networkidle" });
check("mandate offers verified-human leaders only", (await p.getByText("Copy only leaders verified as unique humans").count()) > 0);

// canonical order link
await p.goto(`${BASE}/orders/ord_test_123`, { waitUntil: "networkidle" });
check("order link opens Orders with that order", p.url().includes("/execution?order=ord_test_123"), p.url());

// every route renders
const routes = ["/", "/trade", "/discover", "/following", "/watchlist", "/proposals", "/assist", "/leader", "/portfolio", "/execution", "/history", "/settings/mandate", "/settings/wallet", "/settings/preferences", "/lab", "/follower", "/leader/classic"];
const bad = [];
for (const r of routes) {
  const res = await p.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded" });
  if (!res || res.status() !== 200) bad.push(`${r} ${res?.status()}`);
}
check("every existing route still loads", bad.length === 0, bad.join(", ") || `${routes.length} routes`);
await p.goto(`${BASE}/proposals`, { waitUntil: "networkidle" });
check("Proposals is the active workspace on the inbox", (await p.locator('nav[aria-label="Workspaces"] a[aria-current="page"]').innerText()).includes("Proposals"));
await p.screenshot({ path: OUT + "6-plans-inbox.png" });
await p.goto(`${BASE}/portfolio`, { waitUntil: "networkidle" });
await p.getByText("Allocated Sleeve").waitFor();
const portfolioText = await p.locator("main").innerText();
check("Portfolio shows its summary tiles", ["Total Value", "Open PnL", "Allocated Sleeve", "Active Leaders"].every((t) => portfolioText.includes(t)));
await p.getByRole("tab", { name: "By Leader" }).click();
check("Portfolio tabs switch views", (await p.getByText("Remaining capacity").count()) > 0);
await p.screenshot({ path: OUT + "9-portfolio.png" });
await p.goto(`${BASE}/execution`, { waitUntil: "networkidle" });
const ordersText = await p.locator("main").innerText();
check("Orders page loads (table or empty state)", ordersText.includes("Total Orders") || ordersText.includes("No Flash orders yet"));
await p.screenshot({ path: OUT + "10-orders.png" });

const tab = await b.newContext({ viewport: { width: 900, height: 1100 } });
await tab.addInitScript(() => localStorage.setItem("pact.viewAs", "0x7777777777777777777777777777777777777777"));
const t = await tab.newPage();
await t.goto(`${BASE}/discover`, { waitUntil: "networkidle" });
await t.screenshot({ path: OUT + "7-discover-tablet.png" });
await t.getByRole("button", { name: "Open navigation" }).click();
await t.getByRole("dialog", { name: "Navigation" }).waitFor();
check("tablet: one navigation, in a drawer", (await t.getByRole("dialog", { name: "Navigation" }).innerText()).includes("Orders") && (await t.getByRole("dialog", { name: "Navigation" }).innerText()).includes("Activity log"));
await t.screenshot({ path: OUT + "8-tablet-drawer.png" });
const overflow = await t.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
check("tablet: no horizontal page scroll", !overflow);

check("no console errors", errs.length === 0, errs.slice(0, 4).join(" | "));
console.log(`${ok.filter(Boolean).length}/${ok.length}`);
await b.close();
process.exit(ok.every(Boolean) ? 0 : 1);
