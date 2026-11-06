import { readTx } from "./base-rpc";
import { getOrder, REORGED_FILL, type FlashOrderDetail } from "./flash";
import { assessOnchain, combineEvidence, matchFlashOrder, type LeaderOrder, type PlanFacts, type TxFacts } from "./leader-evidence";
import type { LeaderEvidence } from "./types";

/**
 * Gathers a leader's execution facts (Flash's order record, Base transactions) and runs the
 * pure checks in lib/leader-evidence. Read-only towards Flash and the chain.
 */

export const MAX_EVIDENCE_TXS = 20;

export type VerifyDeps = {
  getOrder: (id: string, funder: string) => Promise<FlashOrderDetail>;
  readTx: (hash: string) => Promise<TxFacts>;
  nowMs?: number;
};

const defaults: VerifyDeps = { getOrder, readTx: (h) => readTx(h) };

export function normalizeTxHashes(input?: string[] | string): string[] | null {
  const list = (Array.isArray(input) ? input : (input ?? "").split(/[\s,]+/)).map((h) => h.trim()).filter(Boolean);
  if (list.some((h) => !/^0x[0-9a-fA-F]{64}$/.test(h))) return null;
  return [...new Set(list.map((h) => h.toLowerCase()))].slice(0, MAX_EVIDENCE_TXS);
}

export async function verifyLeader(
  plan: PlanFacts,
  input: { flashOrderId?: string; txHashes?: string[] },
  usedBy: Map<string, string>,
  deps: Partial<VerifyDeps> = {},
): Promise<LeaderEvidence> {
  const d = { ...defaults, ...deps };
  let order: ReturnType<typeof matchFlashOrder> | undefined;
  let orderLookupFailed: string | undefined;
  const fillTxs: string[] = [];
  if (input.flashOrderId) {
    try {
      const detail = await d.getOrder(input.flashOrderId, plan.leader);
      order = matchFlashOrder(plan, detail.order as LeaderOrder);
      for (const f of detail.fills ?? []) {
        if (f.transactionId && f.status !== REORGED_FILL) fillTxs.push(f.transactionId.toLowerCase());
      }
    } catch (e) {
      orderLookupFailed = `Flash has no order ${input.flashOrderId} for this wallet (${e instanceof Error ? e.message : "lookup failed"})`;
    }
  }
  const hashes = [...new Set([...(input.txHashes ?? []), ...fillTxs])].slice(0, MAX_EVIDENCE_TXS);
  const txs = await Promise.all(hashes.map((h) => d.readTx(h)));
  const onchain = txs.length ? assessOnchain(plan, txs, usedBy) : undefined;
  return combineEvidence({
    nowMs: d.nowMs,
    flashOrderId: input.flashOrderId,
    txHashes: hashes,
    order,
    onchain,
    orderLookupFailed,
  });
}
