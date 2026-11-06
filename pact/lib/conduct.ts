/*
 * L3 leader conduct: did a leader trade against the followers who copied them?
 *
 * Two first-party measures, from facts PACT already holds for a plan:
 *  - front-run: the leader's own trade (from the evidence they attached, read on Base) came
 *    well before the plan was published, and followers paid materially more than the leader;
 *  - sold into followers' buys: the asset left the leader's wallet on Base while followers'
 *    copies of that leader's buy plan were filling.
 * One occurrence is a caution; a repeat is an alert, and policy holds new copies for review.
 *
 * Limits, stated in the UI: PACT reads the leader's wallet on Base only. Sales on a centralized
 * exchange, another chain, or from another wallet are not visible. Tokens leaving the wallet
 * are counted whether sold or transferred.
 */

export const FRONT_RUN_MIN_LEAD_MIN = 30;
export const FRONT_RUN_MIN_ADVANTAGE_BPS = 100;
export const SELL_WINDOW_AFTER_MIN = 30;
export const SELL_MIN_RATIO = 0.25;
export const REPEATS_FOR_ALERT = 2;

export type Fill = { at: number; price: number; units: number };
export type Outflow = { at: number; units: number };

export type FrontRun = { leadMinutes: number; leaderPrice: number; followerPrice: number; advantageBps: number; flagged: boolean };
export type SellIntoFlow = {
  windowStart: string;
  windowEnd: string;
  followerUnits: number;
  soldUnits: number;
  /** Sold share of the leader's evidenced position, or of what followers bought when unknown. */
  ratio: number;
  basis: "leader position" | "follower buys";
  flagged: boolean;
};
export type ConductPlan = { strategyId: string; title: string; frontRun?: FrontRun; sellIntoFlow?: SellIntoFlow };
export type ConductLevel = "clear" | "caution" | "alert";
export type LeaderConduct = {
  leader: string;
  checkedAt: string;
  /** "base" = read from Base RPC; "demo" = seeded DEMO data. */
  source: "base" | "demo";
  plans: ConductPlan[];
  frontRuns: number;
  soldIntoFlow: number;
  level: ConductLevel;
  reasons: string[];
};

const avgPrice = (fills: Fill[]) => {
  const units = fills.reduce((s, f) => s + f.units, 0);
  return units > 0 ? fills.reduce((s, f) => s + f.price * f.units, 0) / units : undefined;
};

/**
 * Leader traded ≥ 30 min before publishing and followers paid ≥ 100 bps worse than the leader
 * (more on a buy, less on a sell). Trading shortly before publishing is normal (skin in the
 * game); getting in long before at a much better price and then promoting is not.
 */
export function frontRun(
  plan: { createdAt: string; side: "buy" | "sell" },
  leader: { firstTradeAt?: string; averagePrice?: number },
  followerFills: Fill[],
): FrontRun | undefined {
  const traded = Date.parse(leader.firstTradeAt ?? "");
  const published = Date.parse(plan.createdAt);
  const followerPrice = avgPrice(followerFills);
  if (!Number.isFinite(traded) || !Number.isFinite(published) || !leader.averagePrice || !followerPrice) return undefined;
  const leadMinutes = (published - traded) / 60_000;
  const edge = plan.side === "buy" ? followerPrice - leader.averagePrice : leader.averagePrice - followerPrice;
  const advantageBps = (edge / leader.averagePrice) * 10_000;
  return {
    leadMinutes,
    leaderPrice: leader.averagePrice,
    followerPrice,
    advantageBps,
    flagged: leadMinutes >= FRONT_RUN_MIN_LEAD_MIN && advantageBps >= FRONT_RUN_MIN_ADVANTAGE_BPS,
  };
}

/** The window followers were buying in: first follower fill to 30 min after the last. */
export function buyWindow(followerFills: Fill[]) {
  if (!followerFills.length) return undefined;
  const times = followerFills.map((f) => f.at);
  return { from: Math.min(...times), to: Math.max(...times) + SELL_WINDOW_AFTER_MIN * 60_000 };
}

/** The leader's outflows of the plan's asset inside the followers' buy window. */
export function sellIntoFlow(followerFills: Fill[], outflows: Outflow[], leaderUnits?: number): SellIntoFlow | undefined {
  const w = buyWindow(followerFills);
  if (!w) return undefined;
  const followerUnits = followerFills.reduce((s, f) => s + f.units, 0);
  const soldUnits = outflows.filter((o) => o.at >= w.from && o.at <= w.to).reduce((s, o) => s + o.units, 0);
  const basis = leaderUnits && leaderUnits > 0 ? "leader position" : "follower buys";
  const denom = basis === "leader position" ? leaderUnits! : followerUnits;
  const ratio = denom > 0 ? soldUnits / denom : 0;
  return {
    windowStart: new Date(w.from).toISOString(),
    windowEnd: new Date(w.to).toISOString(),
    followerUnits,
    soldUnits,
    ratio,
    basis,
    flagged: soldUnits > 0 && ratio >= SELL_MIN_RATIO,
  };
}

/** One occurrence is a caution, a repeat an alert. The reasons are the policy's hold reasons. */
export function summarize(leader: string, plans: ConductPlan[], source: LeaderConduct["source"], nowMs = Date.now()): LeaderConduct {
  const frontRuns = plans.filter((p) => p.frontRun?.flagged).length;
  const soldIntoFlow = plans.filter((p) => p.sellIntoFlow?.flagged).length;
  const reasons = [
    ...(soldIntoFlow >= REPEATS_FOR_ALERT ? ["LEADER_SOLD_INTO_FOLLOWERS"] : []),
    ...(frontRuns >= REPEATS_FOR_ALERT ? ["LEADER_FRONT_RAN_FOLLOWERS"] : []),
  ];
  const level: ConductLevel = reasons.length ? "alert" : frontRuns || soldIntoFlow ? "caution" : "clear";
  return { leader: leader.toLowerCase(), checkedAt: new Date(nowMs).toISOString(), source, plans, frontRuns, soldIntoFlow, level, reasons };
}
