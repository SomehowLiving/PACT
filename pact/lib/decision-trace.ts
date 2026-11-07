import type { LeaderConduct } from "./conduct";
import type { Decision, LeaderMandate, Policy, Proposal, StoredQuote } from "./types";

/*
 * "How PACT decided": every check the policy engine runs for one proposal, in order, with the
 * value, the limit, the source and the result. Pure: the page passes in what it knows. Where a
 * check depends on server-only facts (probation, the loss breaker), the decision's own reasons
 * are the authority, so the trace can never disagree with the decision.
 */

export type TraceResult = "pass" | "fail" | "scaled" | "warn" | "skip" | "pending" | "info";
export type TraceStage = "Holds" | "Mandate fit" | "Size and caps" | "At the quote";
export type TraceRow = {
  stage: TraceStage;
  id: string;
  label: string;
  value: string;
  limit?: string;
  result: TraceResult;
  source: string;
  why?: string;
};

export type TraceInput = {
  proposal: Proposal;
  decision?: Decision;
  policy: Policy;
  mandate?: LeaderMandate;
  /** Spent today on other copies (excluding this one). */
  dailySpentUsd: number;
  leaderSpentUsd: number;
  leaderSleeveMax: number;
  /** Other live or approved copies on the same asset and side. */
  assetExposureUsd: number;
  otherOpenPlans: number;
  otherOpenPlansForLeader: number;
  conduct?: LeaderConduct | null;
  verifiedHuman?: boolean;
  leaderPaused?: boolean;
  quote?: StoredQuote;
  nowMs: number;
};

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (s?: string | number) => (s === undefined || s === "" ? "—" : `${(Number(s) * 100).toFixed(2)}%`);
const num = (s?: string) => (s === undefined || s === "" || !Number.isFinite(Number(s)) ? undefined : Number(s));

