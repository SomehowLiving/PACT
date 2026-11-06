import { appendEvidence, hashSync, threads } from "@/lib/evidence";
import { postBatchCancel, postCancel, type CancelOutcome } from "@/lib/flash";
import { refreshReceipt, stillLive } from "@/lib/receipts";
import { snapshot } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Relays a cancel the follower signed in their wallet. PACT cannot cancel on its own: Flash
 * validates the signature against the funder.
 *
 * Cancelling an entry does NOT cancel its attached protection once the entry has filled at
 * all, so the follower signs one batch message covering the entry and its protective order:
 * `batchCancelMessage([entryId, bracketOrderId])`. With no protective order, a single cancel
 * over `cancelMessage(entryId)` is used.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await req.json()) as { userSignature?: string; orderIds?: string[] };
  if (!body.userSignature) {
    return Response.json({ error: "userSignature required" }, { status: 400 });
  }
  const receipt = snapshot().receipts.find((r) => r.flashOrderId === id);
  if (!receipt?.flashOrderId) {
    return Response.json({ error: "unknown order" }, { status: 404 });
  }

  // Only this receipt's own orders may be cancelled through this route.
  const allowed = new Set([receipt.flashOrderId, receipt.protection?.bracketOrderId].filter((x): x is string => !!x).map((x) => x.toLowerCase()));
  const ids = (body.orderIds?.length ? body.orderIds : [receipt.flashOrderId]).map((x) => x.toLowerCase());
  if (!ids.every((x) => allowed.has(x))) {
    return Response.json({ error: "order ids do not belong to this copy" }, { status: 403 });
  }

  let results: CancelOutcome[];
  try {
    results = ids.length === 1 ? [await postCancel(ids[0], body.userSignature)] : await postBatchCancel(ids, body.userSignature);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "cancel failed" },
      { status: 502 },
    );
  }

  appendEvidence(
    "order.cancel_requested",
    threads.proposal(receipt.proposalId),
    { proposalId: receipt.proposalId, follower: receipt.follower, flashOrderId: receipt.flashOrderId },
    { orderIds: ids, results, signatureHash: hashSync(body.userSignature) },
  );

  // Read the real state back from Flash rather than assuming "cancelled".
  const refreshed = await refreshReceipt(receipt);
  return Response.json({ results, receipt: refreshed.receipt, live: stillLive(refreshed.receipt) });
}
