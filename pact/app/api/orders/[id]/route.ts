import { getOrder } from "@/lib/flash";
import { patchReceipt, snapshot } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const receipt = snapshot().receipts.find((r) => r.flashOrderId === id);
  if (!receipt) {
    return Response.json({ error: "unknown order" }, { status: 404 });
  }
  try {
    // Flash requires the funder address to read an order.
    const detail = await getOrder(id, receipt.follower);
    const fills = detail.fills ?? [];
    const tx = fills.find((f) => f.transactionId)?.transactionId;
    patchReceipt(receipt.proposalId, {
      status: detail.order.status,
      closeReason: detail.order.closeReason ?? undefined,
      transactionId: tx,
      fills,
      // A TWAP produces one fill per slice, so slices done = fills so far.
      completedFillCount: fills.length,
      twapBucketCount: detail.order.twapBucketCount ?? undefined,
    });
    return Response.json({ order: detail.order, fills, transactionId: tx });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "get order failed" },
      { status: 502 },
    );
  }
}
