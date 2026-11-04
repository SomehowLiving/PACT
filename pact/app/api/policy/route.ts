import { policyFor, rebuildFor, snapshot, upsertPolicy } from "@/lib/store";
import type { Policy } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const follower = url.searchParams.get("follower") as `0x${string}` | null;
  if (!follower) {
    return Response.json({ policies: snapshot().policies });
  }
  return Response.json({ policy: policyFor(follower) });
}

export async function POST(req: Request) {
  const body = (await req.json()) as Policy;
  if (!body.follower) {
    return Response.json({ error: "follower required" }, { status: 400 });
  }
  const bad =
    !(body.maxNotionalUsd > 0) ||
    !(body.maxDailyUsd >= body.maxNotionalUsd) ||
    !(body.minNotionalUsd >= 0) ||
    !body.allowChains?.length ||
    !body.allowOrderTypes?.length ||
    !body.allowSides?.length;
  if (bad) {
    return Response.json(
      { error: "per-order cap > 0, daily cap >= per-order cap, and at least one chain, type and side" },
      { status: 400 },
    );
  }
  const policy = upsertPolicy(body);
  await rebuildFor(body.follower);
  return Response.json({ policy });
}
