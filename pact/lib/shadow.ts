import type { Candle } from "./market";
import type { ShadowCopy, Strategy } from "./types";

/**
 * L3: shadow copies (paper). Every new buy plan is copied on paper through PACT's own pipeline
 * with no signature: a real Flash quote at a reference size gives the all-in price a follower
 * would have paid right then, the default mandate says whether it would have copied, and the
 * plan's own stop and target are then replayed on market candles to settle the outcome.
 *
 * Provenance, stated on every record: entry = Flash quote; exit = GeckoTerminal candles. It is
 * a paper result, never mixed with real receipts, and it exists so a new leader has a
 * first-party record before followers trust them (handbook F4 / R15).
 */

/** Paper size: big enough that Flash fees are realistic, small enough to be any follower's size. */
export const SHADOW_NOTIONAL_USD = 100;
/** Settled paper copies a leader needs before leaving probation. */
export const PROBATION_PLANS = 3;

export function shadowable(plan: Pick<Strategy, "side" | "orderType" | "stopLossPrice" | "takeProfitPrice">) {
  return (
    plan.side === "buy" &&
    ["market", "limit", "twap"].includes(plan.orderType) &&
    Number(plan.stopLossPrice) > 0 &&
    Number(plan.takeProfitPrice) > 0
  );
}

export function shadowSize(plan: Pick<Strategy, "qty">) {
  return Math.min(SHADOW_NOTIONAL_USD, Number(plan.qty) || SHADOW_NOTIONAL_USD);
}

/** The paper entry from a Flash quote taken at publish, judged by the default mandate's limits. */
export function shadowEntry(input: {
  plan: Pick<Strategy, "entryReferencePrice" | "limitNotionalPrice" | "orderType" | "qty" | "stopLossPrice" | "takeProfitPrice">;
  allInPrice: number;
  marketPrice: number;
  costRatio: number;
  maxEntryDrift: number;
  maxExecutionCost: number;
  at: string;
}): ShadowCopy {
  const declared = Number(input.plan.entryReferencePrice ?? input.plan.limitNotionalPrice);
  const driftBps = declared > 0 ? ((input.allInPrice - declared) / declared) * 10_000 : undefined;
  const reasons: string[] = [];
  if (driftBps !== undefined && driftBps / 10_000 > input.maxEntryDrift) reasons.push("ENTRY_DRIFT_TOO_HIGH");
  if (input.costRatio > input.maxExecutionCost) reasons.push("EXECUTION_COST_TOO_HIGH");
  // Levels the market has already passed: the copy would be stopped out (or capped) at once.
  if (input.marketPrice <= Number(input.plan.stopLossPrice)) reasons.push("PRICE_ALREADY_BELOW_STOP");
  if (input.marketPrice >= Number(input.plan.takeProfitPrice)) reasons.push("PRICE_ALREADY_AT_TARGET");
  const limit = Number(input.plan.limitNotionalPrice);
  // A limit plan is entered only once the market trades through the limit.
  const waitingForLimit = input.plan.orderType === "limit" && limit > 0 && input.marketPrice > limit;
  return {
    status: reasons.length ? "NOT_COPYABLE" : waitingForLimit ? "WAITING_ENTRY" : "OPEN",
    sizeUsd: shadowSize(input.plan),
    quotedAt: input.at,
    enteredAt: reasons.length || waitingForLimit ? undefined : input.at,
    entryPrice: waitingForLimit ? limit * (1 + input.costRatio) : input.allInPrice,
    marketPrice: input.marketPrice,
    costRatio: input.costRatio,
    entryDriftBps: driftBps,
    reasons,
    source: "flash-quote+geckoterminal-candles",
  };
}

/**
 * Replay the plan's stop and target on candles after the paper entry. A candle touching both is
 * read as the stop (the conservative order). Exits pay the same cost ratio as the entry.
 */
