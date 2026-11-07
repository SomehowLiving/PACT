// LIVE, REAL-MONEY copy through PACT on Base: one small TWAP copy (default $5) with its TP/SL pair.
//
// It drives the real product path: a leader publishes a plan, the follower's mandate decides,
// the review page quotes on Flash, the browser wallet guard checks the payloads, and the
// follower's key signs in an injected wallet. Approvals are real Base transactions.
//
// Keys come from pact/.env.local and are never printed:
//   LIVE_FOLLOWER_PRIVATE_KEY=0x…   funded follower: ≥ $26 USDC and a little ETH on Base (required)
//   LIVE_LEADER_PRIVATE_KEY=0x…     leader wallet, needs no funds (optional; else a fresh one)
//   LIVE_COPY_USD=5                 copy size in USD, 5 to 25 (default 5)
//
//   node e2e/live-fill.mjs          preflight only: balances, Flash quote, guard. Sends nothing.
//   node e2e/live-fill.mjs --yes    really publishes, signs, approves and submits
//
// PACT_URL (default http://localhost:3000) must be a server with persistent storage.
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createWalletClient, http, hexToString } from "viem";
import { base } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE = process.env.PACT_URL ?? "http://localhost:3000";
const OUT = process.env.E2E_OUT ?? join(process.cwd(), "e2e", "out", "live");
const CHROME = process.env.CHROME_PATH ?? join(homedir(), ".cache/ms-playwright/chromium-1248/chrome-linux64/chrome");
const GO = process.argv.includes("--yes");
// Copy size: $5 by default (≈ $0.06 in Flash fees; the rest becomes WETH in the follower's wallet).
// LIVE_COPY_USD may raise it, never above $25.
const COPY_USD = Math.min(25, Math.max(5, Number(process.env.LIVE_COPY_USD ?? 5) || 5));
mkdirSync(OUT, { recursive: true });

