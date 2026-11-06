import { CHAINS } from "./chains";
import { assessLeaderPlan } from "./policy";
import type {
  CopyAction,
  Decision,
  DeskState,
  LeaderPlanGrade,
  OrderType,
  Policy,
  Proposal,
  Receipt,
  Side,
  Strategy,
} from "./types";

/* Pure view-model derivations for the terminal UI. Every number here comes from
   stored plans, policy decisions, or Flash receipts. Nothing is estimated,
   ranked by invented performance, or filled with placeholder values. */

export const CLOSED_STATUSES = [
  "ORDER_STATUS_FILLED",
  "ORDER_STATUS_CANCELLED",
  "ORDER_STATUS_REJECTED",
  "ORDER_STATUS_TERMINATED",
];

/** Seeded demo wallets use one repeated hex digit (0x1111…, 0x7777…). */
export function isDemoAddress(address?: string) {
  return !!address && /^0x([0-9a-f])\1{39}$/i.test(address);
}

export function tokenSymbol(address: string) {
  const a = address.toLowerCase();
  for (const chain of Object.values(CHAINS)) {
    if (a === chain.weth.toLowerCase()) return "WETH";
    if (a === chain.usdc.toLowerCase()) return "USDC";
  }
  return `${address.slice(0, 6)}…`;
}

export function pairLabel(p: Pick<Strategy, "targetAsset" | "contraAsset">) {
  return `${tokenSymbol(p.targetAsset)}/${tokenSymbol(p.contraAsset)}`;
}

export function isExpired(p: Pick<Strategy, "expiresAt">, now = Date.now()) {
  const t = Date.parse(p.expiresAt);
  return Number.isFinite(t) && t <= now;
}

export function rewardRisk(p: Pick<Strategy, "side" | "entryReferencePrice" | "stopLossPrice" | "takeProfitPrice">) {
  return assessLeaderPlan(p).rewardRisk;
}

function startOfUtcDay(now = Date.now()) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/* ── Leaders ──────────────────────────────────────────────────────────── */

export type LeaderRow = {
  leader: `0x${string}`;
  plans: number;
  activePlans: number;
  lastPlanAt?: string;
  grades: Record<LeaderPlanGrade, number>;
  /** Mean declared reward:risk across plans with a valid entry, stop and target. */
  avgRewardRisk?: number;
  /** Plans whose Flash order lookup found an order under the leader wallet. */
  evidenceFound: number;
  /** Followers in this PACT store that selected the leader. */
  pactFollowers: number;
  pairs: string[];
  orderTypes: OrderType[];
  sides: Side[];
  /** Orders submitted to Flash by any follower from this leader's plans. */
  copiedOrders: number;
  filledOrders: number;
  meanDriftBps?: number;
  isDemo: boolean;
  following: boolean;
  paused: boolean;
};

export function leaderRows(state: Pick<DeskState, "strategies" | "policies" | "proposals" | "receipts">, viewer?: Policy, now = Date.now()): LeaderRow[] {
  const byLeader = new Map<string, Strategy[]>();
  for (const s of state.strategies) {
    const key = s.leader.toLowerCase();
    byLeader.set(key, [...(byLeader.get(key) ?? []), s]);
  }
  const proposalLeader = new Map(state.proposals.map((p) => [p.id, p.leader.toLowerCase()]));

  return [...byLeader.entries()].map(([key, plans]) => {
    const leader = plans[0].leader;
    const ratios = plans.map(rewardRisk).filter((r): r is number => typeof r === "number" && Number.isFinite(r));
    const orders = state.receipts.filter((r) => r.flashOrderId && proposalLeader.get(r.proposalId) === key);
    const drifts = orders
      .filter((r) => r.fills?.length)
      .map((r) => r.entryDriftBps)
      .filter((d): d is number => typeof d === "number" && Number.isFinite(d));
    const grades: Record<LeaderPlanGrade, number> = { DISCIPLINED: 0, CAUTION: 0, INCOMPLETE: 0 };
    for (const p of plans) grades[p.leaderPlanGrade] += 1;
    return {
      leader,
      plans: plans.length,
      activePlans: plans.filter((p) => !isExpired(p, now)).length,
      lastPlanAt: plans.map((p) => p.createdAt).sort().at(-1),
      grades,
      avgRewardRisk: ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : undefined,
      evidenceFound: plans.filter((p) => p.leaderEvidenceStatus === "ORDER_FOUND").length,
      pactFollowers: state.policies.filter((p) => p.follows?.some((l) => l.toLowerCase() === key)).length,
      pairs: [...new Set(plans.map(pairLabel))],
      orderTypes: [...new Set(plans.map((p) => p.orderType))],
      sides: [...new Set(plans.map((p) => p.side))],
      copiedOrders: orders.length,
      filledOrders: orders.filter((r) => r.fills?.length).length,
      meanDriftBps: drifts.length ? drifts.reduce((a, b) => a + b, 0) / drifts.length : undefined,
      isDemo: isDemoAddress(leader),
      following: !!viewer?.follows?.some((l) => l.toLowerCase() === key),
      paused: !!viewer?.pausedLeaders?.some((l) => l.toLowerCase() === key),
    };
  });
}

