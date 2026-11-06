import { refreshReceipt, stillLive } from "@/lib/receipts";
import { snapshot } from "@/lib/store";

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
  const result = await refreshReceipt(receipt);
  if (result.ok) {
    return Response.json({
      order: result.detail.order,
      fills: result.detail.fills,
      protectionOrder: result.protectionOrder,
      receipt: result.receipt,
      live: stillLive(result.receipt),
    });
  }
  if (result.pending) {
    // Flash returns 404 for a few seconds after submit; that is "not yet", not a failure.
    return Response.json({ pending: true, receipt: result.receipt, live: true }, { status: 202 });
  }
  return Response.json({ error: result.error, receipt: result.receipt, live: stillLive(result.receipt) }, { status: 502 });
}
