import { ethUsdReference } from "@/lib/oracle";
import { seedDemo } from "@/lib/store";

export const dynamic = "force-dynamic";

// Reloads the demo desks only; real wallets' records are kept (see resetDemoData).
export async function POST() {
  // DEMO plans are priced off today's market (Chainlink ETH/USD on Base); if it is unreachable,
  // they fall back to fixed levels and still work.
  const price = await Promise.race([
    ethUsdReference().then((r) => r.price).catch(() => undefined),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 4000)),
  ]);
  const seeded = await seedDemo({ price });
  return Response.json({
    ok: true,
    pricedAt: price ?? null,
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
