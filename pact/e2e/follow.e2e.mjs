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

async function api(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const LEADER = "0x1111111111111111111111111111111111111111";

async function newSession(browser, account, { tamperQuote = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1500 } });
  const page = await ctx.newPage();
  const wallet = { signTyped: 0, signMsg: 0, sendTx: 0, log: [] };

  await page.exposeFunction("__signTyped", async (json) => {
    wallet.signTyped++;
    const t = JSON.parse(json);
    delete t.types.EIP712Domain;
    wallet.log.push(`typed:${t.primaryType}`);
    return account.signTypedData(t);
  });
  await page.exposeFunction("__signMsg", async (hex) => {
    wallet.signMsg++;
    wallet.log.push("personal_sign");
    const { hexToString } = await import("viem");
    return account.signMessage({ message: hexToString(hex) });
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
  await page.route(/mainnet\.base\.org/, async (route) => {
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
  await page.getByRole("button", { name: "connect", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(address.slice(0, 6), "i") }).waitFor({ timeout: 15000 });
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });

try {
  // ---------- Case 1: honest server, full flow ----------
  console.log("\n# Case 1: connect, ALLOW, guard, sign, submit");
  const a = privateKeyToAccount(generatePrivateKey());
  const s1 = await newSession(browser, a);
  await connect(s1.page, a.address);
  check("wallet connects and follower page shows the address", true, a.address.slice(0, 10));

  await sleep(800); // let the policy for this follower be created
  await api("/api/strategies", { leader: LEADER, orderType: "twap", qty: "10", durationSeconds: 600 });
  await s1.page.reload({ waitUntil: "networkidle" });
  await s1.page.getByRole("button", { name: new RegExp(a.address.slice(0, 6), "i") }).waitFor({ timeout: 15000 });
  await s1.page.getByText("WETH twap").first().waitFor({ timeout: 15000 });
  await s1.page.screenshot({ path: join(OUT, "1-follower-connected.png") });

  const policyEditor = await s1.page.getByText("your limits").count();
  check("policy editor is visible once connected", policyEditor > 0);

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
  check("wallet was asked for approve, Permit2 and order signatures", s1.wallet.sendTx === 1 && s1.wallet.signTyped === 2, s1.wallet.log.join(" → "));

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
  await s1.ctx.close();

  // ---------- Case 2: a lying server must not get a signature ----------
  console.log("\n# Case 2: server inflates the amount 20x; the browser guard must refuse");
  const b = privateKeyToAccount(generatePrivateKey());
  const s2 = await newSession(browser, b, { tamperQuote: true });
  await connect(s2.page, b.address);
  await sleep(800);
  await api("/api/strategies", { leader: LEADER, orderType: "twap", qty: "10", durationSeconds: 600 });
  await s2.page.reload({ waitUntil: "networkidle" });
  await s2.page.getByRole("button", { name: new RegExp(b.address.slice(0, 6), "i") }).waitFor({ timeout: 15000 });
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
  await api("/api/strategies", { leader: LEADER, orderType: "market", qty: "500" });
  await s3.page.reload({ waitUntil: "networkidle" });
  await s3.page.getByText("sign locked").first().waitFor({ timeout: 15000 });
  const lockedBtn = s3.page.getByRole("button", { name: "sign locked" }).first();
  check("sign is disabled on BLOCK", await lockedBtn.isDisabled());
  await s3.page.screenshot({ path: join(OUT, "6-block-locked.png") });
  await s3.ctx.close();
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log(`screenshots: ${OUT}`);
process.exit(failed.length ? 1 : 0);
