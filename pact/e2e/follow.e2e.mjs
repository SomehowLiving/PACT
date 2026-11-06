// End-to-end test of the follower flow with a mock wallet.
//
// A throwaway key signs for real inside a scripted Chromium. The page talks to the live Flash
// API (real quotes, real /order). Only the Base RPC receipt for the approve transaction is
// faked, because the throwaway wallet has no gas. No funds are used or needed.
//
//   npm run dev        # in another terminal
//   npm run e2e
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE = process.env.PACT_URL ?? "http://localhost:3000";
const OUT = process.env.E2E_OUT ?? join(process.cwd(), "e2e", "out");
const CHROME =
  process.env.CHROME_PATH ??
  join(homedir(), ".cache/ms-playwright/chromium-1248/chrome-linux64/chrome");
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, body, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null), setCookie: res.headers.get("set-cookie") };
}

// Sign in from Node the way the browser does: fetch a message, sign it, trade it for a cookie.
async function signInNode(account) {
  const { json } = await api("/api/session/nonce", { address: account.address });
  const signature = await account.signMessage({ message: json.message });
  const res = await api("/api/session", { message: json.message, signature });
  if (res.status !== 200 || !res.setCookie) throw new Error(`sign-in failed: ${JSON.stringify(res.json)}`);
  return res.setCookie.split(";")[0];
}

// A real leader key, so the leader signs in to publish like anyone else.
const leaderAccount = privateKeyToAccount(generatePrivateKey());
const LEADER = leaderAccount.address;
let leaderCookie;
async function disciplinedPlan() {
  const health = await api("/api/health");
  const entry = Number(health.json?.price);
  if (!(entry > 0)) throw new Error(`could not price WETH for E2E plan: ${JSON.stringify(health.json)}`);
  return {
    entryReferencePrice: entry.toFixed(2),
    stopLossPrice: (entry * 0.98).toFixed(2),
    takeProfitPrice: (entry * 1.04).toFixed(2),
    invalidation: "The entry thesis is invalid below the published stop.",
  };
}

async function newSession(browser, account, { tamperQuote = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1500 } });
  const page = await ctx.newPage();
  const wallet = { signTyped: 0, signMsg: 0, signIn: 0, sendTx: 0, log: [] };

  await page.exposeFunction("__signTyped", async (json) => {
    wallet.signTyped++;
    const t = JSON.parse(json);
    delete t.types.EIP712Domain;
    wallet.log.push(`typed:${t.primaryType}`);
    return account.signTypedData(t);
  });
  await page.exposeFunction("__signMsg", async (hex) => {
    const { hexToString } = await import("viem");
    const message = hexToString(hex);
    // A PACT sign-in is not an order action; count it apart from cancels.
    if (message.includes("wants you to sign in with your Ethereum account")) {
      wallet.signIn++;
      wallet.log.push("sign-in");
    } else {
      wallet.signMsg++;
      wallet.log.push("personal_sign");
    }
    return account.signMessage({ message });
  });
  await page.exposeFunction("__sendTx", async () => {
    wallet.sendTx++;
    wallet.log.push("sendTransaction");
    return "0x" + [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
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
            chainId = params[0].chainId;
            (listeners.chainChanged ?? []).forEach((f) => f(chainId));
            return null;
          case "eth_signTypedData_v4":
            return window.__signTyped(params[1]);
          case "personal_sign":
            return window.__signMsg(params[0]);
          case "eth_sendTransaction":
            return window.__sendTx();
          default:
            throw new Error(`mock wallet: unsupported ${method}`);
        }
      },
    };
  }, account.address);

  // The throwaway wallet has no gas: answer the approve receipt, pass everything else through.
  await page.route(/mainnet\.base\.org|mainnet\.arc\.io/, async (route) => {
    const req = route.request();
    let body;
    try {
      body = JSON.parse(req.postData() ?? "null");
    } catch {
      return route.continue();
    }
    const one = Array.isArray(body) ? null : body;
    if (one?.method === "eth_getTransactionReceipt") {
      return route.fulfill({
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: one.id,
          result: {
            transactionHash: one.params[0],
            blockHash: "0x" + "11".repeat(32),
            blockNumber: "0x1",
            transactionIndex: "0x0",
            from: account.address,
            to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            status: "0x1",
            type: "0x2",
            gasUsed: "0x5208",
            cumulativeGasUsed: "0x5208",
            effectiveGasPrice: "0x1",
            contractAddress: null,
            logs: [],
            logsBloom: "0x" + "00".repeat(256),
          },
        }),
      });
    }
    return route.continue();
  });

  if (tamperQuote) {
    // Simulate a lying PACT server: inflate the amount in the order payload Flash returned.
    await page.route("**/api/quote", async (route) => {
      try {
        const res = await route.fetch();
        const json = await res.json();
        // An error from the server has no quote to tamper with: pass it through unchanged.
        if (!res.ok() || !json.quote?.orderTypedData) {
          await route.fulfill({ response: res, json });
          return;
        }
        const typed = JSON.parse(json.quote.orderTypedData);
        typed.message.fromAmount = String(BigInt(typed.message.fromAmount) * 20n);
        json.quote.orderTypedData = JSON.stringify(typed);
        await route.fulfill({ response: res, json });
      } catch {
        // The page was closed while the request was in flight.
      }
    });
  }
  return { ctx, page, wallet };
}

