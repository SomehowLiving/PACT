import { completeSignIn, sessionCookie, sessionFrom } from "@/lib/session";
import type { Hex } from "viem";

export const dynamic = "force-dynamic";

/** Who this browser is signed in as, if anyone. */
export async function GET(req: Request) {
  const session = sessionFrom(req);
  return Response.json(session ? { address: session.address, expiresAt: new Date(session.expiresAt).toISOString() } : { address: null });
}

/** Exchange a signed sign-in message for a session cookie. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { message?: string; signature?: string };
  if (typeof body.message !== "string" || typeof body.signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(body.signature)) {
    return Response.json({ error: "message and signature required" }, { status: 400 });
  }
  const result = await completeSignIn(req, body.message, body.signature as Hex);
  if (!result.ok) return Response.json({ error: result.error }, { status: 401 });
  return Response.json(
    { address: result.session.address, expiresAt: new Date(result.session.expiresAt).toISOString() },
    { headers: { "Set-Cookie": sessionCookie(req, result.token) } },
  );
}

/** Sign out. */
export async function DELETE(req: Request) {
  return Response.json({ address: null }, { headers: { "Set-Cookie": sessionCookie(req, "", 0) } });
}
