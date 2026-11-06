import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHAINS } from "./chains";
import { executionMetrics, postQuote, quoteRequest } from "./flash";
import { bracketPriceFloor, verifyBracketSigning, verifySigning } from "./guard";

/*
 * Live contract test against the real Flash API: quotes only, never an order or a signature.
 * Opt-in:  FLASH_LIVE=1 npx vitest run lib/flash.live.test.ts
 * It proves PACT's request shaping is accepted and its guard passes Flash's real payloads.
 */
const LIVE = process.env.FLASH_LIVE === "1";

function loadKey() {
  if (process.env.FLASH_API_KEY && process.env.FLASH_API_KEY !== "test-key") return;
  try {
    const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    const m = env.match(/^FLASH_API_KEY=(.*)$/m);
    if (m) process.env.FLASH_API_KEY = m[1].trim().replace(/^"|"$/g, "");
  } catch {
    /* no local env */
  }
}

// A well-known public address used only as the quote's funder; nothing is signed or placed.
const FUNDER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const { weth, usdc } = CHAINS.base;
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

describe.skipIf(!LIVE)("Flash live quotes (no orders)", () => {
  loadKey();
  const plan = { entryReferencePrice: "2500", stopLossPrice: "1500" };
  const bracket = { takeProfit: { notionalPrice: "4000" }, stopLoss: { notionalPrice: "1500" }, expireTime: inHours(24) };

  it("accepts a limit entry with an attached bracket (pair rate + aligned expiries)", async () => {
    const body = quoteRequest({
      targetAsset: weth, contraAsset: usdc, side: "buy", qty: "20", orderType: "limit", funderAddress: FUNDER,
      limitNotionalPrice: "1800", attachedBracket: bracket, planExpiresAt: inHours(4),
    });
    expect(body.limitCrossPrice).toBe("1800");
    const quote = await postQuote(body);
    expect(quote.quoteId).toBeTruthy();
    expect(quote.attachedBracket?.evm?.orderTypedData).toBeTruthy();
    const entry = verifySigning({ chain: "base", follower: FUNDER, side: "buy", targetAsset: weth, contraAsset: usdc, qty: "20", quote: quote.evm ?? {} });
    expect(entry.checks.filter((c) => c.level === "fail")).toEqual([]);
  }, 30_000);

  it("guards Flash's real TWAP + protection payloads and reports fees separately", async () => {
    const body = quoteRequest({
      targetAsset: weth, contraAsset: usdc, side: "buy", qty: "20", orderType: "twap", funderAddress: FUNDER,
      durationSeconds: 600, twapBucketCount: 4, attachedBracket: bracket, planExpiresAt: inHours(4),
    });
    const quote = await postQuote(body);
    const entry = verifySigning({ chain: "base", follower: FUNDER, side: "buy", targetAsset: weth, contraAsset: usdc, qty: "20", quote: quote.evm ?? {} });
    expect(entry.checks.filter((c) => c.level === "fail")).toEqual([]);
    const protection = verifyBracketSigning({
      chain: "base", follower: FUNDER, targetAsset: weth, contraAsset: usdc, entryQty: "20",
      priceFloor: bracketPriceFloor(plan), signedMaxFromAmount: quote.attachedBracket?.signedMaxFromAmount,
      quote: quote.attachedBracket?.evm ?? {},
    });
    expect(protection.checks.filter((c) => c.level === "fail")).toEqual([]);
    const m = executionMetrics(quote, "buy");
    expect(Number(m.costRatio)).toBeGreaterThan(0);
    expect(Number(m.allInPrice)).toBeGreaterThan(Number(m.executionPrice));
  }, 30_000);

  it("keeps a TWAP copy inside a short plan window", async () => {
    const body = quoteRequest({
      targetAsset: weth, contraAsset: usdc, side: "buy", qty: "20", orderType: "twap", funderAddress: FUNDER,
      durationSeconds: 7_200, planExpiresAt: inHours(0.25),
    });
    expect(body.durationSeconds).toBeLessThanOrEqual(900);
    const quote = await postQuote(body);
    expect(quote.quoteId).toBeTruthy();
  }, 30_000);

  it("streams orders over Flash's WebSocket: snapshot for one funder, then heartbeats", async () => {
    const { OrderStream } = await import("./flash-stream");
    const snapshots: unknown[][] = [];
    const stream = new OrderStream({ apiKey: process.env.FLASH_API_KEY! }, { onSnapshot: (_s, orders) => snapshots.push(orders) });
    stream.open(FUNDER);
    const deadline = Date.now() + 15_000;
    while (!stream.healthy(FUNDER) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    const status = stream.status(FUNDER);
    stream.closeAll();
    expect(status?.status).toBe("live");
    expect(Array.isArray(snapshots[0])).toBe(true);
  }, 30_000);

  it("reads a real Base transaction and decodes its USDC transfers (leader evidence reader)", async () => {
    const { baseClient, readTx } = await import("./base-rpc");
    // The public RPC refuses eth_getLogs; walk the latest block's transactions instead.
    const block = await baseClient.getBlock({ blockTag: "latest" });
    let tx: Awaited<ReturnType<typeof readTx>> | undefined;
    for (const hash of block.transactions.slice(0, 40)) {
      const candidate = await readTx(hash);
      if (candidate.status === "success" && candidate.transfers.some((t) => t.token === usdc.toLowerCase())) {
        tx = candidate;
        break;
      }
    }
    expect(tx, "no USDC transfer in the first 40 transactions of the latest block").toBeDefined();
    if (!tx) return;
    expect(tx.timestamp).toBeGreaterThan(Date.now() / 1000 - 600);
    expect(tx.finalized).toBe(false); // seconds old: not final yet
    expect(tx.transfers.some((t) => t.token === usdc.toLowerCase() && t.value > BigInt(0))).toBe(true);
  }, 30_000);

  it("paper-copies a plan with a real Flash quote and marks it on real candles", async () => {
    const { runShadowEntry, settleShadowFor } = await import("./shadow-run");
    const { assetPrice } = await import("./price");
    const mid = await assetPrice("base", weth);
    const now = Date.now();
    const plan = {
      id: "live-shadow",
      leader: FUNDER as `0x${string}`,
      chain: "base" as const,
      side: "buy" as const,
      orderType: "twap" as const,
      qty: "250",
      targetAsset: weth,
      contraAsset: usdc,
      entryReferencePrice: mid.toFixed(2),
      stopLossPrice: (mid * 0.97).toFixed(2),
      takeProfitPrice: (mid * 1.05).toFixed(2),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 4 * 3_600_000).toISOString(),
      protectionExpiresAt: new Date(now + 24 * 3_600_000).toISOString(),
      title: "live",
      thesis: "live",
      leaderPlanGrade: "DISCIPLINED" as const,
      leaderPlanReasons: [],
      leaderEvidenceStatus: "UNVERIFIED" as const,
    };
    // Not in the store, so setShadow is a no-op; the returned paper copy is what is checked.
    const entered = await runShadowEntry(plan);
    expect(entered?.status).toBe("OPEN");
    expect(entered!.sizeUsd).toBe(100);
    expect(Math.abs(entered!.entryDriftBps!)).toBeLessThan(150);
    expect(entered!.costRatio).toBeGreaterThan(0);
    const marked = await settleShadowFor({ ...plan, shadow: { ...entered!, enteredAt: new Date(now - 30 * 60_000).toISOString() } });
    expect(["OPEN", "STOPPED", "TARGET"]).toContain(marked?.status);
    if (marked?.status === "OPEN") expect(marked.markPrice).toBeGreaterThan(0);
  }, 30_000);

  it("three prices agree in a calm market: Chainlink on Base, the chart and a Flash quote (R11)", async () => {
    const { referenceAtQuote } = await import("./reference");
    const quote = await postQuote(quoteRequest({ targetAsset: weth, contraAsset: usdc, side: "buy", qty: "100", orderType: "market", funderAddress: FUNDER }));
    const check = await referenceAtQuote({ chain: "base", targetAsset: weth }, Number(executionMetrics(quote, "buy").executionPrice), "0.01");
    expect(check?.oracle).toBeGreaterThan(0);
    expect(check?.chart).toBeGreaterThan(0);
    expect(["OK", "DIVERGED"]).toContain(check?.status); // never UNAVAILABLE: the oracle is fresh
    expect(Math.abs(check!.quoteVsOracleBps!)).toBeLessThan(300);
  }, 30_000);

  it("Arc (5042): quotes, and the wallet guard passes Flash's real Arc payloads, entry and protection", async () => {
    const arc = CHAINS.arc;
    const stop = "1500";
    const quote = await postQuote(
      quoteRequest({
        chain: "arc",
        targetAsset: arc.weth,
        contraAsset: arc.usdc,
        side: "buy",
        qty: "20",
        orderType: "twap",
        funderAddress: FUNDER,
        durationSeconds: 600,
        twapBucketCount: 2,
        attachedBracket: { takeProfit: { notionalPrice: "4000" }, stopLoss: { notionalPrice: stop }, expireTime: inHours(24) },
        planExpiresAt: inHours(4),
      }),
    );
    const m = executionMetrics(quote, "buy");
    expect(Number(m.executionPrice)).toBeGreaterThan(500);
    const entry = verifySigning({ chain: "arc", follower: FUNDER, side: "buy", targetAsset: arc.weth, contraAsset: arc.usdc, qty: "20", quote: quote.evm ?? {} });
    const protection = verifyBracketSigning({
      chain: "arc",
      follower: FUNDER,
      targetAsset: arc.weth,
      contraAsset: arc.usdc,
      entryQty: "20",
      priceFloor: bracketPriceFloor({ stopLossPrice: stop }),
      signedMaxFromAmount: quote.attachedBracket?.signedMaxFromAmount,
      quote: quote.attachedBracket?.evm ?? {},
    });
    const fails = [...entry.checks, ...protection.checks].filter((c) => c.level === "fail");
    expect(fails.map((c) => `${c.id}: ${c.detail}`)).toEqual([]);
  }, 30_000);

  it("marks an open position at Flash's exit quote, net of fees and below the mid", async () => {
    const { exitMark } = await import("./marks");
    const { assetPrice } = await import("./price");
    const mark = await exitMark({ chain: "base", targetAsset: weth, contraAsset: usdc, units: 0.01, funder: FUNDER });
    expect(mark?.basis).toBe("flash-exit-quote");
    const mid = await assetPrice("base", weth);
    // Selling costs fees and impact, so the exit price sits a little under the mid.
    expect(mark!.price).toBeLessThan(mid * 1.01);
    expect(mark!.price).toBeGreaterThan(mid * 0.9);
  }, 30_000);
});
