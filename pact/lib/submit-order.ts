import { INTEGRATOR_FEE_BPS } from "./constants";
import { appendEvidence, hashSync, threads } from "./evidence";
import { listOrders, postOrder, type OrderBody } from "./flash";
import { addReceipt, attachOrder, decisionFor, quoteFor } from "./store";
import { trackFollower } from "./tracker";
import type { Proposal, Receipt } from "./types";

/**
 * L5: the only path that submits a copy to Flash. Shared by the review flow (wallet
 * signatures) and Autopilot (session-key signatures for the follower's PACT wallet).
 */

export type CopySignatures = {
  userSignature: string;
  evmPermitSignature?: string;
  attachedBracketSignature?: string;
  attachedBracketPermitSignature?: string;
};

export type SubmitResult =
  | { ok: true; orderId: string; receipt: Receipt; reconciled: boolean; bracketStatus?: string }
  | { ok: false; status: number; error: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ids of the funder's current orders, best effort (used to reconcile a failed submit). */
async function orderIds(funder: string): Promise<Set<string> | undefined> {
  try {
    const page = await listOrders(funder, 50);
    return new Set((page.orders ?? []).map((o) => o.orderId).filter((id): id is string => !!id));
  } catch {
    return undefined;
  }
}

export async function submitCopy(
  proposal: Proposal,
  sig: CopySignatures,
  signedBy: Receipt["signedBy"] = "WALLET",
): Promise<SubmitResult> {
  const decision = decisionFor(proposal.id);
  if (!decision || decision.verdict === "BLOCK") return { ok: false, status: 403, error: "BLOCK: order refused" };
  if (!sig.userSignature) return { ok: false, status: 400, error: "userSignature required" };
  const quote = quoteFor(proposal.id);
  if (!quote?.quoteId || !quote.orderTypedData) return { ok: false, status: 400, error: "quote first" };
  if (quote.attachedBracket && !sig.attachedBracketSignature) {
    return { ok: false, status: 400, error: "attached bracket signature required" };
  }
  const funder = quote.funder ?? proposal.follower;

  const limit = quote.effectiveLimitNotionalPrice;
  const order: OrderBody = {
    targetChain: proposal.chain,
    contraChain: proposal.chain,
    targetAsset: proposal.targetAsset,
    contraAsset: proposal.contraAsset,
    side: proposal.side,
    qty: quote.qty,
    orderType: proposal.orderType,
    funderAddress: funder,
    quoteId: quote.quoteId,
    userSignature: sig.userSignature,
    evmOrderTypedData: quote.orderTypedData,
    evmPermitTypedData: quote.permitTypedData,
    evmPermitSignature: sig.evmPermitSignature,
    // Submit shape of the pair: legs + signature material. Its expiry lives in the signed deadline.
    attachedBracket: quote.attachedBracket
      ? {
          takeProfit: quote.attachedBracket.bracket.takeProfit,
          stopLoss: quote.attachedBracket.bracket.stopLoss,
          userSignature: sig.attachedBracketSignature!,
          salt: quote.attachedBracket.salt,
          deadline: quote.attachedBracket.deadline,
          signedMaxFromAmount: quote.attachedBracket.signedMaxFromAmount,
          evmPermitTypedData: quote.attachedBracket.permitTypedData || undefined,
          evmPermitSignature: sig.attachedBracketPermitSignature,
        }
      : undefined,
    // Same price basis as the quote (limit + bracket requires the pair rate).
    ...(limit && quote.limitBasis === "cross" ? { limitCrossPrice: limit } : {}),
    ...(limit && quote.limitBasis !== "cross" ? { limitNotionalPrice: limit } : {}),
    // Echo the quote's protections, so Flash does not substitute its own defaults at admission.
    ...(quote.maxPriceImpact ? { maxPriceImpact: quote.maxPriceImpact } : {}),
    ...(quote.maxSlippage ? { maxSlippage: quote.maxSlippage } : {}),
    triggers: proposal.triggers,
    // Submit exactly the slice count that was quoted (and signed), which may be fewer than the
    // leader's auto default when the cost budget required it (lib/copy-quote).
    ...(proposal.orderType === "twap" && (quote.twapBucketCount ?? proposal.twapBucketCount) !== undefined
      ? { twapBucketCount: quote.twapBucketCount ?? proposal.twapBucketCount }
      : {}),
    ...(proposal.orderType === "twap" && proposal.startTime ? { startTime: proposal.startTime } : {}),
    ...(Number(INTEGRATOR_FEE_BPS) > 0 ? { flashIntegratorFeeBps: INTEGRATOR_FEE_BPS } : {}),
    ...(process.env.FLASH_BUILDER_CODE ? { erc8021AttributionCode: process.env.FLASH_BUILDER_CODE } : {}),
  };

  // Flash can create (even fill) an order and still answer 4xx, so never treat an error as
  // "nothing happened": snapshot first, and on error look for a new order before replying.
  const before = await orderIds(funder);
  let orderId: string | undefined;
  let bracketStatus: string | undefined;
  let reconciled = false;
  try {
    const res = await postOrder(order);
    orderId = res.orderId;
    bracketStatus = res.attachedBracket?.status ?? undefined;
  } catch (e) {
    const message = e instanceof Error ? e.message : "order failed";
    if (before) {
      for (let attempt = 0; attempt < 4 && !orderId; attempt++) {
        await sleep(2_500);
        const after = await orderIds(funder);
        const fresh = after ? [...after].filter((id) => !before.has(id)) : [];
        if (fresh.length === 1) {
          orderId = fresh[0];
          reconciled = true;
        }
      }
    }
    if (!orderId) {
      appendEvidence(
        "order.rejected",
        threads.proposal(proposal.id),
        { proposalId: proposal.id, follower: proposal.follower },
        { quoteId: quote.quoteId, error: message, signatureHash: hashSync(sig.userSignature), signedBy, funder },
      );
      return { ok: false, status: 502, error: message };
    }
  }

  attachOrder(proposal.id, orderId);
  const receipt = addReceipt({
    proposalId: proposal.id,
    chain: proposal.chain,
    follower: proposal.follower,
    funder: funder.toLowerCase() === proposal.follower.toLowerCase() ? undefined : funder,
    signedBy,
    decision,
    quoteId: quote.quoteId,
    flashOrderId: orderId,
    status: "submitted",
    quotedExecutionPrice: quote.executionPrice,
    allInPrice: quote.allInPrice,
    quotedFeeUsd: quote.feeNotional,
    quotedCostRatio: quote.costRatio,
    declaredEntryPrice: proposal.entryReferencePrice,
    notionalUsd: quote.notionalUsd ?? proposal.notionalUsd,
    protection: quote.attachedBracket
      ? {
          status: (bracketStatus as "pending_activation" | "never_activated" | "active" | undefined) ?? "pending_activation",
          intendedTakeProfit: quote.attachedBracket.bracket.takeProfit.notionalPrice,
          intendedStopLoss: quote.attachedBracket.bracket.stopLoss.notionalPrice,
        }
      : undefined,
  });

  // Start streaming the funder's orders from Flash now, not on the next desk read.
  trackFollower(proposal.follower);
  return { ok: true, orderId, receipt, reconciled, bracketStatus };
}
