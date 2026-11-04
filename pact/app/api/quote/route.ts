import { INTEGRATOR_FEE_BPS } from "@/lib/constants";
import { postQuote, quoteRequest } from "@/lib/flash";
import { verifySigning } from "@/lib/guard";
import { decisionFor, proposalById, saveQuote } from "@/lib/store";

export const dynamic = "force-dynamic";

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
        limitNotionalPrice: proposal.limitNotionalPrice,
        triggers: proposal.triggers,
        maxSlippage: proposal.maxSlippage,
        maxPriceImpact: proposal.maxPriceImpact,
      }),
    );

    // Same guard the follower's browser runs. A quote that fails is never stored or served.
    const guard = verifySigning({
      chain: proposal.chain,
      follower: proposal.follower,
      side: proposal.side,
      targetAsset: proposal.targetAsset,
      contraAsset: proposal.contraAsset,
      qty,
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
      raw: quote,
    });

    return Response.json({ quote: stored, guard, feeBps: INTEGRATOR_FEE_BPS });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "quote failed" },
      { status: 502 },
    );
  }
}
