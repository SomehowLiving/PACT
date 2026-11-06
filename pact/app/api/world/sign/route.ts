import { requireOwner } from "@/lib/session";
import { signLeaderRequest, WorldError } from "@/lib/world";

export const dynamic = "force-dynamic";

/** RP signature for one leader-verification request. The signing key never leaves PACT. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { address?: string };
  if (!body.address || !/^0x[0-9a-fA-F]{40}$/.test(body.address)) return Response.json({ error: "address required" }, { status: 400 });
  const denied = requireOwner(req, body.address);
  if (denied) return denied;
  try {
    return Response.json(signLeaderRequest());
  } catch (e) {
    if (e instanceof WorldError) return Response.json({ error: e.message, code: e.code }, { status: e.status });
    throw e;
  }
}
