import { parseAbi } from "viem";
import { baseClient } from "./base-rpc";

/**
 * L0 adapter: an independent reference price for ETH/USD, read on chain. Chainlink's ETH/USD
 * feed on Base needs no API key (Pyth's Hermes has required one since 26 Aug 2026). Chainlink
 * updates on a 0.15% move or a heartbeat, so it can lag the market by up to ~0.15%: fine as a
 * reference for a 1% divergence check, not as an execution price.
 */

export const CHAINLINK_ETH_USD_BASE = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70" as const;
/** Base ETH/USD heartbeat is 20 minutes; older than this the feed is treated as unavailable. */
export const ORACLE_MAX_AGE_S = 25 * 60;
export const ORACLE_DEVIATION = 0.0015;

const abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

export type OraclePrice = { price: number; updatedAt: string; source: "chainlink-base-eth-usd" };

let cache: { at: number; value: OraclePrice } | undefined;

export async function ethUsdReference(nowMs = Date.now()): Promise<OraclePrice> {
  if (cache && nowMs - cache.at < 15_000) return cache.value;
  const [decimals, round] = await Promise.all([
    baseClient.readContract({ address: CHAINLINK_ETH_USD_BASE, abi, functionName: "decimals" }),
    baseClient.readContract({ address: CHAINLINK_ETH_USD_BASE, abi, functionName: "latestRoundData" }),
  ]);
  const value: OraclePrice = {
    price: Number(round[1]) / 10 ** decimals,
    updatedAt: new Date(Number(round[3]) * 1000).toISOString(),
    source: "chainlink-base-eth-usd",
  };
  cache = { at: nowMs, value };
  return value;
}
