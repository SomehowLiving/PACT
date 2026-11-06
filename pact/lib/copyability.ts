import { decide, leaderPauseDecision, stopRiskSizing } from "./policy";
import type { CopyAction, Decision, LeaderMandate, Policy, Strategy } from "./types";
import { actionOf, isExpired } from "./views";

/* Copyability preview: what *this follower's* mandate would do with a leader's
   live plans right now. It runs the same decide() the server uses, with the same
   sizing rules as createProposal. It is a preview: the binding decision is made
   server-side when the plan is mirrored, with live prices and current spend. */

export type CopyContext = {
  dailySpentUsd: number;
  leaderDailySpentUsd: number;
  activePlanCount: number;
  activePlanCountForLeader: number;
  assetExposureUsd: number;
  leaderVerifiedHuman?: boolean;
};

export type PlanPreview = {
  plan: Strategy;
  decision: Decision;
  action: CopyAction;
  /** Notional PACT would request before caps, in USD. */
  requestedUsd: number;
  /** Notional after caps (equal to requested unless scaled). */
  approvedUsd: number;
  /** True when a sell had to be sized from the declared entry instead of a live price. */
  estimated: boolean;
  /** True when the plan is already mirrored and this is PACT's stored, binding decision. */
  mirrored?: boolean;
};

/** Plans already mirrored for this follower: their stored decision replaces the preview. */
export type Mirrored = Map<string, { decision: Decision; notionalUsd: number }>;

export type CopyVerdict = "COPYABLE" | "PARTLY" | "NOT_COPYABLE" | "NO_LIVE_PLANS";

export type Copyability = {
  verdict: CopyVerdict;
  previews: PlanPreview[];
  counts: Record<CopyAction, number>;
  /** Most frequent reasons across held or declined plans. */
  topReasons: { reason: string; count: number }[];
};

function sized(plan: Strategy, policy: Policy, mandate: LeaderMandate | undefined) {
  const mode = mandate?.sizingMode ?? "PROPORTIONAL";
  const entry = Number(plan.entryReferencePrice);
  const price = plan.side === "buy" ? 1 : Number.isFinite(entry) && entry > 0 ? entry : undefined;
  const leaderUsd = plan.side === "buy" ? Number(plan.qty) : Number(plan.qty) * (price ?? 0);
  if (mode === "STOP_RISK") {
    const s = stopRiskSizing(plan, mandate?.riskBudgetUsd ?? policy.riskBudgetUsd);
    return { usd: s?.notionalUsd, estimated: plan.side === "sell", invalidStop: !s };
  }
  if (mode === "FIXED") return { usd: mandate?.fixedNotionalUsd ?? policy.minNotionalUsd, estimated: false, invalidStop: false };
  const ratio = mandate?.sizingMode === "PROPORTIONAL" ? mandate.copyRatio : policy.copyRatio;
  return { usd: price === undefined ? undefined : leaderUsd * ratio, estimated: plan.side === "sell", invalidStop: false };
}

export function previewPlan(
  plan: Strategy,
  policy: Policy,
  mandate: LeaderMandate | undefined,
  ctx: CopyContext,
): PlanPreview {
  const s = sized(plan, policy, mandate);
  const effective: Policy = mandate
    ? {
        ...policy,
        maxLeaderDailyUsd: mandate.maxDailyUsd,
        allowOrderTypes: policy.allowOrderTypes.filter((t) => mandate.allowOrderTypes.includes(t)),
      }
    : policy;
  const requestedUsd = s.usd ?? 0;
  const proposal = {
    chain: plan.chain,
    targetAsset: plan.targetAsset,
    contraAsset: plan.contraAsset,
    side: plan.side,
    orderType: plan.orderType,
    qty: String(requestedUsd),
    notionalUsd: requestedUsd,
    maxSlippage: plan.orderType === "market" ? effective.maxSlippage : undefined,
    maxPriceImpact: plan.orderType === "twap" || plan.orderType === "limit" ? effective.maxPriceImpact : undefined,
    expiresAt: plan.expiresAt,
    invalidation: plan.invalidation,
    maxFollowerNotionalUsd: plan.maxFollowerNotionalUsd,
    entryReferencePrice: plan.entryReferencePrice,
    stopLossPrice: plan.stopLossPrice,
    takeProfitPrice: plan.takeProfitPrice,
    leaderEvidenceStatus: plan.leaderEvidenceStatus,
  };
  const decision: Decision =
    leaderPauseDecision(policy, plan.leader) ??
    (s.invalidStop
      ? { verdict: "BLOCK", action: "REVIEW", reasons: ["STOP_RISK_PLAN_INVALID"] }
      : s.usd === undefined
        ? { verdict: "BLOCK", action: "DECLINE", reasons: ["PRICE_UNAVAILABLE"] }
        : decide(proposal, effective, {
            dailySpentUsd: ctx.dailySpentUsd,
            leaderDailySpentUsd: ctx.leaderDailySpentUsd,
            assetExposureUsd: ctx.assetExposureUsd,
            activePlanCount: ctx.activePlanCount,
            activePlanCountForLeader: ctx.activePlanCountForLeader,
            leaderVerifiedHuman: ctx.leaderVerifiedHuman,
          }));
  const approvedUsd =
    decision.verdict === "BLOCK" ? 0 : decision.verdict === "MODIFY" ? Number(decision.modifiedQty) : requestedUsd;
  return { plan, decision, action: actionOf(decision) ?? "DECLINE", requestedUsd, approvedUsd, estimated: s.estimated };
}

export function copyability(
  plans: Strategy[],
  policy: Policy,
  mandate: LeaderMandate | undefined,
  ctx: CopyContext,
  mirrored: Mirrored = new Map(),
  now = Date.now(),
): Copyability {
  const live = plans.filter((p) => !isExpired(p, now));
  const previews = live.map((p): PlanPreview => {
    const known = mirrored.get(p.id);
    if (!known) return previewPlan(p, policy, mandate, ctx);
    return {
      plan: p,
      decision: known.decision,
      action: actionOf(known.decision) ?? "DECLINE",
      requestedUsd: known.notionalUsd,
      approvedUsd: known.decision.verdict === "BLOCK" ? 0 : known.notionalUsd,
      estimated: false,
      mirrored: true,
    };
  });
  const counts: Record<CopyAction, number> = { COPY: 0, SCALE: 0, WAIT: 0, REVIEW: 0, DECLINE: 0 };
  const reasons = new Map<string, number>();
  for (const p of previews) {
    counts[p.action] += 1;
    if (p.decision.verdict === "BLOCK") {
      for (const r of p.decision.reasons) reasons.set(r, (reasons.get(r) ?? 0) + 1);
    }
  }
  const ok = counts.COPY + counts.SCALE;
  const verdict: CopyVerdict = !previews.length
    ? "NO_LIVE_PLANS"
    : ok === previews.length
      ? "COPYABLE"
      : ok > 0
        ? "PARTLY"
        : "NOT_COPYABLE";
  return {
    verdict,
    previews,
    counts,
    topReasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 4),
  };
}
