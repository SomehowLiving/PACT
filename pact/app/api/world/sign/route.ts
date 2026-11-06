import { requireOwner } from "@/lib/session";
import { signWorldRequest, WorldError, type WorldPurpose } from "@/lib/world";

export const dynamic = "force-dynamic";

/** RP signature for one World ID request (leader verification or an Autopilot approval). The signing key never leaves PACT. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { address?: string; purpose?: WorldPurpose };
  if (!body.address || !/^0x[0-9a-fA-F]{40}$/.test(body.address)) return Response.json({ error: "address required" }, { status: 400 });
  const denied = requireOwner(req, body.address);
  if (denied) return denied;
  try {
    const purpose: WorldPurpose = body.purpose === "autopilot" ? "autopilot" : "leader";
    return Response.json(signWorldRequest(purpose));
  } catch (e) {
    if (e instanceof WorldError) return Response.json({ error: e.message, code: e.code }, { status: e.status });
    throw e;
  }
}
