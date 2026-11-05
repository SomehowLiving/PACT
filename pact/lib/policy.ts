import type { Decision, LeaderPlanGrade, Policy, Proposal, Side } from "./types";

export function pairKey(target: string, contra: string) {
  return `${target.toLowerCase()}:${contra.toLowerCase()}`;
}

function n(value: string | undefined) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const HARD = new Set([
  "CHAIN_NOT_ALLOWED",
  "PAIR_NOT_ALLOWED",
  "ORDER_TYPE_NOT_ALLOWED",
  "SIDE_NOT_ALLOWED",
  "SLIPPAGE_TOO_HIGH",
  "PRICE_IMPACT_TOO_HIGH",
  "ACTIVE_PLAN_LIMIT",
  "LEADER_ACTIVE_PLAN_LIMIT",
]);

export type RiskContext = {
  dailySpentUsd: number;
  leaderDailySpentUsd?: number;
  leaderDailyRealizedLossUsd?: number;
  assetExposureUsd?: number;
  activePlanCount?: number;
  activePlanCountForLeader?: number;
};

export type ExecutionMetrics = {
  estimatedPriceImpact?: string;
  executionPrice?: string;
};

export type StopRiskSizing = {
  notionalUsd: number;
  qty: number;
  riskPerUnitUsd: number;
  estimatedLossAtStopUsd: number;
};

function decimal(value: number) {
  return value.toFixed(8).replace(/\.?(?:0+)$/, "");
}

/**
 * Converts a follower's maximum entry drift into a Flash execution limit.
 * A buy gets a maximum price; a sell gets a minimum price. If a leader has
 * already declared a stricter bound, PACT preserves the stricter of the two.
 */
export function effectiveLimitNotionalPrice(
  proposal: Pick<Proposal, "side" | "orderType" | "entryReferencePrice" | "limitNotionalPrice">,
  policy: Pick<Policy, "maxEntryDrift">,
) {
  if (!["twap", "limit"].includes(proposal.orderType)) return proposal.limitNotionalPrice;

  const entry = n(proposal.entryReferencePrice);
  const drift = n(policy.maxEntryDrift);
  const declared = n(proposal.limitNotionalPrice);
  if (!(entry && entry > 0) || drift === undefined || drift < 0) {
    return proposal.limitNotionalPrice;
  }

  const followerBound =
    proposal.side === "buy" ? entry * (1 + drift) : entry * (1 - drift);
  if (!Number.isFinite(followerBound) || followerBound <= 0) return proposal.limitNotionalPrice;

  const effective =
    declared === undefined
      ? followerBound
      : proposal.side === "buy"
        ? Math.min(declared, followerBound)
        : Math.max(declared, followerBound);
  return decimal(effective);
}

/**
 * Converts declared entry/stop and a follower risk budget into a copy size.
 * This is a planned-loss estimate, not a guarantee against gaps or partial fills.
 */
export function stopRiskSizing(
  plan: Pick<Proposal, "side" | "entryReferencePrice" | "stopLossPrice">,
  riskBudgetUsd: number,
): StopRiskSizing | undefined {
  const entry = n(plan.entryReferencePrice);
  const stop = n(plan.stopLossPrice);
  if (!(entry && entry > 0) || !(stop && stop > 0) || !Number.isFinite(riskBudgetUsd) || riskBudgetUsd <= 0) {
    return undefined;
  }
  const correctlyPlaced = plan.side === "buy" ? stop < entry : stop > entry;
  if (!correctlyPlaced) return undefined;
  const riskPerUnitUsd = Math.abs(entry - stop);
  const qty = riskBudgetUsd / riskPerUnitUsd;
  const notionalUsd = qty * entry;
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(notionalUsd) || notionalUsd <= 0) {
    return undefined;
  }
  return { notionalUsd, qty, riskPerUnitUsd, estimatedLossAtStopUsd: riskBudgetUsd };
}

type LeaderPlanInput = {
  side: Side;
  entryReferencePrice?: string;
  stopLossPrice?: string;
  takeProfitPrice?: string;
};

export type LeaderPlanAssessment = {
  grade: LeaderPlanGrade;
  reasons: string[];
  rewardRisk?: number;
};

