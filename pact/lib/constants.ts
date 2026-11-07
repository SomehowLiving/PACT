import { CHAINS } from "./chains";
import type { Policy } from "./types";

export const WETH =
  "0x4200000000000000000000000000000000000006" as const;
export const USDC =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

export const PAIR_KEY = `${WETH.toLowerCase()}:${USDC.toLowerCase()}`;
export const ARC_PAIR_KEY = `${CHAINS.arc.weth.toLowerCase()}:${CHAINS.arc.usdc.toLowerCase()}`;

/** Most leaders one follower can select. Each gets its own mandate and daily sleeve. */
export const MAX_LEADERS = 10;

export const FLASH_BASE = "https://flash.definitive.fi/v1";
/** Flash's documented public playground key: fine for testing, shared with every other user. */
export const PLAYGROUND_KEY_PREFIX = "dpka_513a2bd7";
export const BASESCAN_TX = "https://basescan.org/tx/";

export function defaultPolicy(follower: `0x${string}`): Policy {
  return {
    follower,
    chain: "base",
    allowChains: ["base"],
    maxNotionalUsd: 30,
    maxDailyUsd: 50,
    minNotionalUsd: 5,
    allowModify: true,
    allowPairs: [PAIR_KEY, ARC_PAIR_KEY],
    allowOrderTypes: ["twap", "limit"],
    allowSides: ["buy"],
    maxSlippage: "0.01",
    maxPriceImpact: "0.005",
    copyRatio: 0.25,
    riskBudgetUsd: 2,
    automationMode: "REVIEW",
    maxLeaderDailyUsd: 25,
    maxLeaderDailyRealizedLossUsd: 10,
    maxAssetExposureUsd: 35,
    maxOpenPlans: 3,
    maxOpenPlansPerLeader: 1,
    maxEntryDrift: "0.01",
    maxExecutionCost: "0.03",
    requirePlanProtection: true,
    requireLeaderPlanQuality: false,
    requireLeaderExecutionEvidence: false,
    enableLeaderLossCircuitBreaker: false,
    minRewardRisk: 1.5,
    follows: [],
    mandates: [],
  };
}

/**
 * Limit and trigger orders rest until they fire. Flash wants an explicit end time on them:
 * without one, the shared Permit2 permit for the wallet and token never expires.
 */
export const RESTING_ORDER_SECONDS = 7 * 86_400;