export function decisionTrace(t: TraceInput): TraceRow[] {
  const { proposal: p, decision: d, policy } = t;
  const reasons = new Set(d?.reasons ?? []);
  const has = (code: string) => reasons.has(code);
  const capResult = (code: string, over: boolean): TraceResult => (has(code) ? (d?.verdict === "MODIFY" ? "scaled" : "fail") : over ? "warn" : "pass");
  const rows: TraceRow[] = [];
  const add = (r: TraceRow) => rows.push(r);

  // ---- Holds: stop at the first hit -------------------------------------------------------
  add({
    stage: "Holds",
    id: "paused",
    label: "Leader not paused by you",
    value: t.leaderPaused || has("LEADER_PAUSED") ? "paused" : "active",
    result: has("LEADER_PAUSED") ? "fail" : "pass",
    source: "your mandate",
  });
  const closes = Date.parse(p.expiresAt);
  const minsLeft = Math.round((closes - t.nowMs) / 60_000);
  add({
    stage: "Holds",
    id: "window",
    label: "Leader's entry window open",
    value: Number.isFinite(closes) ? (minsLeft > 0 ? `closes in ${minsLeft >= 120 ? `${Math.round(minsLeft / 60)} h` : `${minsLeft} min`}` : "closed") : "—",
    result: has("PLAN_EXPIRED") || (Number.isFinite(closes) && minsLeft <= 0) ? "fail" : "pass",
    source: "leader's plan",
  });
  add({
    stage: "Holds",
    id: "invalidation",
    label: "Plan states what would make it wrong",
    value: p.invalidation?.trim() ? "declared" : "missing",
    limit: policy.requirePlanProtection ? "required" : "not required",
    result: has("PLAN_NEEDS_INVALIDATION") ? "fail" : p.invalidation?.trim() ? "pass" : policy.requirePlanProtection ? "fail" : "skip",
    source: "leader's plan",
  });
  const entry = num(p.entryReferencePrice);
  const stop = num(p.stopLossPrice);
  const target = num(p.takeProfitPrice);
  const rr =
    entry && stop && target ? (p.side === "buy" ? (target - entry) / (entry - stop) : (entry - target) / (stop - entry)) : undefined;
  const qualityFail = [...reasons].some((r) => r.startsWith("PLAN_NEEDS_") || r === "PLAN_INVALID_STOP_OR_TARGET" || r === "PLAN_REWARD_RISK_TOO_LOW");
  add({
    stage: "Holds",
    id: "quality",
    label: "Plan quality",
    value: `${p.leaderPlanGrade.toLowerCase()}${rr !== undefined && Number.isFinite(rr) ? ` · R:R ${rr.toFixed(2)}` : ""}`,
    limit: policy.requireLeaderPlanQuality ? `disciplined, R:R ≥ ${policy.minRewardRisk}` : `shown; R:R ≥ ${policy.minRewardRisk} is disciplined`,
    result: qualityFail ? "fail" : policy.requireLeaderPlanQuality ? "pass" : p.leaderPlanGrade === "DISCIPLINED" ? "pass" : "warn",
    source: "leader's plan",
    why: "stop < entry < target (long), reward ÷ risk",
  });
  add({
    stage: "Holds",
    id: "evidence",
    label: "Leader's own execution agrees with the plan",
    value: p.leaderEvidenceStatus.replaceAll("_", " ").toLowerCase(),
    limit: policy.requireLeaderExecutionEvidence ? `at least ${(policy.minLeaderEvidence ?? "PLAN_MATCHED").replaceAll("_", " ").toLowerCase()}` : "contradiction holds the copy",
    result: has("LEADER_EXECUTION_MISMATCH") || has("LEADER_EXECUTION_UNVERIFIED") ? "fail" : p.leaderEvidenceStatus === "UNVERIFIED" ? "info" : "pass",
    source: "leader's Flash order + Base trades",
  });
  const c = t.conduct;
  add({
    stage: "Holds",
    id: "conduct",
    label: "Leader didn't trade against followers",
    value: c ? `${c.level}${c.soldIntoFlow || c.frontRuns ? ` · sold into followers ×${c.soldIntoFlow}, front-ran ×${c.frontRuns}` : ""} · ${c.plans.length} plan${c.plans.length === 1 ? "" : "s"} measured` : "not measured yet",
    limit: "a repeat holds new copies",
    result: has("LEADER_SOLD_INTO_FOLLOWERS") || has("LEADER_FRONT_RAN_FOLLOWERS") || c?.level === "alert" ? "fail" : c?.level === "caution" ? "warn" : c ? "pass" : "info",
    source: c?.source === "demo" ? "DEMO record" : "followers' Flash fills + leader's wallet on Base",
  });
  const revenge = p.signals?.find((s) => s.id === "REVENGE_PATTERN");
  add({
    stage: "Holds",
    id: "revenge",
    label: "No bigger re-entry right after a stop-out",
    value: revenge ? revenge.detail : "none in the last 24 h",
    result: has("LEADER_REVENGE_PATTERN") ? "fail" : revenge ? "warn" : "pass",
    source: "leader's plan history",
  });
  add({
    stage: "Holds",
    id: "probation",
    label: "Leader passed probation (3 settled paper copies)",
    value: has("LEADER_ON_PROBATION") ? "on probation" : policy.requireGraduatedLeader ? "passed" : "not required",
    result: has("LEADER_ON_PROBATION") ? "fail" : policy.requireGraduatedLeader ? "pass" : "skip",
    source: "PACT's paper copies at Flash's price",
  });
  add({
    stage: "Holds",
    id: "human",
    label: "Leader verified as a unique human (World ID)",
    value: t.verifiedHuman ? "verified" : "not verified",
    limit: policy.requireVerifiedHuman ? "required" : "not required",
    result: has("LEADER_NOT_VERIFIED_HUMAN") ? "fail" : policy.requireVerifiedHuman ? "pass" : t.verifiedHuman ? "pass" : "skip",
    source: "World ID 4.0",
  });
  add({
    stage: "Holds",
    id: "breaker",
    label: "Leader's daily loss limit not hit",
    value: has("LEADER_LOSS_CIRCUIT_BREAKER") ? "tripped" : policy.enableLeaderLossCircuitBreaker ? "ok" : "breaker off",
    limit: policy.enableLeaderLossCircuitBreaker ? usd(policy.maxLeaderDailyRealizedLossUsd) : undefined,
    result: has("LEADER_LOSS_CIRCUIT_BREAKER") ? "fail" : policy.enableLeaderLossCircuitBreaker ? "pass" : "skip",
    source: "realized P&L from Flash fills",
  });

  // ---- Mandate fit ------------------------------------------------------------------------
  const allowedTypes = t.mandate ? policy.allowOrderTypes.filter((o) => t.mandate!.allowOrderTypes.includes(o)) : policy.allowOrderTypes;
  add({ stage: "Mandate fit", id: "chain", label: "Chain allowed", value: p.chain, limit: (policy.allowChains ?? [policy.chain]).join(", "), result: has("CHAIN_NOT_ALLOWED") ? "fail" : "pass", source: "your mandate" });
  add({ stage: "Mandate fit", id: "pair", label: "Pair allowed", value: "WETH/USDC", result: has("PAIR_NOT_ALLOWED") ? "fail" : "pass", source: "your mandate" });
  add({ stage: "Mandate fit", id: "type", label: "Order type allowed for this leader", value: p.orderType, limit: allowedTypes.join(", "), result: has("ORDER_TYPE_NOT_ALLOWED") ? "fail" : "pass", source: "your leader mandate" });
  add({ stage: "Mandate fit", id: "side", label: "Side allowed", value: p.side, limit: policy.allowSides.join(", "), result: has("SIDE_NOT_ALLOWED") ? "fail" : "pass", source: "your mandate" });
  if (p.orderType === "market") {
    add({ stage: "Mandate fit", id: "slippage", label: "Plan's slippage tolerance", value: pct(p.maxSlippage), limit: `≤ ${pct(policy.maxSlippage)}`, result: has("SLIPPAGE_TOO_HIGH") ? "fail" : "pass", source: "leader's plan vs your mandate" });
  }
  add({ stage: "Mandate fit", id: "impact-tol", label: "Plan's price-impact tolerance", value: p.maxPriceImpact ? pct(p.maxPriceImpact) : "not set (yours applies)", limit: `≤ ${pct(policy.maxPriceImpact)}`, result: has("PRICE_IMPACT_TOO_HIGH") && !t.quote ? "fail" : "pass", source: "leader's plan vs your mandate" });

  // ---- Size and caps ----------------------------------------------------------------------
  const size = p.notionalUsd;
  const mode = p.copySizingMode;
  const sizingValue =
    mode === "FIXED"
      ? `fixed ${usd(t.mandate?.fixedNotionalUsd ?? size)}`
      : mode === "STOP_RISK"
        ? `risk ${usd(p.riskBudgetUsd ?? 0)} ÷ |entry − stop| ${p.stopRiskPerUnitUsd ? usd(p.stopRiskPerUnitUsd) : ""} × entry`
        : `${Math.round((t.mandate?.copyRatio ?? policy.copyRatio) * 100)}% of the leader's ${p.side === "buy" ? "size" : "units"}`;
  add({
    stage: "Size and caps",
    id: "sizing",
    label: "Your size",
    value: `${sizingValue} → ${usd(size)}`,
    result: has("LEADER_SIZE_OUT_OF_CHARACTER") ? "scaled" : "info",
    source: "your leader mandate",
    why: has("LEADER_SIZE_OUT_OF_CHARACTER") ? "plan far above the leader's usual size; scaled back" : undefined,
  });
  add({ stage: "Size and caps", id: "per-order", label: "Per-order limit", value: usd(size), limit: `${usd(policy.minNotionalUsd)} – ${usd(policy.maxNotionalUsd)}`, result: capResult("SIZE_EXCEEDS_MAX", size > policy.maxNotionalUsd), source: "your mandate" });
  add({ stage: "Size and caps", id: "daily", label: "Daily budget", value: `${usd(t.dailySpentUsd)} spent + ${usd(size)}`, limit: `≤ ${usd(policy.maxDailyUsd)}`, result: capResult("DAILY_CAP", t.dailySpentUsd + size > policy.maxDailyUsd + 1e-9), source: "your copies today (Flash)" });
  add({ stage: "Size and caps", id: "sleeve", label: "This leader's daily sleeve", value: `${usd(t.leaderSpentUsd)} spent + ${usd(size)}`, limit: `≤ ${usd(t.leaderSleeveMax)}`, result: capResult("LEADER_DAILY_CAP", t.leaderSpentUsd + size > t.leaderSleeveMax + 1e-9), source: "your leader mandate" });
  add({ stage: "Size and caps", id: "asset", label: "Same-asset exposure (WETH buy)", value: `${usd(t.assetExposureUsd)} other + ${usd(size)}`, limit: `≤ ${usd(policy.maxAssetExposureUsd)}`, result: capResult("ASSET_EXPOSURE_CAP", t.assetExposureUsd + size > policy.maxAssetExposureUsd + 1e-9), source: "all your leaders" });
  if (p.maxFollowerNotionalUsd !== undefined) {
    add({ stage: "Size and caps", id: "capacity", label: "Leader's per-follower capacity", value: usd(size), limit: `≤ ${usd(p.maxFollowerNotionalUsd)}`, result: capResult("PLAN_CAPACITY", size > p.maxFollowerNotionalUsd + 1e-9), source: "leader's plan" });
  }
  add({ stage: "Size and caps", id: "open", label: "Open plans", value: `${t.otherOpenPlans} other open`, limit: `< ${policy.maxOpenPlans}`, result: has("ACTIVE_PLAN_LIMIT") ? "fail" : "pass", source: "your mandate" });
  add({ stage: "Size and caps", id: "open-leader", label: "Open plans from this leader", value: `${t.otherOpenPlansForLeader} other open`, limit: `< ${policy.maxOpenPlansPerLeader}`, result: has("LEADER_ACTIVE_PLAN_LIMIT") ? "fail" : "pass", source: "your mandate" });

  // ---- At the quote -----------------------------------------------------------------------
  const q = t.quote;
  const ref = q?.reference as { status?: string; quoteVsOracleBps?: number; chartVsOracleBps?: number; maxDivergence?: number } | undefined;
  const pending = (label: string, id: string, limit: string, source: string) => add({ stage: "At the quote", id, label, value: "runs when you sign", limit, result: "pending", source });
  if (!q) {
    pending("Flash and the pool agree with Chainlink", "reference", `≤ ${pct(policy.maxReferenceDivergence ?? "0.01")}`, "Chainlink ETH/USD on Base · pool · Flash");
    pending("Price impact on Flash's quote", "impact", `≤ ${pct(policy.maxPriceImpact)}`, "Flash quote");
    pending("Executable price vs leader's entry", "drift", `≤ ${pct(policy.maxEntryDrift)}`, "Flash quote");
    pending("Fees and value lost", "cost", `≤ ${pct(policy.maxExecutionCost ?? "0.03")}`, "Flash quote");
  } else {
    const bps = (n?: number) => (n === undefined || !Number.isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(0)} bps`);
    add({
      stage: "At the quote",
      id: "reference",
      label: "Flash and the pool agree with Chainlink",
      value: ref ? `Flash ${bps(ref.quoteVsOracleBps)} · pool ${bps(ref.chartVsOracleBps)}` : "oracle unavailable",
      limit: `≤ ${pct(policy.maxReferenceDivergence ?? "0.01")}`,
      result: has("REFERENCE_PRICE_DIVERGENCE") || ref?.status === "DIVERGED" ? "fail" : ref ? "pass" : "info",
      source: "Chainlink ETH/USD on Base · pool · Flash",
    });
    add({ stage: "At the quote", id: "impact", label: "Price impact on Flash's quote", value: pct(q.estimatedPriceImpact), limit: `≤ ${pct(policy.maxPriceImpact)}`, result: has("PRICE_IMPACT_TOO_HIGH") ? "fail" : "pass", source: "Flash quote" });
    const exec = num(q.executionPrice);
    const drift = exec && entry ? exec / entry - 1 : undefined;
    add({
      stage: "At the quote",
      id: "drift",
      label: "Executable price vs leader's entry",
      value: drift === undefined ? "—" : `${exec!.toLocaleString("en-US", { maximumFractionDigits: 2 })} vs ${entry!.toLocaleString("en-US", { maximumFractionDigits: 2 })} (${drift >= 0 ? "+" : ""}${(drift * 100).toFixed(2)}%)`,
      limit: `≤ ${pct(policy.maxEntryDrift)}`,
      result: has("ENTRY_DRIFT_TOO_HIGH") ? "fail" : "pass",
      source: "Flash quote",
    });
    add({
      stage: "At the quote",
      id: "cost",
      label: "Fees and value lost",
      value: q.costRatio ? `${pct(q.costRatio)}${q.feeNotional ? ` (fee ${usd(Number(q.feeNotional))})` : ""}` : "—",
      limit: `≤ ${pct(policy.maxExecutionCost ?? "0.03")}`,
      result: has("EXECUTION_COST_TOO_HIGH") ? "fail" : "pass",
      source: "Flash quote",
      why: "max(reported fee, value in − value out) ÷ size",
    });
    if (q.effectiveLimitNotionalPrice) {
      add({
        stage: "At the quote",
        id: "bound",
        label: "Your price bound sent to Flash",
        value: `${q.limitBasis === "cross" ? "limitCrossPrice" : "limitNotionalPrice"} ${Number(q.effectiveLimitNotionalPrice).toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
        result: "info",
        source: "entry × (1 + max drift); Flash's engine enforces it",
      });
    }
  }
  return rows;
}

export function traceSummary(rows: TraceRow[]) {
  const count = (r: TraceResult) => rows.filter((x) => x.result === r).length;
  return { total: rows.length, pass: count("pass"), fail: count("fail"), scaled: count("scaled"), warn: count("warn"), skip: count("skip"), pending: count("pending"), info: count("info") };
}
