import { evidenceRank } from "./leader-evidence";
import { shadowSummary, type ShadowSummary } from "./shadow";
import type { DeskState, LeaderEvidenceStatus } from "./types";

/**
 * L3: a leader's track record, from evidence only. Two sides:
 *  - the leader's own execution behind each plan (lib/leader-evidence), and
 *  - what happened to followers who copied: Flash fills, entry drift, realized P&L.
 * Counts, not scores: PACT does not rank leaders by a number it cannot defend.
 */

export type LeaderRecord = {
  leader: string;
  plans: number;
  evidence: Record<LeaderEvidenceStatus, number>;
  /** Plans backed by a matching order or finalised onchain trades. */
  backed: number;
  /** The leader's own onchain-verified volume and their average entry drift vs declared. */
  leaderVolumeUsd: number;
  leaderAvgEntryDriftBps?: number;
  /** PACT's paper copies of this leader's plans, and probation (handbook F4, R14, R15). */
  shadow: ShadowSummary;
  /** Followers' mean entry drift minus the leader's own: the cost of copying rather than leading. */
  fidelityGapBps?: number;
  copies: {
    proposals: number;
    submitted: number;
    filled: number;
    avgEntryDriftBps?: number;
    realizedPnlUsd: number;
    closedWins: number;
    closedLosses: number;
  };
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

export function leaderRecord(state: Pick<DeskState, "strategies" | "proposals" | "receipts">, leader: string): LeaderRecord {
  const key = leader.toLowerCase();
  const plans = state.strategies.filter((s) => s.leader.toLowerCase() === key);
  const evidence: LeaderRecord["evidence"] = { UNVERIFIED: 0, ORDER_FOUND: 0, PLAN_MATCHED: 0, ONCHAIN_VERIFIED: 0, MISMATCH: 0 };
  const leaderDrifts: number[] = [];
  let leaderVolumeUsd = 0;
  for (const p of plans) {
    evidence[p.leaderEvidenceStatus ?? "UNVERIFIED"]++;
    const on = p.leaderEvidence?.onchain;
    if (p.leaderEvidenceStatus === "ONCHAIN_VERIFIED" && on) {
      leaderVolumeUsd += on.contraUsd;
      if (on.entryDriftBps !== undefined) leaderDrifts.push(on.entryDriftBps);
    }
  }
  const planIds = new Set(plans.map((p) => p.id));
  const proposals = state.proposals.filter((p) => planIds.has(p.strategyId));
  const ids = new Set(proposals.map((p) => p.id));
  const receipts = state.receipts.filter((r) => ids.has(r.proposalId) && r.flashOrderId);
  const filled = receipts.filter((r) => (r.finalFillCount ?? r.fills?.length ?? 0) > 0 || (r.position?.entryUnits ?? 0) > 0);
  const closed = receipts.filter((r) => r.position?.closed && (r.position.exitUnits ?? 0) > 0);
  const copierDrift = mean(filled.map((r) => r.entryDriftBps).filter((v): v is number => v !== undefined));
  const leaderDrift = mean(leaderDrifts);
  return {
    leader: key,
    shadow: shadowSummary(plans),
    fidelityGapBps: copierDrift !== undefined && leaderDrift !== undefined ? copierDrift - leaderDrift : undefined,
    plans: plans.length,
    evidence,
    backed: plans.filter((p) => evidenceRank(p.leaderEvidenceStatus) >= evidenceRank("PLAN_MATCHED")).length,
    leaderVolumeUsd: Math.round(leaderVolumeUsd * 100) / 100,
    leaderAvgEntryDriftBps: mean(leaderDrifts),
    copies: {
      proposals: proposals.length,
      submitted: receipts.length,
      filled: filled.length,
      avgEntryDriftBps: mean(filled.map((r) => r.entryDriftBps).filter((v): v is number => v !== undefined)),
      realizedPnlUsd: Math.round(receipts.reduce((s, r) => s + (r.realizedPnlUsd ?? 0), 0) * 100) / 100,
      closedWins: closed.filter((r) => r.position!.realizedPnlUsd > 0).length,
      closedLosses: closed.filter((r) => r.position!.realizedPnlUsd < 0).length,
    },
  };
}
