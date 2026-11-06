import { describe, expect, it } from "vitest";
import { protectionFrom, receiptVerdict } from "./receipts";

const F = "0x2222222222222222222222222222222222222222";
const intended = {
  bracket: { takeProfit: { notionalPrice: "2600" }, stopLoss: { notionalPrice: "2450" } },
};

describe("protection read-back", () => {
  it("records the pair id once active and compares Flash's live levels with the chosen ones", () => {
    const live = protectionFrom(
      { attachedBracket: { status: "active", bracketOrderId: "b1", takeProfit: { notionalPrice: "2600" }, stopLoss: { notionalPrice: "2450.0" } } },
      intended,
    );
    expect(live).toMatchObject({ status: "active", bracketOrderId: "b1", levelsMatch: true, intendedTakeProfit: "2600" });

    const tampered = protectionFrom(
      { attachedBracket: { status: "active", bracketOrderId: "b1", takeProfit: { notionalPrice: "9999" }, stopLoss: { notionalPrice: "2450" } } },
      intended,
    );
    expect(tampered?.levelsMatch).toBe(false);

    const pending = protectionFrom({ attachedBracket: { status: "pending_activation" } }, intended);
    expect(pending?.levelsMatch).toBeUndefined();
  });
});

describe("receipt verdict", () => {
  const base = { side: "buy" as const, follower: F, integratorFeeBps: "0" };

  it("matches when the fill is inside the bound, fees as quoted, proceeds to the follower", () => {
    const v = receiptVerdict({
      ...base,
      receipt: { averageFillPrice: "2510", feesUsd: 0.3, quotedFeeUsd: "0.36", finalFillCount: 4 },
      quote: { effectiveLimitNotionalPrice: "2525" },
      order: { recipientAddress: F, integratorFeeBps: null },
    });
    expect(v.overall).toBe("MATCH");
  });

  it("flags a fill above the bound and a recipient that is not the follower", () => {
    const v = receiptVerdict({
      ...base,
      receipt: { averageFillPrice: "2600", feesUsd: 0.3, quotedFeeUsd: "0.36", finalFillCount: 2 },
      quote: { effectiveLimitNotionalPrice: "2525" },
      order: { recipientAddress: "0x000000000000000000000000000000000000bEEF", integratorFeeBps: null },
    });
    expect(v.overall).toBe("MISMATCH");
    expect(v.lines.filter((l) => l.result === "MISMATCH").map((l) => l.id)).toEqual(["price.bound", "recipient"]);
  });

  it("stays pending with no finalised fills, and flags changed protection levels", () => {
    expect(
      receiptVerdict({ ...base, receipt: { finalFillCount: 0 }, quote: { effectiveLimitNotionalPrice: "2525" } }).overall,
    ).toBe("PENDING");
    const v = receiptVerdict({
      ...base,
      receipt: {
        averageFillPrice: "2510",
        feesUsd: 0.3,
        quotedFeeUsd: "0.36",
        finalFillCount: 1,
        protection: { intendedTakeProfit: "2600", intendedStopLoss: "2450", takeProfit: "9999", stopLoss: "2450", levelsMatch: false },
      },
      quote: { effectiveLimitNotionalPrice: "2525" },
    });
    expect(v.lines.find((l) => l.id === "protection")?.result).toBe("MISMATCH");
  });
});