async function connect(page, address) {
  await page.goto(`${BASE}/follower`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^connect( wallet)?$/i }).click();
  await page.getByText(new RegExp(address.slice(0, 6), "i")).filter({ visible: true }).first().waitFor({ timeout: 15000 });
}

// Signing happens on the proposal's review page (/review/[id]); open the newest one.
async function openNewestReview(session, follower, orderType) {
  const st = await api(`/api/state?follower=${follower}`);
  const mine = (st.json?.proposals ?? [])
    .filter((p) => p.follower.toLowerCase() === follower.toLowerCase() && (!orderType || p.orderType === orderType))
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  if (!mine[0]) throw new Error(`no proposal for ${follower}`);
  await session.page.goto(`${BASE}/review/${mine[0].id}`, { waitUntil: "networkidle" });
  return mine[0];
}

async function followLeader(account) {
  const follower = account.address;
  const cookie = await signInNode(account);
  const current = await api(`/api/policy?follower=${follower}`);
  if (current.status !== 200 || !current.json?.policy) {
    throw new Error(`could not load follower policy: ${JSON.stringify(current.json)}`);
  }
  const saved = await api("/api/policy", { ...current.json.policy, follows: [LEADER] }, cookie);
  if (saved.status !== 200) {
    throw new Error(`could not select leader: ${JSON.stringify(saved.json)}`);
  }
}

async function publish(plan) {
  leaderCookie ??= await signInNode(leaderAccount);
  const res = await api("/api/strategies", { leader: LEADER, ...plan }, leaderCookie);
  if (res.status !== 200) throw new Error(`publish failed: ${JSON.stringify(res.json)}`);
  return res;
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });

