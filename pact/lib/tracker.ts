import { PLAYGROUND_KEY_PREFIX } from "./constants";
import { OrderStream, type FlashOrderUpdate, type StreamOptions } from "./flash-stream";
import { refreshReceipt } from "./receipts";
import { snapshot } from "./store";
import type { Receipt } from "./types";
import { stillLive } from "./views";

/**
 * L5 tracking. Flash's Orders WebSocket says *that* an order changed; Flash's REST order read
 * says *what* it is now. So a stream frame for a tracked order (entry, its protective order, or
 * a pair minted from the entry) triggers one debounced `refreshReceipt`, and every snapshot
 * (first connect and each reconnect) resyncs all of that follower's live receipts.
 *
 * Scope: with an integrator key, one org-wide connection serves every follower. With Flash's
 * public playground key the org is shared with everyone, so PACT opens one connection per
 * follower that has live orders, capped well under the 50-per-key limit; past the cap a
 * follower is tracked by polling, as before.
 */

export const MAX_FUNDER_STREAMS = 5;
const DEBOUNCE_MS = 750;

export type TrackingInfo = {
  mode: "stream" | "polling" | "off";
  status?: "connecting" | "live" | "degraded" | "stopped";
  detail?: string;
  /** When the stream is live the browser can poll Flash rarely (a safety net, not the feed). */
  pollMs: number;
};

type Tracker = {
  stream?: OrderStream;
  key?: string;
  timers: Map<string, ReturnType<typeof setTimeout>>;
  events: number;
};

const g = globalThis as unknown as { __pactTracker?: Tracker };
const t = (): Tracker => (g.__pactTracker ??= { timers: new Map(), events: 0 });

const orgWide = (key: string) => !key.startsWith(PLAYGROUND_KEY_PREFIX);

function liveReceipts(follower?: string): Receipt[] {
  return snapshot().receipts.filter(
    (r) => r.flashOrderId && stillLive(r) && (!follower || r.follower.toLowerCase() === follower.toLowerCase()),
  );
}

/** Flash streams by funder: the follower's EOA, or their PACT wallet for Autopilot orders. */
const funderOf = (r: Receipt) => (r.funder ?? r.follower).toLowerCase();

function liveForFunder(funder?: string): Receipt[] {
  return snapshot().receipts.filter((r) => r.flashOrderId && stillLive(r) && (!funder || funderOf(r) === funder.toLowerCase()));
}

/** The receipt a stream frame is about, if PACT placed it. */
export function receiptForOrder(order: FlashOrderUpdate, receipts: Receipt[]): Receipt | undefined {
  return receipts.find(
    (r) =>
      r.flashOrderId === order.orderId ||
      (!!r.protection?.bracketOrderId && r.protection.bracketOrderId === order.orderId) ||
      (!!order.sourceEntryOrderId && order.sourceEntryOrderId === r.flashOrderId),
  );
}

function scheduleRefresh(proposalId: string) {
  const tracker = t();
  const pending = tracker.timers.get(proposalId);
  if (pending) clearTimeout(pending);
  tracker.timers.set(
    proposalId,
    setTimeout(() => {
      tracker.timers.delete(proposalId);
      const receipt = snapshot().receipts.find((r) => r.proposalId === proposalId);
      if (!receipt) return;
      void refreshReceipt(receipt)
        .catch(() => undefined)
        .finally(sweep);
    }, DEBOUNCE_MS),
  );
}

function onOrders(_scope: string, orders: FlashOrderUpdate[]) {
  const receipts = snapshot().receipts.filter((r) => r.flashOrderId);
  for (const order of orders) {
    const receipt = receiptForOrder(order, receipts);
    if (!receipt) continue;
    t().events++;
    scheduleRefresh(receipt.proposalId);
  }
}

function onSnapshot(scope: string, orders: FlashOrderUpdate[]) {
  // A snapshot only lists open orders, so it cannot show what closed during a gap: resync
  // every live receipt in scope from REST.
  for (const r of liveForFunder(scope === "*" ? undefined : scope)) scheduleRefresh(r.proposalId);
  onOrders(scope, orders);
}

/** Close streams nobody needs any more (all their orders are terminal). */
function sweep() {
  const { stream } = t();
  if (!stream) return;
  for (const scope of stream.scopes()) {
    if (!liveForFunder(scope === "*" ? undefined : scope).length) stream.close(scope);
  }
}

function ensureStream(key: string, opts?: Partial<StreamOptions>): OrderStream {
  const tracker = t();
  if (!tracker.stream || tracker.key !== key) {
    tracker.stream?.closeAll();
    tracker.stream = new OrderStream({ apiKey: key, ...opts }, { onSnapshot, onUpdate: onOrders });
    tracker.key = key;
  }
  return tracker.stream;
}

/**
 * Make sure a follower's live orders are streamed if possible, and say how they are tracked.
 * Idempotent and cheap: called from the routes that already read the desk.
 */
export function trackFollower(follower: string, opts?: Partial<StreamOptions>): TrackingInfo {
  const key = process.env.FLASH_API_KEY;
  if (!key || process.env.PACT_ORDER_STREAM === "off") return { mode: "off", pollMs: 4_000 };
  const live = liveReceipts(follower);
  if (!live.length) {
    sweep();
    return { mode: "off", pollMs: 4_000 };
  }
  const stream = ensureStream(key, opts);
  const scopes = orgWide(key) ? ["*"] : [...new Set(live.map(funderOf))];
  for (const scope of scopes) {
    if (stream.scopes().includes(scope)) continue;
    if (scope !== "*" && stream.scopes().length >= MAX_FUNDER_STREAMS) {
      return { mode: "polling", detail: "stream slots in use", pollMs: 4_000 };
    }
    stream.open(scope);
  }
  // Healthy only when every funder this follower uses is streaming.
  const statuses = scopes.map((scope) => stream.status(scope));
  const healthy = scopes.every((scope) => stream.healthy(scope));
  const worst = statuses.find((x) => x?.status !== "live") ?? statuses[0];
  return { mode: "stream", status: worst?.status, detail: worst?.detail, pollMs: healthy ? 30_000 : 4_000 };
}

export function trackerStats() {
  const tracker = t();
  return {
    scopes: tracker.stream?.scopes().map((scope) => ({ scope, ...tracker.stream!.status(scope) })) ?? [],
    events: tracker.events,
  };
}

/** Test helper. */
export function resetTracker() {
  const tracker = t();
  tracker.stream?.closeAll();
  for (const timer of tracker.timers.values()) clearTimeout(timer);
  g.__pactTracker = { timers: new Map(), events: 0 };
}
