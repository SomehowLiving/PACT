import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { stable } from "./hash";
import {
  GENESIS,
  type EvidenceEvent,
  type EvidenceKind,
  type EvidenceRefs,
  type Hex,
  type UnsignedEvent,
} from "./evidence-verify";

export * from "./evidence-verify";

/**
 * PACT's append-only evidence log. One JSON line per event in `<store>.evidence.jsonl`. The
 * log is never rewritten: a demo reload or a mandate change that replaces proposals appends
 * events, it does not delete any. The desk store can be edited; this log can only grow, and
 * any edit to it is detectable (see evidence-verify).
 */

type Log = { events: EvidenceEvent[]; threads: Map<string, Hex> };
const g = globalThis as unknown as { __pactEvidence?: Log };

function file() {
  const store = process.env.PACT_STORE_FILE ?? join(process.cwd(), ".data", "store.json");
  return store.replace(/\.json$/, "") + ".evidence.jsonl";
}

/** Same bytes as sha256Json (lib/hash), synchronously, so appends cannot interleave. */
export function hashSync(value: unknown): Hex {
  return `0x${createHash("sha256").update(stable(value), "utf8").digest("hex")}`;
}

function load(): Log {
  const log: Log = { events: [], threads: new Map() };
  let text = "";
  try {
    text = readFileSync(/*turbopackIgnore: true*/ file(), "utf8");
  } catch {
    return log;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as EvidenceEvent;
      log.events.push(e);
      log.threads.set(e.thread, e.hash);
    } catch {
      // A torn final line from a crash mid-write. Verification will report any real damage.
    }
  }
  return log;
}

function current(): Log {
  return (g.__pactEvidence ??= load());
}

export function appendEvidence(
  kind: EvidenceKind,
  thread: string,
  refs: EvidenceRefs,
  data: Record<string, unknown>,
  at = new Date().toISOString(),
): EvidenceEvent {
  const log = current();
  const last = log.events.at(-1);
  // Drop undefined fields so the stored JSON and the hashed JSON are the same bytes.
  const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const body: UnsignedEvent = {
    v: 1,
    seq: last ? last.seq + 1 : 0,
    at,
    kind,
    thread,
    refs: clean(refs),
    data: clean(data),
    prev: last?.hash ?? GENESIS,
    threadPrev: log.threads.get(thread) ?? null,
  };
  const event: EvidenceEvent = { ...body, hash: hashSync(body) };
  try {
    mkdirSync(/*turbopackIgnore: true*/ dirname(file()), { recursive: true });
    appendFileSync(/*turbopackIgnore: true*/ file(), JSON.stringify(event) + "\n");
  } catch {
    /* the in-memory log still verifies; the file is best-effort like the store */
  }
  log.events.push(event);
  log.threads.set(thread, event.hash);
  return event;
}

export function evidenceLog(): EvidenceEvent[] {
  return current().events;
}

export function threadEvents(thread: string): EvidenceEvent[] {
  return current().events.filter((e) => e.thread === thread);
}

/** Last event in a thread, if any. */
export function lastInThread(thread: string): EvidenceEvent | undefined {
  const events = current().events;
  for (let i = events.length - 1; i >= 0; i--) if (events[i].thread === thread) return events[i];
  return undefined;
}

export function evidenceHead() {
  const last = current().events.at(-1);
  return { length: current().events.length, head: last?.hash ?? GENESIS };
}

/** Test helper only: starts an empty log. */
export function resetEvidence() {
  g.__pactEvidence = { events: [], threads: new Map() };
  try {
    rmSync(/*turbopackIgnore: true*/ file(), { force: true });
  } catch {
    /* nothing to remove */
  }
}

export const threads = {
  proposal: (id: string) => `proposal:${id}`,
  mandate: (follower: string) => `mandate:${follower.toLowerCase()}`,
  plan: (strategyId: string) => `plan:${strategyId}`,
};
