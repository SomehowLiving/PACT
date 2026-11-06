// End-to-end test of World ID verified-human leaders, against World's staging network.
//
// World's simulator (https://simulator.worldcoin.org) stands in for World App: it generates a
// real World ID 4.0 staging proof for a connector URI and delivers it through World's bridge.
// Everything else is real: PACT signs the request, IDKit runs in the page, PACT forwards the
// proof to World's /v4/verify and binds the nullifier. No funds are used.
//
//   WORLD_ENV=staging npm run dev     # the server must expect staging proofs
//   The simulator is one human, so run against a store where it has not verified yet
//   (delete <store>.humans.json first); otherwise Case 1 is refused as HUMAN_ALREADY_BOUND.
//   node e2e/world.e2e.mjs            # PACT_URL, E2E_OUT, CHROME_PATH optional
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { IDKit, proofOfHuman } from "@worldcoin/idkit-core";

const BASE = process.env.PACT_URL ?? "http://localhost:3000";
const OUT = (process.env.E2E_OUT ?? join(process.cwd(), "e2e", "out")) + "/";
const CHROME = process.env.CHROME_PATH ?? join(homedir(), ".cache/ms-playwright/chromium-1248/chrome-linux64/chrome");
const SIMULATOR = "https://simulator.worldcoin.org/api/mcp";
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

async function api(path, body, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null), setCookie: res.headers.get("set-cookie") };
}

async function signInNode(account) {
  const { json } = await api("/api/session/nonce", { address: account.address });
  const signature = await account.signMessage({ message: json.message });
  const res = await api("/api/session", { message: json.message, signature });
  if (res.status !== 200 || !res.setCookie) throw new Error(`sign-in failed: ${JSON.stringify(res.json)}`);
  return res.setCookie.split(";")[0];
}

/** World's simulator completes a staging Proof of Human request for this connector URI. */
async function simulate(connectUrl) {
  const res = await fetch(SIMULATOR, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "complete_test_request", arguments: { connect_url: connectUrl } } }),
  });
  const text = await res.text();
  const frames = text
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => JSON.parse(l.slice(5)));
  const msg = frames.at(-1) ?? JSON.parse(text);
  if (msg.error || msg.result?.isError) throw new Error(`simulator: ${JSON.stringify(msg.error ?? msg.result).slice(0, 300)}`);
  return msg.result;
}

async function disciplinedPlan() {
  const entry = Number((await api("/api/health")).json?.price);
  if (!(entry > 0)) throw new Error("could not price WETH");
  return {
    orderType: "twap",
    qty: "25",
    durationSeconds: 600,
    entryReferencePrice: entry.toFixed(2),
    stopLossPrice: (entry * 0.98).toFixed(2),
    takeProfitPrice: (entry * 1.04).toFixed(2),
    invalidation: "The entry thesis is invalid below the published stop.",
  };
}

/** A page whose injected wallet is `account` (personal_sign only: sign-in). */
async function walletPage(browser, account) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await ctx.newPage();
  await page.exposeFunction("__signMsg", async (hex) => {
    const message = Buffer.from(hex.slice(2), "hex").toString("utf8");
    return account.signMessage({ message });
  });
  await page.addInitScript((addr) => {
    const listeners = {};
    window.ethereum = {
      isMetaMask: true,
      on: (e, f) => ((listeners[e] ??= []).push(f)),
      removeListener: (e, f) => (listeners[e] = (listeners[e] ?? []).filter((x) => x !== f)),
      request: async ({ method, params = [] }) => {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [addr];
        if (method === "eth_chainId") return "0x2105";
        if (method === "personal_sign") return window.__signMsg(params[0]);
        throw new Error(`mock wallet: unsupported ${method}`);
      },
    };
  }, account.address);
  return { ctx, page };
}

