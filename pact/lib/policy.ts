import type { Decision, Policy, Proposal } from "./types";

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
]);

export function decide(
  proposal: Pick<
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
  >,
  policy: Policy,
  dailySpentUsd: number,
): Decision {
  const reasons: string[] = [];

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
    reasons.push("SLIPPAGE_TOO_HIGH");
  }

  const remainingDaily = policy.maxDailyUsd - dailySpentUsd;
  const sizeOver = proposal.notionalUsd > policy.maxNotionalUsd;
  const dailyOver = dailySpentUsd + proposal.notionalUsd > policy.maxDailyUsd;

  const hardHit = reasons.some((r) => HARD.has(r));
  if (hardHit) {
    if (sizeOver) reasons.push("SIZE_EXCEEDS_MAX");
    if (dailyOver) reasons.push("DAILY_CAP");
    return { verdict: "BLOCK", reasons };
  }

  if (sizeOver || dailyOver) {
    const cap = Math.min(policy.maxNotionalUsd, remainingDaily);
    if (sizeOver) reasons.push("SIZE_EXCEEDS_MAX");
    if (dailyOver) reasons.push("DAILY_CAP");
    if (policy.allowModify && cap >= policy.minNotionalUsd) {
      return {
        verdict: "MODIFY",
        reasons,
        modifiedQty: String(cap),
      };
    }
    return { verdict: "BLOCK", reasons };
  }

  return { verdict: "ALLOW", reasons: [] };
}
