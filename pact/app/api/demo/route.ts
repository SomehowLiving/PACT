import { seedDemo } from "@/lib/store";

export const dynamic = "force-dynamic";

// Reloads the demo desks only; real wallets' records are kept (see resetDemoData).
export async function POST() {
  const seeded = await seedDemo();
  return Response.json({
    ok: true,
    allow: seeded.allow.decision,
    block: seeded.block.decision,
    allowProposalId: seeded.allow.proposal.id,
    blockProposalId: seeded.block.proposal.id,
    split: seeded.desks.map((d) => ({
      follower: d.proposal.follower,
      verdict: d.decision.verdict,
      reasons: d.decision.reasons,
      qty: d.proposal.qty,
    })),
    cases: [...seeded.portfolio, ...seeded.edgeCases].map((entry) => ({
      case: entry.proposal.demoCase,
      verdict: entry.decision.verdict,
      action: entry.decision.action,
      reasons: entry.decision.reasons,
    })),
  });
}
