import { normalizeTxHashes, verifyLeader } from "@/lib/leader-verify";
import { requireOwner } from "@/lib/session";
import { evidenceTxIndex, setLeaderEvidence, snapshot } from "@/lib/store";

export const dynamic = "force-dynamic";

const RECHECK_MS = 30_000;

function find(id: string) {
  return snapshot().strategies.find((s) => s.id === id);
}

/**
 * A plan's leader-execution evidence. GET re-checks open evidence (an unfilled order, or
 * transactions not final yet) at most every 30 s; it records something only if the facts changed.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const strategy = find(id);
  if (!strategy) return Response.json({ error: "unknown plan" }, { status: 404 });
  const ev = strategy.leaderEvidence;
  if (ev?.open && Date.now() - Date.parse(ev.checkedAt) > RECHECK_MS) {
    const fresh = await verifyLeader(strategy, { flashOrderId: ev.flashOrderId, txHashes: ev.txHashes }, evidenceTxIndex());
    await setLeaderEvidence(id, fresh);
  }
  const current = find(id)!;
  return Response.json({ status: current.leaderEvidenceStatus, evidence: current.leaderEvidence ?? null });
}

/** The publishing leader attaches (more) evidence after publish: a Flash order id and/or tx hashes. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const strategy = find(id);
  if (!strategy) return Response.json({ error: "unknown plan" }, { status: 404 });
  const denied = requireOwner(req, strategy.leader);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { flashOrderId?: string; txHashes?: string[] | string };
  const added = normalizeTxHashes(body.txHashes);
  if (added === null) return Response.json({ error: "transaction hashes must be 0x followed by 64 hex characters" }, { status: 400 });
  const flashOrderId = body.flashOrderId?.trim() || strategy.leaderEvidence?.flashOrderId || strategy.leaderFlashOrderId;
  const txHashes = [...new Set([...(strategy.leaderEvidence?.txHashes ?? []), ...added])];
  if (!flashOrderId && !txHashes.length) return Response.json({ error: "a Flash order id or transaction hash is required" }, { status: 400 });
  const evidence = await verifyLeader(strategy, { flashOrderId, txHashes }, evidenceTxIndex());
  await setLeaderEvidence(id, evidence);
  return Response.json({ status: evidence.status, evidence });
}
