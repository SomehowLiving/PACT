import { afterEach, describe, expect, it, vi } from "vitest";
import { executionMetrics, fillExecutionMetrics, getOrder, postBatchCancel, postCancel, quoteRequest } from "./flash";
import { batchCancelMessage, cancelMessage, parseOrderTypedData } from "./typed";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(body: unknown, status = 200) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  process.env.FLASH_API_KEY = "test-key";
  return fn;
}

describe("flash contracts", () => {
  it("reads an order with the funder address and unwraps { order, fills }", async () => {
    const fn = stubFetch({
      order: { orderId: "o1", status: "ORDER_STATUS_PARTIALLY_FILLED", twapBucketCount: 4 },
      fills: [{ transactionId: "0xabc", fillPrice: "2400", notional: "2.5" }],
    });
    const detail = await getOrder("o1", "0x2222222222222222222222222222222222222222");
    const url = (fn.mock.calls[0] as unknown as [string])[0];
    expect(url).toContain("/orders/o1?funderAddress=0x2222222222222222222222222222222222222222");
    expect(detail.order.status).toBe("ORDER_STATUS_PARTIALLY_FILLED");
    expect(detail.fills[0].transactionId).toBe("0xabc");
  });

  it("surfaces Flash's error message, not raw JSON", async () => {
    stubFetch({ error: { code: "NOT_FOUND", message: "order x not found" } }, 404);
    await expect(getOrder("x", "0x1")).rejects.toThrow(/order x not found/);
  });

  it("builds the cancel message exactly: em dash and one newline", () => {
    expect(cancelMessage("abc")).toBe("Definitive Flash v1 — Cancel Order\nOrder: abc");
    expect(cancelMessage("abc")).not.toContain(" - ");
  });

  it("posts the same message it asks the wallet to sign", async () => {
    const fn = stubFetch({ orderId: "abc", status: "ORDER_STATUS_CANCELLED" });
    await postCancel("abc", "0xsig");
    const init = (fn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toEqual({
      cancelMessage: cancelMessage("abc"),
      userSignature: "0xsig",
    });
  });

  it("echoes triggers for a take-profit quote and refuses one without a trigger", () => {
    const base = {
      targetAsset: "0x4200000000000000000000000000000000000006",
      contraAsset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      side: "sell" as const,
      qty: "0.01",
      orderType: "take-profit" as const,
      funderAddress: "0x2222222222222222222222222222222222222222",
    };
    const q = quoteRequest({ ...base, triggers: [{ notionalPrice: "3000", triggerType: "upper" }] });
    expect(q.triggers).toEqual([{ notionalPrice: "3000", triggerType: "upper" }]);
    expect(() => quoteRequest(base)).toThrow(/trigger/);
  });

  it("sets an end time on resting orders and never on TWAP or market orders", () => {
    const nowMs = Date.UTC(2026, 10, 5, 12, 0, 0);
    const base = {
      targetAsset: "0x4200000000000000000000000000000000000006",
      contraAsset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      side: "buy" as const,
      qty: "25",
      funderAddress: "0x2222222222222222222222222222222222222222",
      nowMs,
    };
    const week = "2026-11-12T12:00:00.000Z";
    expect(quoteRequest({ ...base, orderType: "limit", limitNotionalPrice: "1800" }).expireTime).toBe(week);
    for (const orderType of ["stop-loss", "take-profit", "stop"] as const) {
      const q = quoteRequest({
        ...base,
        orderType,
        triggers: [{ notionalPrice: "3000", triggerType: "upper" }],
      });
      expect(q.expireTime).toBe(week);
    }
    // Flash rejects expireTime on these.
    expect(quoteRequest({ ...base, orderType: "twap" }).expireTime).toBeUndefined();
    expect(quoteRequest({ ...base, orderType: "market" }).expireTime).toBeUndefined();
  });

  it("puts TWAP-only duration on the quote while preserving submit-echo fields", () => {
    const q = quoteRequest({
      targetAsset: "0x4200000000000000000000000000000000000006",
      contraAsset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      side: "buy",
      qty: "25",
      orderType: "twap",
      funderAddress: "0x2222222222222222222222222222222222222222",
      durationSeconds: 600,
      twapBucketCount: 6,
      startTime: "2026-11-05T12:05:00.000Z",
      limitNotionalPrice: "2512.5",
    });
    expect(q).toMatchObject({
      durationSeconds: 600,
      twapBucketCount: 6,
      startTime: "2026-11-05T12:05:00.000Z",
      limitNotionalPrice: "2512.5",
    });
    expect(q.expireTime).toBeUndefined();
  });

  it("rejects unsupported TWAP timing parameters before calling Flash", () => {
    const base = {
      targetAsset: "0x4200000000000000000000000000000000000006",
      contraAsset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      side: "buy" as const,
      qty: "25",
      orderType: "twap" as const,
      funderAddress: "0x2222222222222222222222222222222222222222",
    };
    expect(() => quoteRequest({ ...base, durationSeconds: 299 })).toThrow(/at least 300/);
    expect(() => quoteRequest({ ...base, twapBucketCount: 1 })).toThrow(/2 to 2560/);
  });

  it("includes an attached TP/SL bracket unchanged on a same-chain entry quote", () => {
    const q = quoteRequest({
      targetAsset: "0x4200000000000000000000000000000000000006",
      contraAsset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      side: "buy",
      qty: "25",
      orderType: "twap",
      funderAddress: "0x2222222222222222222222222222222222222222",
      attachedBracket: {
        takeProfit: { notionalPrice: "2600" },
        stopLoss: { notionalPrice: "2450" },
        expireTime: "2026-11-06T12:00:00.000Z",
      },
    });
    expect(q.attachedBracket).toEqual({
      takeProfit: { notionalPrice: "2600" },
      stopLoss: { notionalPrice: "2450" },
      expireTime: "2026-11-06T12:00:00.000Z",
    });
  });

  it("keeps market price (for drift) apart from all-in price and fee cost", () => {
    const quote = {
      quoteId: "q1",
      estimatedPriceImpact: "0.0042",
      from: { amount: "20", notional: "20", symbol: "USDC" },
      to: { amount: "0.0078", notional: "19.5", symbol: "WETH" },
      fees: { estimatedFeeNotional: "0.36" },
    };
    const m = executionMetrics(quote, "buy");
    expect(Number(m.executionPrice)).toBeCloseTo(19.5 / 0.0078, 6); // market mark, what the limit bounds
    expect(Number(m.allInPrice)).toBeCloseTo(20 / 0.0078, 6); // USD spent ÷ WETH received
    // Value lost (20 − 19.5) exceeds the reported fee (0.36): cost is what converting loses.
    expect(Number(m.costRatio)).toBeCloseTo(0.025, 6);
    expect(m.feeNotional).toBe("0.36");

    // A real Flash market quote: fee field 0, value received below value spent.
    const market = executionMetrics(
      { quoteId: "q3", from: { amount: "100", notional: "100" }, to: { amount: "0.0445", notional: "99.832016" }, fees: { estimatedFeeNotional: "0" } },
      "buy",
    );
    expect(Number(market.costRatio)).toBeCloseTo(0.00167984, 8);
    expect(market.feeNotional).toBe("0");

    const sell = executionMetrics(
      {
        quoteId: "q2",
        from: { amount: "0.01", notional: "22.5", symbol: "WETH" },
        to: { amount: "22.4", notional: "22.4", symbol: "USDC" },
        fees: { estimatedFeeNotional: "0.4" },
      },
      "sell",
    );
    expect(Number(sell.allInPrice)).toBeCloseTo((22.4 - 0.4) / 0.01, 6); // integrator fee not taken out of `to` on sells
  });

  it("prices fills from Flash's amounts, never from the inverted sell fillPrice", () => {
    const buy = fillExecutionMetrics(
      {
        fills: [
          { status: "CHAIN_STATUS_FINALIZED", fillPrice: "2505", targetAmount: "0.002", contraAmount: "5.01", feeNotional: "0.03" },
          { status: "CHAIN_STATUS_FINALIZED", fillPrice: "2515", targetAmount: "0.006", contraAmount: "15.09", feeNotional: "0.05" },
        ],
      },
      "buy",
      "2500",
    );
    // All-in (fees included) is the cost basis; the execution price is before fees, where Flash's
    // limit applies, and entry drift is measured on it (the same basis as quote time).
    expect(Number(buy.averageFillPrice)).toBeCloseTo(20.1 / 0.008, 6);
    expect(Number(buy.executionPrice)).toBeCloseTo((20.1 - 0.08) / 0.008, 6);
    expect(buy.entryDriftBps).toBeCloseTo((((20.1 - 0.08) / 0.008 - 2500) / 2500) * 10_000, 6);
    expect(buy.feesUsd).toBeCloseTo(0.08, 9);

    // A real WETH sell: fillPrice is USDC-per-... inverted (~0.00045). Flash's own average wins.
    const sell = fillExecutionMetrics(
      {
        filled: { averageNotionalPrice: "2226.66" },
        fills: [{ status: "CHAIN_STATUS_FINALIZED", fillPrice: "0.00045037", targetAmount: "0.01", contraAmount: "22.2666" }],
      },
      "sell",
      "2200",
    );
    expect(sell.averageFillPrice).toBe("2226.66");
    expect(sell.entryDriftBps).toBeLessThan(0); // sold above entry: better for the follower

    const mixed = fillExecutionMetrics(
      {
        fills: [
          { status: "CHAIN_STATUS_FINALIZED", targetAmount: "0.004", contraAmount: "10" },
          { status: "CHAIN_STATUS_REORGED", targetAmount: "1", contraAmount: "1" },
          { status: "CHAIN_STATUS_PROCESSED", targetAmount: "0.004", contraAmount: "10" },
        ],
      },
      "buy",
    );
    expect(mixed).toMatchObject({ averageFillPrice: "2500", finalFillCount: 1, pendingFillCount: 1 });
  });

  it("uses the pair rate for a limit entry with protection, and keeps copies inside the plan window", () => {
    const now = Date.parse("2026-11-06T12:00:00Z");
    const planEnd = "2026-11-06T16:00:00Z";
    const bracket = { takeProfit: { notionalPrice: "2600" }, stopLoss: { notionalPrice: "2450" }, expireTime: "2026-11-06T14:00:00Z" };
    const limit = quoteRequest({
      targetAsset: "0xT", contraAsset: "0xC", side: "buy", qty: "20", orderType: "limit", funderAddress: "0xF",
      limitNotionalPrice: "2525", attachedBracket: bracket, planExpiresAt: planEnd, nowMs: now,
    });
    expect(limit.limitCrossPrice).toBe("2525");
    expect(limit.limitNotionalPrice).toBeUndefined();
    expect(limit.expireTime).toBe(new Date(planEnd).toISOString()); // not 7 days
    expect(limit.attachedBracket?.expireTime).toBe(limit.expireTime); // protection never ends first

    const plain = quoteRequest({
      targetAsset: "0xT", contraAsset: "0xC", side: "buy", qty: "20", orderType: "limit", funderAddress: "0xF",
      limitNotionalPrice: "2525", planExpiresAt: planEnd, nowMs: now,
    });
    expect(plain.limitNotionalPrice).toBe("2525");
    expect(plain.limitCrossPrice).toBeUndefined();

    const twap = quoteRequest({
      targetAsset: "0xT", contraAsset: "0xC", side: "buy", qty: "20", orderType: "twap", funderAddress: "0xF",
      durationSeconds: 86_400, planExpiresAt: "2026-11-06T12:30:00Z", nowMs: now,
    });
    expect(twap.durationSeconds).toBe(1_800); // capped to the 30 minutes left in the plan
    expect(() =>
      quoteRequest({
        targetAsset: "0xT", contraAsset: "0xC", side: "buy", qty: "20", orderType: "twap", funderAddress: "0xF",
        planExpiresAt: "2026-11-06T12:02:00Z", nowMs: now,
      }),
    ).toThrow(/plan window/);
  });

  it("cancels entry and protection together, and reports already-filled instead of failing", async () => {
    expect(batchCancelMessage(["AAA", "bbb"])).toBe("Definitive Flash v1 — Cancel Orders\nOrders:\naaa\nbbb");
    const fn = stubFetch({ results: [{ orderId: "aaa", ok: true }, { orderId: "bbb", ok: false, errorCode: "PENDING_CANCEL" }] });
    const out = await postBatchCancel(["aaa", "bbb"], "0xsig");
    const init = (fn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toMatchObject({ orderIds: ["aaa", "bbb"], cancelMessage: batchCancelMessage(["aaa", "bbb"]) });
    expect(out.map((r) => r.ok)).toEqual([true, true]);

    stubFetch({ error: { code: "FAILED_PRECONDITION", message: "order already filled" } }, 422);
    await expect(postCancel("ccc", "0xsig")).resolves.toMatchObject({ ok: false, alreadyFilled: true });
  });

  it("signs with a numeric chainId so viem hashes the domain Flash expects", () => {
    const parsed = parseOrderTypedData(
      JSON.stringify({ domain: { name: "DefinitiveFlashAllowance", version: "1", chainId: "8453", verifyingContract: "0x5d" }, types: { EIP712Domain: [], FlashOrder: [] }, primaryType: "FlashOrder", message: {} }),
    );
    expect(parsed.domain.chainId).toBe(8453);
    expect(parsed.types.EIP712Domain).toBeUndefined();
  });
});
