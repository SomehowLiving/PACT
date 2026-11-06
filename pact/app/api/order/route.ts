import { trackFollower } from "@/lib/tracker";
import { appendEvidence, hashSync, threads } from "@/lib/evidence";
import { requireOwner } from "@/lib/session";
import { INTEGRATOR_FEE_BPS } from "@/lib/constants";
import { listOrders, postOrder, type OrderBody } from "@/lib/flash";
import {
  addReceipt,
  attachOrder,
  decisionFor,
  proposalById,
  quoteFor,
} from "@/lib/store";

export const dynamic = "force-dynamic";

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

export async function POST(req: Request) {
  const body = (await req.json()) as {
    proposalId: string;
    userSignature: string;
    evmPermitSignature?: string;
    attachedBracketSignature?: string;
    attachedBracketPermitSignature?: string;
    funderAddress?: `0x${string}`;
  };

  const proposal = proposalById(body.proposalId);
  if (!proposal) {
    return Response.json({ error: "proposal not found" }, { status: 404 });
  }
  const denied = requireOwner(req, proposal.follower);
  if (denied) return denied;
  const decision = decisionFor(proposal.id);
  if (!decision || decision.verdict === "BLOCK") {
    return Response.json(
      { error: "BLOCK: order refused", decision },
      { status: 403 },
    );
  }
  if (!body.userSignature) {
    return Response.json({ error: "userSignature required" }, { status: 400 });
  }
  if (
    body.funderAddress &&
    body.funderAddress.toLowerCase() !== proposal.follower.toLowerCase()
  ) {
    return Response.json({ error: "funder is not the follower" }, { status: 403 });
  }

  const quote = quoteFor(proposal.id);
  if (!quote?.quoteId || !quote.orderTypedData) {
    return Response.json({ error: "quote first" }, { status: 400 });
  }
  if (quote.attachedBracket && !body.attachedBracketSignature) {
    return Response.json({ error: "attached bracket signature required" }, { status: 400 });
  }

  const limit = quote.effectiveLimitNotionalPrice;
  const order: OrderBody = {
    targetChain: proposal.chain,
    contraChain: proposal.chain,
    targetAsset: proposal.targetAsset,
    contraAsset: proposal.contraAsset,
    side: proposal.side,
    qty: quote.qty,
    orderType: proposal.orderType,
    funderAddress: proposal.follower,
    quoteId: quote.quoteId,
    userSignature: body.userSignature,
    evmOrderTypedData: quote.orderTypedData,
    evmPermitTypedData: quote.permitTypedData,
    evmPermitSignature: body.evmPermitSignature,
    // Submit shape of the pair: legs + signature material. Its expiry lives in the signed deadline.
    attachedBracket: quote.attachedBracket
      ? {
          takeProfit: quote.attachedBracket.bracket.takeProfit,
          stopLoss: quote.attachedBracket.bracket.stopLoss,
          userSignature: body.attachedBracketSignature!,
          salt: quote.attachedBracket.salt,
          deadline: quote.attachedBracket.deadline,
          signedMaxFromAmount: quote.attachedBracket.signedMaxFromAmount,
          evmPermitTypedData: quote.attachedBracket.permitTypedData || undefined,
          evmPermitSignature: body.attachedBracketPermitSignature,
        }
      : undefined,
    // Same price basis as the quote (limit + bracket requires the pair rate).
    ...(limit && quote.limitBasis === "cross" ? { limitCrossPrice: limit } : {}),
    ...(limit && quote.limitBasis !== "cross" ? { limitNotionalPrice: limit } : {}),
    // Echo the quote's protections, so Flash does not substitute its own defaults at admission.
    ...(quote.maxPriceImpact ? { maxPriceImpact: quote.maxPriceImpact } : {}),
    ...(quote.maxSlippage ? { maxSlippage: quote.maxSlippage } : {}),
    triggers: proposal.triggers,
    ...(proposal.orderType === "twap" && proposal.twapBucketCount !== undefined
      ? { twapBucketCount: proposal.twapBucketCount }
      : {}),
    ...(proposal.orderType === "twap" && proposal.startTime ? { startTime: proposal.startTime } : {}),
    ...(Number(INTEGRATOR_FEE_BPS) > 0 ? { flashIntegratorFeeBps: INTEGRATOR_FEE_BPS } : {}),
    ...(process.env.FLASH_BUILDER_CODE ? { erc8021AttributionCode: process.env.FLASH_BUILDER_CODE } : {}),
  };

  // Flash can create (even fill) an order and still answer 4xx, so never treat an error as
  // "nothing happened": snapshot first, and on error look for a new order before replying.
  const before = await orderIds(proposal.follower);
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
        const after = await orderIds(proposal.follower);
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
        { quoteId: quote.quoteId, error: message, signatureHash: hashSync(body.userSignature) },
      );
      return Response.json({ error: message }, { status: 502 });
    }
  }

  attachOrder(proposal.id, orderId);
  const receipt = addReceipt({
    proposalId: proposal.id,
    chain: proposal.chain,
    follower: proposal.follower,
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

  // Start streaming this follower's orders from Flash now, not on the next desk read.
  trackFollower(proposal.follower);
  return Response.json({ order: { orderId, attachedBracket: bracketStatus ? { status: bracketStatus } : undefined }, receipt, reconciled });
}
