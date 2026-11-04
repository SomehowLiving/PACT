import { INTEGRATOR_FEE_BPS } from "@/lib/constants";
import { postOrder } from "@/lib/flash";
import {
  addReceipt,
  attachOrder,
  decisionFor,
  proposalById,
  quoteFor,
} from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    proposalId: string;
    userSignature: string;
    evmPermitSignature?: string;
    funderAddress?: `0x${string}`;
  };

  const proposal = proposalById(body.proposalId);
  if (!proposal) {
    return Response.json({ error: "proposal not found" }, { status: 404 });
  }
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

  try {
    const order = await postOrder({
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
      limitNotionalPrice: proposal.limitNotionalPrice,
      triggers: proposal.triggers,
      ...(Number(INTEGRATOR_FEE_BPS) > 0
        ? { flashIntegratorFeeBps: INTEGRATOR_FEE_BPS }
        : {}),
    });

    attachOrder(proposal.id, order.orderId);
    const receipt = addReceipt({
      proposalId: proposal.id,
      chain: proposal.chain,
      follower: proposal.follower,
      decision,
      quoteId: quote.quoteId,
      flashOrderId: order.orderId,
      status: "submitted",
      notionalUsd: quote.notionalUsd ?? proposal.notionalUsd,
    });

    return Response.json({ order, receipt });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "order failed" },
      { status: 502 },
    );
  }
}
