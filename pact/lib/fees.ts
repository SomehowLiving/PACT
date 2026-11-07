import type { ConductLevel } from "./conduct";

/**
 * PACT's fee on a copy. Flash collects it at execution (`flashIntegratorFeeBps`, sent identically
 * on the quote and the order) and pays it to the Flash Portfolio of PACT's integrator account.
 *
 * The rule: PACT earns only on copies of leaders who have earned the follower's trust. A leader on
 * probation (fewer than 3 settled paper copies, or a plan contradicted by their own execution) or
 * with a conduct flag (front-running, selling into followers) is copied for free.
 */

/** Default fee on a proven leader's copy: 10 bps (0.10%). */
export const DEFAULT_PACT_FEE_BPS = "10";
/** Never more than 1%, whatever the environment says. */
export const MAX_PACT_FEE_BPS = 100;

export type FeeWaiver =
  | "FEE_OFF"
  | "NO_INTEGRATOR_ACCOUNT"
  | "LEADER_ON_PROBATION"
  | "LEADER_CONDUCT_CAUTION"
  | "LEADER_CONDUCT_ALERT";

export type CopyFee = {
  /** What is sent to Flash: "0" when waived. */
  bps: string;
  charged: boolean;
  /** The configured rate this copy would carry if the leader had earned it. */
  rateBps: string;
  waivedFor: FeeWaiver[];
};

export const FEE_WAIVER_LABEL: Record<FeeWaiver, string> = {
  FEE_OFF: "PACT's fee is switched off",
  NO_INTEGRATOR_ACCOUNT: "PACT is on Flash's shared test key, so a fee would not reach PACT",
  LEADER_ON_PROBATION: "the leader is on probation",
  LEADER_CONDUCT_CAUTION: "the leader has a conduct caution",
  LEADER_CONDUCT_ALERT: "the leader has a conduct alert",
};

/** Compact labels for tight rows. */
export const FEE_WAIVER_SHORT: Record<FeeWaiver, string> = {
  FEE_OFF: "fee off",
  NO_INTEGRATOR_ACCOUNT: "shared test key",
  LEADER_ON_PROBATION: "leader on probation",
  LEADER_CONDUCT_CAUTION: "conduct caution",
  LEADER_CONDUCT_ALERT: "conduct alert",
};

/** The configured rate (env `PACT_FEE_BPS`), as an integer bps string clamped to 0..100. */
export function pactFeeRate(raw: string | undefined = process.env.PACT_FEE_BPS): string {
  const n = Number(raw ?? DEFAULT_PACT_FEE_BPS);
  if (!Number.isFinite(n) || n <= 0) return "0";
  return String(Math.min(MAX_PACT_FEE_BPS, Math.floor(n)));
}

export function copyFee(input: {
  rateBps: string;
  probation: "PROBATION" | "GRADUATED";
  conductLevel?: ConductLevel;
  /** False on Flash's public playground key: its fees go to that shared account, never PACT's. */
  ownIntegratorKey?: boolean;
}): CopyFee {
  const waivedFor: FeeWaiver[] = [];
  if (!(Number(input.rateBps) > 0)) waivedFor.push("FEE_OFF");
  else if (input.ownIntegratorKey === false) waivedFor.push("NO_INTEGRATOR_ACCOUNT");
  if (input.probation === "PROBATION") waivedFor.push("LEADER_ON_PROBATION");
  if (input.conductLevel === "caution") waivedFor.push("LEADER_CONDUCT_CAUTION");
  if (input.conductLevel === "alert") waivedFor.push("LEADER_CONDUCT_ALERT");
  const charged = waivedFor.length === 0;
  return { bps: charged ? input.rateBps : "0", charged, rateBps: input.rateBps, waivedFor };
}

/** "0.10% (10 bps)" */
export function formatBps(bps: string | number) {
  const n = Number(bps);
  return `${(n / 100).toFixed(2)}% (${n} bps)`;
}

/** One sentence for the follower: what PACT charges on this copy and why. */
export function feeSentence(fee: CopyFee) {
  if (fee.charged) return `PACT's fee: ${formatBps(fee.bps)}, collected by Flash when the copy fills.`;
  const why = fee.waivedFor.filter((w) => w !== "FEE_OFF").map((w) => FEE_WAIVER_LABEL[w]);
  if (!why.length) return "No PACT fee on this copy.";
  return `No PACT fee on this copy: ${why.join(" and ")}.`;
}
