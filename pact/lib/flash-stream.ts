import { FLASH_BASE } from "./constants";

/**
 * L0 adapter for Flash's Orders WebSocket (`wss://flash.definitive.fi/v1/ws`). No business logic:
 * it keeps connections healthy and hands every order frame to a listener.
 *
 * - One connection per scope: a single funder, or the whole org ("*"). A connection cannot
 *   change scope, so each funder gets its own socket on a shared key.
 * - Auth is in-band: `apiKey` on every subscribe. Heartbeats arrive once per second; a gap of
 *   HEARTBEAT_GAP_MS means the socket is dead, so it is closed and reopened.
 * - Reconnect: capped exponential backoff with equal jitter. Every subscribe returns a fresh
 *   snapshot, so a reconnect reseeds state. UNAUTHORIZED stops for good.
 */

export type FlashOrderUpdate = {
  orderId: string;
  orderType?: string;
  side?: string;
  status?: string;
  closeReason?: string | null;
  funderAddress?: string;
  qty?: string;
  filled?: { targetAmount?: string; contraAmount?: string } | null;
  attachedBracket?: { status?: string; bracketOrderId?: string | null };
  sourceEntryOrderId?: string;
  twapBucketCount?: number | null;
  completedFillCount?: number | null;
  pendingUpdate?: boolean;
  placedAt?: string;
  closedAt?: string | null;
};

export type StreamStatus = "connecting" | "live" | "degraded" | "stopped";

export type StreamEvents = {
  /** Fresh snapshot after every (re)subscribe: open orders for this scope. */
  onSnapshot?: (scope: string, orders: FlashOrderUpdate[]) => void;
  onUpdate?: (scope: string, orders: FlashOrderUpdate[]) => void;
  onStatus?: (scope: string, status: StreamStatus, detail?: string) => void;
};

type SocketLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
};

export type StreamOptions = {
  apiKey: string;
  url?: string;
  /** Injected in tests. */
  createSocket?: (url: string) => SocketLike;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  random?: () => number;
};

export const WS_URL = FLASH_BASE.replace(/^http/, "ws").replace(/\/v1\/?$/, "") + "/v1/ws";
export const HEARTBEAT_GAP_MS = 5_000;
const MAX_BACKOFF_MS = 30_000;
const OPEN = 1;

type Conn = {
  scope: string;
  socket?: SocketLike;
  status: StreamStatus;
  attempts: number;
  lastFrameAt: number;
  watchdog?: unknown;
  retry?: unknown;
  closing: boolean;
  detail?: string;
};

export class OrderStream {
  private conns = new Map<string, Conn>();
  private readonly opts: Required<Omit<StreamOptions, "apiKey">> & { apiKey: string };

  constructor(
    opts: StreamOptions,
    private readonly events: StreamEvents = {},
  ) {
    this.opts = {
      url: WS_URL,
      createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
      random: Math.random,
      ...opts,
    };
  }

  /** Open (or keep) a stream for one funder address, or "*" for every funder in the org. */
  open(scope: string) {
    const key = scope === "*" ? "*" : scope.toLowerCase();
    if (this.conns.has(key)) return;
    const conn: Conn = { scope: key, status: "connecting", attempts: 0, lastFrameAt: 0, closing: false };
    this.conns.set(key, conn);
    this.connect(conn);
  }

  close(scope: string) {
    const key = scope === "*" ? "*" : scope.toLowerCase();
    const conn = this.conns.get(key);
    if (!conn) return;
    conn.closing = true;
    this.opts.clearTimer(conn.watchdog);
    this.opts.clearTimer(conn.retry);
    conn.socket?.close();
    this.conns.delete(key);
  }

  closeAll() {
    for (const scope of [...this.conns.keys()]) this.close(scope);
  }

  scopes() {
    return [...this.conns.keys()];
  }

  status(scope: string): { status: StreamStatus; lastFrameAt: number; detail?: string } | undefined {
    const conn = this.conns.get(scope === "*" ? "*" : scope.toLowerCase());
    return conn ? { status: conn.status, lastFrameAt: conn.lastFrameAt, detail: conn.detail } : undefined;
  }

