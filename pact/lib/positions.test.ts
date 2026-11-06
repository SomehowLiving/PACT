import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { legFacts, markToMarket, positionFrom } from "./positions";

const FINAL = "CHAIN_STATUS_FINALIZED";

describe("positions from Flash fills", () => {
  it("counts finalised fills only", () => {
    const facts = legFacts([
      { status: FINAL, targetAmount: "0.004", contraAmount: "10", feeNotional: "0.02", filledAt: "2026-11-06T10:00:00Z" },
      { status: FINAL, targetAmount: "0.006", contraAmount: "15", feeNotional: "0.03", filledAt: "2026-11-06T10:05:00Z" },
      { status: "CHAIN_STATUS_REORGED", targetAmount: "1", contraAmount: "2500" },
      { status: "CHAIN_STATUS_PENDING", targetAmount: "1", contraAmount: "2500" },
    ]);
    expect(facts).toEqual({ targetUnits: 0.01, contraUsd: 25, feesUsd: 0.05, fillCount: 2, lastFilledAt: "2026-11-06T10:05:00Z" });
  });

  it("realizes a stop-out loss net of the exit fee and leaves nothing open", () => {
    const entry = legFacts([{ status: FINAL, targetAmount: "0.01", contraAmount: "25" }]);
    const exit = legFacts([{ status: FINAL, targetAmount: "0.01", contraAmount: "24.5", feeNotional: "0.05", filledAt: "2026-11-06T12:00:00Z" }]);
    const p = positionFrom(entry, exit)!;
    expect(p).toMatchObject({ averageCost: 2500, exitUnits: 0.01, openUnits: 0, realizedPnlUsd: -0.55, closed: true, realizedAt: "2026-11-06T12:00:00Z" });
    expect(markToMarket(p, { price: 3000, basis: "flash-exit-quote", at: "" })).toEqual({ valueUsd: 0, unrealizedPnlUsd: 0 });
  });

  it("splits a partial exit into realized and marked open parts", () => {
    const entry = legFacts([{ status: FINAL, targetAmount: "0.02", contraAmount: "50" }]);
    const exit = legFacts([{ status: FINAL, targetAmount: "0.005", contraAmount: "13", feeNotional: "0" }]);
    const p = positionFrom(entry, exit)!;
    expect(p.realizedPnlUsd).toBeCloseTo(0.5, 6);
    expect(p.openUnits).toBeCloseTo(0.015, 10);
    expect(p.openCostUsd).toBeCloseTo(37.5, 6);
    expect(p.closed).toBe(false);
    const m = markToMarket(p, { price: 2400, basis: "flash-exit-quote", at: "" });
    expect(m.valueUsd).toBeCloseTo(36, 6);
    expect(m.unrealizedPnlUsd).toBeCloseTo(-1.5, 6);
  });

  it("has no position before a fill and never sells more than it bought", () => {
    expect(positionFrom(legFacts([]))).toBeUndefined();
    const p = positionFrom(
      legFacts([{ status: FINAL, targetAmount: "0.01", contraAmount: "25" }]),
      legFacts([{ status: FINAL, targetAmount: "0.0100001", contraAmount: "26" }]),
    )!;
    expect(p.exitUnits).toBe(0.01);
    expect(p.openUnits).toBe(0);
  });
});

// The loss breaker, end to end: Flash reports the protective order stopped out at a loss; the
// next refresh records the realized loss and the follower's waiting copies from that leader
// are re-decided and held.
const { getOrder } = vi.hoisted(() => ({ getOrder: vi.fn() }));
vi.mock("./flash", async (importOriginal) => ({ ...(await importOriginal<typeof import("./flash")>()), getOrder }));

describe("realized loss feeds the leader breaker", () => {
  const storeFile = join(tmpdir(), `pact-positions-test-${process.pid}.json`);
  const g = globalThis as unknown as { __pact?: unknown; __pactEvidence?: unknown };
  beforeEach(() => {
    delete g.__pact;
    delete g.__pactEvidence;
    getOrder.mockReset();
  });

  it("holds the leader's waiting copies once the stop-out loss is realized", async () => {
    process.env.PACT_STORE_FILE = storeFile;
    const store = await import("./store");
    const { refreshReceipt } = await import("./receipts");
    store.resetStore();
    await store.seedDemo();
    const follower = store.DEMO_PORTFOLIO_FOLLOWER;
    const leader = store.DEMO_LEADER;
    store.upsertPolicy({ ...store.policyFor(follower), enableLeaderLossCircuitBreaker: true, maxLeaderDailyRealizedLossUsd: 0.5 });
    await store.rebuildFor(follower);

    const mine = () => store.snapshot().proposals.filter((p) => p.follower === follower && p.leader === leader);
    const [copied, ...waiting] = mine();
    expect(waiting.length).toBeGreaterThan(0);
    const receipt = store.addReceipt({
      proposalId: copied.id,
      follower,
      decision: store.decisionFor(copied.id)!,
      flashOrderId: "entry-1",
      status: "ORDER_STATUS_PENDING",
      notionalUsd: 25,
    });

    getOrder.mockImplementation(async (id: string) =>
      id === "entry-1"
        ? {
            order: { status: "ORDER_STATUS_FILLED", attachedBracket: { status: "active", bracketOrderId: "stop-1" } },
            fills: [{ status: FINAL, targetAmount: "0.01", contraAmount: "25", filledAt: new Date().toISOString() }],
          }
        : {
            order: { status: "ORDER_STATUS_FILLED", closeReason: "REASON_STOP_LOSS" },
            fills: [{ status: FINAL, targetAmount: "0.01", contraAmount: "24.4", feeNotional: "0.05", filledAt: new Date().toISOString() }],
          },
    );
    const result = await refreshReceipt(receipt);
    expect(result.ok).toBe(true);
    expect(result.receipt.realizedPnlUsd).toBeCloseTo(-0.65, 6);
    expect(result.receipt.position).toMatchObject({ closed: true, exitUnits: 0.01 });
    expect(store.leaderDailyRealizedLoss(follower, leader)).toBeCloseTo(0.65, 6);

    // Waiting copies from that leader were re-decided and are now held by the breaker.
    const after = mine().filter((p) => p.id !== copied.id);
    expect(after.length).toBe(waiting.length);
    for (const p of after) expect(store.decisionFor(p.id)?.reasons).toContain("LEADER_LOSS_CIRCUIT_BREAKER");

    const { threadEvents, threads } = await import("./evidence");
    const updates = threadEvents(threads.proposal(copied.id)).filter((e) => e.kind === "order.updated");
    expect(updates.at(-1)?.data.position).toMatchObject({ realizedPnlUsd: -0.65, closed: true });
  });
});
