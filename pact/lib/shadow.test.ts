import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultPolicy, WETH } from "./constants";
import type { Candle } from "./market";
import { decide } from "./policy";
import { PROBATION_PLANS, settleShadow, shadowEntry, shadowSummary } from "./shadow";
import type { ShadowCopy } from "./types";

const T0 = Date.parse("2026-11-06T10:00:00Z");
const plan = {
  entryReferencePrice: "2500",
  stopLossPrice: "2450",
  takeProfitPrice: "2600",
  limitNotionalPrice: undefined as string | undefined,
  orderType: "twap" as const,
  qty: "250",
  expiresAt: new Date(T0 + 4 * 3_600_000).toISOString(),
  protectionExpiresAt: new Date(T0 + 24 * 3_600_000).toISOString(),
};
const entry = (over: Partial<Parameters<typeof shadowEntry>[0]> = {}) =>
  shadowEntry({ plan, allInPrice: 2512.5, marketPrice: 2500, costRatio: 0.005, maxEntryDrift: 0.01, maxExecutionCost: 0.03, at: new Date(T0).toISOString(), ...over });
const candle = (minutes: number, low: number, high: number, close = (low + high) / 2): Candle => ({
  time: (T0 + minutes * 60_000) / 1000,
  open: close,
  high,
  low,
  close,
  volume: 1,
});

describe("paper entry", () => {
  it("enters at Flash's all-in price, sized at most $100, and judges it by the default mandate", () => {
    const e = entry();
    expect(e).toMatchObject({ status: "OPEN", sizeUsd: 100, entryPrice: 2512.5, reasons: [] });
    expect(e.entryDriftBps).toBeCloseTo(50, 6);
    expect(entry({ allInPrice: 2540 }).reasons).toEqual(["ENTRY_DRIFT_TOO_HIGH"]);
    expect(entry({ costRatio: 0.05 }).reasons).toEqual(["EXECUTION_COST_TOO_HIGH"]);
    // The leader's levels are stale: the market is already under the stop.
    expect(entry({ marketPrice: 2240, allInPrice: 2250 }).reasons).toEqual(["PRICE_ALREADY_BELOW_STOP"]);
  });

  it("waits for a limit plan until the market trades through the limit", () => {
    const limitPlan = { ...plan, orderType: "limit" as const, limitNotionalPrice: "2480", entryReferencePrice: "2480" };
    const e = shadowEntry({ plan: limitPlan, allInPrice: 2512, marketPrice: 2500, costRatio: 0.004, maxEntryDrift: 0.02, maxExecutionCost: 0.03, at: new Date(T0).toISOString() });
    expect(e.status).toBe("WAITING_ENTRY");
    const entered = settleShadow(e, limitPlan, [candle(5, 2490, 2505), candle(10, 2478, 2495)], T0 + 15 * 60_000);
    expect(entered.status).toBe("OPEN");
    expect(entered.enteredAt).toBe(new Date(T0 + 10 * 60_000).toISOString());
    const never = settleShadow(e, limitPlan, [candle(5, 2490, 2505)], T0 + 5 * 3_600_000);
    expect(never).toMatchObject({ status: "NOT_COPYABLE", reasons: ["LIMIT_NEVER_REACHED"] });
  });
});

describe("paper settlement on candles", () => {
  const open = entry();

  it("settles at the target, net of the exit cost, as an R multiple", () => {
    const s = settleShadow(open, plan, [candle(5, 2495, 2530), candle(30, 2520, 2601)], T0 + 3_600_000);
    expect(s.status).toBe("TARGET");
    expect(s.exitPrice).toBe(2600);
    expect(s.pnlPct).toBeCloseTo((2600 * 0.995 - 2512.5) / 2512.5, 9);
    expect(s.rMultiple).toBeCloseTo((2600 * 0.995 - 2512.5) / (2512.5 - 2450), 9);
  });

  it("settles at the stop, and reads a candle touching both as the stop", () => {
    expect(settleShadow(open, plan, [candle(5, 2449, 2520)], T0 + 3_600_000).status).toBe("STOPPED");
    const both = settleShadow(open, plan, [candle(5, 2440, 2610)], T0 + 3_600_000);
    expect(both.status).toBe("STOPPED");
    expect(both.rMultiple!).toBeLessThan(-1); // the stop plus costs
  });

  it("marks an open copy without settling it, and expires it at the protection deadline", () => {
    const marked = settleShadow(open, plan, [candle(5, 2490, 2520, 2510)], T0 + 3_600_000);
    expect(marked).toMatchObject({ status: "OPEN", markPrice: 2510 });
    const expired = settleShadow(open, plan, [candle(5, 2490, 2520, 2510), candle(600, 2500, 2540, 2530)], T0 + 25 * 3_600_000);
    expect(expired).toMatchObject({ status: "EXPIRED", exitPrice: 2530 });
    // Candles before the entry are ignored.
    expect(settleShadow({ ...open, enteredAt: new Date(T0 + 60 * 60_000).toISOString() }, plan, [candle(5, 2400, 2420)], T0 + 2 * 3_600_000).status).toBe("OPEN");
  });
});