/* ── Decisions ────────────────────────────────────────────────────────── */

export const ACTIONS: CopyAction[] = ["COPY", "SCALE", "WAIT", "REVIEW", "DECLINE"];

export function actionOf(decision?: Decision): CopyAction | undefined {
  if (!decision) return undefined;
  return decision.action ?? (decision.verdict === "BLOCK" ? "DECLINE" : decision.verdict === "MODIFY" ? "SCALE" : "COPY");
}

export function actionCounts(proposals: Proposal[], decisions: Record<string, Decision>) {
  const counts: Record<CopyAction, number> = { COPY: 0, SCALE: 0, WAIT: 0, REVIEW: 0, DECLINE: 0 };
  for (const p of proposals) {
    const a = actionOf(decisions[p.id]);
    if (a) counts[a] += 1;
  }
  return counts;
}

/** Notional the policy approved. The store already rewrites notionalUsd to the cap on SCALE. */
export function approvedNotional(p: Proposal, decision?: Decision) {
  return !decision || decision.verdict === "BLOCK" ? 0 : p.notionalUsd;
}

/* ── Exposure and capacity ────────────────────────────────────────────── */

export type ExposureGroup = {
  key: string;
  asset: string;
  side: Side;
  /** Policy-approved, not yet submitted. */
  approvedUsd: number;
  /** Submitted to Flash and not closed. */
  liveUsd: number;
  leaders: string[];
};

export function exposureGroups(state: Pick<DeskState, "proposals" | "decisions" | "receipts">, follower?: string): ExposureGroup[] {
  if (!follower) return [];
  const f = follower.toLowerCase();
  const groups = new Map<string, ExposureGroup>();
  const receiptOf = new Map(state.receipts.map((r) => [r.proposalId, r]));
  for (const p of state.proposals) {
    if (p.follower.toLowerCase() !== f) continue;
    const decision = state.decisions[p.id];
    if (!decision || decision.verdict === "BLOCK") continue;
    const receipt = receiptOf.get(p.id);
    const closed = !!receipt?.status && CLOSED_STATUSES.includes(receipt.status);
    if (closed) continue;
    const key = `${p.targetAsset.toLowerCase()}:${p.side}`;
    const g = groups.get(key) ?? {
      key,
      asset: tokenSymbol(p.targetAsset),
      side: p.side,
      approvedUsd: 0,
      liveUsd: 0,
      leaders: [],
    };
    if (receipt?.flashOrderId) g.liveUsd += receipt.notionalUsd;
    else g.approvedUsd += p.notionalUsd;
    if (!g.leaders.includes(p.leader.toLowerCase())) g.leaders.push(p.leader.toLowerCase());
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.approvedUsd + b.liveUsd - (a.approvedUsd + a.liveUsd));
}

export type Capacity = {
  dailyUsed: number;
  dailyMax: number;
  openPlans: number;
  openPlansMax: number;
  sleeves: { leader: `0x${string}`; used: number; max: number; openPlans: number; paused: boolean }[];
  assetMax: number;
};

