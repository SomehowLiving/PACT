import { tokenDecimals } from "./chains";
import type { EvidenceCheck, LeaderEvidence, LeaderEvidenceStatus, Strategy } from "./types";

/**
 * L3 signal: is a leader's plan backed by the leader's own execution? Pure: it reads decoded
 * chain facts and Flash's order record and returns checks with reasons. It never decides a
 * copy; policy reads the resulting status.
 *
 * Two independent sources, either is enough to start:
 *  - Flash order (only findable when placed under PACT's API org): compared field by field
 *    with the plan, and its fill transactions are then checked on chain.
 *  - Transaction hashes from any venue: the leader's wallet's net token flows in each tx must
 *    be the declared trade (e.g. USDC out, WETH in for a buy), near the declared entry, inside
 *    the plan window, final, and not already used to back another plan.
 * The publisher is the signed-in leader wallet (session), so "the leader's wallet" is proven.
 */

export type TokenTransfer = { token: string; from: string; to: string; value: bigint };

export type TxFacts = {
  hash: string;
  /** "missing" = not found on chain (yet). */
  status: "success" | "reverted" | "missing";
  blockNumber?: bigint;
  /** Block time, seconds. */
  timestamp?: number;
  finalized: boolean;
  transfers: TokenTransfer[];
};

/** Flash's REST order, as far as matching needs it. */
export type LeaderOrder = {
  orderId?: string;
  orderType?: string;
  side?: string;
  status?: string;
  closeReason?: string | null;
  qty?: string;
  filled?: { targetAmount?: string; contraAmount?: string } | null;
  limitNotionalPrice?: string | null;
  targetAsset?: { address?: string } | string;
  contraAsset?: { address?: string } | string;
  attachedBracket?: {
    takeProfit?: { notionalPrice?: string | null } | null;
    stopLoss?: { notionalPrice?: string | null } | null;
  } | null;
  placedAt?: string | null;
};

export type PlanFacts = Pick<
  Strategy,
  | "id"
  | "leader"
  | "chain"
  | "side"
  | "orderType"
  | "qty"
  | "targetAsset"
  | "contraAsset"
  | "entryReferencePrice"
  | "stopLossPrice"
  | "takeProfitPrice"
  | "limitNotionalPrice"
  | "createdAt"
  | "expiresAt"
>;

/** A trade may back a plan if it happened at most this long before the plan was published. */
export const EVIDENCE_LOOKBACK_MS = 6 * 60 * 60 * 1000;
/** How much worse than the declared entry the leader may have traded and still "match". */
export const ENTRY_TOLERANCE_BPS = 100;
const OPEN_ORDER = ["ORDER_STATUS_PENDING", "ORDER_STATUS_ACCEPTED", "ORDER_STATUS_PARTIALLY_FILLED"];

const RANK: Record<LeaderEvidenceStatus, number> = {
  MISMATCH: -1,
  UNVERIFIED: 0,
  ORDER_FOUND: 1,
  PLAN_MATCHED: 2,
  ONCHAIN_VERIFIED: 3,
};
export const evidenceRank = (s?: LeaderEvidenceStatus) => RANK[s ?? "UNVERIFIED"];

const lower = (v?: string) => (v ?? "").toLowerCase();
const addr = (a?: { address?: string } | string) => lower(typeof a === "string" ? a : a?.address);
const num = (v?: string | null) => {
  const x = Number(v);
  return v !== undefined && v !== null && v !== "" && Number.isFinite(x) ? x : undefined;
};
const near = (a: number, b: number, bps: number) => Math.abs(a - b) <= (Math.abs(b) * bps) / 10_000;
const units = (value: bigint, decimals: number) => Number(value) / 10 ** decimals;

/** The leader wallet's net movement of the plan's two tokens in one transaction. */
export function netFlows(tx: TxFacts, plan: PlanFacts) {
  const me = lower(plan.leader);
  const decT = tokenDecimals(plan.chain, plan.targetAsset) ?? 18;
  const decC = tokenDecimals(plan.chain, plan.contraAsset) ?? 6;
  let target = BigInt(0);
  let contra = BigInt(0);
  for (const t of tx.transfers) {
    const token = lower(t.token);
    const delta = (lower(t.to) === me ? t.value : BigInt(0)) - (lower(t.from) === me ? t.value : BigInt(0));
    if (token === lower(plan.targetAsset)) target += delta;
    else if (token === lower(plan.contraAsset)) contra += delta;
  }
  return { target: units(target, decT), contra: units(contra, decC) };
}

export type OnchainResult = {
  checks: EvidenceCheck[];
  outcome: "VERIFIED" | "MISMATCH" | "PENDING";
  onchain: NonNullable<LeaderEvidence["onchain"]>;
};

