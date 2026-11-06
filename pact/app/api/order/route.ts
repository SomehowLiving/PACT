import { requireOwner } from "@/lib/session";
import { proposalById } from "@/lib/store";
import { submitCopy } from "@/lib/submit-order";

export const dynamic = "force-dynamic";

/** Review flow: submit the follower's own wallet signatures to Flash (lib/submit-order). */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    proposalId: string;
    userSignature: string;
    evmPermitSignature?: string;
    attachedBracketSignature?: string;
    attachedBracketPermitSignature?: string;
    funderAddress?: `0x${string}`;
  };

  const proposal = proposalById(body.proposalId);
  if (!proposal) {
    return Response.json({ error: "proposal not found" }, { status: 404 });
  }
  const denied = requireOwner(req, proposal.follower);
  if (denied) return denied;
  if (body.funderAddress && body.funderAddress.toLowerCase() !== proposal.follower.toLowerCase()) {
    return Response.json({ error: "funder is not the follower" }, { status: 403 });
  }
  const result = await submitCopy(proposal, body);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({
    order: { orderId: result.orderId, attachedBracket: result.bracketStatus ? { status: result.bracketStatus } : undefined },
    receipt: result.receipt,
    reconciled: result.reconciled,
  });
}
