import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultPolicy, USDC, WETH } from "./constants";
import { decide, decideExecution } from "./policy";
import { referenceCheck, revengePattern, styleDrift } from "./signals";
import type { ShadowCopy, Strategy } from "./types";

const L = "0xabcdef1234567890abcdef1234567890abcdef12" as const;
const T0 = Date.parse("2026-11-06T10:00:00Z");
const at = (h: number) => new Date(T0 + h * 3_600_000).toISOString();
const plan = (id: string, qty: string, createdAt: string, extra: Partial<Strategy> = {}) =>
  ({ id, leader: L, side: "buy", qty, targetAsset: WETH, contraAsset: USDC, createdAt, ...extra }) as Strategy;
const stopped = (exitedAt: string): ShadowCopy => ({
  status: "STOPPED",
  sizeUsd: 100,
  quotedAt: exitedAt,
  entryPrice: 2500,
  marketPrice: 2500,
  costRatio: 0.002,
  reasons: [],
  exitedAt,
  source: "flash-quote+geckoterminal-candles",
});

describe("R8 style drift", () => {
  const history = [plan("a", "100", at(-30)), plan("b", "120", at(-20)), plan("c", "90", at(-10))];

  it("needs history, then compares the size with the leader's usual for the same side and pair", () => {
    expect(styleDrift(plan("x", "400", at(0)), history.slice(0, 2))).toBeUndefined();
    expect(styleDrift(plan("x", "400", at(0)), history)).toMatchObject({ level: "alert", value: 4 });
    expect(styleDrift(plan("x", "250", at(0)), history)?.level).toBe("caution");
    expect(styleDrift(plan("x", "110", at(0)), history)?.level).toBe("info");
    // Sells and later plans are not this plan's history.
    const mixed = [...history.slice(0, 2), plan("s", "5", at(-5), { side: "sell" }), plan("late", "1", at(5))];
    expect(styleDrift(plan("x", "400", at(0)), mixed)).toBeUndefined();
  });
});

describe("R9 revenge pattern", () => {
  it("flags a bigger re-entry within a day of a stop-out", () => {
    const loss = plan("l", "100", at(-6), { shadow: stopped(at(-2)) });
    expect(revengePattern(plan("x", "200", at(0)), [loss])).toMatchObject({ level: "alert", value: 2 });
    expect(revengePattern(plan("x", "100", at(0)), [loss])?.level).toBe("caution");
    expect(revengePattern(plan("x", "200", at(0)), [plan("old", "100", at(-40), { shadow: stopped(at(-30)) })])).toBeUndefined();
  });
});

describe("R11 three prices", () => {
  const base = { maxDivergence: 0.01, maxOracleAgeS: 1500, nowMs: T0 };
  const oracle = { price: 2500, updatedAt: new Date(T0 - 300_000).toISOString() };

  it("agrees, disagrees, or says the oracle is unavailable", () => {
    expect(referenceCheck({ ...base, oracle, chart: 2502, quote: 2505 })).toMatchObject({ status: "OK", quoteVsOracleBps: 20 });
    const off = referenceCheck({ ...base, oracle, chart: 2502, quote: 2540 });
    expect(off.status).toBe("DIVERGED");
    expect(off.quoteVsOracleBps).toBeCloseTo(160, 6);
    expect(referenceCheck({ ...base, oracle: { ...oracle, updatedAt: new Date(T0 - 3_600_000).toISOString() }, quote: 2500 }).status).toBe("UNAVAILABLE");
    expect(referenceCheck({ ...base, quote: 2500 }).status).toBe("UNAVAILABLE");
  });

  it("makes a copy wait at quote time only when the prices disagree", () => {
    const policy = { maxPriceImpact: "0.01", maxEntryDrift: "0.05", maxExecutionCost: "0.03" };
    const metrics = { executionPrice: "2540", costRatio: "0.002" };
    expect(decideExecution({ entryReferencePrice: "2540" }, policy, metrics, { status: "DIVERGED" })?.reasons).toEqual(["REFERENCE_PRICE_DIVERGENCE"]);
    expect(decideExecution({ entryReferencePrice: "2540" }, policy, metrics, { status: "UNAVAILABLE" })).toBeUndefined();
  });
});

