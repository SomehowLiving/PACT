import type { FlashOrder } from "./flash";
import type { Protection, Receipt, StoredQuote } from "./types";

/* Browser-safe receipt logic: protection read-back and the MATCH / MISMATCH verdict.
   Shared by the server refresh (lib/receipts.ts) and the Execution page. */

function same(a?: string | null, b?: string | null) {
  const x = Number(a);
  const y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && x > 0 && Math.abs(x - y) < 1e-9 * Math.max(1, x);
}

/** Builds the protection record from Flash's `order.attachedBracket` and the levels chosen at review. */
export function protectionFrom(
  order: Pick<FlashOrder, "attachedBracket">,
  intended?: StoredQuote["attachedBracket"],
  previous?: Protection,
): Protection | undefined {
  const read = order.attachedBracket;
  const intendedTakeProfit = intended?.bracket.takeProfit.notionalPrice ?? previous?.intendedTakeProfit;
  const intendedStopLoss = intended?.bracket.stopLoss.notionalPrice ?? previous?.intendedStopLoss;
  if (!read && !intendedTakeProfit && !previous) return undefined;
  const takeProfit = read?.takeProfit?.notionalPrice ?? undefined;
  const stopLoss = read?.stopLoss?.notionalPrice ?? undefined;
  const levelsMatch =
    takeProfit !== undefined || stopLoss !== undefined
      ? same(takeProfit, intendedTakeProfit) && same(stopLoss, intendedStopLoss)
      : undefined;
  return {
    ...previous,
    status: read?.status ?? previous?.status,
    bracketOrderId: read?.bracketOrderId ?? previous?.bracketOrderId,
    expiresAt: read?.expiresAt ?? previous?.expiresAt,
    intendedTakeProfit,
    intendedStopLoss,
    takeProfit,
    stopLoss,
    levelsMatch,
  };
}

export type VerdictLine = { id: string; label: string; result: "MATCH" | "MISMATCH" | "PENDING" | "N/A"; detail: string };

/**
 * Receipt verdict: each promise PACT made before signing, checked against Flash's own report.
 * MISMATCH is a visible failure, never hidden. PENDING means there is nothing final to judge yet.
 */
export function receiptVerdict(input: {
  side: "buy" | "sell";
  follower: string;
  receipt: Pick<Receipt, "averageFillPrice" | "feesUsd" | "quotedFeeUsd" | "finalFillCount" | "protection">;
  quote?: Pick<StoredQuote, "effectiveLimitNotionalPrice">;
  order?: Pick<FlashOrder, "recipientAddress" | "integratorFeeBps">;
  integratorFeeBps: string;
}): { overall: "MATCH" | "MISMATCH" | "PENDING"; lines: VerdictLine[] } {
  const lines: VerdictLine[] = [];
  const avg = Number(input.receipt.averageFillPrice);
  const bound = Number(input.quote?.effectiveLimitNotionalPrice);
  const filled = (input.receipt.finalFillCount ?? 0) > 0 && avg > 0;

  if (!(bound > 0)) {
    lines.push({ id: "price.bound", label: "Fill within your price bound", result: "N/A", detail: "no bound on this order type" });
  } else if (!filled) {
    lines.push({ id: "price.bound", label: "Fill within your price bound", result: "PENDING", detail: "no finalised fills yet" });
  } else {
    const ok = input.side === "buy" ? avg <= bound * (1 + 1e-6) : avg >= bound * (1 - 1e-6);
    lines.push({
      id: "price.bound",
      label: "Fill within your price bound",
      result: ok ? "MATCH" : "MISMATCH",
      detail: `average ${avg.toFixed(2)} vs ${input.side === "buy" ? "max" : "min"} ${bound.toFixed(2)}`,
    });
  }

  const quotedFee = Number(input.receipt.quotedFeeUsd);
  const fees = input.receipt.feesUsd;
  if (!filled || fees === undefined) {
    lines.push({ id: "fees", label: "Fees as quoted", result: "PENDING", detail: "no finalised fills yet" });
  } else if (!(quotedFee > 0)) {
    lines.push({ id: "fees", label: "Fees as quoted", result: "N/A", detail: `paid $${fees.toFixed(4)}; no quoted estimate stored` });
  } else {
    // Estimates are not exact (network fee moves); allow 50% over before calling it a mismatch.
    const ok = fees <= quotedFee * 1.5 + 0.01;
    lines.push({
      id: "fees",
      label: "Fees as quoted",
      result: ok ? "MATCH" : "MISMATCH",
      detail: `paid $${fees.toFixed(4)} vs quoted $${quotedFee.toFixed(4)}`,
    });
  }

  if (input.order) {
    const recipient = input.order.recipientAddress ?? input.follower;
    lines.push({
      id: "recipient",
      label: "Proceeds went to you",
      result: recipient.toLowerCase() === input.follower.toLowerCase() ? "MATCH" : "MISMATCH",
      detail: `recipient ${recipient}`,
    });
    const expected = Number(input.integratorFeeBps) > 0 ? input.integratorFeeBps : null;
    const actual = input.order.integratorFeeBps ?? null;
    lines.push({
      id: "integrator.fee",
      label: "PACT fee as disclosed",
      result: String(actual ?? "0") === String(expected ?? "0") ? "MATCH" : "MISMATCH",
      detail: `charged ${actual ?? "0"} bps, disclosed ${expected ?? "0"} bps`,
    });
  }

  const p = input.receipt.protection;
  if (!p?.intendedTakeProfit) {
    lines.push({ id: "protection", label: "Protection levels as chosen", result: "N/A", detail: "no protection on this order" });
  } else if (p.levelsMatch === undefined) {
    lines.push({ id: "protection", label: "Protection levels as chosen", result: "PENDING", detail: `pair ${p.status ?? "not reported yet"}` });
  } else {
    lines.push({
      id: "protection",
      label: "Protection levels as chosen",
      result: p.levelsMatch ? "MATCH" : "MISMATCH",
      detail: `live TP ${p.takeProfit ?? "?"} / SL ${p.stopLoss ?? "?"} vs chosen ${p.intendedTakeProfit} / ${p.intendedStopLoss}`,
    });
  }

  const overall = lines.some((l) => l.result === "MISMATCH")
    ? "MISMATCH"
    : lines.some((l) => l.result === "PENDING")
      ? "PENDING"
      : "MATCH";
  return { overall, lines };
}

