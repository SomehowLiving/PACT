"use client";

import { useDeskContext } from "@/components/DeskContext";
import type { LeaderMandate, Policy } from "@/lib/types";
import { useState } from "react";

/* Follow / unfollow / pause actions shared by Discover and Following.
   Every change is a follower policy save; PACT re-decides queued plans on save. */

export const MAX_LEADERS = 3;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function defaultMandate(leader: `0x${string}`, policy: Policy): LeaderMandate {
  return {
    leader,
    sizingMode: "PROPORTIONAL",
    copyRatio: policy.copyRatio,
    fixedNotionalUsd: policy.minNotionalUsd,
    riskBudgetUsd: policy.riskBudgetUsd,
    maxDailyUsd: policy.maxLeaderDailyUsd,
    allowOrderTypes: [...policy.allowOrderTypes],
    exitMode: "FOLLOWER_BRACKET",
  };
}

export function mandateFor(policy: Policy, leader: string): LeaderMandate | undefined {
  return policy.mandates?.find((m) => same(m.leader, leader));
}

function withFollow(policy: Policy, leader: `0x${string}`): Policy {
  const follows = policy.follows ?? [];
  if (follows.some((l) => same(l, leader))) return policy;
  return {
    ...policy,
    follows: [...follows, leader],
    mandates: [...(policy.mandates ?? []).filter((m) => !same(m.leader, leader)), defaultMandate(leader, policy)],
  };
}

/** Follow (if needed) and store this exact mandate for the leader. */
function withMandate(policy: Policy, mandate: LeaderMandate): Policy {
  const follows = policy.follows ?? [];
  return {
    ...policy,
    follows: follows.some((l) => same(l, mandate.leader)) ? follows : [...follows, mandate.leader],
    mandates: [...(policy.mandates ?? []).filter((m) => !same(m.leader, mandate.leader)), mandate],
  };
}

function withoutFollow(policy: Policy, leader: string): Policy {
  return {
    ...policy,
    follows: (policy.follows ?? []).filter((l) => !same(l, leader)),
    mandates: (policy.mandates ?? []).filter((m) => !same(m.leader, leader)),
    pausedLeaders: (policy.pausedLeaders ?? []).filter((l) => !same(l, leader)),
  };
}

function withPause(policy: Policy, leader: `0x${string}`, paused: boolean): Policy {
  const others = (policy.pausedLeaders ?? []).filter((l) => !same(l, leader));
  return { ...policy, pausedLeaders: paused ? [...others, leader] : others };
}

export function useLeaderActions() {
  const { policy, canAct, isDemo, isConnected, refresh } = useDeskContext();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const follows = policy.follows ?? [];

  const isFollowing = (leader: string) => follows.some((l) => same(l, leader));
  const isPaused = (leader: string) => !!policy.pausedLeaders?.some((l) => same(l, leader));

  /** Why the follow action is unavailable for this leader, or undefined when allowed. */
  function blockedReason(leader: string): string | undefined {
    if (isDemo) return "Demo desks are read-only";
    if (!isConnected) return "Connect your wallet to follow";
    if (!canAct) return "Only your own desk can be changed";
    if (!isFollowing(leader) && follows.length >= MAX_LEADERS) return `Up to ${MAX_LEADERS} leaders; remove one first`;
    return undefined;
  }

  async function save(leader: string, next: Policy): Promise<boolean> {
    setBusy(leader.toLowerCase());
    setError(null);
    try {
      const res = await fetch("/api/policy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "could not save mandate");
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not save mandate");
      return false;
    } finally {
      setBusy(null);
    }
  }

  return {
    busy,
    error,
    isFollowing,
    isPaused,
    blockedReason,
    follow: (leader: `0x${string}`) => (blockedReason(leader) ? undefined : save(leader, withFollow(policy, leader))),
    unfollow: (leader: `0x${string}`) => (blockedReason(leader) ? undefined : save(leader, withoutFollow(policy, leader))),
    setPaused: (leader: `0x${string}`, paused: boolean) =>
      blockedReason(leader) ? undefined : save(leader, withPause(policy, leader, paused)),
    saveMandate: (mandate: LeaderMandate) =>
      blockedReason(mandate.leader) ? Promise.resolve(false) : save(mandate.leader, withMandate(policy, mandate)),
  };
}
