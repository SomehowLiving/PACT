import { describe, expect, it } from "vitest";
import { CHAINS, FLASH_SPENDER, PERMIT2 } from "./chains";
import { verifySigning, type GuardInput } from "./guard";

const FOLLOWER = "0x2222222222222222222222222222222222222222";
const NOW = 1_800_000_000;
const { usdc, weth } = CHAINS.base;

function order(over: Record<string, unknown> = {}, domain: Record<string, unknown> = {}) {
  return JSON.stringify({
    domain: { chainId: "8453", verifyingContract: FLASH_SPENDER, ...domain },
    primaryType: "FlashOrder",
    message: {
      swapper: FOLLOWER,
      recipient: FOLLOWER,
      fromToken: usdc,
      toToken: weth,
      fromAmount: "25000000",
      deadline: String(NOW + 660),
      ...over,
    },
  });
}

function permit(over: Record<string, unknown> = {}, details: Record<string, unknown> = {}) {
  return JSON.stringify({
    domain: { chainId: "8453", verifyingContract: PERMIT2 },
    primaryType: "PermitSingle",
    message: {
      details: { token: usdc, amount: "25000000", expiration: String(NOW + 86_000), ...details },
      spender: FLASH_SPENDER,
      sigDeadline: String(NOW + 86_000),
      ...over,
    },
  });
}

const approve = (spender: string = PERMIT2, amount = "f".repeat(64)) => ({
  to: usdc,
  data: "0x095ea7b3" + spender.slice(2).toLowerCase().padStart(64, "0") + amount,
});

function input(over: Partial<GuardInput["quote"]> = {}, qty = "25"): GuardInput {
  return {
    chain: "base",
    follower: FOLLOWER,
    side: "buy",
    targetAsset: weth,
    contraAsset: usdc,
    qty,
    nowSec: NOW,
    quote: { orderTypedData: order(), permitTypedData: permit(), approveTx: approve(), ...over },
  };
}

const failing = (r: ReturnType<typeof verifySigning>) =>
  r.checks.filter((c) => c.level === "fail").map((c) => c.id);