/** Mirrors the server's risk context so the UI shows the same remaining capacity PACT enforces. */
export function capacity(
  state: Pick<DeskState, "proposals" | "decisions" | "receipts">,
  policy: Policy,
  now = Date.now(),
): Capacity {
  const f = policy.follower.toLowerCase();
  const from = startOfUtcDay(now);
  const leaderOf = new Map(state.proposals.map((p) => [p.id, p.leader.toLowerCase()]));
  const todays = state.receipts.filter(
    (r) => r.follower.toLowerCase() === f && r.flashOrderId && r.decision.verdict !== "BLOCK" && r.createdAt >= from,
  );
  const receiptOf = new Map(state.receipts.map((r) => [r.proposalId, r]));
  const open = state.proposals.filter((p) => {
    if (p.follower.toLowerCase() !== f) return false;
    const d = state.decisions[p.id];
    if (!d || d.verdict === "BLOCK") return false;
    const r = receiptOf.get(p.id);
    return !r?.status || !CLOSED_STATUSES.includes(r.status);
  });
  return {
    dailyUsed: todays.reduce((s, r) => s + r.notionalUsd, 0),
    dailyMax: policy.maxDailyUsd,
    openPlans: open.length,
    openPlansMax: policy.maxOpenPlans,
    assetMax: policy.maxAssetExposureUsd,
    sleeves: (policy.follows ?? []).map((leader) => {
      const key = leader.toLowerCase();
      const mandate = policy.mandates?.find((m) => m.leader.toLowerCase() === key);
      return {
        leader,
        used: todays.filter((r) => leaderOf.get(r.proposalId) === key).reduce((s, r) => s + r.notionalUsd, 0),
        max: mandate?.maxDailyUsd ?? policy.maxLeaderDailyUsd,
        openPlans: open.filter((p) => p.leader.toLowerCase() === key).length,
        paused: !!policy.pausedLeaders?.some((l) => l.toLowerCase() === key),
      };
    }),
  };
}

/* ── Executions ───────────────────────────────────────────────────────── */

export type ExecutionRow = {
  receipt: Receipt;
  proposal?: Proposal;
  fillCount: number;
  bucketCount?: number;
  /** Share of TWAP buckets filled, when Flash reported a bucket count. */
  progress?: number;
  filledUsd: number;
  closed: boolean;
};

export function executionRows(state: Pick<DeskState, "proposals" | "receipts">, follower?: string): ExecutionRow[] {
  const byId = new Map(state.proposals.map((p) => [p.id, p]));
  return state.receipts
    .filter((r) => r.flashOrderId && (!follower || r.follower.toLowerCase() === follower.toLowerCase()))
    .map((receipt) => {
      const fills = receipt.fills ?? [];
      const bucketCount = receipt.twapBucketCount ?? undefined;
      return {
        receipt,
        proposal: byId.get(receipt.proposalId),
        fillCount: fills.length,
        bucketCount,
        progress: bucketCount ? Math.min(1, fills.length / bucketCount) : undefined,
        filledUsd: fills.reduce((s, f) => s + (Number(f.notional) || 0), 0),
        closed: !!receipt.status && CLOSED_STATUSES.includes(receipt.status),
      };
    })
    .sort((a, b) => b.receipt.createdAt.localeCompare(a.receipt.createdAt));
}

/** True while the entry or its attached protection can still change on Flash. */
export function stillLive(receipt: { status?: string; protection?: { status?: string; orderStatus?: string } }) {
  const entryLive = !receipt.status || !CLOSED_STATUSES.includes(receipt.status);
  const p = receipt.protection;
  const protectionLive =
    !!p && (p.status === "pending_activation" || (p.status === "active" && (!p.orderStatus || !CLOSED_STATUSES.includes(p.orderStatus))));
  return entryLive || protectionLive;
}

/** True when the protective order exists and can still be cancelled. */
export function protectionCancellable(receipt: { protection?: { status?: string; bracketOrderId?: string; orderStatus?: string } }) {
  const p = receipt.protection;
  return !!p?.bracketOrderId && p.status === "active" && (!p.orderStatus || !CLOSED_STATUSES.includes(p.orderStatus));
}

export function orderStatusLabel(status?: string) {
  if (!status) return "submitted";
  return status.replace("ORDER_STATUS_", "").replaceAll("_", " ").toLowerCase();
}

export function relativeTime(iso?: string, now = Date.now()) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const s = Math.round((now - t) / 1000);
  const abs = Math.abs(s);
  const unit = abs < 60 ? [abs, "s"] : abs < 3600 ? [Math.round(abs / 60), "m"] : abs < 86400 ? [Math.round(abs / 3600), "h"] : [Math.round(abs / 86400), "d"];
  return s >= 0 ? `${unit[0]}${unit[1]} ago` : `in ${unit[0]}${unit[1]}`;
}
