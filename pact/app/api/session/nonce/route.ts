import { signInMessage } from "@/lib/session";

export const dynamic = "force-dynamic";

/** A fresh, single-use sign-in message for this address to sign. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { address?: string };
  if (!body.address || !/^0x[0-9a-fA-F]{40}$/.test(body.address)) {
    return Response.json({ error: "address required" }, { status: 400 });
  }
  return Response.json({ message: signInMessage(req, body.address as `0x${string}`) });
}
