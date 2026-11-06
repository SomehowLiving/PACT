import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HEARTBEAT_GAP_MS, OrderStream, WS_URL } from "./flash-stream";

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  frame(f: unknown) {
    this.onmessage?.({ data: JSON.stringify(f) });
  }
}

const last = () => FakeSocket.all.at(-1)!;
const make = (events = {}) =>
  new OrderStream(
    { apiKey: "dpka_test", createSocket: (url) => new FakeSocket(url), random: () => 0.5 },
    events,
  );

beforeEach(() => {
  FakeSocket.all = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("Flash orders stream adapter", () => {
  it("connects to Flash's endpoint and subscribes heartbeats and one funder's orders", () => {
    expect(WS_URL).toBe("wss://flash.definitive.fi/v1/ws");
    const s = make();
    s.open("0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD");
    last().open();
    expect(last().sent).toEqual([
      { channel: "heartbeats", type: "subscribe", apiKey: "dpka_test" },
      { channel: "orders", type: "subscribe", apiKey: "dpka_test", funderAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" },
    ]);
    s.open("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
    expect(FakeSocket.all).toHaveLength(1); // one connection per scope
    s.open("*");
    last().open();
    expect(last().sent[1]).toEqual({ channel: "orders", type: "subscribe", apiKey: "dpka_test" });
  });

  it("goes live on the snapshot and hands snapshots and updates to the listener", () => {
    const onSnapshot = vi.fn();
    const onUpdate = vi.fn();
    const s = make({ onSnapshot, onUpdate });
    s.open("0x1");
    last().open();
    expect(s.status("0x1")?.status).toBe("connecting");
    last().frame({ channel: "subscriptions", type: "ack", subscriptions: ["orders", "heartbeats"] });
    last().frame({ channel: "orders", type: "snapshot", orders: [{ orderId: "a", status: "ORDER_STATUS_ACCEPTED" }] });
    expect(s.status("0x1")?.status).toBe("live");
    expect(s.healthy("0x1")).toBe(true);
    last().frame({ channel: "orders", type: "update", orders: [{ orderId: "a", status: "ORDER_STATUS_FILLED" }, { nope: 1 }] });
    expect(onSnapshot).toHaveBeenCalledWith("0x1", [{ orderId: "a", status: "ORDER_STATUS_ACCEPTED" }]);
    expect(onUpdate).toHaveBeenCalledWith("0x1", [{ orderId: "a", status: "ORDER_STATUS_FILLED" }]);
  });

  it("treats a heartbeat gap as a dead socket and reconnects with backoff, then re-subscribes", () => {
    const s = make();
    s.open("0x1");
    last().open();
    last().frame({ channel: "orders", type: "snapshot", orders: [] });
    // Heartbeats keep it alive.
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(1_000);
      last().frame({ channel: "heartbeats", type: "heartbeat", counter: i });
    }
    expect(FakeSocket.all).toHaveLength(1);
    // Then silence.
    vi.advanceTimersByTime(HEARTBEAT_GAP_MS + 1_500);
    expect(s.status("0x1")?.status).toBe("degraded");
    expect(FakeSocket.all[0].readyState).toBe(3);
    vi.advanceTimersByTime(1_000); // first retry: 1 s backoff with jitter
    expect(FakeSocket.all).toHaveLength(2);
    last().open();
    expect(last().sent.map((m) => m.channel)).toEqual(["heartbeats", "orders"]);
  });

  it("backs off further on repeated failures, capped at 30 s", () => {
    const s = make();
    s.open("0x1");
    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      const before = FakeSocket.all.length;
      last().close();
      let waited = 0;
      while (FakeSocket.all.length === before) {
        vi.advanceTimersByTime(250);
        waited += 250;
      }
      delays.push(waited);
    }
    expect(delays[1]).toBeGreaterThan(delays[0]);
    expect(Math.max(...delays)).toBeLessThanOrEqual(30_000);
    expect(s.status("0x1")?.status).toBe("connecting");
  });

  it("stops for good on UNAUTHORIZED and does not reconnect", () => {
    const onStatus = vi.fn();
    const s = make({ onStatus });
    s.open("0x1");
    last().open();
    last().frame({ type: "error", code: "UNAUTHORIZED", message: "apiKey does not match this connection" });
    vi.advanceTimersByTime(120_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(s.status("0x1")?.status).toBe("stopped");
    expect(onStatus).toHaveBeenLastCalledWith("0x1", "stopped", "UNAUTHORIZED");
  });

  it("closes a scope cleanly without reconnecting", () => {
    const s = make();
    s.open("0x1");
    last().open();
    s.close("0x1");
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(s.scopes()).toEqual([]);
  });
});

// Tracker: stream frames for PACT's orders trigger one debounced REST refresh.
const { refreshReceipt } = vi.hoisted(() => ({ refreshReceipt: vi.fn() }));
vi.mock("./receipts", async (importOriginal) => ({ ...(await importOriginal<typeof import("./receipts")>()), refreshReceipt }));

describe("order tracker", () => {
  const g = globalThis as unknown as { __pact?: unknown; __pactEvidence?: unknown };

  it("streams a follower with live orders, refreshes on frames about them, and closes when done", async () => {
    delete g.__pact;
    delete g.__pactEvidence;
    process.env.PACT_STORE_FILE = join(tmpdir(), `pact-tracker-test-${process.pid}.json`);
    process.env.FLASH_API_KEY = "dpka_513a2bd7_playground_for_test";
    const store = await import("./store");
    const tracker = await import("./tracker");
    store.resetStore();
    tracker.resetTracker();
    await store.seedDemo();
    const follower = store.DEMO_PORTFOLIO_FOLLOWER;
    const proposal = store.snapshot().proposals.find((p) => p.follower === follower)!;
    const opts = { createSocket: (url: string) => new FakeSocket(url), random: () => 0.5 };

    // Nothing live yet: no connection.
    expect(tracker.trackFollower(follower, opts).mode).toBe("off");
    expect(FakeSocket.all).toHaveLength(0);

    store.addReceipt({
      proposalId: proposal.id,
      follower,
      decision: store.decisionFor(proposal.id)!,
      flashOrderId: "entry-9",
      status: "ORDER_STATUS_ACCEPTED",
      notionalUsd: 25,
      protection: { status: "active", bracketOrderId: "pair-9" },
    });
    expect(tracker.trackFollower(follower, opts)).toMatchObject({ mode: "stream", status: "connecting", pollMs: 4_000 });
    expect(FakeSocket.all).toHaveLength(1);
    last().open();
    expect(last().sent[1]).toMatchObject({ funderAddress: follower.toLowerCase() });

    // The snapshot resyncs the live receipt once (debounced), even though it lists nothing.
    refreshReceipt.mockImplementation(async (r) => ({ ok: true, receipt: r }));
    last().frame({ channel: "orders", type: "snapshot", orders: [] });
    expect(tracker.trackFollower(follower, opts)).toMatchObject({ mode: "stream", status: "live", pollMs: 30_000 });
    // A burst of frames about the entry and its protective pair: one refresh, not three.
    last().frame({ channel: "orders", type: "update", orders: [{ orderId: "entry-9", status: "ORDER_STATUS_PARTIALLY_FILLED" }] });
    last().frame({ channel: "orders", type: "update", orders: [{ orderId: "pair-9", status: "ORDER_STATUS_ACCEPTED" }] });
    last().frame({ channel: "orders", type: "update", orders: [{ orderId: "someone-else", status: "ORDER_STATUS_FILLED" }] });
    expect(refreshReceipt).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(800);
    expect(refreshReceipt).toHaveBeenCalledTimes(1);
    expect(refreshReceipt.mock.calls[0][0].flashOrderId).toBe("entry-9");
    expect(tracker.trackerStats().events).toBe(2);

    // Once Flash reports everything terminal, the stream is closed.
    store.patchReceipt(proposal.id, { status: "ORDER_STATUS_FILLED", protection: { status: "active", bracketOrderId: "pair-9", orderStatus: "ORDER_STATUS_FILLED" } });
    last().frame({ channel: "orders", type: "update", orders: [{ orderId: "pair-9", status: "ORDER_STATUS_FILLED" }] });
    await vi.advanceTimersByTimeAsync(800);
    expect(tracker.trackerStats().scopes).toEqual([]);
    expect(tracker.trackFollower(follower, opts).mode).toBe("off");
  });

  it("matches a pair minted from the entry by its source entry id", async () => {
    const { receiptForOrder } = await import("./tracker");
    const receipts = [{ proposalId: "p", flashOrderId: "entry-1" }] as never[];
    expect(receiptForOrder({ orderId: "new-pair", sourceEntryOrderId: "entry-1" }, receipts)).toBeDefined();
    expect(receiptForOrder({ orderId: "x" }, receipts)).toBeUndefined();
  });
});
