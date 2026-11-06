import type { Signal, Strategy } from "./types";

/**
 * L3 signals: facts with a stated source. A signal never decides; policy (lib/policy) reads
 * them. Each returns undefined when there is not enough history to say anything honest.
 */

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Plans needed before a leader has a "usual size". */
export const STYLE_HISTORY_MIN = 3;
/** Size this many times the usual counts as out of character (handbook A1: "goes 4×"). */
export const STYLE_DRIFT_ALERT = 3;
/** How long after a stop-out a bigger re-entry counts as a revenge pattern. */
export const REVENGE_WINDOW_MS = 24 * 3_600_000;

type PlanLike = Pick<Strategy, "id" | "leader" | "side" | "qty" | "targetAsset" | "contraAsset" | "createdAt" | "shadow">;

/** R8: this plan's size against the leader's usual size for the same side and pair. */
export function styleDrift(plan: PlanLike, history: PlanLike[]): Signal | undefined {
  const same = history.filter(
    (p) =>
      p.id !== plan.id &&
      p.createdAt < plan.createdAt &&
      p.side === plan.side &&
      p.targetAsset.toLowerCase() === plan.targetAsset.toLowerCase() &&
      Number(p.qty) > 0,
  );
  if (same.length < STYLE_HISTORY_MIN) return undefined;
  const usual = median(same.map((p) => Number(p.qty)));
  const ratio = Number(plan.qty) / usual;
  return {
    id: "STYLE_DRIFT",
    level: ratio >= STYLE_DRIFT_ALERT ? "alert" : ratio >= 2 ? "caution" : "info",
    value: ratio,
    detail: `${ratio.toFixed(1)}× the leader's usual size (${usual} over ${same.length} plans)`,
    source: "leader plan history",
  };
}

/**
 * R9: a bigger re-entry on the same pair and side within a day of a stop-out. The stop-out is
 * PACT's own paper copy of the earlier plan (or a real copy's protective stop).
 */
export function revengePattern(plan: PlanLike, history: PlanLike[]): Signal | undefined {
  const from = Date.parse(plan.createdAt) - REVENGE_WINDOW_MS;
  const stopped = history
    .filter(
      (p) =>
        p.id !== plan.id &&
        p.side === plan.side &&
        p.targetAsset.toLowerCase() === plan.targetAsset.toLowerCase() &&
        p.shadow?.status === "STOPPED" &&
        Date.parse(p.shadow.exitedAt ?? "") >= from &&
        Date.parse(p.shadow.exitedAt ?? "") <= Date.parse(plan.createdAt),
    )
    .sort((a, b) => (b.shadow!.exitedAt ?? "").localeCompare(a.shadow!.exitedAt ?? ""));
  const last = stopped[0];
  if (!last) return undefined;
  const bigger = Number(plan.qty) > Number(last.qty);
  const minutes = Math.round((Date.parse(plan.createdAt) - Date.parse(last.shadow!.exitedAt!)) / 60_000);
  return {
    id: "REVENGE_PATTERN",
    level: bigger ? "alert" : "caution",
    value: Number(plan.qty) / Number(last.qty),
    detail: `${bigger ? "bigger " : ""}re-entry ${minutes} min after a stop-out (${last.qty} → ${plan.qty})`,
    source: "PACT paper copies",
  };
}

export type ReferenceCheck = {
  status: "OK" | "DIVERGED" | "UNAVAILABLE";
  oracle?: number;
  oracleAt?: string;
  chart?: number;
  quote?: number;
  /** Flash's quoted market price vs the oracle, and the chart vs the oracle. */
  quoteVsOracleBps?: number;
  chartVsOracleBps?: number;
  detail: string;
  source: string;
};

/**
 * R11: three prices for the same asset at the same moment: the oracle (independent), the
 * chart (the pool the follower is looking at) and Flash's quote (what would execute). A wide
 * gap means one of them is wrong or the market is moving faster than the oracle.
 */
export function referenceCheck(input: {
  oracle?: { price: number; updatedAt: string };
  chart?: number;
  quote?: number;
  maxDivergence: number;
  maxOracleAgeS: number;
  nowMs: number;
}): ReferenceCheck {
  const source = "Chainlink ETH/USD on Base · GeckoTerminal pool · Flash quote";
  const base = { oracle: input.oracle?.price, oracleAt: input.oracle?.updatedAt, chart: input.chart, quote: input.quote, source };
  const age = input.oracle ? (input.nowMs - Date.parse(input.oracle.updatedAt)) / 1000 : Infinity;
  if (!input.oracle || !(input.oracle.price > 0) || age > input.maxOracleAgeS) {
    return { ...base, status: "UNAVAILABLE", detail: input.oracle ? `oracle is ${Math.round(age / 60)} min old` : "oracle unreadable" };
  }
  const bps = (v?: number) => (v && v > 0 ? ((v - input.oracle!.price) / input.oracle!.price) * 10_000 : undefined);
  const q = bps(input.quote);
  const c = bps(input.chart);
  const worst = Math.max(Math.abs(q ?? 0), Math.abs(c ?? 0));
  const diverged = worst / 10_000 > input.maxDivergence;
  return {
    ...base,
    status: diverged ? "DIVERGED" : "OK",
    quoteVsOracleBps: q,
    chartVsOracleBps: c,
    detail: `Flash ${q === undefined ? "—" : `${q > 0 ? "+" : ""}${q.toFixed(0)} bps`}, chart ${c === undefined ? "—" : `${c > 0 ? "+" : ""}${c.toFixed(0)} bps`} vs oracle (limit ${(input.maxDivergence * 10_000).toFixed(0)} bps)`,
  };
}
