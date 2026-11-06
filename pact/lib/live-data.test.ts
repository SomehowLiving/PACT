import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({
  rpc: {
    getCode: vi.fn(),
    getTransactionCount: vi.fn(),
    getBalance: vi.fn(),
    readContract: vi.fn(),
    getBlock: vi.fn(),
    getLogs: vi.fn(),
  },
}));
vi.mock("./base-rpc", () => ({ baseClient: rpc, logsClient: rpc }));

const W = "0x1234567890abcdef1234567890abcdef12345678";

describe("wallet facts (Base)", () => {
  beforeEach(() => {
    for (const f of Object.values(rpc)) f.mockReset();
    rpc.getCode.mockResolvedValue("0x");
    rpc.getTransactionCount.mockResolvedValue(42);
    rpc.getBalance.mockResolvedValue(BigInt("500000000000000000"));
    // USDC then WETH balanceOf
    rpc.readContract.mockResolvedValueOnce(BigInt(1_250_000_000)).mockResolvedValueOnce(BigInt("200000000000000000"));
    rpc.getBlock.mockResolvedValue({ number: BigInt(1_000_000), timestamp: BigInt(1_800_000_000) });
  });

  it("reads balances, activity and recent USDC/WETH flows", async () => {
    // out USDC, in USDC, out WETH, in WETH
    rpc.getLogs
      .mockResolvedValueOnce([{ args: { value: BigInt(100_000_000) }, blockNumber: BigInt(999_000) }])
      .mockResolvedValueOnce([{ args: { value: BigInt(50_000_000) }, blockNumber: BigInt(999_900) }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ args: { value: BigInt("100000000000000000") }, blockNumber: BigInt(999_500) }]);
    const { walletFacts } = await import("./wallet-facts");
    const w = await walletFacts(W, 1);
    expect(w).toMatchObject({ demo: false, isContract: false, txCount: 42, eth: 0.5, usdc: 1250, weth: 0.2 });
    if (w.demo) throw new Error("unexpected demo");
    expect(w.flows).toEqual({ usdc: { in: 50, out: 100, transfers: 2 }, weth: { in: 0.1, out: 0, transfers: 1 } });
    // Last move at block 999,900: 100 blocks (200 s) before the head.
    expect(w.lastActivityAt).toBe(new Date((1_800_000_000 - 200) * 1000).toISOString());
  });

  it("never reads a DEMO address", async () => {
    const { walletFacts } = await import("./wallet-facts");
    expect(await walletFacts("0x1111111111111111111111111111111111111111")).toEqual({ address: "0x1111111111111111111111111111111111111111", demo: true });
    expect(rpc.getBalance).not.toHaveBeenCalled();
  });

  it("keeps balances when logs fail, and marks flows unknown rather than zero", async () => {
    rpc.getLogs.mockRejectedValue(new Error("request limit reached"));
    const { walletFacts } = await import("./wallet-facts");
    const w = await walletFacts("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", 2);
    if (w.demo) throw new Error("unexpected demo");
    expect(w.usdc).toBe(1250);
    expect(w.flows).toBeUndefined();
  });
});

describe("live-priced demo", () => {
  const g = globalThis as unknown as { __pact?: unknown; __pactEvidence?: unknown };

  it("prices every DEMO plan off today's price and keeps the same decisions", async () => {
    delete g.__pact;
    delete g.__pactEvidence;
    process.env.PACT_STORE_FILE = join(tmpdir(), `pact-live-demo-${process.pid}.json`);
    const store = await import("./store");
    store.resetStore();
    const fixed = await store.seedDemo();
    const fixedCases = [...fixed.portfolio, ...fixed.edgeCases].map((e) => [e.proposal.demoCase, e.decision.action]);
    const live = await store.seedDemo({ price: 2224.58 });
    const liveCases = [...live.portfolio, ...live.edgeCases].map((e) => [e.proposal.demoCase, e.decision.action]);
    expect(liveCases).toEqual(fixedCases);
    const trend = store.snapshot().strategies.find((s) => s.title === "Trend entry · leader one");
    expect(trend).toMatchObject({ entryReferencePrice: "2224.58", stopLossPrice: (2224.58 * 0.98).toFixed(2), takeProfitPrice: (2224.58 * 1.04).toFixed(2) });
    const pullback = store.snapshot().strategies.find((s) => s.title === "Pullback entry · leader two");
    expect(Number(pullback?.limitNotionalPrice)).toBeLessThan(2224.58);
  });
});
