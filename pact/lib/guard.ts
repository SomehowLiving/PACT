import { CHAINS, FLASH_SPENDER, PERMIT2, tokenDecimals } from "./chains";
import type { Chain, Side } from "./types";

// Wallet-side guard. Runs in the follower's browser (and again on the server) over the raw
// payloads Flash returned, BEFORE any signature: the entry order AND, when present, the
// attached protection pair. It does not trust the PACT server.
//
// What a Flash signature binds (FlashOrder: swapper, vault, recipient, fromToken, toToken,
// fromAmount, salt, deadline): who pays, who receives, which tokens, the most that can be
// spent, and until when. It carries no price: limit prices and TP/SL triggers are enforced by
// Flash's engine, not by the signature. So the guard proves where funds can go, not at what price.

export type CheckLevel = "pass" | "warn" | "fail";
export type Check = { id: string; label: string; level: CheckLevel; detail: string };
export type GuardResult = { ok: boolean; checks: Check[] };

type Payload = {
  orderTypedData?: string;
  permitTypedData?: string;
  approveTx?: { to: string; data: string; value?: string };
};

export type GuardInput = {
  chain: Chain;
  follower: string;
  side: Side;
  targetAsset: string;
  contraAsset: string;
  /** Approved size: contra units on a buy (USDC), target units on a sell (WETH). */
  qty: string;
  /**
   * Base units of the spent token already committed to this follower's other unfilled orders.
   * Flash sizes the Permit2 permit (or direct approval) to this order plus those.
   */
  otherOpenUnits?: string;
  /** PACT's integrator fee vault. When set, the signed order must name it. */
  expectedVault?: string;
  quote: Payload;
  nowSec?: number;
};

export type BracketGuardInput = {
  chain: Chain;
  follower: string;
  targetAsset: string;
  contraAsset: string;
  /** Approved entry spend in contra units (USDC) — the bracket sells what this buys. */
  entryQty: string;
  /**
   * A conservative (low) USD price for the target, e.g. the plan's stop. The pair may sell at
   * most about 2× the quoted output (Flash's TWAP allowance), so the cap is
   * 2.2 × entryQty ÷ priceFloor in target units.
   */
  priceFloor: string;
  /** Flash's quoted `attachedBracket.signedMaxFromAmount` (decimal, target units). */
  signedMaxFromAmount?: string;
  /** Base units of the target token in this follower's other open sells and brackets. */
  otherOpenUnits?: string;
  expectedVault?: string;
  quote: Payload;
  nowSec?: number;
};

const MAX_UINT256 = BigInt("0x" + "f".repeat(64));
const APPROVE = "0x095ea7b3";
const DAY = 86_400;

const eq = (a?: string, b?: string) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

export function toUnits(qty: string, decimals: number): bigint | undefined {
  if (!/^\d+(\.\d+)?$/.test(qty)) return undefined;
  const [whole, frac = ""] = qty.split(".");
  if (frac.length > decimals) return undefined;
  return BigInt(whole + frac.padEnd(decimals, "0"));
}

/** Like toUnits, but truncates extra decimals instead of rejecting them. */
function toUnitsLoose(qty: string, decimals: number): bigint | undefined {
  if (!/^\d+(\.\d+)?$/.test(qty)) return undefined;
  const [whole, frac = ""] = qty.split(".");
  return BigInt(whole + frac.slice(0, decimals).padEnd(decimals, "0"));
}

function big(v?: string): bigint | undefined {
  try {
    return v ? BigInt(v) : undefined;
  } catch {
    return undefined;
  }
}

function parse<T>(raw?: string): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

type OrderTyped = {
  domain?: { chainId?: string | number; verifyingContract?: string };
  primaryType?: string;
  message?: {
    swapper?: string;
    vault?: string;
    recipient?: string;
    fromToken?: string;
    toToken?: string;
    fromAmount?: string;
    deadline?: string;
  };
};

