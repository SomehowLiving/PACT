import { FLASH_BASE, INTEGRATOR_FEE_BPS, RESTING_ORDER_SECONDS } from "./constants";
import { batchCancelMessage, cancelMessage } from "./typed";
import type { AttachedBracket, Chain, OrderType, Side, Trigger } from "./types";

function key() {
  const k = process.env.FLASH_API_KEY;
  if (!k) throw new Error("FLASH_API_KEY missing");
  return k;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function flash<T>(path: string, init?: RequestInit): Promise<T> {
  // Reads may retry on 429 (Flash allows 5 req/s per endpoint per key). Writes never retry:
  // a POST /order can create an order even when it returns an error.
  const isRead = !init?.method || init.method === "GET";
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`${FLASH_BASE}${path}`, {
      ...init,
      headers: {
        "x-definitive-api-key": key(),
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    if (res.status !== 429 || !isRead || attempt >= 2) break;
    const reset = Number(res.headers.get("ratelimit-reset"));
    await sleep(Number.isFinite(reset) && reset > 0 ? Math.min(reset, 5) * 1000 : 1_000 * (attempt + 1));
  }
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* raw */
  }
  if (!res.ok) {
    const detail =
      (body as { error?: { message?: string } } | null)?.error?.message ?? text.slice(0, 400);
    const err = new Error(`Flash ${res.status} ${path}: ${detail}`);
    (err as Error & { status: number; body: unknown }).status = res.status;
    (err as Error & { status: number; body: unknown }).body = body;
    throw err;
  }
  return body as T;
}

export type QuoteBody = {
  targetChain: Chain;
  contraChain: Chain;
  targetAsset: string;
  contraAsset: string;
  side: Side;
  qty: string;
  orderType: OrderType;
  funderAddress: string;
  durationSeconds?: number;
  twapBucketCount?: number;
  startTime?: string;
  /** ISO end time. Resting orders only: Flash rejects it on TWAP and market orders. */
  expireTime?: string;
  limitNotionalPrice?: string;
  /** Pair-rate limit (contra per target). Required instead of notional on a limit + attached bracket. */
  limitCrossPrice?: string;
  triggers?: Trigger[];
  attachedBracket?: AttachedBracket;
  maxSlippage?: string;
  maxPriceImpact?: string;
  forceMinimalAllowance: true;
  evmUsePermit2: true;
  flashIntegratorFeeBps?: string;
};

function maybeFeeBps() {
  const n = Number(INTEGRATOR_FEE_BPS);
  if (Number.isFinite(n) && n > 0) return { flashIntegratorFeeBps: INTEGRATOR_FEE_BPS };
  return {};
}

export type FlashQuote = {
  quoteId: string;
  estimatedPriceImpact?: string;
  evm?: {
    orderTypedData?: string;
    approveTx?: { to: string; data: string; value?: string };
    permitTypedData?: string;
  };
  attachedBracket?: {
    salt?: string;
    deadline?: string;
    signedMaxFromAmount?: string;
    evm?: {
      orderTypedData?: string;
      approveTx?: { to: string; data: string; value?: string };
      permitTypedData?: string;
    };
  };
  from?: { notional?: string; amount?: string; symbol?: string };
  to?: { notional?: string; amount?: string; symbol?: string };
  /** Total estimated fee in USD: Definitive platform fee + network fee + integrator fee. */
  fees?: { estimatedFeeNotional?: string };
};

const num = (v?: string | null) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Quote metrics. Two different prices, kept apart on purpose:
 * - `executionPrice` is the market price of the target asset (what Flash's limit price bounds),
 *   used for entry drift.
 * - `allInPrice` is what the follower actually pays per target unit including fees (buys:
 *   USD spent ÷ target received; sells: USD received ÷ target sold), used for disclosure.
 * Fees are a separate cost line (`feeNotional`, `costRatio`), checked against their own budget.
 */
export function executionMetrics(quote: FlashQuote, side: Side) {
  const buy = side === "buy";
  const pricedAsset = buy ? quote.to : quote.from;
  const pricedNotional = num(pricedAsset?.notional);
  const pricedAmount = num(pricedAsset?.amount);
  const fromAmount = num(quote.from?.amount);
  const toAmount = num(quote.to?.amount);
  const fromNotional = num(quote.from?.notional);
  const toNotional = num(quote.to?.notional);
  const feeNotional = num(quote.fees?.estimatedFeeNotional);

  const executionPrice =
    pricedNotional && pricedNotional > 0 && pricedAmount && pricedAmount > 0
      ? pricedNotional / pricedAmount
      : fromAmount && fromAmount > 0 && toAmount && toAmount > 0
        ? buy
          ? fromAmount / toAmount
          : toAmount / fromAmount
        : undefined;

  // Buys: `to` is already net of fees, so USD spent ÷ WETH received is the all-in price.
  // Sells: the integrator fee is not taken out of `to`, so subtract the estimated fee.
  const allInPrice = buy
    ? fromNotional && toAmount && toAmount > 0
      ? fromNotional / toAmount
      : undefined
    : toNotional !== undefined && fromAmount && fromAmount > 0
      ? (toNotional - (feeNotional ?? 0)) / fromAmount
      : undefined;
  const sizeUsd = buy ? fromNotional : toNotional;
  const costRatio = feeNotional !== undefined && sizeUsd && sizeUsd > 0 ? feeNotional / sizeUsd : undefined;

  return {
    estimatedPriceImpact: quote.estimatedPriceImpact,
    executionPrice: executionPrice?.toString(),
    allInPrice: allInPrice?.toString(),
    feeNotional: feeNotional?.toString(),
    costRatio: costRatio?.toString(),
  };
}

/** Fill statuses Flash reports. Only finalised fills are execution facts. */
export const FINAL_FILL = "CHAIN_STATUS_FINALIZED";
export const REORGED_FILL = "CHAIN_STATUS_REORGED";

/**
 * Execution metrics from Flash's own report. Never uses `fillPrice` (spent-per-received, so it
 * is inverted on sells). Prefers Flash's `filled.averageNotionalPrice`; otherwise derives the
 * price from finalised fills' contra ÷ target amounts. Reorged fills are ignored, unconfirmed
 * fills are counted as pending.
 */
export function fillExecutionMetrics(
  report: { filled?: FlashOrderFilled | null; fills?: FlashFillRow[] },
  side: Side,
  declaredEntryPrice?: string,
) {
  const fills = (report.fills ?? []).filter((fill) => fill.status !== REORGED_FILL);
  const final = fills.filter((fill) => !fill.status || fill.status === FINAL_FILL);
  const pendingFillCount = fills.length - final.length;

  const target = final.reduce((sum, fill) => sum + (num(fill.targetAmount) ?? 0), 0);
  const contra = final.reduce((sum, fill) => sum + (num(fill.contraAmount) ?? 0), 0);
  const reported = num(report.filled?.averageNotionalPrice);
  const averageFillPrice = reported && reported > 0 ? reported : target > 0 && contra > 0 ? contra / target : undefined;

  const sum = (key: keyof FlashFillRow) => {
    const values = final.map((fill) => num(fill[key] as string | undefined)).filter((v): v is number => v !== undefined);
    return values.length ? values.reduce((a, b) => a + b, 0) : undefined;
  };
  const entry = num(declaredEntryPrice);
  const entryDriftBps =
    averageFillPrice !== undefined && entry && entry > 0
      ? ((side === "buy" ? averageFillPrice - entry : entry - averageFillPrice) / entry) * 10_000
      : undefined;

  return {
    averageFillPrice: averageFillPrice?.toString(),
    entryDriftBps,
    finalFillCount: final.length,
    pendingFillCount,
    feesUsd: sum("feeNotional"),
    networkFeesUsd: sum("networkFeeNotional"),
    tradeFeesUsd: sum("tradeFeeNotional"),
    integratorFeesUsd: sum("integratorFeeNotional"),
  };
}

export function quoteRequest(
  input: Omit<
    QuoteBody,
    "forceMinimalAllowance" | "evmUsePermit2" | "flashIntegratorFeeBps" | "targetChain" | "contraChain" | "expireTime"
  > & {
    chain?: Chain;
    nowMs?: number;
    /** End of the leader's copy window. A resting copy must not outlive the plan it copies. */
    planExpiresAt?: string;
  },
): QuoteBody {
  const chain = input.chain ?? "base";
  const now = input.nowMs ?? Date.now();
  const maxRest = now + RESTING_ORDER_SECONDS * 1000;
  const planEnd = Date.parse(input.planExpiresAt ?? "");
  const expireTime = new Date(
    Number.isFinite(planEnd) && planEnd > now ? Math.min(planEnd, maxRest) : maxRest,
  ).toISOString();
  const body: QuoteBody = {
    targetChain: chain,
    contraChain: chain,
    targetAsset: input.targetAsset,
    contraAsset: input.contraAsset,
    side: input.side,
    qty: input.qty,
    orderType: input.orderType,
    funderAddress: input.funderAddress,
    forceMinimalAllowance: true,
    evmUsePermit2: true,
    ...maybeFeeBps(),
  };
  if (input.orderType === "twap") {
    body.durationSeconds = input.durationSeconds ?? 600;
    // The copy's TWAP must finish inside the leader's copy window.
    if (Number.isFinite(planEnd) && planEnd > now) {
      const start = Date.parse(input.startTime ?? "");
      const begin = Number.isFinite(start) && start > now ? start : now;
      const room = Math.floor((planEnd - begin) / 1000);
      if (room < 300) throw new Error("plan window ends before a 5-minute TWAP could finish");
      body.durationSeconds = Math.min(body.durationSeconds, room);
    }
    if (body.durationSeconds < 300) {
      throw new Error("TWAP durationSeconds must be at least 300 seconds");
    }
    if (input.twapBucketCount !== undefined) {
      if (!Number.isInteger(input.twapBucketCount) || input.twapBucketCount < 2 || input.twapBucketCount > 2560) {
        throw new Error("TWAP twapBucketCount must be an integer from 2 to 2560");
      }
      body.twapBucketCount = input.twapBucketCount;
    }
    if (input.startTime) body.startTime = input.startTime;
    if (input.limitNotionalPrice) body.limitNotionalPrice = input.limitNotionalPrice;
    body.maxPriceImpact = input.maxPriceImpact ?? "0.005";
  }
  if (input.attachedBracket) {
    if (!["market", "limit", "twap"].includes(input.orderType)) {
      throw new Error("attached brackets require a market, limit, or TWAP entry order");
    }
    body.attachedBracket = input.attachedBracket;
  }
  if (input.orderType === "market") {
    body.maxSlippage = input.maxSlippage ?? "0.01";
  }
  if (input.orderType === "limit") {
    if (input.limitNotionalPrice) {
      // Flash v1 rejects limitNotionalPrice on a limit entry that carries an attached bracket
      // and requires the pair rate instead. With USDC as contra the two are the same number.
      if (input.attachedBracket) body.limitCrossPrice = input.limitNotionalPrice;
      else body.limitNotionalPrice = input.limitNotionalPrice;
    }
    body.maxPriceImpact = input.maxPriceImpact ?? "0.005";
    body.expireTime = expireTime;
  }
  // The protection pair may not expire before the entry it protects.
  if (body.attachedBracket && body.expireTime) {
    const pairEnd = Date.parse(body.attachedBracket.expireTime ?? "");
    if (Number.isFinite(pairEnd) && pairEnd < Date.parse(body.expireTime)) {
      body.attachedBracket = { ...body.attachedBracket, expireTime: body.expireTime };
    }
  }
  if (
    input.orderType === "stop-loss" ||
    input.orderType === "take-profit" ||
    input.orderType === "stop"
  ) {
    if (!input.triggers?.length) throw new Error("trigger order needs a trigger price");
    body.triggers = input.triggers;
    body.maxPriceImpact = input.maxPriceImpact ?? "0.1";
    body.expireTime = expireTime;
  }
  return body;
}

export function postQuote(body: QuoteBody) {
  return flash<FlashQuote>("/quote", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type OrderBody = {
  targetChain: Chain;
  contraChain: Chain;
  targetAsset: string;
  contraAsset: string;
  side: Side;
  qty: string;
  orderType: OrderType;
  funderAddress: string;
  quoteId: string;
  userSignature: string;
  evmOrderTypedData: string;
  evmPermitTypedData?: string;
  evmPermitSignature?: string;
  /**
   * Submit shape of the attached pair (OpenAPI SubmitOrderRequest.attachedBracket). The pair's
   * expireTime is a quote-only field: it is already baked into the signed `deadline`.
   */
  attachedBracket?: {
    takeProfit: AttachedBracket["takeProfit"];
    stopLoss: AttachedBracket["stopLoss"];
    userSignature: string;
    salt?: string;
    deadline?: string;
    signedMaxFromAmount?: string;
    evmPermitTypedData?: string;
    evmPermitSignature?: string;
  };
  triggers?: Trigger[];
  limitNotionalPrice?: string;
  limitCrossPrice?: string;
  /** Echo the quote's protections; when omitted Flash applies its own default at admission. */
  maxPriceImpact?: string;
  maxSlippage?: string;
  flashIntegratorFeeBps?: string;
  erc8021AttributionCode?: string;
  twapBucketCount?: number;
  startTime?: string;
};

export type SubmitOrderResponse = {
  orderId: string;
  attachedBracket?: { status?: AttachedBracketStatus } | null;
};

export function postOrder(body: OrderBody) {
  return flash<SubmitOrderResponse>("/order", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type AttachedBracketStatus = "pending_activation" | "never_activated" | "active";

/** GET /orders/{id} `order` (OpenAPI FlashOrder), the fields PACT reads. */
export type FlashOrder = {
  orderId?: string;
  orderType?: string;
  side?: Side;
  status?: string;
  closeReason?: string | null;
  funderAddress?: string;
  recipientAddress?: string | null;
  qty?: string;
  filled?: FlashOrderFilled | null;
  limitNotionalPrice?: string | null;
  limitCrossPrice?: string | null;
  maxPriceImpact?: string | null;
  twapBucketCount?: number | null;
  trigger?: Trigger | null;
  integratorFeeBps?: string | null;
  tradeFeeBps?: string | null;
  attachedBracket?: {
    status?: AttachedBracketStatus;
    bracketOrderId?: string | null;
    takeProfit?: { notionalPrice?: string | null; crossPrice?: string | null; limitPrice?: string | null } | null;
    stopLoss?: { notionalPrice?: string | null; crossPrice?: string | null; limitPrice?: string | null } | null;
    signedMaxFromAmount?: string | null;
    expiresAt?: string | null;
  } | null;
  sourceEntryOrderId?: string | null;
  placedAt?: string | null;
  closedAt?: string | null;
  expiresAt?: string | null;
};

export type FlashOrderFilled = {
  targetAmount?: string;
  contraAmount?: string;
  averagePrice?: string;
  averageNotionalPrice?: string;
};

/** OpenAPI FlashFill. `fillPrice` is spent-per-received; do not read it as a USD price. */
export type FlashFillRow = {
  status?: string;
  transactionId?: string;
  fillPrice?: string;
  notional?: string;
  targetAmount?: string;
  contraAmount?: string;
  filledAt?: string;
  venues?: string[];
  feeNotional?: string;
  tradeFeeNotional?: string;
  networkFeeNotional?: string;
  integratorFeeNotional?: string;
};

export type FlashOrderDetail = { order: FlashOrder; fills: FlashFillRow[] };

export function getOrder(orderId: string, funderAddress: string) {
  return flash<FlashOrderDetail>(
    `/orders/${orderId}?funderAddress=${encodeURIComponent(funderAddress)}`,
  );
}

/** Flash statuses from which an order can still be cancelled. */
export const CANCELLABLE_STATUSES = ["ORDER_STATUS_PENDING", "ORDER_STATUS_ACCEPTED", "ORDER_STATUS_PARTIALLY_FILLED"];

export type CancelOutcome = { orderId: string; ok: boolean; alreadyFilled?: boolean; error?: string };

/** Single cancel. 422 "already filled" means the order executed; it is reported, not thrown. */
export async function postCancel(orderId: string, userSignature: string): Promise<CancelOutcome> {
  try {
    await flash<{ ok: true }>(`/orders/${orderId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ cancelMessage: cancelMessage(orderId), userSignature }),
    });
    return { orderId, ok: true };
  } catch (e) {
    const status = (e as { status?: number }).status;
    const message = e instanceof Error ? e.message : "cancel failed";
    if (status === 422 && /fill/i.test(message)) return { orderId, ok: false, alreadyFilled: true, error: message };
    throw e;
  }
}

/** Batch cancel: up to 25 orders with one funder signature over `batchCancelMessage(orderIds)`. */
export async function postBatchCancel(orderIds: string[], userSignature: string): Promise<CancelOutcome[]> {
  const ids = orderIds.map((id) => id.toLowerCase());
  const res = await flash<{ results?: { orderId: string; ok: boolean; errorCode?: string }[] }>("/orders/cancel", {
    method: "POST",
    body: JSON.stringify({ orderIds: ids, cancelMessage: batchCancelMessage(ids), userSignature }),
  });
  // PENDING_CANCEL: a cancel is already in flight, so treat it as cancelled.
  return (res.results ?? []).map((r) => {
    const ok = r.ok || r.errorCode === "PENDING_CANCEL";
    return {
      orderId: r.orderId,
      ok,
      alreadyFilled: r.errorCode === "ALREADY_FILLED",
      error: ok ? undefined : r.errorCode,
    };
  });
}

/** Open orders for a funder (used to reconcile a submit that returned an error). */
export function listOrders(funderAddress: string, pageSize = 50) {
  return flash<{ orders?: FlashOrder[]; nextPageToken?: string | null }>(
    `/orders?funderAddress=${encodeURIComponent(funderAddress)}&pageSize=${pageSize}`,
  );
}

export type FlashTokenBalance = {
  chain?: string;
  address?: string;
  symbol?: string;
  tokenDecimals?: number;
  balance?: string;
  notional?: string;
  isNative?: boolean;
};

/** Flat wallet balances across chains (scam and unpriced tokens are omitted by Flash). */
export function getBalances(address: string) {
  return flash<{ balances?: FlashTokenBalance[] }>(`/balances/${encodeURIComponent(address)}`);
}
