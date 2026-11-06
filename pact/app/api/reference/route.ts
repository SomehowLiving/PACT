import { CHAINS } from "@/lib/chains";
import { executionMetrics, postQuote, quoteRequest } from "@/lib/flash";
import { baseWethUsdcMarket } from "@/lib/market";
import { ethUsdReference, ORACLE_MAX_AGE_S } from "@/lib/oracle";
import { DEFAULT_MAX_REFERENCE_DIVERGENCE } from "@/lib/reference";
import { referenceCheck, type ReferenceCheck } from "@/lib/signals";

export const dynamic = "force-dynamic";

// A public address used only as the quote's funder; nothing is signed or placed.
const PROBE = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const g = globalThis as unknown as { __pactReference?: { at: number; value: ReferenceCheck } };

/** Three prices for Base WETH right now: Chainlink, the GeckoTerminal pool, a $100 Flash quote. */
export async function GET() {
  const now = Date.now();
  if (g.__pactReference && now - g.__pactReference.at < 15_000) return Response.json(g.__pactReference.value);
  const { weth, usdc } = CHAINS.base;
  const [oracle, chart, quote] = await Promise.all([
    ethUsdReference(now).catch(() => undefined),
    baseWethUsdcMarket("5m")
      .then((m) => m.price)
      .catch(() => undefined),
    postQuote(quoteRequest({ targetAsset: weth, contraAsset: usdc, side: "buy", qty: "100", orderType: "market", funderAddress: PROBE }))
      .then((q) => Number(executionMetrics(q, "buy").executionPrice))
      .catch(() => undefined),
  ]);
  const value = referenceCheck({
    oracle,
    chart,
    quote,
    maxDivergence: Number(DEFAULT_MAX_REFERENCE_DIVERGENCE),
    maxOracleAgeS: ORACLE_MAX_AGE_S,
    nowMs: now,
  });
  g.__pactReference = { at: now, value };
  return Response.json(value);
}