type PermitTyped = {
  domain?: { chainId?: string | number; verifyingContract?: string };
  primaryType?: string;
  message?: {
    details?: { token?: string; amount?: string; expiration?: string };
    spender?: string;
    sigDeadline?: string;
  };
};

type PayloadSpec = {
  chain: Chain;
  follower: string;
  fromToken: string;
  toToken: string;
  /** Maximum fromAmount the follower authorised, in base units. */
  cap?: bigint;
  otherOpen: bigint;
  expectedVault?: string;
  payload: Payload;
  now: number;
  /** Check id prefix: "" for the entry, "bracket." for the protection pair. */
  prefix: string;
  /** Level when the permit exceeds cap + known open orders (the pair can't see every open sell). */
  permitOverLevel: CheckLevel;
  labels: { swapper: string; recipient: string; tokens: string; amount: string };
};

function checkPayload(spec: PayloadSpec, checks: Check[]) {
  const add = (id: string, label: string, level: CheckLevel, detail: string) =>
    checks.push({ id: spec.prefix + id, label, level, detail });
  const cfg = CHAINS[spec.chain];
  const now = spec.now;

  const order = parse<OrderTyped>(spec.payload.orderTypedData);
  const m = order?.message;
  if (!order || !m) {
    add("order.present", "order payload", "fail", "Flash returned no readable order to sign");
    return;
  }

  add(
    "order.type",
    "Flash order",
    order.primaryType === "FlashOrder" ? "pass" : "fail",
    `primary type ${order.primaryType ?? "missing"}`,
  );
  add(
    "order.chain",
    "chain",
    Number(order.domain?.chainId) === cfg.id ? "pass" : "fail",
    `signing domain is chain ${order.domain?.chainId}, expected ${cfg.id} (${cfg.name})`,
  );
  add(
    "order.verifier",
    "Flash contract",
    eq(order.domain?.verifyingContract, FLASH_SPENDER) ? "pass" : "fail",
    `verifying contract ${order.domain?.verifyingContract ?? "missing"}`,
  );
  add("order.swapper", spec.labels.swapper, eq(m.swapper, spec.follower) ? "pass" : "fail", `swapper ${m.swapper ?? "missing"}`);
  add(
    "order.recipient",
    spec.labels.recipient,
    eq(m.recipient, spec.follower) ? "pass" : "fail",
    `recipient ${m.recipient ?? "missing"}`,
  );
  add(
    "order.tokens",
    spec.labels.tokens,
    eq(m.fromToken, spec.fromToken) && eq(m.toToken, spec.toToken) ? "pass" : "fail",
    `${m.fromToken ?? "?"} → ${m.toToken ?? "?"}`,
  );
  if (spec.expectedVault) {
    add(
      "order.vault",
      "fee vault is PACT's",
      eq(m.vault, spec.expectedVault) ? "pass" : "fail",
      `vault ${m.vault ?? "missing"}`,
    );
  } else {
    add("order.vault", "fee vault", "warn", `vault ${m.vault ?? "missing"} (not pinned: set NEXT_PUBLIC_FLASH_VAULT)`);
  }

  const amount = big(m.fromAmount);
  if (amount === undefined || spec.cap === undefined) {
    add("order.amount", spec.labels.amount, "fail", "amount unreadable or token unknown");
  } else {
    add(
      "order.amount",
      spec.labels.amount,
      amount <= spec.cap ? "pass" : "fail",
      `signs ${amount} base units, allowed ${spec.cap}`,
    );
  }

  const deadline = Number(m.deadline);
  if (!Number.isFinite(deadline) || deadline <= now) {
    add("order.deadline", "deadline", "fail", `deadline ${m.deadline ?? "missing"} is not in the future`);
  } else if (deadline - now > 7 * DAY) {
    add(
      "order.deadline",
      "deadline",
      "warn",
      "order stays valid for more than 7 days (normal for resting and trigger orders; cancel to revoke)",
    );
  } else {
    add("order.deadline", "deadline", "pass", `expires in ${Math.round((deadline - now) / 60)} min`);
  }

  const permitCap = spec.cap === undefined ? undefined : spec.cap + spec.otherOpen;
  const permit = parse<PermitTyped>(spec.payload.permitTypedData);
  if (permit?.message) {
    const d = permit.message.details;
    add(
      "permit.contract",
      "Permit2 contract",
      eq(permit.domain?.verifyingContract, PERMIT2) && Number(permit.domain?.chainId) === cfg.id ? "pass" : "fail",
      `${permit.domain?.verifyingContract ?? "missing"} on chain ${permit.domain?.chainId}`,
    );
    add(
      "permit.spender",
      "only Flash can spend the permit",
      eq(permit.message.spender, FLASH_SPENDER) ? "pass" : "fail",
      `spender ${permit.message.spender ?? "missing"}`,
    );
    add("permit.token", "permit is for the spent token", eq(d?.token, spec.fromToken) ? "pass" : "fail", `token ${d?.token ?? "missing"}`);
    const pAmount = big(d?.amount);
    const within = pAmount !== undefined && permitCap !== undefined && pAmount <= permitCap;
    add(
      "permit.amount",
      "permit sized to this order and your open orders",
      within ? "pass" : pAmount === undefined ? "fail" : spec.permitOverLevel,
      spec.otherOpen > BigInt(0)
        ? `permit ${pAmount ?? "unreadable"}, allowed ${permitCap ?? "unknown"} (this order ${spec.cap ?? "unknown"} + ${spec.otherOpen} already open)`
        : `permit ${pAmount ?? "unreadable"}, allowed ${permitCap ?? "unknown"}`,
    );
    // Flash adds a 24 h buffer to the latest order deadline, so judge the permit against the
    // order's own deadline and not against "now".
    const exp = Number(d?.expiration);
    const orderEnd = Number.isFinite(deadline) && deadline > now ? deadline : now;
    add(
      "permit.expiry",
      "permit expiry",
      Number.isFinite(exp) && exp > now && exp <= orderEnd + DAY + 3_600 ? "pass" : "warn",
      Number.isFinite(exp)
        ? `expires in ${Math.round((exp - now) / 3600)} h (order ends in ${Math.round((orderEnd - now) / 3600)} h)`
        : "no expiry readable",
    );
  }

  const tx = spec.payload.approveTx;
  if (tx) {
    const data = tx.data.toLowerCase();
    const selector = data.slice(0, 10);
    const spender = "0x" + data.slice(34, 74);
    const value = data.slice(74, 138);
    const toPermit2 = eq(spender, PERMIT2);
    // A wallet that already uses a direct approval to Flash's allowance contract keeps that
    // path (minimal authorization), so accept it, but only for a bounded amount.
    const toFlash = eq(spender, FLASH_SPENDER);
    add(
      "approve.shape",
      "approve goes to the spent token, for Permit2 or Flash only",
      eq(tx.to, spec.fromToken) && selector === APPROVE && (toPermit2 || toFlash) && (!tx.value || tx.value === "0")
        ? "pass"
        : "fail",
      `${tx.to} ${selector} spender ${spender}`,
    );
    const approved = value.length === 64 ? BigInt("0x" + value) : undefined;
    const isMax = approved === MAX_UINT256;
    if (toFlash) {
      add(
        "approve.amount",
        "direct allowance to Flash",
        approved !== undefined && permitCap !== undefined && approved <= permitCap ? "pass" : "fail",
        `approves ${approved ?? "unreadable"}, allowed ${permitCap ?? "unknown"}`,
      );
    } else {
      add(
        "approve.amount",
        "token allowance to Permit2",
        isMax ? "warn" : "pass",
        isMax ? "unlimited approval to Permit2 — your real spend limit is the signed permit amount above" : "bounded approval",
      );
    }
  }
}

