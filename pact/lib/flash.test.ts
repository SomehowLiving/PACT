import { afterEach, describe, expect, it, vi } from "vitest";
import { executionMetrics, getOrder, postCancel, quoteRequest } from "./flash";
import { cancelMessage } from "./typed";

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

  it("extracts a quote's actual impact and execution price for the follower gate", () => {
    expect(
      executionMetrics(
        {
          quoteId: "q1",
          estimatedPriceImpact: "0.0042",
          from: { amount: "25", notional: "25", symbol: "USDC" },
          to: { amount: "0.01", notional: "25", symbol: "WETH" },
        },
        "buy",
      ),
    ).toEqual({ estimatedPriceImpact: "0.0042", executionPrice: "2500" });
  });
});
