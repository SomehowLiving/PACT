import { FLASH_BASE, INTEGRATOR_FEE_BPS } from "./constants";
import { cancelMessage } from "./typed";
import type { Chain, OrderType, Side, Trigger } from "./types";

function key() {
  const k = process.env.FLASH_API_KEY;
  if (!k) throw new Error("FLASH_API_KEY missing");
  return k;
}

async function flash<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${FLASH_BASE}${path}`, {
    ...init,
    headers: {
      "x-definitive-api-key": key(),
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
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
  limitNotionalPrice?: string;
  triggers?: Trigger[];
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
  evm?: {
    orderTypedData?: string;
    approveTx?: { to: string; data: string; value?: string };
    permitTypedData?: string;
  };
  from?: { notional?: string; amount?: string; symbol?: string };
  to?: { notional?: string; amount?: string; symbol?: string };
};

export function quoteRequest(
  input: Omit<
    QuoteBody,
    "forceMinimalAllowance" | "evmUsePermit2" | "flashIntegratorFeeBps" | "targetChain" | "contraChain"
  > & { chain?: Chain },
): QuoteBody {
  const chain = input.chain ?? "base";
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
    body.maxPriceImpact = input.maxPriceImpact ?? "0.05";
  }
  if (input.orderType === "market") {
    body.maxSlippage = input.maxSlippage ?? "0.05";
  }
  if (input.orderType === "limit") {
    if (input.limitNotionalPrice) body.limitNotionalPrice = input.limitNotionalPrice;
    body.maxPriceImpact = input.maxPriceImpact ?? "0.05";
  }
  if (
    input.orderType === "stop-loss" ||
    input.orderType === "take-profit" ||
    input.orderType === "stop"
  ) {
    if (!input.triggers?.length) throw new Error("trigger order needs a trigger price");
    body.triggers = input.triggers;
    body.maxPriceImpact = input.maxPriceImpact ?? "0.1";
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
  triggers?: Trigger[];
  limitNotionalPrice?: string;
  flashIntegratorFeeBps?: string;
  twapBucketCount?: number;
  startTime?: string;
};

export function postOrder(body: OrderBody) {
  return flash<{ orderId: string }>("/order", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// POST /order and cancel responses are a flat order; GET /orders/{id} wraps it as
// { order, fills } and requires the funder address as a query parameter.
export type FlashOrder = {
  orderId?: string;
  status?: string;
  closeReason?: string | null;
  twapBucketCount?: number | null;
};

export type FlashFillRow = {
  transactionId?: string;
  fillPrice?: string;
  notional?: string;
  filledAt?: string;
};

export type FlashOrderDetail = { order: FlashOrder; fills: FlashFillRow[] };

export function getOrder(orderId: string, funderAddress: string) {
  return flash<FlashOrderDetail>(
    `/orders/${orderId}?funderAddress=${encodeURIComponent(funderAddress)}`,
  );
}

export function postCancel(orderId: string, userSignature: string) {
  return flash<FlashOrder>(`/orders/${orderId}/cancel`, {
    method: "POST",
    body: JSON.stringify({ cancelMessage: cancelMessage(orderId), userSignature }),
  });
}