/** Guard for the entry order. */
export function verifySigning(input: GuardInput): GuardResult {
  const checks: Check[] = [];
  const buy = input.side === "buy";
  const fromToken = buy ? input.contraAsset : input.targetAsset;
  const toToken = buy ? input.targetAsset : input.contraAsset;
  const dec = tokenDecimals(input.chain, fromToken);
  checkPayload(
    {
      chain: input.chain,
      follower: input.follower,
      fromToken,
      toToken,
      cap: dec === undefined ? undefined : toUnits(input.qty, dec),
      otherOpen: big(input.otherOpenUnits) ?? BigInt(0),
      expectedVault: input.expectedVault,
      payload: input.quote,
      now: input.nowSec ?? Math.floor(Date.now() / 1000),
      prefix: "",
      permitOverLevel: "fail",
      labels: {
        swapper: "funds come from you",
        recipient: "proceeds go to you",
        tokens: "tokens match the proposal",
        amount: "amount within the approved size",
      },
    },
    checks,
  );
  return { ok: !checks.some((c) => c.level === "fail"), checks };
}

/**
 * A conservative (low) USD price for the target, used to bound how much the protection pair may
 * sell: the plan's stop, or half the declared entry when no stop is set.
 */
export function bracketPriceFloor(plan: { stopLossPrice?: string; entryReferencePrice?: string }) {
  const stop = Number(plan.stopLossPrice);
  if (stop > 0) return String(stop);
  const entry = Number(plan.entryReferencePrice);
  return entry > 0 ? String(entry / 2) : "0";
}