export function assessLeaderPlan(
  plan: LeaderPlanInput,
  minRewardRisk = 1.5,
): LeaderPlanAssessment {
  const entry = n(plan.entryReferencePrice);
  const stop = n(plan.stopLossPrice);
  const target = n(plan.takeProfitPrice);
  const reasons: string[] = [];
  if (!(entry && entry > 0)) reasons.push("PLAN_NEEDS_ENTRY");
  if (!(stop && stop > 0)) reasons.push("PLAN_NEEDS_STOP");
  if (!(target && target > 0)) reasons.push("PLAN_NEEDS_TARGET");
  if (reasons.length || entry === undefined || stop === undefined || target === undefined) {
    return { grade: "INCOMPLETE", reasons };
  }

  const correctDirection =
    plan.side === "buy" ? stop < entry && entry < target : target < entry && entry < stop;
  if (!correctDirection) {
    return { grade: "INCOMPLETE", reasons: ["PLAN_INVALID_STOP_OR_TARGET"] };
  }

  const rewardRisk =
    plan.side === "buy" ? (target - entry) / (entry - stop) : (entry - target) / (stop - entry);
  if (!Number.isFinite(rewardRisk) || rewardRisk < minRewardRisk) {
    return {
      grade: "CAUTION",
      reasons: ["PLAN_REWARD_RISK_TOO_LOW"],
      rewardRisk,
    };
  }

  return { grade: "DISCIPLINED", reasons: [], rewardRisk };
}

type PolicyInput = Pick<
  Proposal,
  | "chain"
  | "targetAsset"
  | "contraAsset"
  | "side"
  | "orderType"
  | "qty"
  | "notionalUsd"
  | "maxSlippage"
  | "maxPriceImpact"
> &
  Partial<
    Pick<
      Proposal,
      | "expiresAt"
      | "invalidation"
      | "maxFollowerNotionalUsd"
      | "entryReferencePrice"
      | "stopLossPrice"
      | "takeProfitPrice"
      | "leaderEvidenceStatus"
    >
  >;

