import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FLASH_SPENDER } from "./chains";
import { defaultPolicy, USDC, WETH } from "./constants";

const { postQuote, postOrder } = vi.hoisted(() => ({ postQuote: vi.fn(), postOrder: vi.fn() }));
vi.mock("./flash", async (orig) => ({ ...(await orig<typeof import("./flash")>()), postQuote, postOrder, listOrders: async () => ({ orders: [] }) }));
vi.mock("./reference", () => ({ referenceAtQuote: async () => undefined, DEFAULT_MAX_REFERENCE_DIVERGENCE: "0.01" }));
vi.mock("./tracker", () => ({ trackFollower: () => ({ mode: "off", pollMs: 4000 }) }));

const F = "0x1234567890abcdef1234567890abcdef12345678" as const;
const g = globalThis as unknown as { __pact?: unknown; __pactEvidence?: unknown };

/** A Flash TWAP quote whose fee grows with the slice count, like the live API ($0.087 a slice). */
function quote(body: { funderAddress: string; qty: string; twapBucketCount?: number }) {
  const qty = Number(body.qty);
  const slices = body.twapBucketCount ?? 10; // Flash's own default for this window
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  return {
    quoteId: `q-${slices}`,
    from: { amount: String(qty), notional: String(qty) },
    to: { amount: String(qty / 2500), notional: String(qty * 0.999) },
    fees: { estimatedFeeNotional: String(0.087 * slices) },
    evm: {
      orderTypedData: JSON.stringify({
        domain: { name: "DefinitiveFlashAllowance", version: "1", chainId: "8453", verifyingContract: FLASH_SPENDER },
        types: { FlashOrder: [{ name: "swapper", type: "address" }] },
        primaryType: "FlashOrder",
        message: {
          swapper: body.funderAddress,
          vault: "0x1074393effFCf1A15e306cD3931F48eDA9ABcd55",
          recipient: body.funderAddress,
          fromToken: USDC,
          toToken: WETH,
          fromAmount: String(qty * 1e6),
          salt: "1",
          deadline: String(deadline),
        },
      }),
    },
  };
}

async function setup(twapBucketCount?: number) {
  delete g.__pact;
  delete g.__pactEvidence;
  process.env.PACT_STORE_FILE = join(tmpdir(), `pact-copyquote-test-${process.pid}.json`);
  const store = await import("./store");
  store.resetStore();
  const leader = "0xabcdef1234567890abcdef1234567890abcdef12" as const;
  store.upsertPolicy({
    ...defaultPolicy(F),
    follows: [leader],
    mandates: [{ leader, sizingMode: "FIXED", copyRatio: 0.25, fixedNotionalUsd: 25, riskBudgetUsd: 5, maxDailyUsd: 500, allowOrderTypes: ["twap"], exitMode: "MANUAL" }],
  });
  const plan = store.addStrategy({
    leader,
    title: "twap",
    thesis: "t",
    invalidation: "below the stop",
    expiresAt: new Date(Date.now() + 4 * 3_600_000).toISOString(),
    entryReferencePrice: "2500",
    stopLossPrice: "2450",
    takeProfitPrice: "2600",
    protectionExpiresAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
    chain: "base",
    targetAsset: WETH,
    contraAsset: USDC,
    side: "buy",
    orderType: "twap",
    qty: "100",
    durationSeconds: 600,
    twapBucketCount,
  });
  const { proposal } = await store.createProposal(plan.id, F);
  return { store, proposal };
}

beforeEach(() => {
  postQuote.mockReset();
  postOrder.mockReset();
  postQuote.mockImplementation(async (body) => quote(body));
});

describe("TWAP slices and the cost budget", () => {
  it("re-quotes an over-budget auto-sliced copy with 2 slices and submits exactly that", async () => {
    const { proposal } = await setup();
    const { prepareCopyQuote } = await import("./copy-quote");
    const r = await prepareCopyQuote(proposal);
    expect(postQuote).toHaveBeenCalledTimes(2);
    expect(postQuote.mock.calls[0][0].twapBucketCount).toBeUndefined(); // $0.87 on $25 = 3.5%
    expect(postQuote.mock.calls[1][0].twapBucketCount).toBe(2); // $0.17 = 0.7%
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quote.quoteId).toBe("q-2");
    expect(r.quote.twapBucketCount).toBe(2);

    postOrder.mockResolvedValue({ orderId: "o-1" });
    const { submitCopy } = await import("./submit-order");
    const sent = await submitCopy(proposal, { userSignature: "0xsig" });
    expect(sent.ok).toBe(true);
    expect(postOrder.mock.calls[0][0]).toMatchObject({ quoteId: "q-2", twapBucketCount: 2 });
  });

  it("never changes a slice count the leader set; the copy waits instead", async () => {
    const { store, proposal } = await setup(10);
    const { prepareCopyQuote } = await import("./copy-quote");
    const r = await prepareCopyQuote(proposal);
    expect(postQuote).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(false);
    expect(store.decisionFor(proposal.id)?.reasons).toEqual(["EXECUTION_COST_TOO_HIGH"]);
  });
});
