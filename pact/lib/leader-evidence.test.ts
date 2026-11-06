import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeTransfers, TRANSFER_TOPIC } from "./base-rpc";
import { USDC, WETH } from "./constants";
import { assessOnchain, combineEvidence, matchFlashOrder, type PlanFacts, type TxFacts } from "./leader-evidence";
import { leaderRecord } from "./leader-record";
import { verifyLeader } from "./leader-verify";
import { decide } from "./policy";
import { defaultPolicy } from "./constants";

const LEADER = "0xabcdef1234567890abcdef1234567890abcdef12";
const ROUTER = "0x1111111111111111111111111111111111111aaa";
const published = Date.parse("2026-11-06T10:00:00Z");
const plan: PlanFacts = {
  id: "plan-1",
  leader: LEADER,
  chain: "base",
  side: "buy",
  orderType: "twap",
  qty: "100",
  targetAsset: WETH,
  contraAsset: USDC,
  entryReferencePrice: "2500",
  stopLossPrice: "2450",
  takeProfitPrice: "2600",
  createdAt: new Date(published).toISOString(),
  expiresAt: new Date(published + 4 * 3_600_000).toISOString(),
};

const usdc = (n: number) => BigInt(Math.round(n * 1e6));
const weth = (n: number) => BigInt(Math.round(n * 1e6)) * BigInt(1e12);
/** A buy: the leader pays USDC to a router and receives WETH. */
function buyTx(hash: string, usd: number, wethOut: number, opts: Partial<TxFacts> = {}, leader = LEADER): TxFacts {
  return {
    hash,
    status: "success",
    blockNumber: BigInt(1),
    timestamp: (published + 10 * 60_000) / 1000,
    finalized: true,
    transfers: [
      { token: USDC.toLowerCase(), from: leader, to: ROUTER, value: usdc(usd) },
      { token: WETH.toLowerCase(), from: ROUTER, to: leader, value: weth(wethOut) },
      // Unrelated hop inside the same transaction.
      { token: WETH.toLowerCase(), from: ROUTER, to: "0x2222222222222222222222222222222222222bbb", value: weth(5) },
    ],
    ...opts,
  };
}
const h = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const result = (r: ReturnType<typeof assessOnchain>, id: string) => r.checks.find((c) => c.id === id)?.result;

describe("onchain leader evidence", () => {
  it("verifies a final buy by the leader's wallet near the declared entry", () => {
    const r = assessOnchain(plan, [buyTx(h(1), 60, 0.024), buyTx(h(2), 40.4, 0.016)]);
    expect(r.outcome).toBe("VERIFIED");
    expect(r.onchain.targetUnits).toBeCloseTo(0.04, 8);
    expect(r.onchain.contraUsd).toBeCloseTo(100.4, 6);
    expect(r.onchain.averagePrice).toBeCloseTo(2510, 6);
    expect(r.onchain.entryDriftBps).toBeCloseTo(40, 6);
    expect(r.checks.find((c) => c.id === "tx.size")?.detail).toContain("100%");
  });

  it("calls out a sell offered as evidence for a buy", () => {
    const sold = buyTx(h(3), 0, 0, {
      transfers: [
        { token: WETH.toLowerCase(), from: LEADER, to: ROUTER, value: weth(0.04) },
        { token: USDC.toLowerCase(), from: ROUTER, to: LEADER, value: usdc(100) },
      ],
    });
    const r = assessOnchain(plan, [sold]);
    expect(r.outcome).toBe("MISMATCH");
    expect(result(r, "tx.direction")).toBe("MISMATCH");
  });

  it("calls out a trade well above the declared entry, an old trade, and a reused trade", () => {
    expect(result(assessOnchain(plan, [buyTx(h(4), 103, 0.04)]), "tx.price")).toBe("MISMATCH"); // 2575 = +300 bps
    expect(result(assessOnchain(plan, [buyTx(h(5), 100, 0.04, { timestamp: (published - 8 * 3_600_000) / 1000 })]), "tx.window")).toBe("MISMATCH");
    const used = new Map([[h(6), "other-plan"]]);
    expect(result(assessOnchain(plan, [buyTx(h(6), 100, 0.04)], used), "tx.unique")).toBe("MISMATCH");
    // Its own earlier check is not "reuse".
    expect(result(assessOnchain(plan, [buyTx(h(6), 100, 0.04)], new Map([[h(6), "plan-1"]])), "tx.unique")).toBe("MATCH");
  });

  it("waits on a transaction not found yet or not final, and fails a reverted one", () => {
    expect(assessOnchain(plan, [{ hash: h(7), status: "missing", finalized: false, transfers: [] }]).outcome).toBe("PENDING");
    expect(assessOnchain(plan, [buyTx(h(8), 100, 0.04, { finalized: false })]).outcome).toBe("PENDING");
    expect(assessOnchain(plan, [buyTx(h(9), 100, 0.04, { status: "reverted" })]).outcome).toBe("MISMATCH");
  });

  it("decodes ERC-20 transfers and ignores NFT transfers", () => {
    const pad = (a: string) => `0x${a.slice(2).padStart(64, "0")}`;
    const t = decodeTransfers([
      { address: USDC, topics: [TRANSFER_TOPIC, pad(LEADER), pad(ROUTER)], data: `0x${(25_000_000).toString(16)}` },
      { address: "0x9999999999999999999999999999999999999999", topics: [TRANSFER_TOPIC, pad(LEADER), pad(ROUTER), pad("0x01")], data: "0x" },
      { address: USDC, topics: ["0xdeadbeef"], data: "0x01" },
    ]);
    expect(t).toEqual([{ token: USDC.toLowerCase(), from: LEADER, to: ROUTER.toLowerCase(), value: BigInt(25_000_000) }]);
  });
});

