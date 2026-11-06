import type { Proposal, Receipt } from "./types";

/**
 * Descriptive execution-fidelity history for one leader, built only from this
 * follower's own Flash receipts. It answers "did my copies of this leader stay
 * near the declared entry?" and nothing more: it is not a skill, safety, or
 * profitability score, and it says nothing about orders placed outside PACT.
 */
export type LeaderFidelity = {
  leader: `0x${string}`;
  /** Orders this follower submitted to Flash for this leader's plans. */
  submitted: number;
  /** Submitted orders with at least one Flash fill row. */
  filled: number;
  /** Filled orders that had a declared entry, so drift could be measured. */
  driftSamples: number;
  /** Mean signed drift in bps; positive means the follower paid worse than declared. */
  meanDriftBps?: number;
  /** Most adverse single-order drift in bps. */
  worstDriftBps?: number;
  /** Drift samples at or inside the follower's current entry-drift bound. */
  withinBound?: number;
  /** Flash close reasons seen on this leader's orders, e.g. FILLED or EXPIRED. */
  closeReasons: Record<string, number>;
};

export function leaderFidelity(
  follower: string,
  leaders: `0x${string}`[],
  proposals: Pick<Proposal, "id" | "leader">[],
  receipts: Pick<
    Receipt,
    "proposalId" | "follower" | "flashOrderId" | "fills" | "entryDriftBps" | "closeReason"
  >[],
  maxEntryDrift?: string,
): LeaderFidelity[] {
  const leaderOf = new Map(proposals.map((proposal) => [proposal.id, proposal.leader.toLowerCase()]));
  const mine = receipts.filter(
    (receipt) =>
      receipt.flashOrderId && receipt.follower.toLowerCase() === follower.toLowerCase(),
  );
  const boundBps = Number(maxEntryDrift) * 10_000;

  return leaders.map((leader) => {
    const orders = mine.filter((receipt) => leaderOf.get(receipt.proposalId) === leader.toLowerCase());
    const drifts = orders
      .filter((receipt) => receipt.fills?.length)
      .map((receipt) => receipt.entryDriftBps)
      .filter((drift): drift is number => typeof drift === "number" && Number.isFinite(drift));
    const closeReasons: Record<string, number> = {};
    for (const receipt of orders) {
      if (receipt.closeReason) {
        closeReasons[receipt.closeReason] = (closeReasons[receipt.closeReason] ?? 0) + 1;
      }
    }
    return {
      leader,
      submitted: orders.length,
      filled: orders.filter((receipt) => receipt.fills?.length).length,
      driftSamples: drifts.length,
      meanDriftBps: drifts.length ? drifts.reduce((sum, drift) => sum + drift, 0) / drifts.length : undefined,
      worstDriftBps: drifts.length ? Math.max(...drifts) : undefined,
      withinBound:
        drifts.length && Number.isFinite(boundBps)
          ? drifts.filter((drift) => drift <= boundBps).length
          : undefined,
      closeReasons,
    };
  });
}
