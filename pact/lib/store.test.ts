import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultPolicy, USDC, WETH } from "./constants";

const storeFile = join(tmpdir(), `pact-store-test-${process.pid}.json`);

async function freshStore() {
  vi.resetModules();
  process.env.PACT_STORE_FILE = storeFile;
  const store = await import("./store");
  store.resetStore();
  return store;
}

beforeEach(() => {
  if (existsSync(storeFile)) rmSync(storeFile);
});

describe("multi-leader demo simulation", () => {
  it("applies follower-wide and per-leader thresholds across selected leaders", async () => {
    const store = await freshStore();
    await store.seedDemo();

    const state = store.snapshot();
    const follower = store.DEMO_PORTFOLIO_FOLLOWER.toLowerCase();
    const policy = state.policies.find((item) => item.follower.toLowerCase() === follower);
    const rows = state.proposals
      .filter((proposal) => proposal.follower.toLowerCase() === follower)
      .filter((proposal) => proposal.title.includes("leader"));
    const byTitle = new Map(rows.map((proposal) => [proposal.title, proposal]));

    expect(policy?.follows).toHaveLength(3);

    const trend = byTitle.get("Trend entry · leader one");
    const pullback = byTitle.get("Pullback entry · leader two");
    const chase = byTitle.get("Late market chase · leader three");

    expect(trend).toBeDefined();
    expect(state.decisions[trend!.id]).toMatchObject({ verdict: "ALLOW", action: "COPY" });
    expect(trend?.notionalUsd).toBe(20);
    store.addReceipt({
      proposalId: trend!.id,
      follower: store.DEMO_PORTFOLIO_FOLLOWER,
      decision: state.decisions[trend!.id],
      flashOrderId: "demo-closed-loss",
      status: "ORDER_STATUS_FILLED",
      notionalUsd: trend!.notionalUsd,
      realizedPnlUsd: -10,
    });
    expect(store.leaderDailyRealizedLoss(store.DEMO_PORTFOLIO_FOLLOWER, trend!.leader)).toBe(10);

    expect(pullback).toBeDefined();
    expect(state.decisions[pullback!.id]).toMatchObject({
      verdict: "MODIFY",
      action: "SCALE",
      reasons: ["LEADER_DAILY_CAP"],
      modifiedQty: "25",
    });
    expect(pullback?.notionalUsd).toBe(25);

    expect(chase).toBeDefined();
    expect(state.decisions[chase!.id]).toMatchObject({
      verdict: "BLOCK",
      action: "DECLINE",
    });
    expect(state.decisions[chase!.id].reasons).toContain("ORDER_TYPE_NOT_ALLOWED");
    expect(state.decisions[chase!.id].reasons).not.toContain("ACTIVE_PLAN_LIMIT");
  });

  it("seeds deterministic policy cases without inventing execution or performance", async () => {
    const store = await freshStore();
    await store.seedDemo();
    const state = store.snapshot();
    const byCase = new Map(
      state.proposals
        .filter((proposal) => proposal.demoCase)
        .map((proposal) => [proposal.demoCase, proposal]),
    );

    const expected = [
      ["CORE_TWAP_COPY", "ALLOW", "COPY", undefined],
      ["SLEEVE_SCALE", "MODIFY", "SCALE", "LEADER_DAILY_CAP"],
      ["MARKET_REFUSAL", "BLOCK", "DECLINE", "ORDER_TYPE_NOT_ALLOWED"],
      ["EXPIRED_PLAN", "BLOCK", "WAIT", "PLAN_EXPIRED"],
      ["LOW_RR_CAUTION", "ALLOW", "COPY", undefined],
      ["EVIDENCE_REVIEW", "BLOCK", "REVIEW", "LEADER_EXECUTION_UNVERIFIED"],
      ["HIGH_BETA_PAIR_REFUSAL", "BLOCK", "DECLINE", "PAIR_NOT_ALLOWED"],
    ] as const;

    for (const [demoCase, verdict, action, reason] of expected) {
      const proposal = byCase.get(demoCase);
      expect(proposal, demoCase).toBeDefined();
      const decision = state.decisions[proposal!.id];
      expect(decision).toMatchObject({ verdict, action });
      if (reason) expect(decision.reasons).toContain(reason);
    }

    expect(byCase.get("LOW_RR_CAUTION")?.leaderPlanGrade).toBe("CAUTION");
    expect(state.decisions[byCase.get("SLEEVE_SCALE")!.id].modifiedQty).toBe("25");
  });

  it("uses a leader mandate for fixed sizing, order eligibility, and manual exit", async () => {
    const store = await freshStore();
    const follower = "0x8888888888888888888888888888888888888888" as const;
    store.upsertPolicy({
      ...defaultPolicy(follower),
      follows: [store.DEMO_LEADER],
      mandates: [
        {
          leader: store.DEMO_LEADER,
          sizingMode: "FIXED",
          copyRatio: 0.25,
          fixedNotionalUsd: 7,
          riskBudgetUsd: 2,
          maxDailyUsd: 12,
          allowOrderTypes: ["twap"],
          exitMode: "MANUAL",
        },
      ],
    });
    const strategy = store.addStrategy({
      leader: store.DEMO_LEADER,
      title: "Fixed mandate test",
      thesis: "A complete test plan.",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      invalidation: "Test invalidation.",
      maxFollowerNotionalUsd: 20,
      entryReferencePrice: "2500",
      stopLossPrice: "2450",
      takeProfitPrice: "2600",
      protectionExpiresAt: new Date(Date.now() + 120_000).toISOString(),
      chain: "base",
      targetAsset: WETH,
      contraAsset: USDC,
      side: "buy",
      orderType: "twap",
      qty: "80",
      durationSeconds: 600,
    });

    const { proposal, decision } = await store.createProposal(strategy.id, follower);
    expect(proposal).toMatchObject({
      notionalUsd: 7,
      qty: "7",
      copySizingMode: "FIXED",
      followerExitMode: "MANUAL",
    });
    expect(decision).toMatchObject({ verdict: "ALLOW", action: "COPY" });
  });

  it("sizes a follower from its planned loss at the declared stop", async () => {
    const store = await freshStore();
    const follower = "0x9999999999999999999999999999999999999999" as const;
    store.upsertPolicy({
      ...defaultPolicy(follower),
      maxNotionalUsd: 200,
      maxDailyUsd: 200,
      maxLeaderDailyUsd: 200,
      maxAssetExposureUsd: 200,
      follows: [store.DEMO_LEADER],
      mandates: [
        {
          leader: store.DEMO_LEADER,
          sizingMode: "STOP_RISK",
          copyRatio: 0.25,
          fixedNotionalUsd: 7,
          riskBudgetUsd: 2,
          maxDailyUsd: 200,
          allowOrderTypes: ["twap"],
          exitMode: "FOLLOWER_BRACKET",
        },
      ],
    });
    const strategy = store.addStrategy({
      leader: store.DEMO_LEADER,
      title: "Stop-risk mandate test",
      thesis: "A complete test plan.",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      invalidation: "Test invalidation.",
      maxFollowerNotionalUsd: 200,
      entryReferencePrice: "2500",
      stopLossPrice: "2450",
      takeProfitPrice: "2600",
      protectionExpiresAt: new Date(Date.now() + 120_000).toISOString(),
      chain: "base",
      targetAsset: WETH,
      contraAsset: USDC,
      side: "buy",
      orderType: "twap",
      qty: "80",
      durationSeconds: 600,
    });

    const { proposal, decision } = await store.createProposal(strategy.id, follower);
    expect(proposal).toMatchObject({
      notionalUsd: 100,
      qty: "100",
      copySizingMode: "STOP_RISK",
      riskBudgetUsd: 2,
      stopRiskPerUnitUsd: 50,
      estimatedLossAtStopUsd: 2,
    });
    expect(decision).toMatchObject({ verdict: "ALLOW", action: "COPY" });
  });
});

