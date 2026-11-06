import { referenceAtQuote } from "@/lib/reference";
import { requireOwner } from "@/lib/session";
import { INTEGRATOR_FEE_BPS } from "@/lib/constants";
import { executionMetrics, postQuote, quoteRequest } from "@/lib/flash";
import { bracketPriceFloor, verifyBracketSigning, verifySigning } from "@/lib/guard";
import { decideExecution, effectiveLimitNotionalPrice } from "@/lib/policy";
import {
  decisionFor,
  openSpendUnits,
  policyFor,
  proposalById,
  saveQuote,
  updateDecision,
} from "@/lib/store";
import type { AttachedBracket, Proposal } from "@/lib/types";

export const dynamic = "force-dynamic";

function attachedBracketFor(proposal: Proposal): AttachedBracket | undefined {
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

export async function POST(req: Request) {
  const body = (await req.json()) as { proposalId: string };
  const proposal = proposalById(body.proposalId);
  if (!proposal) {
    return Response.json({ error: "proposal not found" }, { status: 404 });
  }
  const denied = requireOwner(req, proposal.follower);
  if (denied) return denied;
  const decision = decisionFor(proposal.id);
  if (!decision || decision.verdict === "BLOCK") {
    return Response.json(
      { error: "BLOCK: no quote", decision },
      { status: 403 },
    );
  }

  const qty = decision.modifiedQty ?? proposal.qty;
  const attachedBracket = attachedBracketFor(proposal);
  const policy = policyFor(proposal.follower);
  const effectiveLimit = effectiveLimitNotionalPrice(proposal, policy);

  try {
    const request = quoteRequest({
        chain: proposal.chain,
        targetAsset: proposal.targetAsset,
        contraAsset: proposal.contraAsset,
        side: proposal.side,
        qty,
        orderType: proposal.orderType,
        funderAddress: proposal.follower,
        durationSeconds: proposal.durationSeconds,
        twapBucketCount: proposal.twapBucketCount,
        startTime: proposal.startTime,
        limitNotionalPrice: effectiveLimit,
        triggers: proposal.triggers,
        maxSlippage: proposal.maxSlippage,
        maxPriceImpact: proposal.maxPriceImpact,
        attachedBracket,
        // A resting copy (and its TWAP) must not outlive the leader's copy window.
        planExpiresAt: proposal.expiresAt,
      });
    const quote = await postQuote(request);
    const metrics = executionMetrics(quote, proposal.side);
    const reference = await referenceAtQuote(proposal, Number(metrics.executionPrice), policy.maxReferenceDivergence);
    const executionDecision = decideExecution(proposal, policy, metrics, reference);
    if (executionDecision) {
      updateDecision(proposal.id, executionDecision);
      return Response.json(
        {
          error: "quote no longer satisfies this follower's copy policy",
          decision: executionDecision,
          metrics,
          reference,
        },
        { status: 409 },
      );
    }
    if (attachedBracket && !quote.attachedBracket?.evm?.orderTypedData) {
      return Response.json(
        { error: "Flash did not return the attached bracket signing payload" },
        { status: 502 },
      );
    }

    // Flash sizes the permit to this order plus the wallet's other open orders for the token.
    const spentToken = proposal.side === "buy" ? proposal.contraAsset : proposal.targetAsset;
    const otherOpenUnits = openSpendUnits(
      proposal.follower,
      proposal.chain,
      spentToken,
      proposal.id,
    );

    // Same guard the follower's browser runs, on the entry AND the protection pair. A quote
    // that fails is never stored or served.
    const expectedVault = process.env.NEXT_PUBLIC_FLASH_VAULT || undefined;
    const guard = verifySigning({
      chain: proposal.chain,
      follower: proposal.follower,
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
            follower: proposal.follower,
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
      return Response.json(
        { error: "guard rejected the Flash quote", guard, bracketGuard },
        { status: 502 },
      );
    }

    const stored = saveQuote({
      proposalId: proposal.id,
      quoteId: quote.quoteId,
      qty,
      reference,
      orderTypedData: quote.evm?.orderTypedData,
      approveTx: quote.evm?.approveTx
        ? {
            to: quote.evm.approveTx.to as `0x${string}`,
            data: quote.evm.approveTx.data as `0x${string}`,
            value: quote.evm.approveTx.value,
          }
        : undefined,
      permitTypedData: quote.evm?.permitTypedData,
      notionalUsd: quote.from?.notional
        ? Number(quote.from.notional)
        : proposal.notionalUsd,
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

    return Response.json({ quote: stored, guard, bracketGuard, feeBps: INTEGRATOR_FEE_BPS, otherOpenUnits });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "quote failed" },
      { status: 502 },
    );
  }
}