describe("leader's Flash order against the plan", () => {
  const order = {
    orderId: "o1",
    orderType: "twap",
    side: "buy",
    status: "ORDER_STATUS_FILLED",
    qty: "100",
    filled: { targetAmount: "0.04", contraAmount: "100.4" },
    targetAsset: { address: WETH },
    contraAsset: { address: USDC },
    attachedBracket: { takeProfit: { notionalPrice: "2600" }, stopLoss: { notionalPrice: "2450" } },
  };

  it("matches field by field", () => {
    const m = matchFlashOrder(plan, order);
    expect(m.checks.every((c) => c.result === "MATCH" || c.result === "NOTE")).toBe(true);
    expect(m.open).toBe(false);
  });

  it("flags a different side, different protection, and an order cancelled before any fill", () => {
    expect(matchFlashOrder(plan, { ...order, side: "sell" }).checks.find((c) => c.id === "order.side")?.result).toBe("MISMATCH");
    expect(
      matchFlashOrder(plan, { ...order, attachedBracket: { stopLoss: { notionalPrice: "2000" } } }).checks.find((c) => c.id === "order.protection")?.result,
    ).toBe("MISMATCH");
    const cancelled = matchFlashOrder(plan, { ...order, status: "ORDER_STATUS_CANCELLED", filled: null });
    expect(cancelled.checks.find((c) => c.id === "order.filled")?.result).toBe("MISMATCH");
    const resting = matchFlashOrder(plan, { ...order, status: "ORDER_STATUS_ACCEPTED", filled: null });
    expect(resting.checks.find((c) => c.id === "order.filled")?.result).toBe("PENDING");
    expect(resting.open).toBe(true);
  });

  it("combines: chain proof beats an order match; any contradiction wins", () => {
    const matched = matchFlashOrder(plan, { ...order, status: "ORDER_STATUS_ACCEPTED", filled: null });
    expect(combineEvidence({ txHashes: [], order: matched })).toMatchObject({ status: "PLAN_MATCHED", open: true });
    const verified = assessOnchain(plan, [buyTx(h(10), 100, 0.04)]);
    expect(combineEvidence({ txHashes: [h(10)], order: matchFlashOrder(plan, order), onchain: verified }).status).toBe("ONCHAIN_VERIFIED");
    expect(combineEvidence({ txHashes: [h(10)], order: matchFlashOrder(plan, { ...order, side: "sell" }), onchain: verified }).status).toBe("MISMATCH");
    expect(combineEvidence({ txHashes: [], orderLookupFailed: "404" }).status).toBe("MISMATCH");
  });

  it("checks the order's own fill transactions on chain", async () => {
    const seen: string[] = [];
    const ev = await verifyLeader(plan, { flashOrderId: "o1" }, new Map(), {
      getOrder: async () => ({ order, fills: [{ transactionId: h(11) }, { transactionId: h(12), status: "CHAIN_STATUS_REORGED" }] }) as never,
      readTx: async (hash) => {
        seen.push(hash);
        return buyTx(hash, 100.4, 0.04);
      },
    });
    expect(seen).toEqual([h(11)]); // the reorged fill is not evidence
    expect(ev.status).toBe("ONCHAIN_VERIFIED");
    expect(ev.txHashes).toEqual([h(11)]);
  });
});

