import { evidenceHead, evidenceLog, verifyLog } from "@/lib/evidence";

export const dynamic = "force-dynamic";

/**
 * PACT's append-only evidence log, for anyone to verify independently.
 *
 *   GET /api/evidence                 head hash, length and a full server-side verification
 *   GET /api/evidence?events=1        plus every event (verify them yourself with lib/evidence-verify)
 *   GET /api/evidence?thread=proposal:<id>   one thread's events
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const all = evidenceLog();
  const thread = url.searchParams.get("thread");
  const check = await verifyLog(all);
  const head = evidenceHead();
  const body: Record<string, unknown> = { kind: "pact.evidence-log", version: 1, ...head, verification: check };
  if (thread) body.events = all.filter((e) => e.thread === thread);
  else if (url.searchParams.has("events")) body.events = all;
  return Response.json(body);
}
