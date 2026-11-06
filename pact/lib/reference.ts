import { CHAINS } from "./chains";
import { baseWethUsdcMarket } from "./market";
import { ethUsdReference, ORACLE_MAX_AGE_S } from "./oracle";
import { referenceCheck, type ReferenceCheck } from "./signals";
import type { Proposal } from "./types";

/** Default R11 limit: Flash or the chart more than 1% from the oracle means wait. */
export const DEFAULT_MAX_REFERENCE_DIVERGENCE = "0.01";

/**
 * Gathers the three prices for R11 at quote time. Only Base WETH/USDC has an oracle and a
 * chart wired, so other pairs return undefined (no check, nothing claimed).
 */
export async function referenceAtQuote(
  proposal: Pick<Proposal, "chain" | "targetAsset">,
  quotePrice: number,
  maxDivergence: string | undefined,
  nowMs = Date.now(),
): Promise<ReferenceCheck | undefined> {
  if (proposal.chain !== "base" || proposal.targetAsset.toLowerCase() !== CHAINS.base.weth.toLowerCase()) return undefined;
  const [oracle, chart] = await Promise.all([
    ethUsdReference(nowMs).catch(() => undefined),
    baseWethUsdcMarket("5m")
      .then((m) => m.price)
      .catch(() => undefined),
  ]);
  return referenceCheck({
    oracle,
    chart,
    quote: Number.isFinite(quotePrice) ? quotePrice : undefined,
    maxDivergence: Number(maxDivergence ?? DEFAULT_MAX_REFERENCE_DIVERGENCE),
    maxOracleAgeS: ORACLE_MAX_AGE_S,
    nowMs,
  });
}
