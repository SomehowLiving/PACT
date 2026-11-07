import { prepareCopyQuote } from "@/lib/copy-quote";
import { requireOwner } from "@/lib/session";
import { proposalById } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Review flow: quote a copy for the follower's own wallet to sign (lib/copy-quote). */
export async function POST(req: Request) {
  const body = (await req.json()) as { proposalId: string };
  const proposal = proposalById(body.proposalId);
  if (!proposal) {
    return Response.json({ error: "proposal not found" }, { status: 404 });
  }
  const denied = requireOwner(req, proposal.follower);
  if (denied) return denied;
  const result = await prepareCopyQuote(proposal);
  if (!result.ok) return Response.json(result.body, { status: result.status });
  return Response.json({
    quote: result.quote,
    guard: result.guard,
    bracketGuard: result.bracketGuard,
    feeBps: result.quote.pactFee?.bps ?? "0",
    pactFee: result.quote.pactFee,
    otherOpenUnits: result.otherOpenUnits,
  });
}
