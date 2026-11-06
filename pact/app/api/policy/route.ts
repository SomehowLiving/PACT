import { requireOwner } from "@/lib/session";
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
  const denied = requireOwner(req, body.follower);
  if (denied) return denied;
  const mandateLeaders = new Set((body.mandates ?? []).map((mandate) => mandate.leader.toLowerCase()));
  const mandatesValid =
    mandateLeaders.size === (body.mandates?.length ?? 0) &&
    (body.mandates ?? []).every(
      (mandate) =>
        (body.follows ?? []).some((leader) => leader.toLowerCase() === mandate.leader.toLowerCase()) &&
        (mandate.sizingMode === "PROPORTIONAL" ||
          mandate.sizingMode === "FIXED" ||
          mandate.sizingMode === "STOP_RISK") &&
        mandate.copyRatio > 0 &&
        mandate.copyRatio <= 1 &&
        mandate.fixedNotionalUsd > 0 &&
        mandate.riskBudgetUsd > 0 &&
        mandate.maxDailyUsd >= body.minNotionalUsd &&
        mandate.allowOrderTypes.length > 0 &&
        (mandate.exitMode === "FOLLOWER_BRACKET" || mandate.exitMode === "MANUAL"),
    );
  // Only a selected leader can be paused.
  const pausedValid = (body.pausedLeaders ?? []).every((paused) =>
    (body.follows ?? []).some((leader) => leader.toLowerCase() === paused.toLowerCase()),
  );
  const bad =
    !(body.maxNotionalUsd > 0) ||
    !(body.maxDailyUsd >= body.maxNotionalUsd) ||
    !(body.minNotionalUsd >= 0) ||
    !(body.copyRatio > 0 && body.copyRatio <= 1) ||
    !(body.riskBudgetUsd > 0) ||
    !(body.automationMode === undefined || body.automationMode === "REVIEW" || body.automationMode === "ASSIST") ||
    !(body.maxLeaderDailyUsd >= body.minNotionalUsd) ||
    !(body.maxLeaderDailyRealizedLossUsd > 0) ||
    !(body.maxAssetExposureUsd >= body.minNotionalUsd) ||
    !(body.maxOpenPlans >= 1) ||
    !(body.maxOpenPlansPerLeader >= 1) ||
    !(Number(body.maxEntryDrift) >= 0) ||
    !(body.maxExecutionCost === undefined || (Number(body.maxExecutionCost) > 0 && Number(body.maxExecutionCost) <= 0.3)) ||
    !(body.maxReferenceDivergence === undefined || (Number(body.maxReferenceDivergence) >= 0.001 && Number(body.maxReferenceDivergence) <= 0.1)) ||
    !(body.minLeaderEvidence === undefined || body.minLeaderEvidence === "PLAN_MATCHED" || body.minLeaderEvidence === "ONCHAIN_VERIFIED") ||
    !(Number(body.maxPriceImpact) >= 0) ||
    !(Number(body.maxSlippage) >= 0) ||
    !(body.minRewardRisk >= 1) ||
    (body.follows?.length ?? 0) > 3 ||
    (body.mandates?.length ?? 0) > 3 ||
    !mandatesValid ||
    !pausedValid ||
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