const config = (await api("/api/world")).json;
if (!config?.enabled) {
  console.log(`World ID is not configured on ${BASE}: missing ${config?.missing?.join(", ")}`);
  process.exit(1);
}
if (config.environment !== "staging") {
  console.log(`The server expects ${config.environment} proofs; start it with WORLD_ENV=staging to use the simulator.`);
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const a = privateKeyToAccount(generatePrivateKey());
const b = privateKeyToAccount(generatePrivateKey());

try {
  // ---------- Case 1: a leader verifies in the browser ----------
  console.log("\n# Case 1: a leader verifies as a unique human from the Publish page");
  {
    const unsigned = await api("/api/world/sign", { address: a.address });
    check("an RP signature needs the leader's session", unsigned.status === 401, `status ${unsigned.status}`);

    const { page } = await walletPage(browser, a);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${BASE}/leader`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^connect( wallet)?$/i }).first().click();
    await page.getByText(new RegExp(a.address.slice(0, 6), "i")).filter({ visible: true }).first().waitFor({ timeout: 15000 });
    const panel = page.locator(".panel", { hasText: "one unique human per leader address" }).first();
    await panel.scrollIntoViewIfNeeded();
    await panel.getByRole("button", { name: "Verify with World ID" }).click();
    const open = panel.getByRole("link", { name: "Open in World App" });
    await open.waitFor({ timeout: 30000 });
    check("the panel shows a World ID QR code and link", (await panel.locator('img[alt="Scan with World App"]').count()) === 1);
    await page.screenshot({ path: OUT + "world-1-qr.png" });

    const connectUrl = await open.getAttribute("href");
    const sim = await simulate(connectUrl);
    check("World's simulator generated and delivered a staging proof", !!sim, JSON.stringify(sim).slice(0, 160));

    await panel.getByText("This wallet was verified on").waitFor({ timeout: 60000 }).catch(async () => {
      console.log("panel says:", (await panel.innerText()).replace(/\n/g, " · "));
    });
    const verified = (await api("/api/world")).json.verified;
    check("PACT verified the proof with World and bound it to the leader", !!verified[a.address.toLowerCase()]);
    check("the panel shows the leader as a verified human", (await panel.getByText("This wallet was verified on").count()) === 1);
    await page.screenshot({ path: OUT + "world-2-verified.png" });

    await page.goto(`${BASE}/leaders/${a.address}`, { waitUntil: "networkidle" });
    check("the leader profile carries the Verified human badge", (await page.getByText("Verified human").count()) > 0);
    const ev = (await api(`/api/evidence?thread=${encodeURIComponent(`leader:${a.address.toLowerCase()}`)}`)).json?.events ?? [];
    const event = ev.find((e) => e.kind === "leader.human_verified");
    check("the evidence log records it with a nullifier digest only", !!event && /^0x[0-9a-f]{64}$/.test(event.data.nullifierDigest) && !("nullifier" in event.data));
    check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  }

  // ---------- Case 2: the same human cannot back a second leader address ----------
  console.log("\n# Case 2: the same human tries to verify a second leader wallet");
  {
    const cookie = await signInNode(b);
    const sig = await api("/api/world/sign", { address: b.address }, cookie);
    check("the leader gets an RP signature for the request", sig.status === 200 && !!sig.json?.sig);
    const request = await IDKit.request({
      app_id: config.app_id,
      action: config.action,
      rp_context: { rp_id: config.rp_id, nonce: sig.json.nonce, created_at: sig.json.created_at, expires_at: sig.json.expires_at, signature: sig.json.sig },
      allow_legacy_proofs: false,
      environment: "staging",
    }).preset(proofOfHuman({ signal: b.address.toLowerCase() }));
    await simulate(request.connectorURI);
    const done = await request.pollUntilCompletion();
    check("the simulator returned a proof for the second wallet", done.success === true, done.success ? "" : String(done.error));
    // Signed in as leader A but presenting B's proof: the signal check refuses it before World.
    const wrongWallet = await api("/api/world/verify", { address: a.address, proof: done.result }, await signInNode(a));
    check("a proof bound to another wallet is refused", wrongWallet.status === 400 && wrongWallet.json?.code === "WORLD_SIGNAL_MISMATCH", `status ${wrongWallet.status} ${wrongWallet.json?.code ?? ""}`);
    const otherSession = await api("/api/world/verify", { address: a.address, proof: done.result }, cookie);
    check("verifying for a wallet you are not signed in as is refused", otherSession.status === 403, `status ${otherSession.status}`);
    const second = await api("/api/world/verify", { address: b.address, proof: done.result }, cookie);
    check("the same human backing a second leader address is refused (409)", second.status === 409 && second.json?.code === "HUMAN_ALREADY_BOUND", `status ${second.status} ${second.json?.code ?? ""}: ${second.json?.error ?? ""}`);
  }

  // ---------- Case 3: a follower copies only verified-human leaders ----------
  console.log("\n# Case 3: a follower's mandate requires verified-human leaders");
  {
    const f = privateKeyToAccount(generatePrivateKey());
    const fc = await signInNode(f);
    const current = (await api(`/api/policy?follower=${f.address}`)).json.policy;
    const saved = await api("/api/policy", { ...current, follows: [a.address, b.address], requireVerifiedHuman: true }, fc);
    check("the follower saves the verified-human rule", saved.status === 200, `status ${saved.status}`);
    const plan = await disciplinedPlan();
    for (const leader of [a, b]) {
      const lc = await signInNode(leader);
      const pub = await api("/api/strategies", { leader: leader.address, ...plan }, lc);
      if (pub.status !== 200) throw new Error(`publish failed: ${JSON.stringify(pub.json)}`);
    }
    const st = (await api(`/api/state?follower=${f.address}`)).json;
    const reasonsFor = (leader) =>
      st.proposals.filter((p) => p.follower.toLowerCase() === f.address.toLowerCase() && p.leader.toLowerCase() === leader.address.toLowerCase()).map((p) => st.decisions[p.id]?.reasons ?? []);
    const fromA = reasonsFor(a);
    const fromB = reasonsFor(b);
    check("the verified leader's plan is not held for identity", fromA.length > 0 && fromA.every((r) => !r.includes("LEADER_NOT_VERIFIED_HUMAN")), JSON.stringify(fromA));
    check("the unverified leader's plan is held (LEADER_NOT_VERIFIED_HUMAN)", fromB.length > 0 && fromB.every((r) => r.includes("LEADER_NOT_VERIFIED_HUMAN")), JSON.stringify(fromB));
  }

  // ---------- Case 4: Autopilot needs a human approval of its exact limits ----------
  console.log("\n# Case 4: Autopilot is approved as a human, bound to its limits");
  {
    const g = privateKeyToAccount(generatePrivateKey());
    const gc = await signInNode(g);
    const current = (await api(`/api/policy?follower=${g.address}`)).json.policy;
    const saved = await api("/api/policy", { ...current, requireHumanForAutopilot: true }, gc);
    check("the follower turns on World ID approval for Autopilot", saved.status === 200, `status ${saved.status}`);
    const limits = { chain: "base", hours: 72, maxPerOrderUsd: 25, maxDailyUsd: 100 };
    const without = await api("/api/autopilot", { follower: g.address, ...limits }, gc);
    check("a session without a human approval is refused", without.status === 403 && without.json?.code === "HUMAN_APPROVAL_REQUIRED", `status ${without.status} ${without.json?.code ?? ""}`);

    const sig = await api("/api/world/sign", { address: g.address, purpose: "autopilot" }, gc);
    const signal = `${g.address.toLowerCase()}:autopilot:${limits.chain}:${limits.hours}h:${limits.maxPerOrderUsd}:${limits.maxDailyUsd}`;
    const request = await IDKit.request({
      app_id: config.app_id,
      action: config.actions.autopilot,
      rp_context: { rp_id: config.rp_id, nonce: sig.json.nonce, created_at: sig.json.created_at, expires_at: sig.json.expires_at, signature: sig.json.sig },
      allow_legacy_proofs: false,
      environment: "staging",
    }).preset(proofOfHuman({ signal }));
    await simulate(request.connectorURI);
    const done = await request.pollUntilCompletion();
    check("the simulator approved these limits", done.success === true, done.success ? "" : String(done.error));

    const replay = await api("/api/autopilot", { follower: g.address, ...limits, maxPerOrderUsd: 2500, maxDailyUsd: 5000, worldProof: done.result }, gc);
    check("the approval cannot be reused for higher limits", replay.status === 403 && replay.json?.code === "WORLD_SIGNAL_MISMATCH", `status ${replay.status} ${replay.json?.code ?? ""}`);
    const created = await api("/api/autopilot", { follower: g.address, ...limits, worldProof: done.result }, gc);
    check("with the approval, the session is created", created.status === 200 && !!created.json?.grant?.id, `status ${created.status} ${created.json?.error ?? ""}`);
    const ev = (await api(`/api/evidence?thread=${encodeURIComponent(`mandate:${g.address.toLowerCase()}`)}`)).json?.events ?? [];
    const approved = ev.find((e) => e.kind === "autopilot.human_approved");
    check("the approval is in the evidence log with its limits", !!approved && approved.data.limits?.maxPerOrderUsd === 25 && /^0x[0-9a-f]{64}$/.test(approved.data.approverDigest));
  }
} catch (e) {
  check("run completed", false, e instanceof Error ? e.message : String(e));
} finally {
  await browser.close();
}

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
