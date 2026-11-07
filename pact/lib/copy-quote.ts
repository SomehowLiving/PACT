import { executionMetrics, postQuote, quoteRequest } from "./flash";
import { bracketPriceFloor, verifyBracketSigning, verifySigning, type GuardResult } from "./guard";
import { decideExecution, DEFAULT_MAX_EXECUTION_COST, effectiveLimitNotionalPrice } from "./policy";
import { referenceAtQuote } from "./reference";
import { PLAYGROUND_KEY_PREFIX } from "./constants";
import { copyFee, pactFeeRate } from "./fees";
import { conductFor, decisionFor, leaderProbation, openSpendUnits, policyFor, saveQuote, updateDecision } from "./store";
import type { AttachedBracket, Decision, Proposal, StoredQuote } from "./types";

/**
 * L5: compile a copy into a Flash quote, run quote-time policy and the guard, and store what
 * passed. Shared by the review flow (the follower signs in their wallet) and Autopilot (a
 * scoped session key signs for the follower's PACT wallet). `funder` is the address that
 * signs and pays: the follower's EOA in review, their PACT wallet under Autopilot.
 */

/** Flash's minimum TWAP slice count. */
export const MIN_TWAP_BUCKETS = 2;

export function attachedBracketFor(proposal: Proposal): AttachedBracket | undefined {
  if (
    proposal.followerExitMode === "MANUAL" ||
    proposal.side !== "buy" ||
    !["market", "limit", "twap"].includes(proposal.orderType) ||
    !proposal.takeProfitPrice ||
    !proposal.stopLossPrice ||
    !proposal.protectionExpiresAt
  ) {
    return undefined;
  }
  return {
    takeProfit: { notionalPrice: proposal.takeProfitPrice },
    stopLoss: { notionalPrice: proposal.stopLossPrice },
    expireTime: proposal.protectionExpiresAt,
  };
}

export type CopyQuoteResult =
  | { ok: true; quote: StoredQuote; guard: GuardResult; bracketGuard?: GuardResult; otherOpenUnits: string }
  | { ok: false; status: number; body: Record<string, unknown> };

