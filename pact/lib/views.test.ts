import { describe, expect, it } from "vitest";
import { defaultPolicy, USDC, WETH } from "./constants";
import { actionCounts, capacity, executionRows, exposureGroups, isDemoAddress, leaderRows, tokenSymbol } from "./views";
import type { Decision, Proposal, Receipt, Strategy } from "./types";

const L1 = "0x1111111111111111111111111111111111111111" as const;
const L2 = "0x5555555555555555555555555555555555555555" as const;
const F = "0x2222222222222222222222222222222222222222" as const;
const NOW = Date.parse("2026-11-06T12:00:00Z");

function strategy(id: string, leader: `0x${string}`, extra: Partial<Strategy> = {}): Strategy {
  return {
    id,
    leader,
    title: id,
    thesis: "",
    expiresAt: "2026-11-06T16:00:00Z",
    leaderPlanGrade: "DISCIPLINED",
    leaderPlanReasons: [],
    leaderEvidenceStatus: "UNVERIFIED",
    chain: "base",
    targetAsset: WETH,
    contraAsset: USDC,
    side: "buy",
    orderType: "twap",
    qty: "20",
    entryReferencePrice: "2500",
    stopLossPrice: "2450",
    takeProfitPrice: "2600",
    createdAt: "2026-11-06T10:00:00Z",
    ...extra,
  };
}

function proposal(id: string, leader: `0x${string}`, notionalUsd: number): Proposal {
  return { ...strategy(id, leader), strategyId: id, follower: F, notionalUsd, copySizingMode: "PROPORTIONAL", followerExitMode: "MANUAL" } as Proposal;
}

const allow: Decision = { verdict: "ALLOW", action: "COPY", reasons: [] };
const scale: Decision = { verdict: "MODIFY", action: "SCALE", reasons: ["DAILY_CAP"], modifiedQty: "10" };
const block: Decision = { verdict: "BLOCK", action: "DECLINE", reasons: ["PAIR_NOT_ALLOWED"] };

describe("terminal view models", () => {
  it("builds leader rows only from published plans and real receipts", () => {
    const policy = { ...defaultPolicy(F), follows: [L1], pausedLeaders: [L1] };
    const rows = leaderRows(
      {
        strategies: [
          strategy("a", L1),
          strategy("b", L1, { expiresAt: "2026-11-06T11:00:00Z", leaderEvidenceStatus: "ORDER_FOUND" }),
          strategy("c", L2, { leaderPlanGrade: "INCOMPLETE", stopLossPrice: undefined }),
        ],
        policies: [policy],
        proposals: [proposal("a", L1, 20)],
        receipts: [
          { id: "r", proposalId: "a", follower: F, decision: allow, flashOrderId: "o", fills: [{ fillPrice: "2510" }], entryDriftBps: 40, notionalUsd: 20, createdAt: "2026-11-06T11:00:00Z" },
        ],
      },
      policy,
      NOW,
    );
    const one = rows.find((r) => r.leader === L1)!;
    expect(one).toMatchObject({ plans: 2, activePlans: 1, evidenceFound: 1, pactFollowers: 1, copiedOrders: 1, filledOrders: 1, meanDriftBps: 40, following: true, paused: true, isDemo: true });
    expect(one.avgRewardRisk).toBeCloseTo(2);
    const two = rows.find((r) => r.leader === L2)!;
    expect(two.avgRewardRisk).toBeUndefined();
    expect(two.grades.INCOMPLETE).toBe(1);
    expect(two.meanDriftBps).toBeUndefined();
  });

  it("counts actions and splits approved from live exposure", () => {
    const proposals = [proposal("a", L1, 20), proposal("b", L2, 10), proposal("c", L2, 99)];
    const decisions = { a: allow, b: scale, c: block };
    expect(actionCounts(proposals, decisions)).toMatchObject({ COPY: 1, SCALE: 1, DECLINE: 1, WAIT: 0 });
    const receipts: Receipt[] = [
      { id: "r", proposalId: "a", follower: F, decision: allow, flashOrderId: "o", status: "ORDER_STATUS_ACCEPTED", notionalUsd: 20, createdAt: "2026-11-06T11:00:00Z" },
    ];
    const [weth] = exposureGroups({ proposals, decisions, receipts }, F);
    expect(weth).toMatchObject({ asset: "WETH", side: "buy", liveUsd: 20, approvedUsd: 10 });
    expect(weth.leaders).toHaveLength(2);

    const policy = { ...defaultPolicy(F), follows: [L1, L2] };
    const cap = capacity({ proposals, decisions, receipts }, policy, NOW);
    expect(cap.dailyUsed).toBe(20);
    expect(cap.openPlans).toBe(2);
    expect(cap.sleeves.find((s) => s.leader === L1)?.used).toBe(20);
    expect(cap.sleeves.find((s) => s.leader === L2)?.used).toBe(0);
  });

  it("reports TWAP progress only when Flash gave a bucket count", () => {
    const rows = executionRows({
      proposals: [proposal("a", L1, 20)],
      receipts: [
        { id: "r", proposalId: "a", follower: F, decision: allow, flashOrderId: "o", twapBucketCount: 4, fills: [{ notional: "5" }, { notional: "5" }], notionalUsd: 20, createdAt: "2026-11-06T11:00:00Z" },
        { id: "s", proposalId: "a", follower: F, decision: allow, notionalUsd: 20, createdAt: "2026-11-06T11:00:00Z" },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fillCount: 2, progress: 0.5, filledUsd: 10, closed: false });
  });

  it("labels tokens and recognises seeded demo wallets", () => {
    expect(tokenSymbol(WETH)).toBe("WETH");
    expect(tokenSymbol(USDC.toLowerCase())).toBe("USDC");
    expect(isDemoAddress(L1)).toBe(true);
    expect(isDemoAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")).toBe(false);
  });
});
