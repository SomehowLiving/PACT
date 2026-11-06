import { sha256Json } from "./hash";

/**
 * Evidence events and their verification. Browser-safe: a follower can check a downloaded
 * bundle, or the whole log, without trusting PACT's server.
 *
 * Each event commits to the one before it in the whole log (`prev`) and to the one before it in
 * its own thread (`threadPrev`), e.g. every event about one proposal. `hash` is SHA-256 over the
 * canonical JSON of the event without `hash`. Editing, reordering or deleting an event breaks
 * every hash after it.
 */

export type Hex = `0x${string}`;
export const GENESIS: Hex = `0x${"0".repeat(64)}`;

export type EvidenceKind =
  | "mandate.set"
  | "plan.published"
  | "decision.made"
  | "decision.updated"
  | "proposal.withdrawn"
  | "quote.stored"
  | "order.submitted"
  | "order.rejected"
  | "order.updated"
  | "order.cancel_requested"
  | "leader.evidence"
  | "shadow.entry"
  | "shadow.settled"
  | "autopilot.granted"
  | "autopilot.revoked"
  | "autopilot.run";

export type EvidenceRefs = {
  proposalId?: string;
  strategyId?: string;
  follower?: string;
  leader?: string;
  flashOrderId?: string;
};

export type EvidenceEvent = {
  v: 1;
  seq: number;
  at: string;
  kind: EvidenceKind;
  /** "proposal:<id>", "mandate:<follower>" or "plan:<strategyId>". */
  thread: string;
  refs: EvidenceRefs;
  data: Record<string, unknown>;
  prev: Hex;
  threadPrev: Hex | null;
  hash: Hex;
};

export type UnsignedEvent = Omit<EvidenceEvent, "hash">;

export function eventBody(event: EvidenceEvent): UnsignedEvent {
  const { hash: _hash, ...body } = event;
  void _hash;
  return body;
}

export type ChainCheck =
  | { ok: true; length: number; head: Hex }
  | { ok: false; length: number; brokenAt: number; reason: string };

/** Every hash recomputes. Used on its own for a subset of events (e.g. a bundle). */
export async function checkHashes(events: EvidenceEvent[]): Promise<ChainCheck> {
  for (const [i, e] of events.entries()) {
    if ((await sha256Json(eventBody(e))) !== e.hash) {
      return { ok: false, length: events.length, brokenAt: i, reason: `event ${e.seq} (${e.kind}) does not match its hash` };
    }
  }
  return { ok: true, length: events.length, head: events.at(-1)?.hash ?? GENESIS };
}

/** The whole log: hashes, sequence numbers, and both kinds of link. */
export async function verifyLog(events: EvidenceEvent[]): Promise<ChainCheck> {
  const hashes = await checkHashes(events);
  if (!hashes.ok) return hashes;
  const lastInThread = new Map<string, Hex>();
  let prev = GENESIS;
  for (const [i, e] of events.entries()) {
    const fail = (reason: string): ChainCheck => ({ ok: false, length: events.length, brokenAt: i, reason });
    if (e.seq !== i) return fail(`expected event ${i}, found ${e.seq}: an event is missing or out of order`);
    if (e.prev !== prev) return fail(`event ${e.seq} does not follow event ${i - 1}`);
    if (e.threadPrev !== (lastInThread.get(e.thread) ?? null)) return fail(`event ${e.seq} skips part of ${e.thread}`);
    lastInThread.set(e.thread, e.hash);
    prev = e.hash;
  }
  return { ok: true, length: events.length, head: prev };
}

/**
 * One thread out of the log (what an evidence bundle carries): every hash recomputes and each
 * event links to the one before it in the thread, from the thread's first event on.
 */
export async function verifyThread(events: EvidenceEvent[]): Promise<ChainCheck> {
  const hashes = await checkHashes(events);
  if (!hashes.ok) return hashes;
  let threadPrev: Hex | null = null;
  for (const [i, e] of events.entries()) {
    if (e.thread !== events[0].thread) {
      return { ok: false, length: events.length, brokenAt: i, reason: `event ${e.seq} belongs to ${e.thread}` };
    }
    if (e.threadPrev !== threadPrev) {
      return { ok: false, length: events.length, brokenAt: i, reason: `event ${e.seq} skips part of ${e.thread}` };
    }
    threadPrev = e.hash;
  }
  return { ok: true, length: events.length, head: threadPrev ?? GENESIS };
}
