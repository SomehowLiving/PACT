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
});
