import { requireOwner } from "@/lib/session";
import { bindLeader, verifyLeaderProof, WorldError, type WorldProof } from "@/lib/world";

export const dynamic = "force-dynamic";

/**
 * Verifies a World ID proof for the signed-in leader and binds it to their address: one
 * human, one leader. Identity only; it authorizes nothing.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { address?: string; proof?: WorldProof };
  if (!body.address || !/^0x[0-9a-fA-F]{40}$/.test(body.address)) return Response.json({ error: "address required" }, { status: 400 });
  const denied = requireOwner(req, body.address);
  if (denied) return denied;
  try {
    const { nullifier, protocol } = await verifyLeaderProof(body.address, body.proof ?? {});
    const { record, created } = bindLeader(body.address, nullifier, protocol);
    return Response.json({ verified: true, verifiedAt: record.verifiedAt, created });
  } catch (e) {
    if (e instanceof WorldError) return Response.json({ error: e.message, code: e.code }, { status: e.status });
    throw e;
  }
}