describe("verifySigning", () => {
  it("passes an honest quote and warns about the max Permit2 approval", () => {
    const r = verifySigning(input());
    expect(r.ok).toBe(true);
    expect(r.checks.find((c) => c.id === "approve.amount")?.level).toBe("warn");
  });

  it("fails when the server inflates the amount above the approved size", () => {
    const r = verifySigning(input({ orderTypedData: order({ fromAmount: "500000000" }) }));
    expect(r.ok).toBe(false);
    expect(failing(r)).toContain("order.amount");
  });

  it("fails when the permit is larger than the approved size", () => {
    const r = verifySigning(input({ permitTypedData: permit({}, { amount: "500000000" }) }));
    expect(failing(r)).toContain("permit.amount");
  });

  it("accepts a permit that covers this order plus the follower's other open orders", () => {
    // Flash: a new 25 USDC order with 40 USDC already open needs a 65 USDC permit.
    const quote = { permitTypedData: permit({}, { amount: "65000000" }) };
    const r = verifySigning({ ...input(quote), otherOpenUnits: "40000000" });
    expect(r.ok).toBe(true);
    expect(r.checks.find((c) => c.id === "permit.amount")?.level).toBe("pass");
  });

  it("still fails a permit larger than this order plus the known open orders", () => {
    const quote = { permitTypedData: permit({}, { amount: "66000000" }) };
    const r = verifySigning({ ...input(quote), otherOpenUnits: "40000000" });
    expect(failing(r)).toContain("permit.amount");
  });

  it("fails the same honest 65 USDC permit when no open orders are known", () => {
    const r = verifySigning(input({ permitTypedData: permit({}, { amount: "65000000" }) }));
    expect(failing(r)).toContain("permit.amount");
  });

  it("never lets open orders raise the order's own signed amount", () => {
    const r = verifySigning({
      ...input({ orderTypedData: order({ fromAmount: "65000000" }) }),
      otherOpenUnits: "40000000",
    });
    expect(failing(r)).toContain("order.amount");
  });

  it("ignores an unreadable open-orders value instead of widening the limit", () => {
    const r = verifySigning({
      ...input({ permitTypedData: permit({}, { amount: "65000000" }) }),
      otherOpenUnits: "lots",
    });
    expect(failing(r)).toContain("permit.amount");
  });

  it("judges the permit expiry against the order deadline plus Flash's 24 h buffer", () => {
    const week = 7 * 86_400;
    const resting = input({
      orderTypedData: order({ deadline: String(NOW + week) }),
      permitTypedData: permit({}, { expiration: String(NOW + week + 86_400) }),
    });
    expect(verifySigning(resting).checks.find((c) => c.id === "permit.expiry")?.level).toBe("pass");

    const unlimited = input({
      orderTypedData: order({ deadline: String(NOW + week) }),
      permitTypedData: permit({}, { expiration: "281474976710655" }),
    });
    expect(verifySigning(unlimited).checks.find((c) => c.id === "permit.expiry")?.level).toBe("warn");
  });

  it("fails when proceeds are redirected to another address", () => {
    const r = verifySigning(
      input({ orderTypedData: order({ recipient: "0x9999999999999999999999999999999999999999" }) }),
    );
    expect(failing(r)).toContain("order.recipient");
  });

  it("fails when the funds would come from a different swapper", () => {
    const r = verifySigning(
      input({ orderTypedData: order({ swapper: "0x9999999999999999999999999999999999999999" }) }),
    );
    expect(failing(r)).toContain("order.swapper");
  });

  it("fails when the server swaps the output token", () => {
    const r = verifySigning(
      input({ orderTypedData: order({ toToken: "0x0000000000000000000000000000000000000001" }) }),
    );
    expect(failing(r)).toContain("order.tokens");
  });

  it("fails when the permit spender is not the Flash contract", () => {
    const r = verifySigning(
      input({ permitTypedData: permit({ spender: "0x9999999999999999999999999999999999999999" }) }),
    );
    expect(failing(r)).toContain("permit.spender");
  });

  it("fails when the approve tx gives an allowance to someone other than Permit2", () => {
    const r = verifySigning(
      input({ approveTx: approve("0x9999999999999999999999999999999999999999") }),
    );
    expect(failing(r)).toContain("approve.shape");
  });

  it("fails when the signing domain is the wrong chain", () => {
    const r = verifySigning(input({ orderTypedData: order({}, { chainId: "1" }) }));
    expect(failing(r)).toContain("order.chain");
  });

  it("fails an expired deadline", () => {
    const r = verifySigning(input({ orderTypedData: order({ deadline: String(NOW - 5) }) }));
    expect(failing(r)).toContain("order.deadline");
  });

  it("only warns on the very long deadline of a trigger order", () => {
    const r = verifySigning({
      ...input({ orderTypedData: order({ deadline: "281474976710655" }) }),
    });
    expect(r.ok).toBe(true);
    expect(r.checks.find((c) => c.id === "order.deadline")?.level).toBe("warn");
  });

  it("verifies a sell in target units (take-profit)", () => {
    const sell: GuardInput = {
      ...input(
        {
          orderTypedData: order({ fromToken: weth, toToken: usdc, fromAmount: "5000000000000000" }),
          permitTypedData: permit({}, { token: weth, amount: "5000000000000000" }),
          approveTx: { ...approve(), to: weth },
        },
        "0.005",
      ),
      side: "sell",
    };
    expect(verifySigning(sell).ok).toBe(true);
    const inflated = {
      ...sell,
      quote: { ...sell.quote, orderTypedData: order({ fromToken: weth, toToken: usdc, fromAmount: "50000000000000000" }) },
    };
    expect(failing(verifySigning(inflated))).toContain("order.amount");
  });

  it("fails closed when there is no order payload", () => {
    expect(verifySigning(input({ orderTypedData: undefined })).ok).toBe(false);
  });
});
