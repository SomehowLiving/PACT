import { describe, expect, it } from "vitest";
import { defaultPolicy, USDC, WETH } from "./constants";
import { decisionTrace, traceSummary, type TraceInput } from "./decision-trace";
import type { Decision, Proposal } from "./types";

const F = "0x2222222222222222222222222222222222222222" as const;
const L = "0x1111111111111111111111111111111111111111" as const;
const NOW = Date.parse("2026-11-06T12:00:00Z");

function proposal(extra: Partial<Proposal> = {}): Proposal {
  return {
    id: "p1",
    strategyId: "s1",
    follower: F,
    leader: L,
    title: "t",
    thesis: "t",
    expiresAt: "2026-11-06T14:00:00Z",
    invalidation: "below the stop",
    entryReferencePrice: "2500",
    stopLossPrice: "2450",
    takeProfitPrice: "2600",
    leaderPlanGrade: "DISCIPLINED",
    leaderPlanReasons: [],
    leaderEvidenceStatus: "UNVERIFIED",
    copySizingMode: "PROPORTIONAL",
    followerExitMode: "FOLLOWER_BRACKET",
    chain: "base",
    targetAsset: WETH,
    contraAsset: USDC,
    side: "buy",
    orderType: "twap",
    qty: "25",
    notionalUsd: 25,
    maxPriceImpact: "0.005",
    createdAt: "2026-11-06T11:00:00Z",
    ...extra,
  } as Proposal;
}

function input(p: Proposal, decision: Decision, extra: Partial<TraceInput> = {}): TraceInput {
  return {
    proposal: p,
    decision,
    policy: { ...defaultPolicy(F), follows: [L] },
    dailySpentUsd: 0,
    leaderSpentUsd: 0,
    leaderSleeveMax: 25,
    assetExposureUsd: 0,
    otherOpenPlans: 0,
    otherOpenPlansForLeader: 0,
    nowMs: NOW,
    ...extra,
  };
}

describe("decision trace", () => {
  it("an approved copy has no failed checks, and lists every stage", () => {
    const rows = decisionTrace(input(proposal(), { verdict: "ALLOW", action: "COPY", reasons: [] }));
    expect(rows.filter((r) => r.result === "fail")).toEqual([]);
    expect(new Set(rows.map((r) => r.stage))).toEqual(new Set(["Holds", "Mandate fit", "Size and caps", "At the quote"]));
    expect(traceSummary(rows).total).toBeGreaterThanOrEqual(25);
  });

  it("every reason in the decision shows as a failed or scaled check", () => {
    const cases: [Decision, Partial<Proposal>, Partial<TraceInput>][] = [
      [{ verdict: "BLOCK", action: "DECLINE", reasons: ["ORDER_TYPE_NOT_ALLOWED"] }, { orderType: "market", maxSlippage: "0.01" }, {}],
      [{ verdict: "BLOCK", action: "WAIT", reasons: ["PLAN_EXPIRED"] }, { expiresAt: "2026-11-06T11:59:00Z" }, {}],
      [{ verdict: "BLOCK", action: "REVIEW", reasons: ["LEADER_EXECUTION_MISMATCH"] }, { leaderEvidenceStatus: "MISMATCH" }, {}],
      [{ verdict: "BLOCK", action: "REVIEW", reasons: ["LEADER_SOLD_INTO_FOLLOWERS"] }, {}, {}],
      [{ verdict: "MODIFY", action: "SCALE", reasons: ["LEADER_DAILY_CAP"], modifiedQty: "10" }, { notionalUsd: 10 }, { leaderSpentUsd: 15 }],
    ];
    const codeToRow: Record<string, string> = {
      ORDER_TYPE_NOT_ALLOWED: "type",
      PLAN_EXPIRED: "window",
      LEADER_EXECUTION_MISMATCH: "evidence",
      LEADER_SOLD_INTO_FOLLOWERS: "conduct",
      LEADER_DAILY_CAP: "sleeve",
    };
    for (const [d, p, extra] of cases) {
      const rows = decisionTrace(input(proposal(p), d, extra));
      for (const code of d.reasons) {
        const row = rows.find((r) => r.id === codeToRow[code]);
        expect(row?.result, code).toBe(d.verdict === "MODIFY" ? "scaled" : "fail");
      }
    }
  });

  it("shows the real numbers once Flash has quoted", () => {
    const rows = decisionTrace(
      input(proposal(), { verdict: "ALLOW", action: "COPY", reasons: [] }, {
        quote: { proposalId: "p1", quoteId: "q", qty: "25", estimatedPriceImpact: "0.0004", executionPrice: "2510", costRatio: "0.0034", feeNotional: "0.08", reference: { status: "OK", quoteVsOracleBps: -12, chartVsOracleBps: -2 } } as never,
      }),
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.reference.value).toBe("Flash -12 bps · pool -2 bps");
    expect(byId.drift.value).toContain("+0.40%");
    expect(byId.cost.value).toContain("0.34%");
    expect(rows.some((r) => r.result === "pending")).toBe(false);
  });
});
