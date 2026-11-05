import { INTEGRATOR_FEE_BPS } from "@/lib/constants";
import { executionMetrics, postQuote, quoteRequest } from "@/lib/flash";
import { verifySigning } from "@/lib/guard";
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
    const quote = await postQuote(
      quoteRequest({
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
      }),
    );
    const metrics = executionMetrics(quote, proposal.side);
    const executionDecision = decideExecution(proposal, policy, metrics);
    if (executionDecision) {
      updateDecision(proposal.id, executionDecision);
      return Response.json(
        {
          error: "quote no longer satisfies this follower's copy policy",
          decision: executionDecision,
          metrics,
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

    // Same guard the follower's browser runs. A quote that fails is never stored or served.
    const guard = verifySigning({
      chain: proposal.chain,
      follower: proposal.follower,
      side: proposal.side,
      targetAsset: proposal.targetAsset,
      contraAsset: proposal.contraAsset,
      qty,
      otherOpenUnits,
      quote: quote.evm ?? {},
    });
    if (!guard.ok) {
      return Response.json(
        { error: "guard rejected the Flash quote", guard },
        { status: 502 },
      );
    }

    const stored = saveQuote({
      proposalId: proposal.id,
      quoteId: quote.quoteId,
      qty,
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
      declaredLimitNotionalPrice: proposal.limitNotionalPrice,
      effectiveLimitNotionalPrice: effectiveLimit,
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

    return Response.json({ quote: stored, guard, feeBps: INTEGRATOR_FEE_BPS, otherOpenUnits });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "quote failed" },
      { status: 502 },
    );
  }
}
