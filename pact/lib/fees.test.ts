import { describe, expect, it } from "vitest";
import { copyFee, feeSentence, pactFeeRate } from "./fees";
import { quoteRequest } from "./flash";
import { CHAINS } from "./chains";

describe("PACT's fee: charged only when the leader has earned it", () => {
  it("charges the configured rate on a graduated leader with clean conduct", () => {
    const fee = copyFee({ rateBps: "10", probation: "GRADUATED", conductLevel: "clear" });
    expect(fee).toEqual({ bps: "10", charged: true, rateBps: "10", waivedFor: [] });
    expect(feeSentence(fee)).toBe("PACT's fee: 0.10% (10 bps), collected by Flash when the copy fills.");
  });

  it("waives it for a leader on probation, and says why", () => {
    const fee = copyFee({ rateBps: "10", probation: "PROBATION" });
    expect(fee.bps).toBe("0");
    expect(fee.charged).toBe(false);
    expect(fee.waivedFor).toEqual(["LEADER_ON_PROBATION"]);
    expect(feeSentence(fee)).toBe("No PACT fee on this copy: the leader is on probation.");
  });

  it("waives it for a conduct caution or alert, even after probation", () => {
    expect(copyFee({ rateBps: "10", probation: "GRADUATED", conductLevel: "caution" }).waivedFor).toEqual(["LEADER_CONDUCT_CAUTION"]);
    expect(copyFee({ rateBps: "10", probation: "GRADUATED", conductLevel: "alert" }).bps).toBe("0");
  });

  it("never charges on Flash's shared playground key: the fee would go to that account, not PACT's", () => {
    const fee = copyFee({ rateBps: "10", probation: "GRADUATED", conductLevel: "clear", ownIntegratorKey: false });
    expect(fee).toMatchObject({ bps: "0", charged: false, waivedFor: ["NO_INTEGRATOR_ACCOUNT"] });
    expect(feeSentence(fee)).toBe("No PACT fee on this copy: PACT is on Flash's shared test key, so a fee would not reach PACT.");
    expect(copyFee({ rateBps: "10", probation: "GRADUATED", ownIntegratorKey: true }).charged).toBe(true);
  });

  it("reads the rate from the environment: default 10 bps, clamped to 1%, 0 switches it off", () => {
    expect(pactFeeRate(undefined)).toBe("10");
    expect(pactFeeRate("25")).toBe("25");
    expect(pactFeeRate("500")).toBe("100");
    expect(pactFeeRate("0")).toBe("0");
    expect(pactFeeRate("abc")).toBe("0");
    const off = copyFee({ rateBps: "0", probation: "GRADUATED" });
    expect(off.waivedFor).toEqual(["FEE_OFF"]);
    expect(feeSentence(off)).toBe("No PACT fee on this copy.");
  });

  it("sends flashIntegratorFeeBps to Flash only when a fee is charged", () => {
    const base = {
      targetAsset: CHAINS.base.weth, contraAsset: CHAINS.base.usdc, side: "buy" as const, qty: "20",
      orderType: "twap" as const, funderAddress: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    };
    expect(quoteRequest({ ...base, integratorFeeBps: "10" }).flashIntegratorFeeBps).toBe("10");
    expect("flashIntegratorFeeBps" in quoteRequest({ ...base, integratorFeeBps: "0" })).toBe(false);
    expect("flashIntegratorFeeBps" in quoteRequest(base)).toBe(false);
  });
});
