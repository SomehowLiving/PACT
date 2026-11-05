import { CHAINS, FLASH_SPENDER, PERMIT2, tokenDecimals } from "./chains";
import type { Chain, Side } from "./types";

// Wallet-side guard. Runs in the follower's browser (and again on the server) over the raw
// payloads Flash returned, BEFORE any signature. It does not trust the PACT server, so a
// compromised or lying server cannot get a signature on something the policy did not allow.

export type CheckLevel = "pass" | "warn" | "fail";
export type Check = { id: string; label: string; level: CheckLevel; detail: string };
export type GuardResult = { ok: boolean; checks: Check[] };

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
   * Flash sizes the Permit2 permit to this order plus those, so the permit may be that large.
   * The order signature (fromAmount) stays capped to `qty` either way.
   */
  otherOpenUnits?: string;
  quote: {
    orderTypedData?: string;
    permitTypedData?: string;
    approveTx?: { to: string; data: string; value?: string };
  };
  nowSec?: number;
};

const MAX_UINT256 = BigInt("0x" + "f".repeat(64));
const APPROVE = "0x095ea7b3";
const DAY = 86_400;

const eq = (a?: string, b?: string) =>
  Boolean(a && b && a.toLowerCase() === b.toLowerCase());

export function toUnits(qty: string, decimals: number): bigint | undefined {
  if (!/^\d+(\.\d+)?$/.test(qty)) return undefined;
  const [whole, frac = ""] = qty.split(".");
  if (frac.length > decimals) return undefined;
  return BigInt(whole + frac.padEnd(decimals, "0"));
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

export function verifySigning(input: GuardInput): GuardResult {
  const checks: Check[] = [];
  const add = (id: string, label: string, level: CheckLevel, detail: string) =>
    checks.push({ id, label, level, detail });
  const now = input.nowSec ?? Math.floor(Date.now() / 1000);
  const cfg = CHAINS[input.chain];

  const order = parse<OrderTyped>(input.quote.orderTypedData);
  const m = order?.message;
  if (!order || !m) {
    add("order.present", "order payload", "fail", "Flash returned no readable order to sign");
    return { ok: false, checks };
  }

  const buy = input.side === "buy";
  const fromToken = buy ? input.contraAsset : input.targetAsset;
  const toToken = buy ? input.targetAsset : input.contraAsset;
  const dec = tokenDecimals(input.chain, fromToken);
  const cap = dec === undefined ? undefined : toUnits(input.qty, dec);

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
  add(
    "order.swapper",
    "funds come from you",
    eq(m.swapper, input.follower) ? "pass" : "fail",
    `swapper ${m.swapper ?? "missing"}`,
  );
  add(
    "order.recipient",
    "proceeds go to you",
    eq(m.recipient, input.follower) ? "pass" : "fail",
    `recipient ${m.recipient ?? "missing"}`,
  );
  add(
    "order.tokens",
    "tokens match the proposal",
    eq(m.fromToken, fromToken) && eq(m.toToken, toToken) ? "pass" : "fail",
    `${m.fromToken ?? "?"} → ${m.toToken ?? "?"}`,
  );

  let amount: bigint | undefined;
  try {
    amount = m.fromAmount ? BigInt(m.fromAmount) : undefined;
  } catch {
    amount = undefined;
  }
  if (amount === undefined || cap === undefined) {
    add("order.amount", "amount within the approved size", "fail", "amount unreadable or token unknown");
  } else {
    add(
      "order.amount",
      "amount within the approved size",
      amount <= cap ? "pass" : "fail",
      `signs ${amount} base units, policy approved ${cap}`,
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
      "order stays valid for more than 7 days (normal for trigger orders — cancel it in Definitive to revoke)",
    );
  } else {
    add("order.deadline", "deadline", "pass", `expires in ${Math.round((deadline - now) / 60)} min`);
  }

  const permit = parse<PermitTyped>(input.quote.permitTypedData);
  if (permit?.message) {
    const d = permit.message.details;
    add(
      "permit.contract",
      "Permit2 contract",
      eq(permit.domain?.verifyingContract, PERMIT2) &&
        Number(permit.domain?.chainId) === cfg.id
        ? "pass"
        : "fail",
      `${permit.domain?.verifyingContract ?? "missing"} on chain ${permit.domain?.chainId}`,
    );
    add(
      "permit.spender",
      "only Flash can spend the permit",
      eq(permit.message.spender, FLASH_SPENDER) ? "pass" : "fail",
      `spender ${permit.message.spender ?? "missing"}`,
    );
    add(
      "permit.token",
      "permit is for the spent token",
      eq(d?.token, fromToken) ? "pass" : "fail",
      `token ${d?.token ?? "missing"}`,
    );
    let pAmount: bigint | undefined;
    try {
      pAmount = d?.amount ? BigInt(d.amount) : undefined;
    } catch {
      pAmount = undefined;
    }
    let other = BigInt(0);
    try {
      other = input.otherOpenUnits ? BigInt(input.otherOpenUnits) : BigInt(0);
    } catch {
      other = BigInt(0);
    }
    const permitCap = cap === undefined ? undefined : cap + other;
    add(
      "permit.amount",
      "permit sized to this order and your open orders",
      pAmount !== undefined && permitCap !== undefined && pAmount <= permitCap ? "pass" : "fail",
      other > BigInt(0)
        ? `permit ${pAmount ?? "unreadable"}, allowed ${permitCap ?? "unknown"} (this order ${cap ?? "unknown"} + ${other} already open)`
        : `permit ${pAmount ?? "unreadable"}, approved ${cap ?? "unknown"}`,
    );
    // Flash adds a 24 h buffer to the latest order deadline, so judge the permit against the
    // order's own deadline and not against "now" (a 7-day limit order needs an 8-day permit).
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

  const tx = input.quote.approveTx;
  if (tx) {
    const data = tx.data.toLowerCase();
    const selector = data.slice(0, 10);
    const spender = "0x" + data.slice(34, 74);
    const value = data.slice(74, 138);
    add(
      "approve.shape",
      "approve goes to the spent token, for Permit2 only",
      eq(tx.to, fromToken) &&
        selector === APPROVE &&
        eq(spender, PERMIT2) &&
        (!tx.value || tx.value === "0")
        ? "pass"
        : "fail",
      `${tx.to} ${selector} spender ${spender}`,
    );
    const isMax = value.length === 64 && BigInt("0x" + value) === MAX_UINT256;
    add(
      "approve.amount",
      "token allowance to Permit2",
      isMax ? "warn" : "pass",
      isMax
        ? "unlimited approval to Permit2 — your real spend limit is the signed permit amount above"
        : "bounded approval",
    );
  }

  return { ok: !checks.some((c) => c.level === "fail"), checks };
}