const env = (() => {
  const out = {};
  // pact/.env.local, then the repo root .env (where PACT_PRIVATE_KEY may live). Never printed.
  for (const file of [join(process.cwd(), "..", ".env"), join(process.cwd(), ".env.local")]) {
    try {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch {
      // file absent
    }
  }
  return { ...out, ...process.env };
})();
const pk = (v) => (v && /^(0x)?[0-9a-fA-F]{64}$/.test(v) ? (v.startsWith("0x") ? v : `0x${v}`) : undefined);
const followerKey = pk(env.LIVE_FOLLOWER_PRIVATE_KEY) ?? pk(env.PACT_PRIVATE_KEY);
if (!followerKey) {
  console.log("Set LIVE_FOLLOWER_PRIVATE_KEY in pact/.env.local or PACT_PRIVATE_KEY in .env (a dedicated, funded wallet). Nothing was done.");
  process.exit(1);
}
// LIVE_VIDEO=1 records the review and signing as a demo segment, with on-screen captions.
const VIDEO = env.LIVE_VIDEO === "1";
async function caption(page, text) {
  if (!VIDEO) return;
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
// A demo step: never allowed to interrupt the real-money flow.
const beat = async (fn) => {
  if (!VIDEO) return;
  try {
    await fn();
  } catch {
    /* presentation only */
  }
};
const follower = privateKeyToAccount(followerKey);
const leader = privateKeyToAccount(pk(env.LIVE_LEADER_PRIVATE_KEY) ?? generatePrivateKey());
const rpc = env.EVM_RPC_URL || env.NEXT_PUBLIC_EVM_RPC_URL || "https://mainnet.base.org";
const chain = createPublicClient({ chain: base, transport: http(rpc) });
const wallet = createWalletClient({ account: follower, chain: base, transport: http(rpc) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

async function api(path, body, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null), setCookie: res.headers.get("set-cookie") };
}
async function signIn(account) {
  const { json } = await api("/api/session/nonce", { address: account.address });
  const signature = await account.signMessage({ message: json.message });
  const res = await api("/api/session", { message: json.message, signature });
  if (res.status !== 200 || !res.setCookie) throw new Error(`sign-in failed for ${short(account.address)}`);
  return res.setCookie.split(";")[0];
}

// ---------- 1. Preflight ----------
console.log(`PACT: ${BASE}`);
console.log(`Follower ${short(follower.address)} · leader ${short(leader.address)}${env.LIVE_LEADER_PRIVATE_KEY ? "" : " (fresh, unfunded)"}`);
const pre = (await api(`/api/preflight?funder=${follower.address}&qty=${COPY_USD}&buckets=2&duration=600`)).json;
for (const l of pre?.lines ?? []) console.log(`  [${l.level}] ${l.label}: ${l.detail}`);
// LIVE_SKIP_PREFLIGHT=1 is for rehearsing the flow with an unfunded key (it stops at the first approval).
if (!pre?.ready && env.LIVE_SKIP_PREFLIGHT !== "1") {
  console.log("\nPreflight is not ready (see the lines marked fail). Nothing was sent.");
  process.exit(1);
}
if (!GO) {
  console.log(`\nPreflight passed. Re-run with --yes to publish a plan, sign and submit a real $${COPY_USD} TWAP copy with its TP/SL pair.`);
  process.exit(0);
}

// ---------- 2. Mandate, then plan ----------
const followerCookie = await signIn(follower);
const current = (await api(`/api/policy?follower=${follower.address}`)).json.policy;
const follows = [...new Set([...(current.follows ?? []), leader.address])];
// A fixed-size mandate for this leader, so the copy is exactly COPY_USD whatever the desk's ratio.
const mandates = [
  ...(current.mandates ?? []).filter((m) => m.leader.toLowerCase() !== leader.address.toLowerCase()),
  { leader: leader.address, sizingMode: "FIXED", copyRatio: 0.25, fixedNotionalUsd: COPY_USD, riskBudgetUsd: 2, maxDailyUsd: 25, allowOrderTypes: ["twap", "limit"], exitMode: "FOLLOWER_BRACKET" },
];
const saved = await api("/api/policy", { ...current, follows, mandates, minNotionalUsd: Math.min(current.minNotionalUsd ?? 5, COPY_USD) }, followerCookie);
if (saved.status !== 200) throw new Error(`could not save the mandate: ${JSON.stringify(saved.json)}`);
const price = Number((await api("/api/health")).json?.price);
if (!(price > 0)) throw new Error("no WETH price");
const leaderCookie = await signIn(leader);
const plan = {
  leader: leader.address,
  title: "Live fill · ETH TWAP",
  thesis: "Accumulate ETH over ten minutes inside a tight stop.",
  invalidation: "Invalid below the stop.",
  orderType: "twap",
  qty: "100", // the leader's size; the follower's fixed mandate copies COPY_USD
  durationSeconds: 600,
  twapBucketCount: 2,
  entryReferencePrice: price.toFixed(2),
  stopLossPrice: (price * 0.98).toFixed(2),
  takeProfitPrice: (price * 1.04).toFixed(2),
  maxFollowerNotionalUsd: 60,
};
const pub = await api("/api/strategies", plan, leaderCookie);
if (pub.status !== 200) throw new Error(`publish failed: ${JSON.stringify(pub.json)}`);
const strategyId = pub.json?.strategy?.id ?? pub.json?.id;
console.log(`\nPlan published: entry $${plan.entryReferencePrice}, stop $${plan.stopLossPrice}, target $${plan.takeProfitPrice}`);
let proposal = (await api(`/api/state?follower=${follower.address}`)).json.proposals.find(
  (p) => p.follower.toLowerCase() === follower.address.toLowerCase() && p.strategyId === strategyId,
);
if (!proposal) {
  const made = await api("/api/proposals", { strategyId, follower: follower.address }, followerCookie);
  proposal = made.json?.proposal;
}
const st = (await api(`/api/state?follower=${follower.address}`)).json;
const decision = st.decisions[proposal.id];
console.log(`Decision: ${decision.action} ${decision.reasons.join(", ")} · copy $${proposal.notionalUsd}`);
if (decision.verdict === "BLOCK" || proposal.notionalUsd > COPY_USD + 0.01) {
  console.log(`Not copyable under the mandate (or above $${COPY_USD}). Stopping before any signature.`);
  process.exit(1);
}

// ---------- 3. Review page, real wallet ----------
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const ctx = await browser.newContext(
  VIDEO
    ? { viewport: { width: 1440, height: 900 }, recordVideo: { dir: join(OUT, "video"), size: { width: 1440, height: 900 } } }
    : { viewport: { width: 1440, height: 1400 } },
);
const page = await ctx.newPage();
const log = [];
await page.exposeFunction("__signTyped", async (json) => {
  const t = JSON.parse(json);
  delete t.types.EIP712Domain;
  log.push(`sign ${t.primaryType}`);
  return follower.signTypedData(t);
});
await page.exposeFunction("__signMsg", async (hex) => {
  log.push("sign message");
  return follower.signMessage({ message: hexToString(hex) });
});
await page.exposeFunction("__sendTx", async (txJson) => {
  const tx = JSON.parse(txJson);
  log.push(`send tx to ${short(tx.to)}`);
  const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : undefined });
  console.log(`  approval tx ${hash}`);
  await chain.waitForTransactionReceipt({ hash });
  return hash;
});
await page.addInitScript((addr) => {
  let chainId = "0x2105";
  const listeners = {};
  window.ethereum = {
    isMetaMask: true,
    on: (e, f) => ((listeners[e] ??= []).push(f)),
    removeListener: (e, f) => (listeners[e] = (listeners[e] ?? []).filter((x) => x !== f)),
    request: async ({ method, params = [] }) => {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [addr];
        case "eth_chainId":
          return chainId;
        case "wallet_switchEthereumChain":
          if (params[0].chainId !== "0x2105") throw new Error("live fill runs on Base only");
          return null;
        case "eth_signTypedData_v4":
          return window.__signTyped(params[1]);
        case "personal_sign":
          return window.__signMsg(params[0]);
        case "eth_sendTransaction":
          return window.__sendTx(JSON.stringify(params[0]));
        default:
          throw new Error(`live wallet: unsupported ${method}`);
      }
    },
  };
}, follower.address);

