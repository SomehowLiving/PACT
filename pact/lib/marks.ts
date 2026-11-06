import { executionMetrics, postQuote, quoteRequest } from "./flash";
import type { Mark } from "./positions";
import { assetPrice } from "./price";
import type { Chain } from "./types";

/**
 * What an open position is worth now: Flash's own quote to sell exactly those units, fees
 * taken off (the price the follower would really get). When Flash will not quote that size,
 * fall back to Flash's search mid price and say so. Never the chart.
 */

const cache = new Map<string, { mark: Mark; at: number }>();
const TTL_MS = 30_000;

export async function exitMark(input: {
  chain: Chain;
  targetAsset: `0x${string}`;
  contraAsset: `0x${string}`;
  units: number;
  funder: `0x${string}`;
  nowMs?: number;
}): Promise<Mark | undefined> {
  const now = input.nowMs ?? Date.now();
  // Bucket the size so polling many small changes does not burst Flash's rate limit.
  const units = Number(input.units.toPrecision(4));
  if (!(units > 0)) return undefined;
  const key = `${input.chain}:${input.targetAsset.toLowerCase()}:${units}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.mark;

  let mark: Mark | undefined;
  try {
    const quote = await postQuote(
      quoteRequest({
        chain: input.chain,
        targetAsset: input.targetAsset,
        contraAsset: input.contraAsset,
        side: "sell",
        qty: units.toFixed(10).replace(/\.?0+$/, ""),
        orderType: "market",
        funderAddress: input.funder,
        nowMs: now,
      }),
    );
    const price = Number(executionMetrics(quote, "sell").allInPrice);
    if (Number.isFinite(price) && price > 0) mark = { price, basis: "flash-exit-quote", at: new Date(now).toISOString() };
  } catch {
    /* below Flash's minimum size, or rate limited: try the mid */
  }
  if (!mark) {
    try {
      const price = await assetPrice(input.chain, input.targetAsset);
      mark = { price, basis: "flash-search-mid", at: new Date(now).toISOString() };
    } catch {
      return undefined;
    }
  }
  cache.set(key, { mark, at: now });
  return mark;
}
