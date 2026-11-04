import { CHAINS } from "./chains";
import type { Policy } from "./types";

export const WETH =
  "0x4200000000000000000000000000000000000006" as const;
export const USDC =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

export const PAIR_KEY = `${WETH.toLowerCase()}:${USDC.toLowerCase()}`;
export const ARC_PAIR_KEY = `${CHAINS.arc.weth.toLowerCase()}:${CHAINS.arc.usdc.toLowerCase()}`;

export const FLASH_BASE = "https://flash.definitive.fi/v1";
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
    maxSlippage: "0.05",
    maxPriceImpact: "0.05",
  };
}

export const INTEGRATOR_FEE_BPS = "0";
