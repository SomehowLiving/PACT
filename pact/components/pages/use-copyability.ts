"use client";

import { useDeskContext } from "@/components/DeskContext";
import { mandateFor } from "@/components/pages/following-actions";
import type { Tone } from "@/components/ui";
import { copyability, type Copyability, type CopyContext, type CopyVerdict, type Mirrored } from "@/lib/copyability";
import { capacity, exposureGroups } from "@/lib/views";
import { useCallback, useMemo } from "react";

export const COPY_VERDICT: Record<CopyVerdict, { tone: Tone; label: string }> = {
  COPYABLE: { tone: "good", label: "Copyable" },
  PARTLY: { tone: "warn", label: "Partly copyable" },
  NOT_COPYABLE: { tone: "bad", label: "Not copyable" },
  NO_LIVE_PLANS: { tone: "neutral", label: "No live plans" },
};

/**
 * Follower-specific copyability of any leader, from the viewed desk's mandate and its current
 * usage. The same engine the copy drawer uses (lib/copyability): plans this desk already
 * mirrored keep their stored, binding decision; the rest are previewed.
 */
export function useCopyabilityOf() {
  const { state, policy } = useDeskContext();

  const mirrored = useMemo(() => {
    const map: Mirrored = new Map();
    for (const p of state?.proposals ?? []) {
      if (p.follower.toLowerCase() !== policy.follower.toLowerCase()) continue;
      const decision = state?.decisions[p.id];
      if (decision) map.set(p.strategyId, { decision, notionalUsd: p.notionalUsd });
    }
    return map;
  }, [state?.proposals, state?.decisions, policy.follower]);

  const base = useMemo(() => (state ? { cap: capacity(state, policy), weth: exposureGroups(state, policy.follower).find((g) => g.asset === "WETH" && g.side === "buy") } : undefined), [state, policy]);

  return useCallback(
    (leader: string): Copyability | undefined => {
      if (!state || !base) return undefined;
      const sleeve = base.cap.sleeves.find((s) => s.leader.toLowerCase() === leader.toLowerCase());
      const ctx: CopyContext = {
        dailySpentUsd: base.cap.dailyUsed,
        leaderDailySpentUsd: sleeve?.used ?? 0,
        activePlanCount: base.cap.openPlans,
        activePlanCountForLeader: sleeve?.openPlans ?? 0,
        assetExposureUsd: base.weth?.liveUsd ?? 0,
      };
      const plans = state.strategies.filter((s) => s.leader.toLowerCase() === leader.toLowerCase()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return copyability(plans, policy, mandateFor(policy, leader), ctx, mirrored);
    },
    [state, base, policy, mirrored],
  );
}
