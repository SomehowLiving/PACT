import { postCancel } from "@/lib/flash";
import { patchReceipt, snapshot } from "@/lib/store";

export const dynamic = "force-dynamic";

// Relays a cancel the follower signed in their wallet. PACT cannot cancel on its own:
// Flash validates the signature against the funder address.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await req.json()) as { userSignature?: string };
  if (!body.userSignature) {
    return Response.json({ error: "userSignature required" }, { status: 400 });
  }
  const receipt = snapshot().receipts.find((r) => r.flashOrderId === id);
  if (!receipt) {
    return Response.json({ error: "unknown order" }, { status: 404 });
  }
  try {
    const order = await postCancel(id, body.userSignature);
    patchReceipt(receipt.proposalId, {
      status: order.status ?? "ORDER_STATUS_CANCELLED",
      closeReason: order.closeReason ?? undefined,
    });
    return Response.json({ order });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "cancel failed" },
      { status: 502 },
    );
  }
}
