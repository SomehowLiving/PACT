/*
 * World ID signals, shared by the browser (which asks World App for a proof) and the server
 * (which checks the proof is bound to the same value).
 */

/** A leader proof is bound to the leader's address. */
export function leaderSignal(address: string) {
  return address.toLowerCase();
}

/**
 * An Autopilot approval is bound to the follower and the exact limits being granted, so an
 * approval for $25/order cannot be replayed for $2,500/order.
 */
export function autopilotSignal(follower: string, g: { chain: string; hours: number; maxPerOrderUsd: number; maxDailyUsd: number }) {
  return `${follower.toLowerCase()}:autopilot:${g.chain}:${g.hours}h:${g.maxPerOrderUsd}:${g.maxDailyUsd}`;
}
