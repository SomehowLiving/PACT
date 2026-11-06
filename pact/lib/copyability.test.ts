import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultPolicy, USDC, WETH } from "./constants";
import { copyability, previewPlan, type CopyContext } from "./copyability";
import type { LeaderMandate, Strategy } from "./types";

const L = "0x1111111111111111111111111111111111111111" as const;
const F = "0x2222222222222222222222222222222222222222" as const;
const NOW = Date.parse("2026-11-06T12:00:00Z");
// decide() reads the clock for plan expiry: pin it so the fixtures' windows stay open.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const empty: CopyContext = { dailySpentUsd: 0, leaderDailySpentUsd: 0, activePlanCount: 0, activePlanCountForLeader: 0, assetExposureUsd: 0 };

function plan(extra: Partial<Strategy> = {}): Strategy {
  return {
    id: "p",
    leader: L,
    title: "t",
    thesis: "",
    expiresAt: "2026-11-06T16:00:00Z",
    invalidation: "below 2450",
    leaderPlanGrade: "DISCIPLINED",
    leaderPlanReasons: [],
    leaderEvidenceStatus: "UNVERIFIED",
    chain: "base",
    targetAsset: WETH,
    contraAsset: USDC,
    side: "buy",
    orderType: "twap",
    qty: "80",
    entryReferencePrice: "2500",
    stopLossPrice: "2450",
    takeProfitPrice: "2600",
    createdAt: "2026-11-06T10:00:00Z",
    ...extra,
  };
}

const policy = { ...defaultPolicy(F), follows: [L] };
const mandate = (m: Partial<LeaderMandate>): LeaderMandate => ({
  leader: L,
  sizingMode: "PROPORTIONAL",
  copyRatio: 0.25,
  fixedNotionalUsd: 5,
  riskBudgetUsd: 2,
  maxDailyUsd: 25,
  allowOrderTypes: ["twap", "limit"],
  exitMode: "FOLLOWER_BRACKET",
  ...m,
});

describe("copyability preview", () => {
  it("sizes like createProposal and runs the real policy", () => {
    expect(previewPlan(plan(), policy, mandate({}), empty)).toMatchObject({ action: "COPY", requestedUsd: 20, approvedUsd: 20 });
    // 100% of $80 exceeds the $30 per-order and $25 sleeve caps → scaled to the sleeve.
    expect(previewPlan(plan(), policy, mandate({ copyRatio: 1 }), empty)).toMatchObject({ action: "SCALE", approvedUsd: 25 });
    // Stop-risk: $2 at a $50 stop distance = 0.04 WETH = $100, capped.
    expect(previewPlan(plan(), policy, mandate({ sizingMode: "STOP_RISK" }), empty).requestedUsd).toBeCloseTo(100);
    expect(previewPlan(plan({ stopLossPrice: undefined }), policy, mandate({ sizingMode: "STOP_RISK" }), empty).decision.reasons).toEqual([
      "STOP_RISK_PLAN_INVALID",
    ]);
    expect(previewPlan(plan({ orderType: "market" }), policy, mandate({}), empty).action).toBe("DECLINE");
  });

  it("honours a pause and summarises a verdict over live plans only", () => {
    expect(previewPlan(plan(), { ...policy, pausedLeaders: [L] }, mandate({}), empty).decision.reasons).toEqual(["LEADER_PAUSED"]);
    const result = copyability(
      [plan(), plan({ id: "m", orderType: "market" }), plan({ id: "x", expiresAt: "2026-11-06T11:00:00Z" })],
      policy,
      mandate({}),
      empty,
      undefined,
      NOW,
    );
    expect(result.previews).toHaveLength(2);
    expect(result.verdict).toBe("PARTLY");
    expect(result.topReasons[0].reason).toBe("ORDER_TYPE_NOT_ALLOWED");
    expect(copyability([], policy, undefined, empty, undefined, NOW).verdict).toBe("NO_LIVE_PLANS");
    // An already-mirrored plan reports its stored decision, not a fresh preview.
    const mirrored = new Map([["p", { decision: { verdict: "ALLOW" as const, action: "COPY" as const, reasons: [] }, notionalUsd: 20 }]]);
    const busy = { ...empty, activePlanCountForLeader: 1 };
    const withStored = copyability([plan()], policy, mandate({}), busy, mirrored, NOW);
    expect(withStored.previews[0]).toMatchObject({ action: "COPY", mirrored: true, approvedUsd: 20 });
  });
});
