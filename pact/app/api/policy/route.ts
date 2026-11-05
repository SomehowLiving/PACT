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
  const mandateLeaders = new Set((body.mandates ?? []).map((mandate) => mandate.leader.toLowerCase()));
  const mandatesValid =
    mandateLeaders.size === (body.mandates?.length ?? 0) &&
    (body.mandates ?? []).every(
      (mandate) =>
        (body.follows ?? []).some((leader) => leader.toLowerCase() === mandate.leader.toLowerCase()) &&
        (mandate.sizingMode === "PROPORTIONAL" || mandate.sizingMode === "FIXED") &&
        mandate.copyRatio > 0 &&
        mandate.copyRatio <= 1 &&
        mandate.fixedNotionalUsd > 0 &&
        mandate.maxDailyUsd >= body.minNotionalUsd &&
        mandate.allowOrderTypes.length > 0 &&
        (mandate.exitMode === "FOLLOWER_BRACKET" || mandate.exitMode === "MANUAL"),
    );
  const bad =
    !(body.maxNotionalUsd > 0) ||
    !(body.maxDailyUsd >= body.maxNotionalUsd) ||
    !(body.minNotionalUsd >= 0) ||
    !(body.copyRatio > 0 && body.copyRatio <= 1) ||
    !(body.maxLeaderDailyUsd >= body.minNotionalUsd) ||
    !(body.maxLeaderDailyRealizedLossUsd > 0) ||
    !(body.maxAssetExposureUsd >= body.minNotionalUsd) ||
    !(body.maxOpenPlans >= 1) ||
    !(body.maxOpenPlansPerLeader >= 1) ||
    !(Number(body.maxEntryDrift) >= 0) ||
    !(Number(body.maxPriceImpact) >= 0) ||
    !(Number(body.maxSlippage) >= 0) ||
    !(body.minRewardRisk >= 1) ||
    (body.follows?.length ?? 0) > 3 ||
    (body.mandates?.length ?? 0) > 3 ||
    !mandatesValid ||
    !body.allowChains?.length ||
    !body.allowOrderTypes?.length ||
    !body.allowSides?.length;
  if (bad) {
    return Response.json(
      {
        error:
          "valid copy ratio, risk sleeves, up to three leaders, and at least one chain, type and side are required",
      },
      { status: 400 },
    );
  }
  const policy = upsertPolicy(body);
  await rebuildFor(body.follower);
  return Response.json({ policy });
}