export function assessOnchain(
  plan: PlanFacts,
  txs: TxFacts[],
  usedBy: Map<string, string> = new Map(),
): OnchainResult {
  const checks: EvidenceCheck[] = [];
  const add = (id: string, label: string, result: EvidenceCheck["result"], detail: string) =>
    checks.push({ id, label, result, detail });
  const buy = plan.side === "buy";
  const short = (h: string) => `${h.slice(0, 10)}…`;

  const reused = txs.filter((t) => usedBy.has(lower(t.hash)) && usedBy.get(lower(t.hash)) !== plan.id);
  add(
    "tx.unique",
    "Not already backing another plan",
    reused.length ? "MISMATCH" : "MATCH",
    reused.length ? `${reused.map((t) => short(t.hash)).join(", ")} already backs plan ${usedBy.get(lower(reused[0].hash))}` : `${txs.length} transaction${txs.length === 1 ? "" : "s"}`,
  );

  const missing = txs.filter((t) => t.status === "missing");
  const reverted = txs.filter((t) => t.status === "reverted");
  add(
    "tx.exists",
    "Transactions succeeded on chain",
    reverted.length ? "MISMATCH" : missing.length ? "PENDING" : "MATCH",
    reverted.length ? `reverted: ${reverted.map((t) => short(t.hash)).join(", ")}` : missing.length ? `not found yet: ${missing.map((t) => short(t.hash)).join(", ")}` : "all succeeded",
  );

  const mined = txs.filter((t) => t.status === "success");
  let targetUnits = 0;
  let contraUsd = 0;
  const wrongWay: string[] = [];
  for (const tx of mined) {
    const f = netFlows(tx, plan);
    // A buy: target in, contra out. A sell: target out, contra in.
    const ok = buy ? f.target > 0 && f.contra < 0 : f.target < 0 && f.contra > 0;
    if (!ok) wrongWay.push(short(tx.hash));
    else {
      targetUnits += Math.abs(f.target);
      contraUsd += Math.abs(f.contra);
    }
  }
  add(
    "tx.direction",
    buy ? "Leader's wallet bought with the contra token" : "Leader's wallet sold the target token",
    wrongWay.length ? "MISMATCH" : mined.length ? "MATCH" : "PENDING",
    wrongWay.length
      ? `no ${buy ? "buy" : "sell"} by ${plan.leader.slice(0, 8)}… in ${wrongWay.join(", ")}`
      : mined.length
        ? `${targetUnits.toPrecision(4)} target for $${contraUsd.toFixed(2)}`
        : "waiting for transactions",
  );

  const published = Date.parse(plan.createdAt);
  const expires = Date.parse(plan.expiresAt);
  const times = mined.map((t) => (t.timestamp ?? 0) * 1000).filter((t) => t > 0);
  const tooEarly = times.filter((t) => t < published - EVIDENCE_LOOKBACK_MS);
  const tooLate = times.filter((t) => Number.isFinite(expires) && t > expires);
  add(
    "tx.window",
    "Traded inside the plan window",
    tooEarly.length || tooLate.length ? "MISMATCH" : times.length ? "MATCH" : "PENDING",
    tooEarly.length
      ? "a trade is more than 6 h older than the plan: old trades cannot back a new plan"
      : tooLate.length
        ? "a trade is after the plan expired"
        : times.length
          ? `first trade ${Math.round((Math.min(...times) - published) / 60_000)} min from publish`
          : "waiting for transactions",
  );

  const averagePrice = targetUnits > 0 && contraUsd > 0 ? contraUsd / targetUnits : undefined;
  const entry = num(plan.entryReferencePrice) ?? num(plan.limitNotionalPrice);
  const entryDriftBps =
    averagePrice !== undefined && entry ? ((buy ? averagePrice - entry : entry - averagePrice) / entry) * 10_000 : undefined;
  add(
    "tx.price",
    "Price near the declared entry",
    entryDriftBps === undefined ? (entry ? "PENDING" : "NOTE") : entryDriftBps <= ENTRY_TOLERANCE_BPS ? "MATCH" : "MISMATCH",
    entryDriftBps === undefined
      ? entry
        ? "waiting for fills"
        : "plan declares no entry price"
      : `average $${averagePrice!.toFixed(2)} vs declared $${entry}: ${entryDriftBps > 0 ? "+" : ""}${entryDriftBps.toFixed(0)} bps (${buy ? "paid" : "received"} ${entryDriftBps > 0 ? "worse" : "better"}; limit +${ENTRY_TOLERANCE_BPS})`,
  );

  const final = mined.length > 0 && mined.every((t) => t.finalized);
  add(
    "tx.final",
    "Final on Base",
    final ? "MATCH" : "PENDING",
    final ? "all in finalised blocks" : "not finalised yet",
  );

  const planUsd = buy ? num(plan.qty) : num(plan.qty) && averagePrice ? num(plan.qty)! * averagePrice : undefined;
  if (planUsd && contraUsd > 0) {
    add("tx.size", "Leader's own size", "NOTE", `$${contraUsd.toFixed(2)} traded vs $${planUsd.toFixed(2)} declared (${Math.round((contraUsd / planUsd) * 100)}%)`);
  }

  const outcome = checks.some((c) => c.result === "MISMATCH")
    ? "MISMATCH"
    : checks.some((c) => c.result === "PENDING")
      ? "PENDING"
      : "VERIFIED";
  return {
    checks,
    outcome,
    onchain: {
      targetUnits,
      contraUsd,
      averagePrice,
      entryDriftBps,
      firstTradeAt: times.length ? new Date(Math.min(...times)).toISOString() : undefined,
      finalized: final,
    },
  };
}