describe("probation", () => {
  const settled = (status: ShadowCopy["status"], r = 1): ShadowCopy => ({ ...entry(), status, rMultiple: r, pnlPct: r / 100 });

  it("keeps a leader on probation until enough paper copies settle, and while any plan is contradicted", () => {
    const two = [{ shadow: settled("TARGET") }, { shadow: settled("STOPPED", -1) }, { shadow: entry() }];
    expect(shadowSummary(two)).toMatchObject({ probation: "PROBATION", settled: 2, targets: 1, stops: 1 });
    const three = [...two.slice(0, 2), { shadow: settled("EXPIRED", 0.2) }];
    expect(shadowSummary(three)).toMatchObject({ probation: "GRADUATED", settled: PROBATION_PLANS });
    expect(shadowSummary([...three, { leaderEvidenceStatus: "MISMATCH" as const }]).probation).toBe("PROBATION");
  });

  it("flags a leader whose plans mostly could not be copied within default limits (R14)", () => {
    const blocked = { shadow: { ...entry(), status: "NOT_COPYABLE" as const, reasons: ["ENTRY_DRIFT_TOO_HIGH"] } };
    expect(shadowSummary([blocked, blocked, { shadow: entry() }]).uncopyable).toBe(true);
    expect(shadowSummary([blocked, { shadow: entry() }, { shadow: entry() }]).uncopyable).toBe(false);
  });

  it("is a follower's choice in the policy", () => {
    const p = { ...defaultPolicy("0x2222222222222222222222222222222222222222"), requireGraduatedLeader: true, requirePlanProtection: false };
    const prop = { side: "buy", orderType: "twap", chain: "base", qty: "25", notionalUsd: 25, targetAsset: "0x4200000000000000000000000000000000000006", contraAsset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" } as never;
    expect(decide(prop, p, { dailySpentUsd: 0, leaderProbation: "PROBATION" }).reasons).toEqual(["LEADER_ON_PROBATION"]);
    expect(decide(prop, p, { dailySpentUsd: 0, leaderProbation: "GRADUATED" }).reasons).not.toContain("LEADER_ON_PROBATION");
  });
});

describe("paper copies through the store", () => {
  const g = globalThis as unknown as { __pact?: unknown; __pactEvidence?: unknown };

  it("enters with a quote, settles on candles, chains both, and re-decides copies when a leader graduates", async () => {
    delete g.__pact;
    delete g.__pactEvidence;
    process.env.PACT_STORE_FILE = join(tmpdir(), `pact-shadow-test-${process.pid}.json`);
    const store = await import("./store");
    const ev = await import("./evidence");
    const { runShadowEntry, settleShadowFor } = await import("./shadow-run");
    store.resetStore();
    await store.seedDemo();
    const leader = store.DEMO_LEADER;
    const follower = store.DEMO_PORTFOLIO_FOLLOWER;
    store.upsertPolicy({ ...store.policyFor(follower), requireGraduatedLeader: true });
    await store.rebuildFor(follower);
    const held = () =>
      store.snapshot().proposals.filter((p) => p.follower === follower && p.leader === leader).map((p) => store.decisionFor(p.id)?.reasons ?? []);
    expect(held().some((r) => r.includes("LEADER_ON_PROBATION"))).toBe(true);

    // A Flash buy quote for $100: 0.0398 WETH at a $2,500 market, $0.50 fees.
    const quote = async () => ({ from: { amount: "100", notional: "100" }, to: { amount: "0.0398", notional: "99.5" }, fees: { estimatedFeeNotional: "0.5" } }) as never;
    const plans = store
      .snapshot()
      .strategies.filter((s) => s.leader === leader && s.side === "buy" && s.orderType !== "limit" && s.targetAsset.toLowerCase() === WETH.toLowerCase())
      .slice(0, PROBATION_PLANS);
    expect(plans).toHaveLength(PROBATION_PLANS);
    for (const p of plans) {
      // Market at the plan's entry so the paper copy is copyable.
      const s = await runShadowEntry({ ...p, entryReferencePrice: "2500", stopLossPrice: "2450", takeProfitPrice: "2600" }, { quote, nowMs: T0 });
      expect(s?.status).toBe("OPEN");
    }
    const kinds = () => ev.evidenceLog().map((e) => e.kind);
    expect(kinds().filter((k) => k === "shadow.entry")).toHaveLength(PROBATION_PLANS);

    for (const p of store.snapshot().strategies.filter((s) => plans.some((q) => q.id === s.id))) {
      const s = await settleShadowFor(
        { ...p, stopLossPrice: "2450", takeProfitPrice: "2600" },
        { candles: async () => [candle(5, 2495, 2530), candle(30, 2520, 2605)], nowMs: T0 + 3_600_000 },
      );
      expect(s?.status).toBe("TARGET");
    }
    expect(kinds().filter((k) => k === "shadow.settled")).toHaveLength(PROBATION_PLANS);
    expect((await ev.verifyLog(ev.evidenceLog())).ok).toBe(true);
    expect(store.leaderProbation(leader)).toBe("GRADUATED");
    expect(held().some((r) => r.includes("LEADER_ON_PROBATION"))).toBe(false);
  });
});
