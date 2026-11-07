// Records the PACT demo tour as video segments with on-screen captions (read-only: no signing).
//
//   node e2e/demo-video.mjs before                  Landing → Discover → caught leader → Mandate → Proposals
//   ORDER_ID=… FOLLOWER=0x… node e2e/demo-video.mjs after
//                                                   the real order → fills → Basescan → receipts → Portfolio → World ID
//
// The signing segment is recorded by e2e/live-fill.mjs (LIVE_VIDEO=1) during the real copy.
// Segments land in e2e/out/demo/<part>/ as .webm; e2e/out is not committed.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = process.env.PACT_URL ?? "http://localhost:3000";
const PART = process.argv[2] ?? "before";
const OUT = join(process.cwd(), "e2e", "out", "demo", PART);
const CHROME = process.env.CHROME_PATH ?? join(homedir(), ".cache/ms-playwright/chromium-1248/chrome-linux64/chrome");
const DEMO_DESK = "0x2222222222222222222222222222222222222222";
const DUMP_LEADER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
});
const desk = PART === "after" ? process.env.FOLLOWER : DEMO_DESK;
if (desk) await ctx.addInitScript((a) => localStorage.setItem("pact.viewAs", a), desk);
// Each page starts dark and fades in once its data has loaded, so loading states never show.
await ctx.addInitScript(() => {
  const style = document.createElement("style");
  style.id = "__demo_fade";
  style.textContent = "html{background:#0e0c0a!important}body{opacity:0;transition:opacity .35s ease}";
  (document.head || document.documentElement).appendChild(style);
});
const page = await ctx.newPage();
const LOADING = /No leaders yet|No desk selected|No Flash orders yet|Loading|Connect your wallet, or choose a DEMO desk/;
async function reveal(ready) {
  // Wait for real content (not a blank first paint), with no loading or empty-desk state left.
  await page
    .waitForFunction(
      ([src, must]) => {
        const t = document.body?.innerText ?? "";
        return t.length > 300 && !new RegExp(src).test(t) && (!must || new RegExp(must).test(t));
      },
      [LOADING.source, ready?.source ?? ""],
      { timeout: 12000 },
    )
    .catch(() => undefined);
  await sleep(400);
  await page.evaluate(() => document.getElementById("__demo_fade")?.remove()).catch(() => undefined);
  await sleep(350);
}

async function caption(text) {
  await page
    .evaluate((t) => {
      let el = document.getElementById("__demo_caption");
      if (!el) {
        el = document.createElement("div");
        el.id = "__demo_caption";
        el.style.cssText =
          "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;max-width:1100px;padding:12px 22px;border-radius:14px;background:rgba(14,12,10,.92);border:1px solid rgba(240,230,210,.25);color:#f3ead8;font:500 19px/1.4 system-ui,sans-serif;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.5);pointer-events:none";
        document.body.appendChild(el);
      }
      el.textContent = t;
    }, text)
    .catch(() => undefined);
}
async function go(path, wait = 1800) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch(() => undefined);
  await sleep(Math.min(wait, 900));
  if (path === "/") await page.evaluate(() => document.getElementById("__demo_fade")?.remove()).catch(() => undefined);
  else await reveal();
  await sleep(Math.max(0, wait - 900));
}
async function scroll(dy, steps = 6) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy / steps);
    await sleep(90);
  }
}
const step = async (fn) => {
  try {
    await fn();
  } catch (e) {
    console.log(`  (step skipped: ${e.message?.split("\n")[0]})`);
  }
};

if (PART === "before") {
  await go("/", 1200);
  await caption("Copy trading usually works for leaders, not followers. PACT copies the plan, not the position — executed on Definitive Flash.");
  await sleep(5500);
  await scroll(700);
  await sleep(2500);

  await go("/discover");
  await caption("Discover: leaders publish structured plans — entry, stop, target. PACT scores plan quality, execution evidence and copyability for MY desk.");
  await sleep(6500);

  await go(`/leaders/${DUMP_LEADER}?tab=execution`);
  await caption("PACT caught this leader selling into followers' buys — twice. Every follower's new copies of this leader are now held for review.");
  await sleep(4000);
  await step(async () => {
    await page.getByText(/follower fairness|sold into|conduct/i).first().scrollIntoViewIfNeeded();
  });
  await sleep(4000);

  await go("/settings/mandate");
  await caption("My mandate: sizing and a daily sleeve per leader, caps, allowed order types, maximum entry drift and my own exits — for up to ten leaders.");
  await sleep(4500);
  await scroll(600);
  await sleep(2500);

  await go("/proposals");
  await caption("Every new plan becomes a proposal on my desk, already decided under my rules: COPY, SCALE, WAIT, DECLINE or REVIEW — with the reasons.");
  await sleep(6000);
}

if (PART === "after") {
  const id = process.env.ORDER_ID;
  if (!id) throw new Error("ORDER_ID required");
  await go(`/execution?order=${encodeURIComponent(id)}`, 3000);
  await caption("Orders: my $5 TWAP, executed onchain by Flash. Fills come from Flash's own rows; entry drift is measured against the leader's declared entry.");
  await sleep(6500);
  await step(async () => {
    await page.getByText("Onchain attribution").first().scrollIntoViewIfNeeded();
    await scroll(-200, 3);
  });
  await caption("Each settlement transaction is read back from Base: its ERC-8021 stamp proves Flash settled this fill for a PACT copy. PACT's fee: none — the leader is still on probation.");
  await sleep(7500);

  // One click from a fill to the chain.
  let tx;
  await step(async () => {
    tx = await page.locator('a[href*="/tx/0x"]').first().getAttribute("href");
  });
  if (tx) {
    await page.locator('a[href*="/tx/0x"]').first().hover().catch(() => undefined);
    await sleep(800);
    // Basescan serves a Cloudflare check to headless browsers; Blockscout shows the same Base transaction.
    await page.goto(tx.replace("https://basescan.org", "https://base.blockscout.com"), { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => undefined);
    await reveal(/Tokens transferred[\s\S]*USDC/);
    await caption("One click from the order: the fill on Base — a successful Flash settlement, USDC out of my own wallet, swapped onchain.");
    await sleep(3000);
    await scroll(380);
    await sleep(4000);
  }

  await go(`/execution?order=${encodeURIComponent(id)}`, 2500);
  await step(async () => {
    await page.getByRole("tab", { name: "Policy & Mandate" }).click();
    await sleep(800);
    await page.getByText("Receipt verdict").first().scrollIntoViewIfNeeded();
  });
  await caption("Receipt verdict: every promise PACT made before I signed — price bound, fees, recipient, my stop and target — checked against Flash's own report.");
  await sleep(6500);
  await step(async () => {
    await page.getByRole("tab", { name: "On-chain Evidence" }).click();
    await sleep(1500);
  });
  await caption("And the evidence trail: every decision, quote and fill in a hash-chained log that my browser re-verifies.");
  await sleep(5500);

  await go("/portfolio", 2500);
  await caption("Portfolio: the position comes from Flash fills and is marked at Flash's real sell quote. My stop and target stay live on Flash.");
  await sleep(6500);

  await go("/leader", 2500);
  await step(async () => {
    await page.getByText(/world id/i).first().scrollIntoViewIfNeeded();
  });
  await caption("Leaders prove with World ID that one human stands behind a leader address. A second wallet for the same human is refused.");
  await sleep(6500);

  await go("/", 1500);
  await caption("PACT — copy the plan, not the trader. My rules, Flash's execution, onchain proof.");
  await sleep(5000);
}

const video = page.video();
await ctx.close();
await browser.close();
console.log(`segment: ${await video?.path()}`);
