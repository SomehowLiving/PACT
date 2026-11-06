import { CHAINS } from "./chains";
import { defaultPolicy } from "./constants";
import { executionMetrics, postQuote, quoteRequest, type FlashQuote } from "./flash";
import { baseWethUsdcMarket, type Candle, type Timeframe } from "./market";
import { DEFAULT_MAX_EXECUTION_COST } from "./policy";
import { settleShadow, shadowable, shadowEntry, shadowSize } from "./shadow";
import { setShadow } from "./store";
import type { ShadowCopy, Strategy } from "./types";

/**
 * Runs PACT's paper copy of a plan: quotes only, never an order or a signature. Kept out of the
 * pure L3 module so tests can drive the logic without Flash or market data.
 */

type Deps = {
  quote: (body: ReturnType<typeof quoteRequest>) => Promise<FlashQuote>;
  candles: (tf: Timeframe) => Promise<Candle[]>;
  nowMs: number;
};

const defaults = (): Deps => ({
  quote: postQuote,
  candles: async (tf) => (await baseWethUsdcMarket(tf)).candles,
  nowMs: Date.now(),
});

/** Paper copies need the Base WETH/USDC market for settlement (the only market data adapter). */
function onSupportedMarket(plan: Strategy) {
  const c = CHAINS.base;
  return plan.chain === "base" && plan.targetAsset.toLowerCase() === c.weth.toLowerCase() && plan.contraAsset.toLowerCase() === c.usdc.toLowerCase();
}

export async function runShadowEntry(plan: Strategy, deps: Partial<Deps> = {}): Promise<ShadowCopy | undefined> {
  if (plan.shadow || !shadowable(plan) || !onSupportedMarket(plan)) return plan.shadow;
  const d = { ...defaults(), ...deps };
  const quote = await d.quote(
    quoteRequest({
      chain: plan.chain,
      targetAsset: plan.targetAsset,
      contraAsset: plan.contraAsset,
      side: "buy",
      qty: String(shadowSize(plan)),
      orderType: "market",
      funderAddress: plan.leader,
      nowMs: d.nowMs,
    }),
  );
  const m = executionMetrics(quote, "buy");
  const allIn = Number(m.allInPrice);
  const market = Number(m.executionPrice);
  if (!(allIn > 0 && market > 0)) return undefined;
  const policy = defaultPolicy(plan.leader);
  const shadow = shadowEntry({
    plan,
    allInPrice: allIn,
    marketPrice: market,
    costRatio: Number(m.costRatio) || 0,
    maxEntryDrift: Number(policy.maxEntryDrift),
    maxExecutionCost: Number(policy.maxExecutionCost ?? DEFAULT_MAX_EXECUTION_COST),
    at: new Date(d.nowMs).toISOString(),
  });
  await setShadow(plan.id, shadow);
  return shadow;
}

/** Candles covering the paper copy's life, at the finest timeframe that reaches back far enough. */
function timeframeFor(sinceMs: number, nowMs: number): Timeframe {
  const span = nowMs - sinceMs;
  if (span <= 7.5 * 3_600_000) return "5m";
  if (span <= 6.5 * 86_400_000) return "1h";
  return "1d";
}

export async function settleShadowFor(plan: Strategy, deps: Partial<Deps> = {}): Promise<ShadowCopy | undefined> {
  const shadow = plan.shadow;
  if (!shadow || !["OPEN", "WAITING_ENTRY"].includes(shadow.status)) return shadow;
  const d = { ...defaults(), ...deps };
  const since = Date.parse(shadow.enteredAt ?? shadow.quotedAt);
  const candles = await d.candles(timeframeFor(since, d.nowMs));
  const next = { ...settleShadow(shadow, plan, candles, d.nowMs), settledCheckAt: new Date(d.nowMs).toISOString() };
  await setShadow(plan.id, next);
  return next;
}
