import { exitMark } from "@/lib/marks";
import { markToMarket, type Mark } from "@/lib/positions";
import { snapshot } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * One follower's PACT positions: realized P&L from Flash fills and open positions marked at
 * Flash's own exit quote for the total open size per asset. Read-only; never places an order.
 *
 *   GET /api/positions?follower=0x…
 */
export async function GET(req: Request) {
  const follower = new URL(req.url).searchParams.get("follower")?.toLowerCase();
  if (!follower || !/^0x[0-9a-f]{40}$/.test(follower)) {
    return Response.json({ error: "follower address required" }, { status: 400 });
  }
  const state = snapshot();
  const rows = state.receipts
    .filter((r) => r.follower.toLowerCase() === follower && r.position)
    .map((r) => ({ receipt: r, proposal: state.proposals.find((p) => p.id === r.proposalId) }));

  // One exit quote per asset, for the whole open size: what selling everything would fetch.
  const openByAsset = new Map<string, { units: number; chain: NonNullable<(typeof rows)[0]["proposal"]>["chain"]; contra: `0x${string}`; target: `0x${string}` }>();
  for (const { receipt, proposal } of rows) {
    if (!proposal || receipt.position!.closed) continue;
    const key = `${proposal.chain}:${proposal.targetAsset.toLowerCase()}`;
    const entry = openByAsset.get(key) ?? { units: 0, chain: proposal.chain, contra: proposal.contraAsset, target: proposal.targetAsset };
    entry.units += receipt.position!.openUnits;
    openByAsset.set(key, entry);
  }
  const marks = new Map<string, Mark | undefined>();
  for (const [key, open] of openByAsset) {
    marks.set(
      key,
      await exitMark({ chain: open.chain, targetAsset: open.target, contraAsset: open.contra, units: open.units, funder: follower as `0x${string}` }),
    );
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const totals = { realizedUsd: 0, realizedTodayUsd: 0, unrealizedUsd: 0, openValueUsd: 0, openCostUsd: 0, unmarked: 0 };
  const positions = rows.map(({ receipt, proposal }) => {
    const position = receipt.position!;
    const mark = proposal ? marks.get(`${proposal.chain}:${proposal.targetAsset.toLowerCase()}`) : undefined;
    const mtm = markToMarket(position, mark);
    totals.realizedUsd += position.realizedPnlUsd;
    if (position.realizedAt && position.realizedAt >= today.toISOString()) totals.realizedTodayUsd += position.realizedPnlUsd;
    if (!position.closed) {
      totals.openCostUsd += position.openCostUsd;
      if (mark) {
        totals.openValueUsd += mtm.valueUsd;
        totals.unrealizedUsd += mtm.unrealizedPnlUsd;
      } else totals.unmarked++;
    }
    return {
      proposalId: receipt.proposalId,
      flashOrderId: receipt.flashOrderId,
      leader: proposal?.leader,
      title: proposal?.title,
      position,
      mark: position.closed ? undefined : mark,
      ...mtm,
    };
  });
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return Response.json({
    follower,
    positions,
    totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, k === "unmarked" ? v : r2(v)])),
    method:
      "Realized: protective-order sell fills minus average entry cost, from Flash fill rows. Open: units held × Flash's exit quote for the total open size (fees off); mid price only when Flash will not quote, and labelled.",
  });
}
