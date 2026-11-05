import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assessLeaderPlan, decide, decideExecution } from "./policy";
import type { Policy, OrderType, Proposal, Side } from "./types";

const root = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(
  readFileSync(join(root, "../specs/policy-cases.json"), "utf8"),
) as {
  policy: Omit<Policy, "follower">;
  cases: {
    name: string;
    dailySpentUsd: number;
    proposal: {
      chain: "base";
      targetAsset: string;
      contraAsset: string;
      side: Side;
      orderType: OrderType;
      qty: string;
      notionalUsd: number;
      maxSlippage?: string;
      maxPriceImpact?: string;
      durationSeconds?: number;
      limitNotionalPrice?: string;
    };
    expect: {
      verdict: "ALLOW" | "MODIFY" | "BLOCK";
      reasons?: string[];
      reasonsInclude?: string[];
      modifiedQty?: string;
    };
  }[];
};

const policy = { ...raw.policy, follower: "0x0000000000000000000000000000000000000001" as const };

describe("decide", () => {
  for (const c of raw.cases) {
    it(c.name, () => {
      const proposal = c.proposal as Pick<
        Proposal,
        | "chain"
        | "targetAsset"
        | "contraAsset"
        | "side"
        | "orderType"
        | "qty"
        | "notionalUsd"
        | "maxSlippage"
        | "maxPriceImpact"
      >;
      const got = decide(proposal, policy, c.dailySpentUsd);
    expect(got.verdict).toBe(c.expect.verdict);
      expect(got.action).toBe(
        c.expect.verdict === "ALLOW"
          ? "COPY"
          : c.expect.verdict === "MODIFY"
            ? "SCALE"
            : "DECLINE",
      );
      if (c.expect.reasons) {
        expect(got.reasons).toEqual(c.expect.reasons);
      }
      if (c.expect.reasonsInclude) {
        for (const code of c.expect.reasonsInclude) {
          expect(got.reasons).toContain(code);
        }
      }
      if (c.expect.modifiedQty) {
        expect(got.modifiedQty).toBe(c.expect.modifiedQty);
      }
    });
  }

  it("waits when a pact plan has expired", () => {
    const got = decide(
      {
        chain: "base",
        targetAsset: "0x4200000000000000000000000000000000000006",
        contraAsset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        side: "buy",
        orderType: "twap",
        qty: "10",
        notionalUsd: 10,
        expiresAt: "2020-01-01T00:00:00.000Z",
      },
      policy,
      0,
    );
    expect(got).toMatchObject({ verdict: "BLOCK", action: "WAIT", reasons: ["PLAN_EXPIRED"] });
  });

  it("scales a plan to its declared follower capacity", () => {
    const got = decide(
      {
        chain: "base",
        targetAsset: "0x4200000000000000000000000000000000000006",
        contraAsset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        side: "buy",
        orderType: "twap",
        qty: "60",
        notionalUsd: 60,
        maxFollowerNotionalUsd: 20,
      },
      { ...policy, maxNotionalUsd: 100, maxDailyUsd: 100 },
      0,
    );
    expect(got).toMatchObject({
      verdict: "MODIFY",
      action: "SCALE",
      modifiedQty: "20",
      reasons: ["PLAN_CAPACITY"],
    });
  });

  it("scales a follower trade to the leader daily sleeve", () => {
    const got = decide(
      {
        chain: "base",
        targetAsset: "0x4200000000000000000000000000000000000006",
        contraAsset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        side: "buy",
        orderType: "twap",
        qty: "20",
        notionalUsd: 20,
      },
      { ...policy, maxNotionalUsd: 100, maxDailyUsd: 100, maxLeaderDailyUsd: 25 },
      { dailySpentUsd: 0, leaderDailySpentUsd: 15 },
    );
    expect(got).toMatchObject({
      verdict: "MODIFY",
      action: "SCALE",
      modifiedQty: "10",
      reasons: ["LEADER_DAILY_CAP"],
    });
  });

  it("blocks a third live copy plan before prompting the wallet", () => {
    const got = decide(
      {
        chain: "base",
        targetAsset: "0x4200000000000000000000000000000000000006",
        contraAsset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        side: "buy",
        orderType: "twap",
        qty: "10",
        notionalUsd: 10,
      },
      { ...policy, maxOpenPlans: 2 },
      { dailySpentUsd: 0, activePlanCount: 2 },
    );
    expect(got).toMatchObject({
      verdict: "BLOCK",
      action: "DECLINE",
      reasons: ["ACTIVE_PLAN_LIMIT"],
    });
  });

  it("waits when a live quote drifts outside the leader entry band", () => {
    const got = decideExecution(
      { entryReferencePrice: "2500" },
      { maxPriceImpact: "0.005", maxEntryDrift: "0.01" },
      { executionPrice: "2530" },
    );
    expect(got).toEqual({
      verdict: "BLOCK",
      action: "WAIT",
      reasons: ["ENTRY_DRIFT_TOO_HIGH"],
    });
  });

  it("accepts a long plan with a valid 2R stop and target", () => {
    expect(
      assessLeaderPlan({
        side: "buy",
        entryReferencePrice: "2500",
        stopLossPrice: "2450",
        takeProfitPrice: "2600",
      }),
    ).toMatchObject({ grade: "DISCIPLINED", rewardRisk: 2 });
  });

  it("marks a leader plan with weak reward:risk as a caution", () => {
    expect(
      assessLeaderPlan({
        side: "buy",
        entryReferencePrice: "2500",
        stopLossPrice: "2450",
        takeProfitPrice: "2550",
      }),
    ).toMatchObject({
      grade: "CAUTION",
      reasons: ["PLAN_REWARD_RISK_TOO_LOW"],
    });
  });

  it("requires disciplined leader plan terms when the follower enables that gate", () => {
    const got = decide(
      {
        chain: "base",
        targetAsset: "0x4200000000000000000000000000000000000006",
        contraAsset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        side: "buy",
        orderType: "twap",
        qty: "10",
        notionalUsd: 10,
        entryReferencePrice: "2500",
        stopLossPrice: "2450",
        takeProfitPrice: "2550",
      },
      { ...policy, requireLeaderPlanQuality: true, minRewardRisk: 1.5 },
      0,
    );
    expect(got).toEqual({
      verdict: "BLOCK",
      action: "REVIEW",
      reasons: ["PLAN_REWARD_RISK_TOO_LOW"],
    });
  });

  it("leaves a low reward:risk plan copyable when the follower does not enable that gate", () => {
    const got = decide(
      {
        chain: "base",
        targetAsset: "0x4200000000000000000000000000000000000006",
        contraAsset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        side: "buy",
        orderType: "twap",
        qty: "10",
        notionalUsd: 10,
        entryReferencePrice: "2500",
        stopLossPrice: "2450",
        takeProfitPrice: "2550",
      },
      { ...policy, requireLeaderPlanQuality: false },
      0,
    );
    expect(got).toMatchObject({ verdict: "ALLOW", action: "COPY" });
  });

  it("can require Flash execution evidence from a leader before copying", () => {
    const got = decide(
      {
        chain: "base",
        targetAsset: "0x4200000000000000000000000000000000000006",
        contraAsset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        side: "buy",
        orderType: "twap",
        qty: "10",
        notionalUsd: 10,
        entryReferencePrice: "2500",
        stopLossPrice: "2450",
        takeProfitPrice: "2600",
        leaderEvidenceStatus: "UNVERIFIED",
      },
      {
        ...policy,
        requireLeaderPlanQuality: true,
        minRewardRisk: 1.5,
        requireLeaderExecutionEvidence: true,
      },
      0,
    );
    expect(got).toEqual({
      verdict: "BLOCK",
      action: "REVIEW",
      reasons: ["LEADER_EXECUTION_UNVERIFIED"],
    });
  });

  it("waits on new copies when a leader reaches the recorded daily-loss breaker", () => {
    const got = decide(
      {
        chain: "base",
        targetAsset: "0x4200000000000000000000000000000000000006",
        contraAsset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        side: "buy",
        orderType: "twap",
        qty: "10",
        notionalUsd: 10,
      },
      {
        ...policy,
        maxLeaderDailyRealizedLossUsd: 10,
        enableLeaderLossCircuitBreaker: true,
      },
      { dailySpentUsd: 0, leaderDailyRealizedLossUsd: 10 },
    );
    expect(got).toEqual({
      verdict: "BLOCK",
      action: "WAIT",
      reasons: ["LEADER_LOSS_CIRCUIT_BREAKER"],
    });
  });
});