describe("policy reads plan-time signals", () => {
  it("holds a revenge pattern for review", () => {
    const p = { ...defaultPolicy("0x2222222222222222222222222222222222222222"), requirePlanProtection: false };
    const prop = { side: "buy", orderType: "twap", chain: "base", qty: "25", notionalUsd: 25, targetAsset: WETH, contraAsset: USDC } as never;
    const signal = { id: "REVENGE_PATTERN" as const, level: "alert" as const, detail: "", source: "" };
    expect(decide(prop, p, { dailySpentUsd: 0, planSignals: [signal] }).reasons).toEqual(["LEADER_REVENGE_PATTERN"]);
    expect(decide(prop, p, { dailySpentUsd: 0, planSignals: [{ ...signal, level: "caution" }] }).reasons).not.toContain("LEADER_REVENGE_PATTERN");
  });
});

describe("style drift in sizing", () => {
  const g = globalThis as unknown as { __pact?: unknown; __pactEvidence?: unknown };

  it("brings a proportional copy back to the leader's usual size and says why; a fixed-size copy keeps its size", async () => {
    delete g.__pact;
    delete g.__pactEvidence;
    process.env.PACT_STORE_FILE = join(tmpdir(), `pact-signals-test-${process.pid}.json`);
    const store = await import("./store");
    store.resetStore();
    const proportional = "0x1234567890abcdef1234567890abcdef12345678" as const;
    const fixed = "0x1234567890abcdef1234567890abcdef12345679" as const;
    store.upsertPolicy({ ...defaultPolicy(proportional), follows: [L], copyRatio: 0.1, maxNotionalUsd: 1000, maxDailyUsd: 5000, maxLeaderDailyUsd: 5000, maxAssetExposureUsd: 5000, maxOpenPlans: 10, maxOpenPlansPerLeader: 10 });
    const fixedBase = defaultPolicy(fixed);
    store.upsertPolicy({
      ...fixedBase,
      follows: [L],
      mandates: [
        { leader: L, sizingMode: "FIXED", copyRatio: 0.1, fixedNotionalUsd: 20, riskBudgetUsd: 5, maxDailyUsd: 500, allowOrderTypes: ["twap", "market", "limit"], exitMode: "FOLLOWER_BRACKET" },
      ],
    });
    const publish = (qty: string) =>
      store.addStrategy({
        leader: L,
        title: `plan ${qty}`,
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
        qty,
        durationSeconds: 600,
      });
    for (const [q, h] of [["100", 30], ["100", 20], ["100", 10]] as const) {
      const s = publish(q);
      s.createdAt = new Date(Date.now() - h * 3_600_000).toISOString();
    }
    const big = publish("400");
    const a = await store.createProposal(big.id, proportional);
    expect(a.proposal.signals?.find((s) => s.id === "STYLE_DRIFT")).toMatchObject({ level: "alert", value: 4 });
    expect(Number(a.proposal.qty)).toBeCloseTo(10, 6); // 0.1 × the usual $100, not 0.1 × $400
    expect(a.decision).toMatchObject({ verdict: "MODIFY", action: "SCALE" });
    expect(a.decision.reasons).toContain("LEADER_SIZE_OUT_OF_CHARACTER");

    const b = await store.createProposal(big.id, fixed);
    expect(b.proposal.signals?.find((s) => s.id === "STYLE_DRIFT")?.level).toBe("alert");
    expect(Number(b.proposal.qty)).toBe(20);
    expect(b.decision.reasons).not.toContain("LEADER_SIZE_OUT_OF_CHARACTER");
  });
});
