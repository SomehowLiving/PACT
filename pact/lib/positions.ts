import { FINAL_FILL, REORGED_FILL, type FlashFillRow } from "./flash";
import type { Position } from "./types";

/**
 * Positions from Flash's own fill rows. A PACT buy copy opens a position (entry fills: WETH
 * received for USDC spent); its protective order closes it (exit fills: WETH sold for USDC).
 *
 * Fee convention, matching executionMetrics: on a buy, `targetAmount` already arrives net of
 * fees, so the USDC spent is the full cost. On a sell, the fee is not taken out of
 * `contraAmount`, so PACT subtracts the fill's `feeNotional`. If Flash turns out to net sell
 * fees already, realized P&L is understated by the fee, never overstated.
 */

export type LegFacts = {
  targetUnits: number;
  contraUsd: number;
  feesUsd: number;
  fillCount: number;
  lastFilledAt?: string;
};

const n = (v?: string) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Finalised fills only: a reorged fill never happened, an unconfirmed one may not stay. */
export function legFacts(fills: FlashFillRow[] = []): LegFacts {
  const final = fills.filter((f) => f.status !== REORGED_FILL && (!f.status || f.status === FINAL_FILL));
  const last = final.map((f) => f.filledAt).filter((t): t is string => !!t).sort().at(-1);
  return {
    targetUnits: final.reduce((s, f) => s + n(f.targetAmount), 0),
    contraUsd: final.reduce((s, f) => s + n(f.contraAmount), 0),
    feesUsd: final.reduce((s, f) => s + n(f.feeNotional), 0),
    fillCount: final.length,
    lastFilledAt: last,
  };
}

const round = (v: number, dp = 6) => Math.round(v * 10 ** dp) / 10 ** dp;

/** A buy copy's position after its entry fills and any protective-order exit fills. */
export function positionFrom(entry: LegFacts, exit?: LegFacts): Position | undefined {
  if (!(entry.targetUnits > 0 && entry.contraUsd > 0)) return undefined;
  const avgCost = entry.contraUsd / entry.targetUnits;
  // An exit can never sell more than the entry bought; clamp so rounding cannot invent units.
  const exitUnits = Math.min(exit?.targetUnits ?? 0, entry.targetUnits);
  const exitProceedsUsd = exit ? exit.contraUsd - exit.feesUsd : 0;
  const openUnits = entry.targetUnits - exitUnits;
  return {
    basis: "flash-fills",
    entryUnits: round(entry.targetUnits, 10),
    entryCostUsd: round(entry.contraUsd),
    averageCost: round(avgCost),
    exitUnits: round(exitUnits, 10),
    exitProceedsUsd: round(exitProceedsUsd),
    openUnits: round(openUnits, 10),
    openCostUsd: round(openUnits * avgCost),
    realizedPnlUsd: exitUnits > 0 ? round(exitProceedsUsd - exitUnits * avgCost) : 0,
    realizedAt: exitUnits > 0 ? exit?.lastFilledAt : undefined,
    feesUsd: round(entry.feesUsd + (exit?.feesUsd ?? 0)),
    // Dust left by rounding is not an open position.
    closed: openUnits <= entry.targetUnits * 1e-6,
  };
}

export type Mark = {
  /** USD per target unit the follower would receive selling now. */
  price: number;
  basis: "flash-exit-quote" | "flash-search-mid";
  at: string;
};

export function markToMarket(position: Position, mark?: Mark) {
  if (!mark || position.closed) return { valueUsd: 0, unrealizedPnlUsd: 0 };
  const valueUsd = position.openUnits * mark.price;
  return { valueUsd: round(valueUsd), unrealizedPnlUsd: round(valueUsd - position.openCostUsd) };
}
