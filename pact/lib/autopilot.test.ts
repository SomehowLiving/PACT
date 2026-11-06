import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { decodeAbiParameters, recoverAddress, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultPolicy, USDC, WETH } from "./constants";
import { FLASH_SPENDER } from "./chains";

const { postQuote } = vi.hoisted(() => ({ postQuote: vi.fn() }));
vi.mock("./flash", async (orig) => ({ ...(await orig<typeof import("./flash")>()), postQuote }));
vi.mock("./reference", () => ({ referenceAtQuote: async () => undefined, DEFAULT_MAX_REFERENCE_DIVERGENCE: "0.01" }));
vi.mock("./oracle", () => ({ ethUsdReference: async () => ({ price: 2500, updatedAt: new Date().toISOString(), source: "chainlink-base-eth-usd" }), ORACLE_MAX_AGE_S: 1500 }));

const g = globalThis as unknown as { __pact?: unknown; __pactEvidence?: unknown; __pactGrants?: unknown };
const F = "0x1234567890abcdef1234567890abcdef12345678" as const;

/** A Flash-shaped quote funded by `funder`: $qty USDC → WETH at $2,500. */
function quoteFor(funder: string, qty: number, recipient = funder) {
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  return {
    quoteId: "q-auto",
    estimatedPriceImpact: "0.0003",
    from: { amount: String(qty), notional: String(qty) },
    to: { amount: String(qty / 2500), notional: String(qty * 0.998) },
    fees: { estimatedFeeNotional: "0" },
    evm: {
      orderTypedData: JSON.stringify({
        domain: { name: "DefinitiveFlashAllowance", version: "1", chainId: "8453", verifyingContract: FLASH_SPENDER },
        types: {
          FlashOrder: [
            { name: "swapper", type: "address" },
            { name: "vault", type: "address" },
            { name: "recipient", type: "address" },
            { name: "fromToken", type: "address" },
            { name: "toToken", type: "address" },
            { name: "fromAmount", type: "uint256" },
            { name: "salt", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        primaryType: "FlashOrder",
        message: {
          swapper: funder,
          vault: "0x1074393effFCf1A15e306cD3931F48eDA9ABcd55",
          recipient,
          fromToken: USDC,
          toToken: WETH,
          fromAmount: String(qty * 1e6),
          salt: "7",
          deadline: String(deadline),
        },
      }),
    },
  };
}

async function setup() {
  delete g.__pact;
  delete g.__pactEvidence;
  delete g.__pactGrants;
  process.env.PACT_STORE_FILE = join(tmpdir(), `pact-autopilot-test-${process.pid}.json`);
  process.env.PACT_SESSION_SECRET = "autopilot-test-secret";
  const store = await import("./store");
  const autopilot = await import("./autopilot");
  const ev = await import("./evidence");
  store.resetStore();
  autopilot.resetGrants();
  await store.seedDemo();
  const leader = store.DEMO_LEADER;
  store.upsertPolicy({
    ...defaultPolicy(F),
    follows: [leader],
    automationMode: "AUTOPILOT",
    mandates: [
      { leader, sizingMode: "FIXED", copyRatio: 0.25, fixedNotionalUsd: 25, riskBudgetUsd: 5, maxDailyUsd: 500, allowOrderTypes: ["twap", "market", "limit"], exitMode: "MANUAL" },
    ],
  });
  const plan = store.addStrategy({
    leader,
    title: "autopilot plan",
    thesis: "t",
    invalidation: "below the stop",
    expiresAt: new Date(Date.now() + 4 * 3_600_000).toISOString(),
    entryReferencePrice: "2500",
    stopLossPrice: "2450",
    takeProfitPrice: "2600",
    protectionExpiresAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
    chain: "base",
    targetAsset: WETH,
    contraAsset: USDC,
    side: "buy",
    orderType: "twap",
    qty: "100",
    durationSeconds: 600,
  });
  const { proposal, decision } = await store.createProposal(plan.id, F);
  return { store, autopilot, ev, proposal, decision };
}

beforeEach(() => {
  postQuote.mockReset();
});

describe("Autopilot session grants", () => {
  it("keeps the session key encrypted and out of every public view", async () => {
    const { autopilot } = await setup();
    const grant = await autopilot.createGrant({ follower: F, chain: "base", hours: 24, maxPerOrderUsd: 50, maxDailyUsd: 200 });
    const view = await autopilot.publicGrant(grant);
    expect(view).not.toHaveProperty("encryptedKey");
    expect(JSON.stringify(view)).not.toContain(grant.encryptedKey);
    expect(view.status).toBe("NOT_DEPLOYED"); // no factory configured in tests
    const onDisk = readFileSync(process.env.PACT_STORE_FILE!.replace(/\.json$/, ".grants.json"), "utf8");
    expect(onDisk).toContain(grant.encryptedKey);
    expect(onDisk).not.toMatch(/"0x[0-9a-f]{64}"/); // no raw private key
    expect(grant.scope.maxPerOrder[0]).toBe("50000000"); // $50 in USDC base units
  });

  it("signs only inside the scope, and the signature is the session key's", async () => {
    const { autopilot } = await setup();
    const grant = await autopilot.createGrant({ follower: F, chain: "base", hours: 24, maxPerOrderUsd: 50, maxDailyUsd: 200 });
    const ok = await autopilot.sessionSign(grant, quoteFor(grant.account, 25).evm.orderTypedData);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const [kind, key, , sig] = decodeAbiParameters([{ type: "uint8" }, { type: "address" }, { type: "bytes" }, { type: "bytes" }], ok.signature);
    expect(kind).toBe(1);
    expect(key).toBe(grant.sessionKey);
    expect(await recoverAddress({ hash: ok.digest, signature: sig as Hex })).toBe(grant.sessionKey);

    const theft = await autopilot.sessionSign(grant, quoteFor(grant.account, 25, "0x000000000000000000000000000000000000bEEF").evm.orderTypedData);
    expect(theft).toEqual({ ok: false, violations: ["swapper or recipient is not the PACT wallet"] });
    const big = await autopilot.sessionSign(grant, quoteFor(grant.account, 80).evm.orderTypedData);
    expect(big.ok ? [] : big.violations).toContain("over the per-order cap");
  });
});

describe("Autopilot runs", () => {
  it("quotes for the PACT wallet, passes policy and guard, signs, and stays a dry run until the grant is live on chain", async () => {
    const { autopilot, ev, proposal, decision } = await setup();
    expect(decision.verdict).not.toBe("BLOCK");
    const grant = await autopilot.createGrant({ follower: F, chain: "base", hours: 24, maxPerOrderUsd: 50, maxDailyUsd: 200 });
    postQuote.mockImplementation(async (body: { funderAddress: string; qty: string }) => quoteFor(body.funderAddress, Number(body.qty)));
    const run = await autopilot.runAutopilot(proposal.id);
    expect(postQuote.mock.calls[0]?.[0]?.funderAddress, JSON.stringify(run)).toBe(grant.account);
    expect(run.outcome).toBe("DRY_RUN");
    expect(run.reasons).toEqual(["GRANT_NOT_DEPLOYED"]);
    expect(run.signatures?.map((s) => s.kind)).toEqual(["order"]);
    const trail = ev.threadEvents(ev.threads.proposal(proposal.id)).map((e) => e.kind);
    expect(trail).toContain("quote.stored");
    expect(trail.at(-1)).toBe("autopilot.run");
    expect((await ev.verifyLog(ev.evidenceLog())).ok).toBe(true);
  });

  it("skips with a reason when Autopilot is off, the copy is over the grant, or the grant is revoked", async () => {
    const { store, autopilot, proposal } = await setup();
    const grant = await autopilot.createGrant({ follower: F, chain: "base", hours: 24, maxPerOrderUsd: 10, maxDailyUsd: 100 });
    expect((await autopilot.runAutopilot(proposal.id)).reasons).toEqual(["OVER_GRANT_PER_ORDER"]);
    autopilot.revokeGrant(F, grant.id);
    expect((await autopilot.runAutopilot(proposal.id)).reasons).toEqual(["NO_ACTIVE_GRANT"]);
    store.upsertPolicy({ ...store.policyFor(F), automationMode: "REVIEW" });
    expect((await autopilot.runAutopilot(proposal.id)).reasons).toEqual(["AUTOPILOT_OFF"]);
    expect(postQuote).not.toHaveBeenCalled();
  });
});
