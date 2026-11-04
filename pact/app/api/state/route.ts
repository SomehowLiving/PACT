import { blockedNotional, dailySpent, snapshot } from "@/lib/store";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const follower = req.nextUrl.searchParams.get("follower") as
    | `0x${string}`
    | null;
  const state = snapshot();
  return Response.json({
    ...state,
    dailySpentUsd: follower ? dailySpent(follower) : 0,
    blockedNotionalUsd: blockedNotional(follower ?? undefined),
  });
}