export function settleShadow(
  shadow: ShadowCopy,
  plan: Pick<Strategy, "stopLossPrice" | "takeProfitPrice" | "limitNotionalPrice" | "protectionExpiresAt" | "expiresAt">,
  candles: Candle[],
  nowMs: number,
): ShadowCopy {
  if (shadow.status === "NOT_COPYABLE" || shadow.status === "STOPPED" || shadow.status === "TARGET" || shadow.status === "EXPIRED") {
    return shadow;
  }
  const stop = Number(plan.stopLossPrice);
  const target = Number(plan.takeProfitPrice);
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  let s: ShadowCopy = { ...shadow };

  if (s.status === "WAITING_ENTRY") {
    const limit = Number(plan.limitNotionalPrice);
    const from = Date.parse(s.quotedAt) / 1000;
    const until = Date.parse(plan.expiresAt) / 1000;
    const touch = sorted.find((c) => c.time >= from && c.time <= until && c.low <= limit);
    if (!touch) {
      return nowMs / 1000 > until ? { ...s, status: "NOT_COPYABLE", reasons: [...s.reasons, "LIMIT_NEVER_REACHED"] } : s;
    }
    s = { ...s, status: "OPEN", enteredAt: new Date(touch.time * 1000).toISOString() };
  }

  const entered = Date.parse(s.enteredAt!) / 1000;
  const deadlineMs = Date.parse(plan.protectionExpiresAt ?? "") || Date.parse(plan.expiresAt) + 24 * 3_600_000;
  const after = sorted.filter((c) => c.time >= entered && c.time * 1000 <= deadlineMs);
  const exitAt = (price: number, status: ShadowCopy["status"], time: number): ShadowCopy => {
    const net = price * (1 - s.costRatio);
    const risk = s.entryPrice - stop;
    return {
      ...s,
      status,
      exitPrice: price,
      exitedAt: new Date(time * 1000).toISOString(),
      pnlPct: (net - s.entryPrice) / s.entryPrice,
      rMultiple: risk > 0 ? (net - s.entryPrice) / risk : undefined,
    };
  };
  for (const c of after) {
    if (c.low <= stop) return exitAt(stop, "STOPPED", c.time);
    if (c.high >= target) return exitAt(target, "TARGET", c.time);
  }
  const last = after.at(-1);
  if (nowMs > deadlineMs && last) return exitAt(last.close, "EXPIRED", last.time);
  // Still open: mark at the last close, clearly not an outcome.
  return last ? { ...s, markPrice: last.close, markedAt: new Date(last.time * 1000).toISOString() } : s;
}

export const SETTLED = ["STOPPED", "TARGET", "EXPIRED"] as const;

export type ShadowSummary = {
  copies: number;
  notCopyable: number;
  settled: number;
  targets: number;
  stops: number;
  expired: number;
  avgR?: number;
  avgPnlPct?: number;
  avgEntryDriftBps?: number;
  avgCostRatio?: number;
  probation: "PROBATION" | "GRADUATED";
  probationReason: string;
  /** R14: most paper copies could not have been copied within default limits. */
  uncopyable: boolean;
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

export function shadowSummary(plans: { shadow?: ShadowCopy; leaderEvidenceStatus?: Strategy["leaderEvidenceStatus"] }[]): ShadowSummary {
  const shadows = plans.map((p) => p.shadow).filter((s): s is ShadowCopy => !!s);
  const settled = shadows.filter((s) => (SETTLED as readonly string[]).includes(s.status));
  const notCopyable = shadows.filter((s) => s.status === "NOT_COPYABLE").length;
  const contradicted = plans.some((p) => p.leaderEvidenceStatus === "MISMATCH");
  const graduated = settled.length >= PROBATION_PLANS && !contradicted;
  return {
    copies: shadows.length,
    notCopyable,
    settled: settled.length,
    targets: settled.filter((s) => s.status === "TARGET").length,
    stops: settled.filter((s) => s.status === "STOPPED").length,
    expired: settled.filter((s) => s.status === "EXPIRED").length,
    avgR: mean(settled.map((s) => s.rMultiple).filter((v): v is number => v !== undefined)),
    avgPnlPct: mean(settled.map((s) => s.pnlPct).filter((v): v is number => v !== undefined)),
    avgEntryDriftBps: mean(shadows.map((s) => s.entryDriftBps).filter((v): v is number => v !== undefined)),
    avgCostRatio: mean(shadows.map((s) => s.costRatio)),
    probation: graduated ? "GRADUATED" : "PROBATION",
    probationReason: contradicted
      ? "a plan is contradicted by the leader's own execution"
      : graduated
        ? `${settled.length} paper copies settled`
        : `${settled.length} of ${PROBATION_PLANS} paper copies settled`,
    uncopyable: shadows.length >= 3 && notCopyable / shadows.length > 0.5,
  };
}