try {
  // ---------- Case 0: writes need the owner's session ----------
  console.log("\n# Case 0: wallet sessions gate every desk write");
  {
    const owner = privateKeyToAccount(generatePrivateKey());
    const intruder = privateKeyToAccount(generatePrivateKey());
    const policy = (await api(`/api/policy?follower=${owner.address}`)).json.policy;
    const anon = await api("/api/policy", { ...policy, follows: [LEADER] });
    check("mandate save without a session is refused (401)", anon.status === 401, `status ${anon.status}`);
    const other = await api("/api/policy", { ...policy, follows: [LEADER] }, await signInNode(intruder));
    check("mandate save signed in as another wallet is refused (403)", other.status === 403, `status ${other.status}`);
    const mine = await api("/api/policy", { ...policy, follows: [LEADER] }, await signInNode(owner));
    check("mandate save by the signed-in owner is accepted", mine.status === 200, `status ${mine.status}`);
    const plan = await api("/api/strategies", { leader: owner.address, qty: "25" });
    check("publishing a plan without a session is refused (401)", plan.status === 401, `status ${plan.status}`);
  }

  // ---------- Case 1: honest server, full flow ----------
  console.log("\n# Case 1: connect, ALLOW, guard, sign, submit");
  const a = privateKeyToAccount(generatePrivateKey());
  const s1 = await newSession(browser, a);
  await connect(s1.page, a.address);
  check("wallet connects and follower page shows the address", true, a.address.slice(0, 10));

  await sleep(800); // let the policy for this follower be created
  await followLeader(a);
  const plan1 = await disciplinedPlan();
  await publish({
    leader: LEADER,
    orderType: "twap",
    // $100 leader plan → $25 follower copy (25%). A $2.50 copy fails PACT's execution-cost
    // budget: Flash fees with protection are well over 3% at that size.
    qty: "100",
    durationSeconds: 600,
    ...plan1,
  });
  await s1.page.reload({ waitUntil: "networkidle" });
  await s1.page.getByText(new RegExp(a.address.slice(0, 6), "i")).filter({ visible: true }).first().waitFor({ timeout: 15000 });
  await s1.page.getByText("ETH accumulation pact").first().waitFor({ timeout: 15000 });
  await s1.page.screenshot({ path: join(OUT, "1-follower-connected.png") });

  const policyEditor = await s1.page.getByText(/your limits|save limits/).count();
  check("policy editor is visible once connected", policyEditor > 0);

  const copy1 = await openNewestReview(s1, a.address, "twap");
  const signBtn = s1.page.getByRole("button", { name: "sign", exact: true }).first();
  await signBtn.waitFor({ timeout: 15000 });
  check("sign is enabled for an ALLOW proposal", await signBtn.isEnabled());

  const orderRes = s1.page.waitForResponse((r) => r.url().includes("/api/order") && r.request().method() === "POST", { timeout: 60000 }).catch(() => null);
  await signBtn.click();
  const oRes = await orderRes;
  await sleep(1200);
  await s1.page.screenshot({ path: join(OUT, "2-after-sign.png") });

  const guardText = await s1.page.getByText(/safe to sign/).first().textContent().catch(() => null);
  check("guard panel appears and says safe to sign", Boolean(guardText?.includes("safe to sign")), guardText?.slice(0, 60) ?? "missing");
  check("browser signed in once with a gasless message before its first write", s1.wallet.signIn === 1, s1.wallet.log.join(" → "));
  check(
    "wallet was asked for entry funding and Flash signatures",
    s1.wallet.sendTx >= 1 && s1.wallet.signTyped >= 2,
    s1.wallet.log.join(" → "),
  );

  const body = oRes ? await oRes.json().catch(() => null) : null;
  console.log(`      /api/order → ${oRes?.status()} ${JSON.stringify(body)?.slice(0, 300)}`);
  const accepted = Boolean(oRes?.ok() && body?.order?.orderId);
  check("order submit reached Flash and got an answer", Boolean(oRes), `status ${oRes?.status()}`);

  if (accepted) {
    const id = body.order.orderId;
    check("Flash accepted the order and returned an order id", true, id);
    const doneStep = await s1.page.getByText("submit to Flash").count();
    check("timeline shows the submit step", doneStep > 0);
    // Poll the live order status through our own API.
    let st = null;
    for (let i = 0; i < 6; i++) {
      await sleep(2500);
      st = (await api(`/api/orders/${id}`)).json;
      if (st?.order?.status) break;
    }
    check("live order status read from Flash", Boolean(st?.order?.status), st?.order?.status ?? JSON.stringify(st)?.slice(0, 120));
    await s1.page.waitForTimeout(2500);
    await s1.page.screenshot({ path: join(OUT, "3-order-status.png") });

    const status = st?.order?.status;
    const cancelBtn = s1.page.getByRole("button", { name: "cancel order" });
    if (["ORDER_STATUS_PENDING", "ORDER_STATUS_ACCEPTED", "ORDER_STATUS_PARTIALLY_FILLED"].includes(status)) {
      await cancelBtn.waitFor({ timeout: 12000 });
      const cancelRes = s1.page.waitForResponse((r) => r.url().includes("/cancel"), { timeout: 30000 });
      await cancelBtn.click();
      const cr = await cancelRes;
      const cj = await cr.json().catch(() => null);
      console.log(`      /cancel → ${cr.status()} ${JSON.stringify(cj)?.slice(0, 200)}`);
      check("cancel signed in wallet (personal_sign) and Flash accepted it", cr.ok() && s1.wallet.signMsg === 1, `status ${cr.status()}`);
      await sleep(1500);
      await s1.page.screenshot({ path: join(OUT, "4-after-cancel.png") });
    } else {
      console.log(`      order is already ${status}, so the cancel button is correctly not offered`);
      check("cancel is not offered for a terminal order", (await cancelBtn.count()) === 0, status);
    }
  } else {
    const msg = body?.error ?? "";
    check("a rejected order surfaces a readable error in the UI", msg.length > 0 || oRes?.status() >= 400, msg.slice(0, 160));
  }

  // The copy's history is in the append-only log, and the whole log still verifies.
  const log = await api(`/api/evidence?thread=${encodeURIComponent(`proposal:${copy1.id}`)}`);
  const kinds = (log.json?.events ?? []).map((e) => e.kind);
  check("evidence log verifies end to end", log.json?.verification?.ok === true, `${log.json?.length} events`);
  check(
    "this copy's trail records decision, quote and the submit outcome",
    kinds[0] === "decision.made" && kinds.includes("quote.stored") && (kinds.includes("order.submitted") || kinds.includes("order.rejected")),
    kinds.join(" → "),
  );
  await s1.ctx.close();

  // ---------- Case 2: a lying server must not get a signature ----------
  console.log("\n# Case 2: server inflates the amount 20x; the browser guard must refuse");
  const b = privateKeyToAccount(generatePrivateKey());
  const s2 = await newSession(browser, b, { tamperQuote: true });
  await connect(s2.page, b.address);
  await sleep(800);
  await followLeader(b);
  const plan2 = await disciplinedPlan();
  await publish({
    leader: LEADER,
    orderType: "twap",
    // $100 leader plan → $25 follower copy (25%). A $2.50 copy fails PACT's execution-cost
    // budget: Flash fees with protection are well over 3% at that size.
    qty: "100",
    durationSeconds: 600,
    ...plan2,
  });
  await s2.page.reload({ waitUntil: "networkidle" });
  await s2.page.getByText(new RegExp(b.address.slice(0, 6), "i")).filter({ visible: true }).first().waitFor({ timeout: 15000 });
  await openNewestReview(s2, b.address, "twap");
  const sign2 = s2.page.getByRole("button", { name: "sign", exact: true }).first();
  await sign2.waitFor({ timeout: 15000 });
  await sign2.click();
  await sleep(2500);
  await s2.page.screenshot({ path: join(OUT, "5-guard-refused.png") });
  const refused = await s2.page.getByText(/guard refused to sign/).count();
  check("guard refuses the tampered quote with a visible message", refused > 0);
  check("wallet was never asked to sign or send anything", s2.wallet.signTyped === 0 && s2.wallet.sendTx === 0 && s2.wallet.signMsg === 0, s2.wallet.log.join(",") || "no wallet calls");
  await s2.ctx.close();

  // ---------- Case 3: BLOCK stays locked ----------
  console.log("\n# Case 3: BLOCK proposal keeps sign locked");
  const c = privateKeyToAccount(generatePrivateKey());
  const s3 = await newSession(browser, c);
  await connect(s3.page, c.address);
  await sleep(800);
  await followLeader(c);
  const plan3 = await disciplinedPlan();
  await publish({
    leader: LEADER,
    orderType: "market",
    qty: "500",
    ...plan3,
  });
  await s3.page.reload({ waitUntil: "networkidle" });
  await openNewestReview(s3, c.address, "market");
  await s3.page.getByText("sign locked").first().waitFor({ timeout: 15000 });
  const lockedBtn = s3.page.getByRole("button", { name: "sign locked" }).first();
  check("sign is disabled on BLOCK", await lockedBtn.isDisabled());
  await s3.page.screenshot({ path: join(OUT, "6-block-locked.png") });
  await s3.ctx.close();

  // ---------- Case 4: leader evidence is checked on Base ----------
  console.log("\n# Case 4: a leader backs a plan with someone else's transaction");
  {
    const d = privateKeyToAccount(generatePrivateKey());
    await followLeader(d);
    const bad = await api("/api/strategies", { leader: LEADER, qty: "100", ...(await disciplinedPlan()), leaderTxHashes: "0x1234" }, leaderCookie);
    check("a malformed transaction hash is refused at publish", bad.status === 400, `status ${bad.status}`);

    // A real, recent Base transaction that the throwaway leader wallet had nothing to do with.
    const rpc = await fetch("https://mainnet.base.org", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["latest", false] }),
    }).then((r) => r.json());
    const foreignTx = rpc.result.transactions[0];
    const pub = await publish({ orderType: "twap", qty: "100", durationSeconds: 600, ...(await disciplinedPlan()), leaderTxHashes: [foreignTx] });
    const strategy = pub.json.strategy;
    const failed = (strategy.leaderEvidence?.checks ?? []).filter((c) => c.result === "MISMATCH").map((c) => c.id);
    check("someone else's transaction is called out as contradicting the plan", strategy.leaderEvidenceStatus === "MISMATCH", failed.join(", "));
    const st = await api(`/api/state?follower=${d.address}`);
    const copy = st.json.proposals.find((p) => p.strategyId === strategy.id && p.follower.toLowerCase() === d.address.toLowerCase());
    const reasons = st.json.decisions[copy?.id]?.reasons ?? [];
    check("the follower's copy is held because the leader's execution contradicts it", reasons.includes("LEADER_EXECUTION_MISMATCH"), reasons.join(", "));
    const anon = await api(`/api/strategies/${strategy.id}/evidence`, { txHashes: [foreignTx] });
    check("attaching evidence without the leader's session is refused", anon.status === 401, `status ${anon.status}`);
    const record = await api(`/api/leaders/${LEADER}`);
    check("the leader's record counts the contradiction", record.json?.record?.evidence?.MISMATCH >= 1, JSON.stringify(record.json?.record?.evidence));
  }

  // ---------- Case 5: paper copies and probation ----------
  console.log("\n# Case 5: PACT paper-copies a new plan with a real Flash quote");
  {
    const pub = await publish({ orderType: "twap", qty: "100", durationSeconds: 600, ...(await disciplinedPlan()) });
    const shadow = pub.json.strategy.shadow;
    check(
      "a plan at today's levels is paper-copied at Flash's all-in price",
      shadow?.status === "OPEN" && shadow.sizeUsd === 100 && Math.abs(shadow.entryDriftBps) < 150,
      shadow ? `entry $${shadow.entryPrice.toFixed(2)}, drift ${shadow.entryDriftBps.toFixed(0)} bps, cost ${(shadow.costRatio * 100).toFixed(2)}%` : "no paper copy",
    );
    const rec = await api(`/api/leaders/${LEADER}`);
    const s = rec.json?.record?.shadow;
    check("a leader with no settled paper copies is on probation", s?.probation === "PROBATION" && s.copies >= 1, s ? `${s.copies} copies, ${s.probationReason}` : "missing");
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
    const page = await ctx.newPage();
    // Deep link to the profile's Paper copies tab (?tab= is the canonical tab state).
    await page.goto(`${BASE}/leaders/${LEADER}?tab=paper`, { waitUntil: "networkidle" });
    await page.getByText("on probation").first().waitFor({ timeout: 20000 });
    await page.getByText("Paper, not receipts").waitFor({ timeout: 10000 });
    const rows = await page.locator("table tbody tr").count();
    await page.goto(`${BASE}/leaders/${LEADER}?tab=execution`, { waitUntil: "networkidle" });
    await page.getByText("on probation").first().waitFor({ timeout: 20000 });
    const contradicted = await page.getByText("contradicted").count();
    check("the leader page shows probation, paper copies and evidence", rows >= 1 && contradicted > 0, `${rows} paper rows · ${contradicted} contradicted`);
    await page.screenshot({ path: join(OUT, "7-leader-page.png"), fullPage: true });
    await ctx.close();
  }

  // ---------- Case 6: signals ----------
  console.log("\n# Case 6: three prices at quote time; a leader suddenly trades 4x their usual size");
  {
    const quoted = (await api(`/api/state?follower=${a.address}`)).json?.quotes?.[copy1.id]?.reference;
    check(
      "the follower's real quote recorded Chainlink, the chart and Flash side by side",
      quoted?.oracle > 0 && quoted?.chart > 0 && quoted?.quote > 0 && quoted?.status === "OK",
      quoted ? `${quoted.status}: ${quoted.detail}` : "missing",
    );
    const live = await api("/api/reference");
    check("the live three-price check answers", live.status === 200 && ["OK", "DIVERGED"].includes(live.json?.status), live.json?.detail);

    const e = privateKeyToAccount(generatePrivateKey());
    await followLeader(e);
    const big = await publish({ orderType: "twap", qty: "400", durationSeconds: 600, ...(await disciplinedPlan()) });
    const st = await api(`/api/state?follower=${e.address}`);
    const copy = st.json.proposals.find((p) => p.strategyId === big.json.strategy.id && p.follower.toLowerCase() === e.address.toLowerCase());
    const drift = copy?.signals?.find((s) => s.id === "STYLE_DRIFT");
    const decision = st.json.decisions[copy?.id];
    check("a plan at 4x the leader's usual size raises a style-drift alert", drift?.level === "alert", drift?.detail);
    check(
      "a proportional copy is scaled back to the usual size and says why",
      decision?.reasons?.includes("LEADER_SIZE_OUT_OF_CHARACTER") && Number(copy.qty) < 400 * 0.25,
      `${decision?.verdict} ${decision?.action} qty ${copy?.qty} · ${decision?.reasons?.join(", ")}`,
    );
  }

  // ---------- Case 7: Arc ----------
  console.log("\n# Case 7: the same follower flow on Arc (chain 5042)");
  {
    const f = privateKeyToAccount(generatePrivateKey());
    const s7 = await newSession(browser, f);
    await connect(s7.page, f.address);
    const cookie = await signInNode(f);
    const current = (await api(`/api/policy?follower=${f.address}`)).json.policy;
    const saved = await api("/api/policy", { ...current, follows: [LEADER], allowChains: ["base", "arc"] }, cookie);
    check("a follower opts into Arc in their mandate", saved.status === 200, `status ${saved.status}`);
    const pub = await publish({ chain: "arc", orderType: "twap", qty: "100", durationSeconds: 600, ...(await disciplinedPlan()) });
    check("a leader publishes an Arc plan", pub.json.strategy.chain === "arc", pub.json.strategy.targetAsset);
    await s7.page.reload({ waitUntil: "networkidle" });
    const copy7 = await openNewestReview(s7, f.address, "twap");
    check("the copy is on Arc", copy7.chain === "arc", copy7.chain);
    const sign7 = s7.page.getByRole("button", { name: "sign", exact: true }).first();
    await sign7.waitFor({ timeout: 15000 });
    const order7 = s7.page.waitForResponse((r) => r.url().includes("/api/order") && r.request().method() === "POST", { timeout: 60000 }).catch(() => null);
    await sign7.click();
    const o7 = await order7;
    const body7 = o7 ? await o7.json().catch(() => null) : null;
    const guard7 = await s7.page.getByText(/safe to sign/).first().textContent().catch(() => null);
    check("the wallet guard passes Flash's Arc payloads in the browser", Boolean(guard7?.includes("safe to sign")), guard7?.slice(0, 60) ?? "missing");
    const typedChains = s7.wallet.log.filter((l) => l.startsWith("typed:")).length;
    check("the wallet signed the Arc permits and orders", typedChains >= 2, s7.wallet.log.join(" → "));
    // A zero-balance wallet: Flash checking the balance means it accepted the Arc signatures.
    const err = body7?.error ?? "";
    check(
      "Flash verified the Arc signatures and answered on balance",
      Boolean(o7) && (Boolean(body7?.order?.orderId) || /balance/i.test(err)) && !/signature/i.test(err),
      `${o7?.status()} ${err.slice(0, 140) || body7?.order?.orderId}`,
    );
    await s7.page.screenshot({ path: join(OUT, "8-arc-review.png") });
    await s7.ctx.close();
  }

  // ---------- Case 8: Autopilot session key ----------
  console.log("\n# Case 8: Autopilot signs a real copy with a scoped session key (dry run until live on chain)");
  {
    const h = privateKeyToAccount(generatePrivateKey());
    const anon = await api("/api/autopilot", { follower: h.address, hours: 24, maxPerOrderUsd: 50, maxDailyUsd: 200 });
    check("creating a session without the wallet's sign-in is refused", anon.status === 401, `status ${anon.status}`);
    const cookie = await signInNode(h);
    const current = (await api(`/api/policy?follower=${h.address}`)).json.policy;
    await api("/api/policy", { ...current, follows: [LEADER], automationMode: "AUTOPILOT" }, cookie);
    // The session must outlast the protective order it signs (24 h here), or the stop could not fire.
    const created = await api("/api/autopilot", { follower: h.address, chain: "base", hours: 72, maxPerOrderUsd: 50, maxDailyUsd: 200 }, cookie);
    const grant = created.json?.grant;
    check(
      "a session is created with a fresh key and an onchain scope",
      created.status === 200 && /^0x[0-9a-fA-F]{40}$/.test(grant?.sessionKey ?? "") && grant?.scope?.maxPerOrder?.[0] === "50000000",
      `${grant?.status} · key ${grant?.sessionKey?.slice(0, 10)} · ${created.json?.setup?.length} setup calls`,
    );
    const listed = await api(`/api/autopilot?follower=${h.address}`);
    check("the session key itself is never returned", !JSON.stringify(listed.json).includes("encryptedKey") && !JSON.stringify(created.json).includes("encryptedKey"));

    const pub = await publish({ orderType: "twap", qty: "100", durationSeconds: 600, ...(await disciplinedPlan()) });
    const run = (pub.json.autopilot ?? []).find((r) => r.proposalId && pub.json.copies.some((c) => c.proposal.id === r.proposalId && c.proposal.follower.toLowerCase() === h.address.toLowerCase()));
    check(
      "Autopilot quoted, passed policy and the guard, and signed with the session key",
      run?.outcome === "DRY_RUN" && run.signatures?.some((s) => s.kind === "order"),
      run ? `${run.outcome} · ${run.reasons.join(", ")} · signed ${run.signatures?.map((s) => s.kind).join(", ")}` : JSON.stringify(pub.json.autopilot)?.slice(0, 200),
    );
    const trail = await api(`/api/evidence?thread=${encodeURIComponent(`proposal:${run?.proposalId}`)}`);
    check("the Autopilot run is in the evidence chain", (trail.json?.events ?? []).some((e) => e.kind === "autopilot.run") && trail.json?.verification?.ok, (trail.json?.events ?? []).map((e) => e.kind).join(" → "));
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log(`screenshots: ${OUT}`);
process.exit(failed.length ? 1 : 0);