  private setStatus(conn: Conn, status: StreamStatus, detail?: string) {
    if (conn.status === status && conn.detail === detail) return;
    conn.status = status;
    conn.detail = detail;
    this.events.onStatus?.(conn.scope, status, detail);
  }

  private connect(conn: Conn) {
    let socket: SocketLike;
    try {
      socket = this.opts.createSocket(this.opts.url);
    } catch (e) {
      this.scheduleReconnect(conn, e instanceof Error ? e.message : "connect failed");
      return;
    }
    conn.socket = socket;
    socket.onopen = () => {
      const base = { apiKey: this.opts.apiKey, type: "subscribe" };
      socket.send(JSON.stringify({ channel: "heartbeats", ...base }));
      socket.send(
        JSON.stringify({ channel: "orders", ...base, ...(conn.scope === "*" ? {} : { funderAddress: conn.scope }) }),
      );
      conn.lastFrameAt = this.opts.now();
      this.armWatchdog(conn);
    };
    socket.onmessage = (ev) => this.onFrame(conn, ev.data);
    socket.onerror = () => {
      /* onclose follows and decides */
    };
    socket.onclose = () => {
      this.opts.clearTimer(conn.watchdog);
      if (conn.closing || conn.status === "stopped") return;
      this.scheduleReconnect(conn, "connection closed");
    };
  }

  private onFrame(conn: Conn, raw: unknown) {
    conn.lastFrameAt = this.opts.now();
    let frame: { channel?: string; type?: string; orders?: FlashOrderUpdate[]; code?: string; message?: string };
    try {
      frame = JSON.parse(typeof raw === "string" ? raw : String(raw));
    } catch {
      return;
    }
    if (frame.type === "error") {
      if (frame.code === "UNAUTHORIZED") {
        // A bad key will not start working on retry.
        this.setStatus(conn, "stopped", frame.code);
        conn.closing = true;
        conn.socket?.close();
        return;
      }
      if (frame.code === "STREAMING_UNAVAILABLE") this.setStatus(conn, "degraded", frame.code);
      if (frame.code === "SUBSCRIBE_FAILED" || frame.code === "SNAPSHOT_FAILED" || frame.code === "STREAM_ERROR") {
        conn.socket?.close(); // reconnect and re-subscribe
      }
      return;
    }
    if (frame.channel !== "orders") return; // heartbeats and acks only prove liveness
    const orders = (frame.orders ?? []).filter((o) => o && typeof o.orderId === "string");
    if (frame.type === "snapshot") {
      conn.attempts = 0;
      this.setStatus(conn, "live");
      this.events.onSnapshot?.(conn.scope, orders);
    } else if (frame.type === "update") {
      this.events.onUpdate?.(conn.scope, orders);
    }
  }

  private armWatchdog(conn: Conn) {
    this.opts.clearTimer(conn.watchdog);
    conn.watchdog = this.opts.setTimer(() => {
      if (conn.closing) return;
      if (this.opts.now() - conn.lastFrameAt > HEARTBEAT_GAP_MS) {
        this.setStatus(conn, "degraded", "heartbeats stopped");
        conn.socket?.close(); // onclose schedules the reconnect
        return;
      }
      this.armWatchdog(conn);
    }, 1_000);
  }

  private scheduleReconnect(conn: Conn, detail: string) {
    if (conn.closing) return;
    this.setStatus(conn, "degraded", detail);
    const backoff = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** conn.attempts++);
    const delay = backoff / 2 + this.opts.random() * (backoff / 2);
    this.opts.clearTimer(conn.retry);
    conn.retry = this.opts.setTimer(() => {
      if (conn.closing) return;
      this.setStatus(conn, "connecting");
      this.connect(conn);
    }, delay);
  }

  /** True when the socket is open and has spoken within the heartbeat gap. */
  healthy(scope: string) {
    const conn = this.conns.get(scope === "*" ? "*" : scope.toLowerCase());
    return !!conn && conn.status === "live" && conn.socket?.readyState === OPEN && this.opts.now() - conn.lastFrameAt <= HEARTBEAT_GAP_MS;
  }
}
