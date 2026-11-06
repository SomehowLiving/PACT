import { erc20Abi, formatUnits, type Hex } from "viem";
import { baseClient, logsClient } from "./base-rpc";
import { USDC, WETH } from "./constants";
import { isDemoAddress } from "./views";

/*
 * A wallet's real facts on Base, read from chain (L0, no interpretation): balances, how many
 * transactions it has sent, whether it is a contract, and how much USDC and WETH moved in and
 * out over the last few hours. Shown for every leader; DEMO addresses are not read.
 */

export const FLOW_WINDOW_HOURS = 6;
const BLOCK_S = 2;
const CACHE_MS = 120_000;

export type Flow = { in: number; out: number; transfers: number };
export type WalletFacts = {
  address: string;
  chain: "base";
  demo: false;
  readAt: string;
  isContract: boolean;
  /** Transactions this address has sent (its nonce). */
  txCount: number;
  eth: number;
  usdc: number;
  weth: number;
  windowHours: number;
  /** Undefined when the log endpoint did not answer: unknown, not zero. */
  flows?: { usdc: Flow; weth: Flow };
  lastActivityAt?: string;
};
export type DemoWallet = { address: string; demo: true };

const TRANSFER = {
  type: "event",
  name: "Transfer",
  inputs: [
    { type: "address", name: "from", indexed: true },
    { type: "address", name: "to", indexed: true },
    { type: "uint256", name: "value", indexed: false },
  ],
} as const;

const cache = new Map<string, { at: number; value: WalletFacts }>();

async function flow(token: Hex, owner: Hex, decimals: number, fromBlock: bigint, toBlock: bigint) {
  const [outs, ins] = await Promise.all([
    logsClient.getLogs({ address: token, event: TRANSFER, args: { from: owner }, fromBlock, toBlock }),
    logsClient.getLogs({ address: token, event: TRANSFER, args: { to: owner }, fromBlock, toBlock }),
  ]);
  const sum = (ls: typeof outs) => ls.reduce((s, l) => s + Number(formatUnits(l.args.value ?? BigInt(0), decimals)), 0);
  const last = [...outs, ...ins].reduce((m, l) => (l.blockNumber && l.blockNumber > m ? l.blockNumber : m), BigInt(0));
  return { flow: { in: sum(ins), out: sum(outs), transfers: outs.length + ins.length }, last };
}

export async function walletFacts(address: string, nowMs = Date.now()): Promise<WalletFacts | DemoWallet> {
  const key = address.toLowerCase();
  if (isDemoAddress(key)) return { address: key, demo: true };
  const hit = cache.get(key);
  if (hit && nowMs - hit.at < CACHE_MS) return hit.value;
  const owner = key as Hex;
  const [code, txCount, eth, usdc, weth] = await Promise.all([
    baseClient.getCode({ address: owner }),
    baseClient.getTransactionCount({ address: owner }),
    baseClient.getBalance({ address: owner }),
    baseClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    baseClient.readContract({ address: WETH, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
  ]);
  let flows: WalletFacts["flows"];
  let lastActivityAt: string | undefined;
  try {
    const head = await logsClient.getBlock({ blockTag: "latest" });
    const fromBlock = head.number - BigInt((FLOW_WINDOW_HOURS * 3600) / BLOCK_S);
    const [u, w] = await Promise.all([flow(USDC, owner, 6, fromBlock, head.number), flow(WETH, owner, 18, fromBlock, head.number)]);
    flows = { usdc: u.flow, weth: w.flow };
    const last = u.last > w.last ? u.last : w.last;
    if (last > BigInt(0)) lastActivityAt = new Date((Number(head.timestamp) - Number(head.number - last) * BLOCK_S) * 1000).toISOString();
  } catch {
    // Log endpoint unavailable: balances still show, flows stay unknown.
  }
  const value: WalletFacts = {
    address: key,
    chain: "base",
    demo: false,
    readAt: new Date(nowMs).toISOString(),
    isContract: !!code && code !== "0x",
    txCount,
    eth: Number(formatUnits(eth, 18)),
    usdc: Number(formatUnits(usdc, 6)),
    weth: Number(formatUnits(weth, 18)),
    windowHours: FLOW_WINDOW_HOURS,
    flows,
    lastActivityAt,
  };
  cache.set(key, { at: nowMs, value });
  return value;
}
