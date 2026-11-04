import { createProposal, snapshot } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = snapshot();
  return Response.json({
    proposals: s.proposals,
    decisions: s.decisions,
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    strategyId: string;
    follower: `0x${string}`;
  };
  if (!body.strategyId || !body.follower) {
    return Response.json({ error: "strategyId and follower required" }, { status: 400 });
  }
  try {
    const result = await createProposal(body.strategyId, body.follower);
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "failed" },
      { status: 400 },
    );
  }
}