export function decide(
  proposal: PolicyInput,
  policy: Policy,
  input: number | RiskContext,
): Decision {
  const context: RiskContext =
    typeof input === "number" ? { dailySpentUsd: input } : input;
  const dailySpentUsd = context.dailySpentUsd;
  const reasons: string[] = [];
  const maxLeaderDailyUsd = policy.maxLeaderDailyUsd ?? Number.POSITIVE_INFINITY;
  const maxLeaderDailyRealizedLossUsd =
    policy.maxLeaderDailyRealizedLossUsd ?? Number.POSITIVE_INFINITY;
  const maxAssetExposureUsd = policy.maxAssetExposureUsd ?? Number.POSITIVE_INFINITY;
  const maxOpenPlans = policy.maxOpenPlans ?? Number.POSITIVE_INFINITY;
  const maxOpenPlansPerLeader = policy.maxOpenPlansPerLeader ?? Number.POSITIVE_INFINITY;

  const expiresAt = Date.parse(proposal.expiresAt ?? "");
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    return { verdict: "BLOCK", action: "WAIT", reasons: ["PLAN_EXPIRED"] };
  }
  if (policy.requirePlanProtection && !proposal.invalidation?.trim()) {
    return { verdict: "BLOCK", action: "REVIEW", reasons: ["PLAN_NEEDS_INVALIDATION"] };
  }
  if (policy.requireLeaderPlanQuality) {
    const assessment = assessLeaderPlan(proposal, policy.minRewardRisk ?? 1.5);
    if (assessment.grade !== "DISCIPLINED") {
      return { verdict: "BLOCK", action: "REVIEW", reasons: assessment.reasons };
    }
  }
  if (policy.requireLeaderExecutionEvidence && proposal.leaderEvidenceStatus !== "ORDER_FOUND") {
    return { verdict: "BLOCK", action: "REVIEW", reasons: ["LEADER_EXECUTION_UNVERIFIED"] };
  }
  if (
    policy.enableLeaderLossCircuitBreaker &&
    (context.leaderDailyRealizedLossUsd ?? 0) >= maxLeaderDailyRealizedLossUsd
  ) {
    return {
      verdict: "BLOCK",
      action: "WAIT",
      reasons: ["LEADER_LOSS_CIRCUIT_BREAKER"],
    };
  }

  if (!(policy.allowChains ?? [policy.chain]).includes(proposal.chain)) {
    reasons.push("CHAIN_NOT_ALLOWED");
  }
  if (!policy.allowPairs.includes(pairKey(proposal.targetAsset, proposal.contraAsset))) {
    reasons.push("PAIR_NOT_ALLOWED");
  }
  if (!policy.allowOrderTypes.includes(proposal.orderType)) {
    reasons.push("ORDER_TYPE_NOT_ALLOWED");
  }
  if (!policy.allowSides.includes(proposal.side)) {
    reasons.push("SIDE_NOT_ALLOWED");
  }

  const slip = n(proposal.maxSlippage);
  const maxSlip = n(policy.maxSlippage);
  if (slip !== undefined && maxSlip !== undefined && slip > maxSlip) {
    reasons.push("SLIPPAGE_TOO_HIGH");
  }

  const impact = n(proposal.maxPriceImpact);
  const maxImpact = n(policy.maxPriceImpact);
  if (impact !== undefined && maxImpact !== undefined && impact > maxImpact) {
    reasons.push("PRICE_IMPACT_TOO_HIGH");
  }

  const remainingDaily = policy.maxDailyUsd - dailySpentUsd;
  const remainingLeaderDaily =
    maxLeaderDailyUsd - (context.leaderDailySpentUsd ?? 0);
  const remainingAssetExposure =
    maxAssetExposureUsd - (context.assetExposureUsd ?? 0);
  const sizeOver = proposal.notionalUsd > policy.maxNotionalUsd;
  const dailyOver = dailySpentUsd + proposal.notionalUsd > policy.maxDailyUsd;
  const leaderDailyOver =
    (context.leaderDailySpentUsd ?? 0) + proposal.notionalUsd > maxLeaderDailyUsd;
  const assetExposureOver =
    (context.assetExposureUsd ?? 0) + proposal.notionalUsd > maxAssetExposureUsd;
  const planOver =
    proposal.maxFollowerNotionalUsd !== undefined &&
    proposal.notionalUsd > proposal.maxFollowerNotionalUsd;
  if ((context.activePlanCount ?? 0) >= maxOpenPlans) {
    reasons.push("ACTIVE_PLAN_LIMIT");
  }
  if ((context.activePlanCountForLeader ?? 0) >= maxOpenPlansPerLeader) {
    reasons.push("LEADER_ACTIVE_PLAN_LIMIT");
  }

  const hardHit = reasons.some((r) => HARD.has(r));
  if (hardHit) {
    if (sizeOver) reasons.push("SIZE_EXCEEDS_MAX");
    if (dailyOver) reasons.push("DAILY_CAP");
    if (leaderDailyOver) reasons.push("LEADER_DAILY_CAP");
    if (assetExposureOver) reasons.push("ASSET_EXPOSURE_CAP");
    if (planOver) reasons.push("PLAN_CAPACITY");
    return { verdict: "BLOCK", action: "DECLINE", reasons };
  }

  if (sizeOver || dailyOver || leaderDailyOver || assetExposureOver || planOver) {
    const cap = Math.min(
      policy.maxNotionalUsd,
      remainingDaily,
      remainingLeaderDaily,
      remainingAssetExposure,
      proposal.maxFollowerNotionalUsd ?? Number.POSITIVE_INFINITY,
    );
    if (sizeOver) reasons.push("SIZE_EXCEEDS_MAX");
    if (dailyOver) reasons.push("DAILY_CAP");
    if (leaderDailyOver) reasons.push("LEADER_DAILY_CAP");
    if (assetExposureOver) reasons.push("ASSET_EXPOSURE_CAP");
    if (planOver) reasons.push("PLAN_CAPACITY");
    if (policy.allowModify && cap >= policy.minNotionalUsd) {
      return {
        verdict: "MODIFY",
        action: "SCALE",
        reasons,
        modifiedQty: String(cap),
      };
    }
    return { verdict: "BLOCK", action: "DECLINE", reasons };
  }

  return { verdict: "ALLOW", action: "COPY", reasons: [] };
}

export function decideExecution(
  proposal: Pick<Proposal, "entryReferencePrice">,
  policy: Pick<Policy, "maxPriceImpact" | "maxEntryDrift">,
  metrics: ExecutionMetrics,
): Decision | undefined {
  const impact = n(metrics.estimatedPriceImpact);
  const maxImpact = n(policy.maxPriceImpact);
  if (impact !== undefined && maxImpact !== undefined && impact > maxImpact) {
    return { verdict: "BLOCK", action: "DECLINE", reasons: ["PRICE_IMPACT_TOO_HIGH"] };
  }

  const reference = n(proposal.entryReferencePrice);
  const execution = n(metrics.executionPrice);
  const maxDrift = n(policy.maxEntryDrift);
  if (
    reference !== undefined &&
    reference > 0 &&
    execution !== undefined &&
    maxDrift !== undefined &&
    Math.abs(execution / reference - 1) > maxDrift
  ) {
    return { verdict: "BLOCK", action: "WAIT", reasons: ["ENTRY_DRIFT_TOO_HIGH"] };
  }

  return undefined;
}
