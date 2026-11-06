import { fillExecutionMetrics, getOrder, type FlashOrder, type FlashOrderDetail } from "./flash";
import { patchReceipt, snapshot } from "./store";
import type { Receipt } from "./types";
import { protectionFrom } from "./verdict";

export { protectionFrom, receiptVerdict, type VerdictLine } from "./verdict";

/* Server-side receipt refresh, shared by the order-status and evidence routes. Reads Flash's
   own report for the entry and, once active, the protection pair's protective order. */

/** Flash returns 404 for a just-submitted order for a few seconds. */
const JUST_SUBMITTED_MS = 15_000;

export type RefreshResult =
  | { ok: true; receipt: Receipt; detail: FlashOrderDetail; protectionOrder?: FlashOrder }
  | { ok: false; pending: true; receipt: Receipt }
  | { ok: false; pending?: false; receipt: Receipt; error: string; status?: number };

export async function refreshReceipt(receipt: Receipt): Promise<RefreshResult> {
  if (!receipt.flashOrderId) return { ok: false, receipt, error: "no Flash order on this receipt" };
  const state = snapshot();
  const proposal = state.proposals.find((p) => p.id === receipt.proposalId);
  const quote = state.quotes[receipt.proposalId];

  let detail: FlashOrderDetail;
  try {
    detail = await getOrder(receipt.flashOrderId, receipt.follower);
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 404 && Date.now() - Date.parse(receipt.createdAt) < JUST_SUBMITTED_MS) {
      return { ok: false, pending: true, receipt };
    }
    return { ok: false, receipt, error: e instanceof Error ? e.message : "get order failed", status };
  }

  const order = detail.order;
  const fills = detail.fills ?? [];
  const metrics = fillExecutionMetrics({ filled: order.filled, fills }, proposal?.side ?? "buy", receipt.declaredEntryPrice);

  let protection = protectionFrom(order, quote?.attachedBracket, receipt.protection);
  let protectionOrder: FlashOrder | undefined;
  if (protection?.bracketOrderId) {
    try {
      protectionOrder = (await getOrder(protection.bracketOrderId, receipt.follower)).order;
      protection = {
        ...protection,
        orderStatus: protectionOrder.status ?? protection.orderStatus,
        closeReason: protectionOrder.closeReason ?? protection.closeReason,
      };
    } catch {
      /* keep the last known protection state */
    }
  }

  const updated =
    patchReceipt(receipt.proposalId, {
      status: order.status,
      closeReason: order.closeReason ?? undefined,
      transactionId: fills.find((f) => f.transactionId)?.transactionId,
      fills: fills.map((f) => ({
        transactionId: f.transactionId,
        fillPrice: f.fillPrice,
        notional: f.notional,
        filledAt: f.filledAt,
      })),
      completedFillCount: metrics.finalFillCount,
      finalFillCount: metrics.finalFillCount,
      pendingFillCount: metrics.pendingFillCount,
      twapBucketCount: order.twapBucketCount ?? undefined,
      averageFillPrice: metrics.averageFillPrice,
      entryDriftBps: metrics.entryDriftBps,
      feesUsd: metrics.feesUsd,
      protection,
    }) ?? receipt;

  return { ok: true, receipt: updated, detail, protectionOrder };
}

export { stillLive } from "./views";