export async function prepareCopyQuote(proposal: Proposal, funder: `0x${string}` = proposal.follower): Promise<CopyQuoteResult> {
  const decision: Decision | undefined = decisionFor(proposal.id);
  if (!decision || decision.verdict === "BLOCK") {
    return { ok: false, status: 403, body: { error: "BLOCK: no quote", decision } };
  }
  const qty = decision.modifiedQty ?? proposal.qty;
  const attachedBracket = attachedBracketFor(proposal);
  const policy = policyFor(proposal.follower);
  const effectiveLimit = effectiveLimitNotionalPrice(proposal, policy);
  // PACT's fee: charged only on copies of a leader who has earned it (lib/fees). Decided once,
  // before the quote, and submitted unchanged with the order, as Flash requires.
  const pactFee = copyFee({
    rateBps: pactFeeRate(),
    probation: leaderProbation(proposal.leader),
    conductLevel: conductFor(proposal.leader)?.level,
    ownIntegratorKey: !(process.env.FLASH_API_KEY ?? "").startsWith(PLAYGROUND_KEY_PREFIX),
  });

  try {
    const build = (twapBucketCount = proposal.twapBucketCount) => quoteRequest({
      chain: proposal.chain,
      targetAsset: proposal.targetAsset,
      contraAsset: proposal.contraAsset,
      side: proposal.side,
      qty,
      orderType: proposal.orderType,
      funderAddress: funder,
      durationSeconds: proposal.durationSeconds,
      twapBucketCount,
      startTime: proposal.startTime,
      limitNotionalPrice: effectiveLimit,
      triggers: proposal.triggers,
      maxSlippage: proposal.maxSlippage,
      maxPriceImpact: proposal.maxPriceImpact,
      attachedBracket,
      // A resting copy (and its TWAP) must not outlive the leader's copy window.
      planExpiresAt: proposal.expiresAt,
      integratorFeeBps: pactFee.bps,
    });
    let request = build();
    let quote = await postQuote(request);
    let metrics = executionMetrics(quote, proposal.side);
    // Each TWAP slice pays its own fees, so a small copy over the cost budget is re-quoted once
    // with the fewest slices (2) instead of being held: bound, don't veto. Only when the leader
    // left the slice count to Flash; a leader-set count is part of the plan.
    const budget = Number(policy.maxExecutionCost ?? DEFAULT_MAX_EXECUTION_COST);
    if (proposal.orderType === "twap" && proposal.twapBucketCount === undefined && Number(metrics.costRatio) > budget) {
      const fewer = build(MIN_TWAP_BUCKETS);
      const retry = await postQuote(fewer);
      const retryMetrics = executionMetrics(retry, proposal.side);
      if (Number(retryMetrics.costRatio) < Number(metrics.costRatio)) {
        request = fewer;
        quote = retry;
        metrics = retryMetrics;
      }
    }
    const reference = await referenceAtQuote(proposal, Number(metrics.executionPrice), policy.maxReferenceDivergence);
    const executionDecision = decideExecution(proposal, policy, metrics, reference);
    if (executionDecision) {
      updateDecision(proposal.id, executionDecision);
      return {
        ok: false,
        status: 409,
        body: { error: "quote no longer satisfies this follower's copy policy", decision: executionDecision, metrics, reference },
      };
    }
    if (attachedBracket && !quote.attachedBracket?.evm?.orderTypedData) {
      return { ok: false, status: 502, body: { error: "Flash did not return the attached bracket signing payload" } };
    }

    // Flash sizes the permit to this order plus the wallet's other open orders for the token.
    const spentToken = proposal.side === "buy" ? proposal.contraAsset : proposal.targetAsset;
    const otherOpenUnits = openSpendUnits(proposal.follower, proposal.chain, spentToken, proposal.id);

    // The same guard the follower's browser runs, on the entry AND the protection pair. A quote
    // that fails is never stored or served, and never signed by a session key.
    const expectedVault = process.env.NEXT_PUBLIC_FLASH_VAULT || undefined;
    const guard = verifySigning({
      chain: proposal.chain,
      follower: funder,
      side: proposal.side,
      targetAsset: proposal.targetAsset,
      contraAsset: proposal.contraAsset,
      qty,
      otherOpenUnits,
      expectedVault,
      quote: quote.evm ?? {},
    });
    const bracketGuard =
      attachedBracket && quote.attachedBracket?.evm
        ? verifyBracketSigning({
            chain: proposal.chain,
            follower: funder,
            targetAsset: proposal.targetAsset,
            contraAsset: proposal.contraAsset,
            entryQty: qty,
            priceFloor: bracketPriceFloor(proposal),
            signedMaxFromAmount: quote.attachedBracket.signedMaxFromAmount,
            otherOpenUnits: openSpendUnits(proposal.follower, proposal.chain, proposal.targetAsset, proposal.id),
            expectedVault,
            quote: quote.attachedBracket.evm,
          })
        : undefined;
    if (!guard.ok || (bracketGuard && !bracketGuard.ok)) {
      return { ok: false, status: 502, body: { error: "guard rejected the Flash quote", guard, bracketGuard } };
    }

    const stored = saveQuote({
      proposalId: proposal.id,
      quoteId: quote.quoteId,
      qty,
      funder,
      reference,
      orderTypedData: quote.evm?.orderTypedData,
      approveTx: quote.evm?.approveTx
        ? { to: quote.evm.approveTx.to as `0x${string}`, data: quote.evm.approveTx.data as `0x${string}`, value: quote.evm.approveTx.value }
        : undefined,
      permitTypedData: quote.evm?.permitTypedData,
      notionalUsd: quote.from?.notional ? Number(quote.from.notional) : proposal.notionalUsd,
      estimatedPriceImpact: metrics.estimatedPriceImpact,
      executionPrice: metrics.executionPrice,
      allInPrice: metrics.allInPrice,
      feeNotional: metrics.feeNotional,
      costRatio: metrics.costRatio,
      declaredLimitNotionalPrice: proposal.limitNotionalPrice,
      effectiveLimitNotionalPrice: effectiveLimit,
      limitBasis: request.limitCrossPrice ? "cross" : request.limitNotionalPrice ? "notional" : undefined,
      maxPriceImpact: request.maxPriceImpact,
      maxSlippage: request.maxSlippage,
      twapBucketCount: request.twapBucketCount,
      pactFee,
      attachedBracket:
        attachedBracket && quote.attachedBracket
          ? {
              bracket: attachedBracket,
              salt: quote.attachedBracket.salt,
              deadline: quote.attachedBracket.deadline,
              signedMaxFromAmount: quote.attachedBracket.signedMaxFromAmount,
              orderTypedData: quote.attachedBracket.evm?.orderTypedData,
              approveTx: quote.attachedBracket.evm?.approveTx
                ? {
                    to: quote.attachedBracket.evm.approveTx.to as `0x${string}`,
                    data: quote.attachedBracket.evm.approveTx.data as `0x${string}`,
                    value: quote.attachedBracket.evm.approveTx.value,
                  }
                : undefined,
              permitTypedData: quote.attachedBracket.evm?.permitTypedData,
            }
          : undefined,
      createdAt: new Date().toISOString(),
      raw: quote,
    });
    return { ok: true, quote: stored, guard, bracketGuard, otherOpenUnits };
  } catch (e) {
    return { ok: false, status: 502, body: { error: e instanceof Error ? e.message : "quote failed" } };
  }
}
