import { trackFollower } from "@/lib/tracker";
import { blockedNotional, dailySpent, leaderDailyRealizedLosses, snapshot } from "@/lib/store";
import { verifiedLeaders } from "@/lib/world";
import { autoseedIfEmpty } from "@/lib/demo-seed";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const follower = req.nextUrl.searchParams.get("follower") as
    | `0x${string}`
    | null;
  await autoseedIfEmpty();
  const state = snapshot();
  return Response.json({
    ...state,
    humans: verifiedLeaders(),
    dailySpentUsd: follower ? dailySpent(follower) : 0,
    blockedNotionalUsd: blockedNotional(follower ?? undefined),
    leaderDailyRealizedLossesUsd: follower ? leaderDailyRealizedLosses(follower) : {},
    // How this follower's live orders are tracked: Flash's stream when possible, else polling.
    tracking: follower ? trackFollower(follower) : undefined,
  });
}
