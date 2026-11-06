import { walletFacts } from "@/lib/wallet-facts";

export const dynamic = "force-dynamic";

/** A wallet's real facts on Base: balances, transactions sent, recent USDC/WETH flows. Read-only. */
export async function GET(_req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return Response.json({ error: "address required" }, { status: 400 });
  try {
    return Response.json(await walletFacts(address));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message.split("\n")[0] : "Base read failed" }, { status: 502 });
  }
}