describe("follower leader pause", () => {
  it("holds a paused leader's plans, keeps the mandate, and re-decides on resume", async () => {
    const store = await freshStore();
    await store.seedDemo();
    const follower = store.DEMO_PORTFOLIO_FOLLOWER;
    const leader = store.DEMO_LEADER;
    const trendId = () =>
      store
        .snapshot()
        .proposals.find(
          (proposal) =>
            proposal.follower.toLowerCase() === follower.toLowerCase() &&
            proposal.title === "Trend entry · leader one",
        )!.id;

    const policy = store.policyFor(follower);
    store.upsertPolicy({ ...policy, pausedLeaders: [leader] });
    await store.rebuildFor(follower);

    const paused = store.policyFor(follower);
    expect(paused.follows).toHaveLength(3);
    expect(paused.pausedLeaders).toEqual([leader]);
    expect(store.decisionFor(trendId())).toEqual({
      verdict: "BLOCK",
      action: "WAIT",
      reasons: ["LEADER_PAUSED"],
    });
    // Other selected leaders are unaffected.
    const pullback = store
      .snapshot()
      .proposals.find(
        (proposal) =>
          proposal.follower.toLowerCase() === follower.toLowerCase() &&
          proposal.title === "Pullback entry · leader two",
      )!;
    expect(store.decisionFor(pullback.id)?.reasons).not.toContain("LEADER_PAUSED");

    store.upsertPolicy({ ...paused, pausedLeaders: [] });
    await store.rebuildFor(follower);
    expect(store.decisionFor(trendId())).toMatchObject({ verdict: "ALLOW", action: "COPY" });
  });

  it("drops a pause when the leader is no longer selected", async () => {
    const store = await freshStore();
    const follower = "0x2222222222222222222222222222222222222222" as const;
    const leader = "0x1111111111111111111111111111111111111111" as const;
    const saved = store.upsertPolicy({
      ...defaultPolicy(follower),
      follows: [],
      pausedLeaders: [leader],
    });
    expect(saved.pausedLeaders).toEqual([]);
  });
});

