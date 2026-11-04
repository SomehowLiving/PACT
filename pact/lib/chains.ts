import type { Chain } from "./types";

export type ChainConfig = {
  id: number;
  name: string;
  usdc: `0x${string}`;
  weth: `0x${string}`;
  explorerTx: string;
};

export const CHAINS: Record<Chain, ChainConfig> = {
  base: {
    id: 8453,
    name: "Base",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    weth: "0x4200000000000000000000000000000000000006",
    explorerTx: "https://basescan.org/tx/",
  },
  // Flash lists Arc as chain 5042. Token addresses come from Flash /search (Oct 2026).
  arc: {
    id: 5042,
    name: "Arc",
    usdc: "0x3600000000000000000000000000000000000000",
    weth: "0x128cc466b61f542da60c70e3aa11c10e19b84edb",
    explorerTx: "https://explorer.arc.io/tx/",
  },
};

export const CHAIN_IDS = Object.keys(CHAINS) as Chain[];

// Canonical Permit2 (same address on every chain Flash supports).
export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
// Flash allowance contract that verifies FlashOrder signatures and spends the Permit2 permit.
export const FLASH_SPENDER = "0x5d00000873b6BF41539e6f5365B0Ff7d3c368f78" as const;

export function tokenDecimals(chain: Chain, token: string): number | undefined {
  const t = token.toLowerCase();
  const c = CHAINS[chain];
  if (t === c.usdc.toLowerCase()) return 6;
  if (t === c.weth.toLowerCase()) return 18;
  return undefined;
}
