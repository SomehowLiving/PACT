import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultPolicy, USDC, WETH } from "./constants";
import { frontRun, sellIntoFlow, summarize } from "./conduct";
import { decide } from "./policy";

const T = Date.parse("2026-11-06T12:00:00Z");
const min = (n: number) => n * 60_000;
const fills = [
  { at: T, price: 2500, units: 0.01 },
  { at: T + min(5), price: 2510, units: 0.01 },
];

describe("front-run", () => {
  it("flags a leader who got in long before publishing at a much better price", () => {
    const r = frontRun({ createdAt: new Date(T - min(1)).toISOString(), side: "buy" }, { firstTradeAt: new Date(T - min(120)).toISOString(), averagePrice: 2400 }, fills);
    expect(r?.flagged).toBe(true);
    expect(r?.leadMinutes).toBeCloseTo(119);
    expect(r?.advantageBps).toBeGreaterThan(400);
  });

  it("does not flag skin in the game: trading just before publishing at the same price", () => {
    const r = frontRun({ createdAt: new Date(T - min(1)).toISOString(), side: "buy" }, { firstTradeAt: new Date(T - min(6)).toISOString(), averagePrice: 2502 }, fills);
    expect(r?.flagged).toBe(false);
  });

  it("needs the leader's evidenced trade", () => {
    expect(frontRun({ createdAt: new Date(T).toISOString(), side: "buy" }, {}, fills)).toBeUndefined();
  });
});

describe("sold into followers' buys", () => {
  it("counts the asset leaving the leader's wallet inside the followers' buy window", () => {
    const r = sellIntoFlow(fills, [{ at: T + min(10), units: 0.3 }, { at: T + min(200), units: 5 }], 1);
    expect(r?.soldUnits).toBeCloseTo(0.3);
    expect(r?.ratio).toBeCloseTo(0.3);
    expect(r?.flagged).toBe(true);
  });

  it("ignores sales outside the window and small trims", () => {
    expect(sellIntoFlow(fills, [{ at: T - min(10), units: 1 }], 1)?.flagged).toBe(false);
    expect(sellIntoFlow(fills, [{ at: T + min(2), units: 0.05 }], 1)?.flagged).toBe(false);
  });

  it("falls back to followers' bought units when the leader's position is unknown", () => {
    const r = sellIntoFlow(fills, [{ at: T + min(1), units: 0.01 }]);
    expect(r?.basis).toBe("follower buys");
    expect(r?.ratio).toBeCloseTo(0.5);
  });
});

describe("summary and policy", () => {
  const flagged = (id: string) => ({ strategyId: id, title: id, sellIntoFlow: { windowStart: "", windowEnd: "", followerUnits: 1, soldUnits: 1, ratio: 1, basis: "leader position" as const, flagged: true } });

  it("one occurrence is a caution, a repeat is an alert with a hold reason", () => {
    expect(summarize("0xA", [flagged("a")], "base").level).toBe("caution");
    const two = summarize("0xA", [flagged("a"), flagged("b")], "base");
    expect(two).toMatchObject({ level: "alert", reasons: ["LEADER_SOLD_INTO_FOLLOWERS"], soldIntoFlow: 2 });
  });

  it("holds new copies for review on an alert, and only then", () => {
    const p = { ...defaultPolicy("0x2222222222222222222222222222222222222222"), requirePlanProtection: false };
    const prop = { side: "buy", orderType: "twap", chain: "base", qty: "25", notionalUsd: 25, targetAsset: WETH, contraAsset: USDC } as never;
    expect(decide(prop, p, { dailySpentUsd: 0, leaderConduct: { level: "alert", reasons: ["LEADER_SOLD_INTO_FOLLOWERS"] } })).toMatchObject({ verdict: "BLOCK", action: "REVIEW", reasons: ["LEADER_SOLD_INTO_FOLLOWERS"] });
    expect(decide(prop, p, { dailySpentUsd: 0, leaderConduct: { level: "caution", reasons: [] } }).verdict).not.toBe("BLOCK");
  });
});