describe("demo reload", () => {
  it("replaces the demo desks but keeps a real wallet's mandate, plan and mirrors", async () => {
    const store = await freshStore();
    await store.seedDemo();
    const real = "0x1234567890abcdef1234567890abcdef12345678" as const;
    const realLeader = "0xabcdef1234567890abcdef1234567890abcdef12" as const;
    store.upsertPolicy({ ...defaultPolicy(real), follows: [realLeader, store.DEMO_LEADER] });
    const plan = store.addStrategy({
      leader: realLeader,
      title: "Real plan",
      thesis: "Not demo data.",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      entryReferencePrice: "2500",
      stopLossPrice: "2450",
      takeProfitPrice: "2600",
      protectionExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      chain: "base",
      targetAsset: WETH,
      contraAsset: USDC,
      side: "buy",
      orderType: "twap",
      qty: "25",
      durationSeconds: 600,
    });
    const mirror = await store.createProposal(plan.id, real);
    const demoCount = store.snapshot().strategies.filter((s) => s.leader !== realLeader).length;

    await store.seedDemo();
    const state = store.snapshot();
    expect(state.policies.some((p) => p.follower.toLowerCase() === real)).toBe(true);
    expect(state.strategies.filter((s) => s.id === plan.id)).toHaveLength(1);
    expect(state.proposals.some((p) => p.id === mirror.proposal.id)).toBe(true);
    expect(state.decisions[mirror.proposal.id]).toBeDefined();
    // Demo plans were replaced, not duplicated.
    expect(state.strategies.filter((s) => s.leader !== realLeader)).toHaveLength(demoCount);
  });
});
