import { createPublicClient, http, type Hex } from "viem";
import { base } from "viem/chains";
import type { TokenTransfer, TxFacts } from "./leader-evidence";

/**
 * L0 adapter for Base RPC. Reads transaction receipts and decodes ERC-20 `Transfer` logs; no
 * interpretation (that is lib/leader-evidence). "Final" means the block is at or below Base's
 * `finalized` block, so a reorg cannot undo it.
 */

export const baseClient = createPublicClient({
  chain: base,
  transport: http(process.env.EVM_RPC_URL || process.env.NEXT_PUBLIC_EVM_RPC_URL || "https://mainnet.base.org"),
});

/**
 * Log reads (eth_getLogs) need an endpoint that serves them: mainnet.base.org rate-limits
 * them to nothing. publicnode serves six-hour Base ranges for free; BASE_LOGS_RPC_URL overrides.
 */
export const logsClient = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_LOGS_RPC_URL || "https://base-rpc.publicnode.com"),
});

type Client = Pick<typeof baseClient, "getTransactionReceipt" | "getBlock">;

/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const topicAddress = (topic?: string) => (topic ? (`0x${topic.slice(-40)}` as const) : undefined);

export function decodeTransfers(logs: { address: string; topics: readonly string[]; data: string }[]): TokenTransfer[] {
  const out: TokenTransfer[] = [];
  for (const log of logs) {
    // ERC-20 Transfer has exactly three topics; ERC-721 has four (the token id is indexed).
    if (log.topics[0] !== TRANSFER_TOPIC || log.topics.length !== 3) continue;
    const from = topicAddress(log.topics[1]);
    const to = topicAddress(log.topics[2]);
    if (!from || !to || !log.data || log.data === "0x") continue;
    out.push({ token: log.address.toLowerCase(), from, to, value: BigInt(log.data) });
  }
  return out;
}

let finalizedCache: { at: number; number: bigint } | undefined;

async function finalizedBlock(client: Client, nowMs: number) {
  if (finalizedCache && nowMs - finalizedCache.at < 10_000) return finalizedCache.number;
  const block = await client.getBlock({ blockTag: "finalized" });
  finalizedCache = { at: nowMs, number: block.number };
  return block.number;
}

export async function readTx(hash: string, client: Client = baseClient, nowMs = Date.now()): Promise<TxFacts> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return { hash, status: "missing", finalized: false, transfers: [] };
  let receipt: Awaited<ReturnType<Client["getTransactionReceipt"]>>;
  try {
    receipt = await client.getTransactionReceipt({ hash: hash as Hex });
  } catch {
    return { hash, status: "missing", finalized: false, transfers: [] };
  }
  const [block, finalized] = await Promise.all([
    client.getBlock({ blockNumber: receipt.blockNumber }),
    finalizedBlock(client, nowMs).catch(() => undefined),
  ]);
  return {
    hash: hash.toLowerCase(),
    status: receipt.status === "success" ? "success" : "reverted",
    blockNumber: receipt.blockNumber,
    timestamp: Number(block.timestamp),
    finalized: finalized !== undefined && receipt.blockNumber <= finalized,
    transfers: decodeTransfers(receipt.logs),
  };
}

/** Base produces a block every 2 seconds. */
const BLOCK_S = 2;
/** Public RPCs cap log ranges; six hours of Base blocks stays well inside. */
const MAX_WINDOW_BLOCKS = 10_800;

/**
 * ERC-20 `token` leaving `owner` on Base between two times: every Transfer whose `from` is the
 * owner. A sale on any Base venue (Flash, an AMM, an aggregator) shows up here; so does a plain
 * transfer to another wallet. Times are derived from block numbers (2 s blocks).
 */
export async function tokenOutflows(
  owner: string,
  token: string,
  fromMs: number,
  toMs: number,
  decimals = 18,
  client: Pick<typeof baseClient, "getBlock" | "getLogs"> = logsClient,
): Promise<{ at: number; units: number; tx: string }[]> {
  const head = await client.getBlock({ blockTag: "latest" });
  const headNo = head.number;
  const headS = Number(head.timestamp);
  const blockAt = (ms: number) => headNo - BigInt(Math.max(0, Math.ceil((headS - ms / 1000) / BLOCK_S)));
  let fromBlock = blockAt(fromMs) - BigInt(5);
  const toBlock = toMs >= headS * 1000 ? headNo : blockAt(toMs) + BigInt(5);
  if (toBlock < fromBlock) return [];
  if (toBlock - fromBlock > BigInt(MAX_WINDOW_BLOCKS)) fromBlock = toBlock - BigInt(MAX_WINDOW_BLOCKS);
  const logs = await client.getLogs({
    address: token as Hex,
    event: {
      type: "event",
      name: "Transfer",
      inputs: [
        { type: "address", name: "from", indexed: true },
        { type: "address", name: "to", indexed: true },
        { type: "uint256", name: "value", indexed: false },
      ],
    },
    args: { from: owner as Hex },
    fromBlock,
    toBlock,
  });
  return logs.map((l) => ({
    at: (headS - Number(headNo - (l.blockNumber ?? headNo)) * BLOCK_S) * 1000,
    units: Number(l.args.value ?? BigInt(0)) / 10 ** decimals,
    tx: l.transactionHash ?? "",
  }));
}
