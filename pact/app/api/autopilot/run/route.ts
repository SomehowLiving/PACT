import { runAutopilot } from "@/lib/autopilot";
import { requireOwner } from "@/lib/session";
import { proposalById } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Run Autopilot on one copy now (it also runs on its own when a followed leader publishes). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { proposalId?: string };
  const proposal = body.proposalId ? proposalById(body.proposalId) : undefined;
  if (!proposal) return Response.json({ error: "proposal not found" }, { status: 404 });
  const denied = requireOwner(req, proposal.follower);
  if (denied) return denied;
  return Response.json(await runAutopilot(proposal.id));
}