/** The leader's Flash order, field by field against the published plan. */
export function matchFlashOrder(plan: PlanFacts, order: LeaderOrder): { checks: EvidenceCheck[]; open: boolean } {
  const checks: EvidenceCheck[] = [];
  const add = (id: string, label: string, result: EvidenceCheck["result"], detail: string) =>
    checks.push({ id, label, result, detail });

  const t = addr(order.targetAsset);
  const c = addr(order.contraAsset);
  if (t || c) {
    const ok = t === lower(plan.targetAsset) && (!c || c === lower(plan.contraAsset));
    add("order.pair", "Same pair", ok ? "MATCH" : "MISMATCH", ok ? "target and contra match" : `order trades ${t || "?"} / ${c || "?"}`);
  } else {
    add("order.pair", "Same pair", "NOTE", "Flash did not report the pair on this order");
  }
  add("order.side", "Same side", order.side === plan.side ? "MATCH" : "MISMATCH", `order ${order.side ?? "?"}, plan ${plan.side}`);
  add(
    "order.type",
    "Same order type",
    order.orderType === plan.orderType ? "MATCH" : "MISMATCH",
    `order ${order.orderType ?? "?"}, plan ${plan.orderType}`,
  );

  if (plan.orderType === "limit") {
    const ol = num(order.limitNotionalPrice);
    const pl = num(plan.limitNotionalPrice);
    add(
      "order.limit",
      "Same limit price",
      ol && pl && near(ol, pl, 50) ? "MATCH" : "MISMATCH",
      `order ${ol ?? "—"}, plan ${pl ?? "—"}`,
    );
  }

  const tp = num(order.attachedBracket?.takeProfit?.notionalPrice);
  const sl = num(order.attachedBracket?.stopLoss?.notionalPrice);
  const ptp = num(plan.takeProfitPrice);
  const psl = num(plan.stopLossPrice);
  if (tp !== undefined || sl !== undefined) {
    const ok = (tp === undefined || !ptp || near(tp, ptp, 50)) && (sl === undefined || !psl || near(sl, psl, 50));
    add("order.protection", "Leader's own stop and target", ok ? "MATCH" : "MISMATCH", `order TP ${tp ?? "—"} / SL ${sl ?? "—"}, plan TP ${ptp ?? "—"} / SL ${psl ?? "—"}`);
  } else if (ptp || psl) {
    add("order.protection", "Leader's own stop and target", "NOTE", "the leader's order carries no attached protection");
  }

  const oq = num(order.qty);
  const pq = num(plan.qty);
  if (oq && pq) add("order.size", "Leader's own size", "NOTE", `order ${oq} vs plan ${pq} (${Math.round((oq / pq) * 100)}%)`);

  const filledTarget = num(order.filled?.targetAmount) ?? 0;
  const open = OPEN_ORDER.includes(order.status ?? "");
  if (!open && filledTarget <= 0) {
    // Placing an order, publishing, then cancelling it would let followers copy a trade the
    // leader is not in.
    add("order.filled", "Leader is in the trade", "MISMATCH", `order ${order.status ?? "closed"} with nothing filled`);
  } else {
    add("order.filled", "Leader is in the trade", filledTarget > 0 ? "MATCH" : "PENDING", filledTarget > 0 ? `${filledTarget} filled` : "order open, nothing filled yet");
  }
  return { checks, open };
}

/** One status from both sources. Any contradiction wins; chain proof beats an order match. */
export function combineEvidence(input: {
  nowMs?: number;
  flashOrderId?: string;
  txHashes: string[];
  order?: { checks: EvidenceCheck[]; open: boolean };
  onchain?: OnchainResult;
  orderLookupFailed?: string;
}): LeaderEvidence {
  const checks = [
    ...(input.orderLookupFailed
      ? [{ id: "order.found", label: "Flash order under the leader's wallet", result: "MISMATCH" as const, detail: input.orderLookupFailed }]
      : input.order
        ? [{ id: "order.found", label: "Flash order under the leader's wallet", result: "MATCH" as const, detail: input.flashOrderId ?? "" }]
        : []),
    ...(input.order?.checks ?? []),
    ...(input.onchain?.checks ?? []),
  ];
  const contradicted = checks.some((c) => c.result === "MISMATCH");
  const orderMatched = !!input.order && !input.order.checks.some((c) => c.result === "MISMATCH");
  const status: LeaderEvidenceStatus = contradicted
    ? "MISMATCH"
    : input.onchain?.outcome === "VERIFIED"
      ? "ONCHAIN_VERIFIED"
      : orderMatched
        ? "PLAN_MATCHED"
        : "UNVERIFIED";
  return {
    status,
    checkedAt: new Date(input.nowMs ?? Date.now()).toISOString(),
    flashOrderId: input.flashOrderId,
    txHashes: input.txHashes,
    checks,
    onchain: input.onchain?.onchain,
    open: !contradicted && (!!input.order?.open || input.onchain?.outcome === "PENDING"),
  };
}
