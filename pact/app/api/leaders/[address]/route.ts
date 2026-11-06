import { runShadowEntry, settleShadowFor } from "@/lib/shadow-run";
import { leaderRecord } from "@/lib/leader-record";
import { verifyLeader } from "@/lib/leader-verify";
import { evidenceTxIndex, setLeaderEvidence, snapshot } from "@/lib/store";

export const dynamic = "force-dynamic";

const RECHECK_MS = 60_000;
const MAX_RECHECKS = 3;
const MAX_SHADOW_ENTRIES = 2;
const SETTLE_EVERY_MS = 5 * 60_000;

/**
 * A leader's evidence-backed record: each plan with what PACT verified about the leader's own
 * execution, plus followers' Flash outcomes. Re-checks a few open plans (unfilled orders, or
 * transactions not yet final) per read; records only changed facts.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return Response.json({ error: "leader address required" }, { status: 400 });
  const key = address.toLowerCase();
  const stale = snapshot()
    .strategies.filter(
      (s) => s.leader.toLowerCase() === key && s.leaderEvidence?.open && Date.now() - Date.parse(s.leaderEvidence.checkedAt) > RECHECK_MS,
    )
    .slice(0, MAX_RECHECKS);
  for (const s of stale) {
    const ev = s.leaderEvidence!;
    await setLeaderEvidence(s.id, await verifyLeader(s, { flashOrderId: ev.flashOrderId, txHashes: ev.txHashes }, evidenceTxIndex()));
  }
  // Paper copies: enter plans that have none yet, settle open ones every few minutes.
  const mine = snapshot().strategies.filter((s) => s.leader.toLowerCase() === key);
  const now = Date.now();
  for (const s of mine.filter((p) => !p.shadow && Date.parse(p.expiresAt) > now).slice(0, MAX_SHADOW_ENTRIES)) {
    await runShadowEntry(s).catch(() => undefined);
  }
  const unsettled = snapshot()
    .strategies.filter(
      (s) =>
        s.leader.toLowerCase() === key &&
        s.shadow &&
        ["OPEN", "WAITING_ENTRY"].includes(s.shadow.status) &&
        now - Date.parse(s.shadow.settledCheckAt ?? s.shadow.quotedAt) > SETTLE_EVERY_MS,
    )
    .slice(0, MAX_RECHECKS);
  for (const s of unsettled) await settleShadowFor(s).catch(() => undefined);
  const state = snapshot();
  const plans = state.strategies
    .filter((s) => s.leader.toLowerCase() === key)
    .map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      side: s.side,
      orderType: s.orderType,
      qty: s.qty,
      entryReferencePrice: s.entryReferencePrice,
      status: s.leaderEvidenceStatus,
      evidence: s.leaderEvidence ?? null,
      stopLossPrice: s.stopLossPrice,
      takeProfitPrice: s.takeProfitPrice,
      shadow: s.shadow ?? null,
    }));
  return Response.json({ record: leaderRecord(state, key), plans });
}
