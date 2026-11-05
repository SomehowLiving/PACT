import { assessFollowerForAssist } from "@/lib/agent";
import { policyFor, snapshot } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const follower = new URL(req.url).searchParams.get("follower") as `0x${string}` | null;
  if (!follower) return Response.json({ error: "follower required" }, { status: 400 });

  const state = snapshot();
  const proposals = state.proposals.filter(
    (proposal) => proposal.follower.toLowerCase() === follower.toLowerCase(),
  );
  return Response.json(assessFollowerForAssist(policyFor(follower), proposals, state.decisions));
}