/** Upper bound, in target base units, on what the protection pair may sell. */
export function bracketCapUnits(input: Pick<BracketGuardInput, "chain" | "targetAsset" | "contraAsset" | "entryQty" | "priceFloor">) {
  const targetDec = tokenDecimals(input.chain, input.targetAsset);
  const qty = Number(input.entryQty);
  const floor = Number(input.priceFloor);
  if (targetDec === undefined || !(qty > 0) || !(floor > 0)) return undefined;
  const maxTarget = (2.2 * qty) / floor;
  return toUnitsLoose(maxTarget.toFixed(Math.min(targetDec, 18)), targetDec);
}

/**
 * Guard for the attached protection pair. It sells the target the entry receives (WETH → USDC)
 * back to the follower. Its trigger prices are not part of the signature; PACT records the
 * levels the follower chose and reads them back from Flash after submit.
 */
export function verifyBracketSigning(input: BracketGuardInput): GuardResult {
  const checks: Check[] = [];
  const now = input.nowSec ?? Math.floor(Date.now() / 1000);
  const cap = bracketCapUnits(input);
  checkPayload(
    {
      chain: input.chain,
      follower: input.follower,
      fromToken: input.targetAsset,
      toToken: input.contraAsset,
      cap,
      otherOpen: big(input.otherOpenUnits) ?? BigInt(0),
      expectedVault: input.expectedVault,
      payload: input.quote,
      now,
      prefix: "bracket.",
      // Other protection pairs and sells may share the permit; PACT can't see all of them,
      // and the recipient is pinned to the follower, so an oversize permit is a warning.
      permitOverLevel: "warn",
      labels: {
        swapper: "protection sells from your wallet",
        recipient: "protection proceeds go to you",
        tokens: "protection sells what the entry buys",
        amount: "protection size within bounds",
      },
    },
    checks,
  );
  const order = parse<OrderTyped>(input.quote.orderTypedData);
  const targetDec = tokenDecimals(input.chain, input.targetAsset);
  if (order?.message?.fromAmount && input.signedMaxFromAmount && targetDec !== undefined) {
    const signed = big(order.message.fromAmount);
    const quoted = toUnitsLoose(input.signedMaxFromAmount, targetDec);
    checks.push({
      id: "bracket.order.quoted",
      label: "protection matches the quote",
      level: signed !== undefined && quoted !== undefined && signed === quoted ? "pass" : "warn",
      detail: `signs ${signed ?? "?"}, quote says ${quoted ?? "?"}`,
    });
  }
  return { ok: !checks.some((c) => c.level === "fail"), checks };
}