describe("scan through the store", () => {
  const g = globalThis as unknown as { __pact?: unknown; __pactEvidence?: unknown };

  it("measures followers' real fills against the leader's outflows, logs it, and holds new copies", async () => {
    delete g.__pact;
    delete g.__pactEvidence;
    process.env.PACT_STORE_FILE = join(tmpdir(), `pact-conduct-test-${process.pid}.json`);
    const store = await import("./store");
    const ev = await import("./evidence");
    const { scanLeaderConduct } = await import("./conduct-run");
    store.resetStore();
    const leader = "0xd0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d1" as const;
    const follower = "0xf0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f1" as const;
    store.upsertPolicy({ ...defaultPolicy(follower), follows: [leader], requirePlanProtection: false });
    const now = Date.now();
    const planFor = (title: string) =>
      store.addStrategy({
        leader,
        chain: "base",
        targetAsset: WETH,
        contraAsset: USDC,
        side: "buy",
        title,
        thesis: "t",
        orderType: "twap",
        qty: "25",
        durationSeconds: 600,
        expiresAt: new Date(now + 3_600_000).toISOString(),
        invalidation: "stop",
        entryReferencePrice: "2500",
        stopLossPrice: "2450",
        takeProfitPrice: "2600",
      });
    // Two plans the follower copied and got filled on.
    for (const [i, title] of ["one", "two"].entries()) {
      const s = planFor(title);
      const prop = (await store.createProposal(s.id, follower))?.proposal;
      store.addReceipt({
        proposalId: prop!.id,
        follower,
        decision: store.decisionFor(prop!.id)!,
        flashOrderId: `o${i}`,
        status: "ORDER_STATUS_FILLED",
        fills: [{ fillPrice: "2500", notional: "25", filledAt: new Date(now - (i + 1) * 3_600_000).toISOString(), transactionId: `0x${i}` }],
        notionalUsd: 25,
      });
    }
    // Base says: right after each follower fill, 0.02 WETH (twice what followers bought) left the leader.
    const outflows = async (_o: string, _t: string, from: number) => [{ at: from + 60_000, units: 0.02 }];
    const { conduct } = await scanLeaderConduct(leader, { outflows });
    expect(conduct).toMatchObject({ level: "alert", soldIntoFlow: 2, reasons: ["LEADER_SOLD_INTO_FOLLOWERS"], source: "base" });
    expect(ev.evidenceLog().some((e) => e.kind === "leader.conduct" && e.data.level === "alert")).toBe(true);
    // A new plan from this leader is now held for the follower.
    const next = planFor("three");
    const held = (await store.createProposal(next.id, follower))?.proposal;
    expect(store.decisionFor(held!.id)?.reasons).toEqual(["LEADER_SOLD_INTO_FOLLOWERS"]);
  });
});

describe("Base outflow timing", () => {
  it("maps block numbers to times with 2 s blocks and keeps the range bounded", async () => {
    const { tokenOutflows } = await import("./base-rpc");
    const headS = 1_800_000_000;
    let range: { fromBlock?: bigint; toBlock?: bigint } = {};
    const client = {
      getBlock: async () => ({ number: BigInt(1_000_000), timestamp: BigInt(headS) }),
      getLogs: async (args: { fromBlock?: bigint; toBlock?: bigint }) => {
        range = args;
        return [{ blockNumber: BigInt(999_700), args: { value: BigInt("500000000000000000") }, transactionHash: "0xabc" }];
      },
    } as never;
    const out = await tokenOutflows("0x1", WETH, (headS - 1200) * 1000, (headS - 300) * 1000, 18, client);
    expect(out).toEqual([{ at: (headS - 600) * 1000, units: 0.5, tx: "0xabc" }]);
    expect(range.fromBlock).toBe(BigInt(1_000_000 - 600 - 5));
    expect(range.toBlock).toBe(BigInt(1_000_000 - 150 + 5));
  });
});

describe("conduct changes", () => {
  const g = globalThis as unknown as { __pact?: unknown; __pactEvidence?: unknown };

  it("a first clean scan is not news: no evidence event, no re-decided copies", async () => {
    delete g.__pact;
    delete g.__pactEvidence;
    process.env.PACT_STORE_FILE = join(tmpdir(), `pact-conduct-clear-${process.pid}.json`);
    const store = await import("./store");
    const ev = await import("./evidence");
    store.resetStore();
    const before = ev.evidenceLog().length;
    const r = await store.setLeaderConduct(summarize("0xc1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1", [], "base"));
    expect(r.changed).toBe(false);
    expect(ev.evidenceLog().length).toBe(before);
  });
});