await page.goto(`${BASE}/follower`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /^connect( wallet)?$/i }).click();
await page.getByText(new RegExp(follower.address.slice(0, 6), "i")).filter({ visible: true }).first().waitFor({ timeout: 20000 });
await page.goto(`${BASE}/review/${proposal.id}`, { waitUntil: "networkidle" });
const signBtn = page.getByRole("button", { name: "sign", exact: true }).first();
await signBtn.waitFor({ timeout: 20000 });
await page.screenshot({ path: join(OUT, "1-review.png"), fullPage: true });
await beat(async () => {
  await sleep(1500);
  await caption(page, `A leader just published a live ETH plan. PACT turned it into my own copy: $${COPY_USD}, sized by my mandate — not the leader's $100.`);
  await sleep(5500);
  await page.getByText("Policy Check").first().scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 250);
  await caption(page, "My mandate decides before Flash is even asked: order type, chain, per-order cap, daily sleeve, reward:risk, my price bound, my exit.");
  await sleep(6000);
  const all = page.getByRole("button", { name: /see all \d+ checks/i }).first();
  await all.scrollIntoViewIfNeeded();
  await all.click();
  await caption(page, "How PACT decided: every check behind this copy, with its number, its limit and its source.");
  await sleep(6000);
  await signBtn.scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, -120);
  await caption(page, "Sign: Flash quotes my exact size, the price must agree with Chainlink, and my browser checks Flash's payload before my wallet signs.");
  await sleep(4000);
});
const orderRes = page.waitForResponse((r) => r.url().includes("/api/order") && r.request().method() === "POST", { timeout: Number(env.LIVE_ORDER_TIMEOUT_MS ?? 180000) }).catch(() => null);
await signBtn.click();
await beat(async () => {
  await page.getByText(/safe to sign/).first().waitFor({ timeout: 30000 });
  await caption(page, "Wallet guard passed: recipient is me, tokens, amounts, spender and deadline all match. Now my wallet approves and signs.");
  await sleep(3000);
  await caption(page, "I sign the TWAP entry and my own stop and target (an attached TP/SL bracket) — real Base transactions.");
});
const oRes = await orderRes;
const body = oRes ? await oRes.json().catch(() => null) : null;
await sleep(1500);
await beat(async () => {
  await caption(page, oRes?.ok() ? "Submitted. Flash now executes my TWAP onchain, in 2 slices over 10 minutes, with my stop and target attached." : "Flash did not accept the order.");
  await page.getByText(/Flash quote terms/i).first().scrollIntoViewIfNeeded();
  await sleep(6000);
});
await page.screenshot({ path: join(OUT, "2-submitted.png"), fullPage: true });
const guard = await page.getByText(/safe to sign/).first().textContent().catch(() => null);
console.log(`\nWallet guard: ${guard ?? "not shown"}`);
console.log(`Wallet actions: ${log.join(" → ")}`);
if (VIDEO) {
  const video = page.video();
  await page.close();
  console.log(`Demo segment: ${await video?.path()}`);
}
const orderId = body?.order?.orderId ?? body?.orderId;
if (!oRes) {
  console.log(`No order was submitted: a wallet step did not complete (wallet actions: ${log.join(" → ") || "none"}). Check USDC and ETH on Base.`);
  await browser.close();
  process.exit(1);
}
if (!oRes.ok() || !orderId) {
  console.log(`Flash did not accept the order: ${oRes.status()} ${JSON.stringify(body)?.slice(0, 300)}`);
  await browser.close();
  process.exit(1);
}
console.log(`\nFlash order ${orderId} submitted. Following it (TWAP ≈ 10 min)…`);

