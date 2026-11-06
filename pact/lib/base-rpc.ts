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