describe("policy reads leader evidence", () => {
  const base = {
    side: "buy" as const,
    orderType: "twap" as const,
    chain: "base" as const,
    qty: "25",
    notionalUsd: 25,
    invalidation: "below the stop",
    entryReferencePrice: "2500",
    stopLossPrice: "2450",
    takeProfitPrice: "2600",
    targetAsset: WETH,
    contraAsset: USDC,
  };
  const policy = { ...defaultPolicy("0x2222222222222222222222222222222222222222"), maxNotionalUsd: 100, maxDailyUsd: 200 };

  it("holds a contradicted plan for every follower", () => {
    expect(decide({ ...base, leaderEvidenceStatus: "MISMATCH" } as never, policy, 0).reasons).toEqual(["LEADER_EXECUTION_MISMATCH"]);
  });

  it("requires a matching order by default, or chain proof when the follower asks for it", () => {
    const required = { ...policy, requireLeaderExecutionEvidence: true };
    expect(decide({ ...base, leaderEvidenceStatus: "UNVERIFIED" } as never, required, 0).reasons).toEqual(["LEADER_EXECUTION_UNVERIFIED"]);
    expect(decide({ ...base, leaderEvidenceStatus: "PLAN_MATCHED" } as never, required, 0).reasons).not.toContain("LEADER_EXECUTION_UNVERIFIED");
    const strict = { ...required, minLeaderEvidence: "ONCHAIN_VERIFIED" as const };
    expect(decide({ ...base, leaderEvidenceStatus: "PLAN_MATCHED" } as never, strict, 0).reasons).toEqual(["LEADER_EXECUTION_UNVERIFIED"]);
    expect(decide({ ...base, leaderEvidenceStatus: "ONCHAIN_VERIFIED" } as never, strict, 0).reasons).not.toContain("LEADER_EXECUTION_UNVERIFIED");
  });
});

describe("evidence in the store", () => {
  const g = globalThis as unknown as { __pact?: unknown; __pactEvidence?: unknown };

  it("re-decides waiting copies when evidence arrives, records it once, and builds the record", async () => {
    delete g.__pact;
    delete g.__pactEvidence;
    process.env.PACT_STORE_FILE = join(tmpdir(), `pact-leader-evidence-test-${process.pid}.json`);
    const store = await import("./store");
    const ev = await import("./evidence");
    store.resetStore();
    await store.seedDemo();
    const follower = store.DEMO_EVIDENCE_FOLLOWER; // requires leader execution evidence
    const mine = () => store.snapshot().proposals.filter((p) => p.follower === follower);
    const before = mine()[0];
    expect(store.decisionFor(before.id)?.reasons).toContain("LEADER_EXECUTION_UNVERIFIED");

    const strategy = store.snapshot().strategies.find((s) => s.id === before.strategyId)!;
    const verified = combineEvidence({ txHashes: [h(20)], onchain: assessOnchain({ ...strategy, createdAt: plan.createdAt, expiresAt: plan.expiresAt }, [buyTx(h(20), 25, 0.01, {}, strategy.leader)]) });
    expect(verified.status).toBe("ONCHAIN_VERIFIED");
    await store.setLeaderEvidence(strategy.id, verified);
    const after = mine().find((p) => p.strategyId === strategy.id)!;
    expect(after.leaderEvidenceStatus).toBe("ONCHAIN_VERIFIED");
    expect(store.decisionFor(after.id)?.reasons ?? []).not.toContain("LEADER_EXECUTION_UNVERIFIED");

    // A later re-check with the same facts adds nothing to the log.
    const count = ev.evidenceLog().filter((e) => e.kind === "leader.evidence").length;
    await store.setLeaderEvidence(strategy.id, { ...verified, checkedAt: new Date().toISOString() });
    expect(ev.evidenceLog().filter((e) => e.kind === "leader.evidence").length).toBe(count);
    expect(store.evidenceTxIndex().get(h(20))).toBe(strategy.id);

    const record = leaderRecord(store.snapshot(), strategy.leader);
    expect(record.evidence.ONCHAIN_VERIFIED).toBe(1);
    expect(record.backed).toBe(1);
    expect(record.leaderVolumeUsd).toBe(25);
    expect(record.plans).toBeGreaterThan(1);
  });
});