// ---------- 4. Follow to the end ----------
let receipt;
for (let i = 0; i < 90; i++) {
  receipt = (await api(`/api/orders/${encodeURIComponent(orderId)}`)).json?.receipt ?? receipt;
  const fills = receipt?.fills?.length ?? 0;
  process.stdout.write(`\r  ${receipt?.status ?? "…"} · ${fills} fill${fills === 1 ? "" : "s"}      `);
  if (["ORDER_STATUS_FILLED", "ORDER_STATUS_CANCELLED", "ORDER_STATUS_REJECTED", "ORDER_STATUS_TERMINATED"].includes(receipt?.status)) break;
  await sleep(10_000);
}
console.log("\n");
const last = VIDEO ? await browser.newPage({ viewport: { width: 1440, height: 1400 } }) : page;
await last.goto(`${BASE}/execution?order=${encodeURIComponent(orderId)}`, { waitUntil: "networkidle" });
await sleep(2500);
await last.screenshot({ path: join(OUT, "3-order.png"), fullPage: true });
await browser.close();

console.log(`Status: ${receipt?.status}`);
for (const f of receipt?.fills ?? []) console.log(`  fill $${Number(f.notional).toFixed(2)} @ $${Number(f.fillPrice).toFixed(2)} · https://basescan.org/tx/${f.transactionId}`);
console.log(`Average fill: ${receipt?.averageFillPrice ?? "—"} · drift ${receipt?.entryDriftBps?.toFixed?.(1) ?? "—"} bps · fees $${receipt?.feesUsd?.toFixed?.(3) ?? "—"}`);
console.log(`Protection: ${receipt?.protection?.status ?? "none"} (stop and target stay live on Flash for 24 h; cancel from the review page)`);
console.log(`Evidence: ${BASE}/api/orders/${encodeURIComponent(orderId)}/evidence?download`);
console.log(`Screenshots: ${OUT}`);
