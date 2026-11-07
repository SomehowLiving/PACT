import { builderCode, txAttribution } from "@/lib/erc8021";
import { REORGED_FILL } from "@/lib/flash";
import { snapshot } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Reads each fill's settlement transaction from Base and decodes its ERC-8021 suffix: proof from
 * the chain alone that Flash settled the fill for a PACT copy (lib/erc8021). Base only; Flash
 * appends Definitive's code first and PACT's builder code second.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const receipt = snapshot().receipts.find((r) => r.flashOrderId === id);
  if (!receipt) return Response.json({ error: "unknown order" }, { status: 404 });
  const expectedCode = builderCode() ?? null;
  if ((receipt.chain ?? "base") !== "base") {
    return Response.json({ expectedCode, chain: receipt.chain, transactions: [], note: "attribution is read on Base only" });
  }
  const hashes = [
    ...new Set(
      (receipt.fills ?? [])
        .filter((f) => f.status !== REORGED_FILL && f.transactionId)
        .map((f) => f.transactionId!.toLowerCase()),
    ),
  ].slice(0, 20);
  const transactions = await Promise.all(hashes.map((h) => txAttribution(h, expectedCode ?? undefined)));
  return Response.json({ expectedCode, chain: "base", transactions });
}
