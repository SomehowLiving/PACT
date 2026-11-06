import { encodeAbiParameters, getContractAddress, hashTypedData, keccak256, parseAbi, concat, type Hex } from "viem";
import { CHAINS, FLASH_SPENDER, PERMIT2 } from "./chains";
import type { Chain } from "./types";

/**
 * Browser-safe side of PACT's onchain session authority (contracts/src/PactSessionAccount.sol).
 * Encodes session signatures exactly as the contract decodes them, and mirrors its scope rules
 * so PACT refuses to sign anything the account would reject anyway. The contract is the
 * enforcement; this is a pre-check.
 */

export const KIND_FLASH_ORDER = 1;
export const KIND_PERMIT2 = 2;
export const KIND_CANCEL = 3;
/** Flash sizes Permit2 permits to the order plus a 24-hour buffer (mirrors the contract). */
export const PERMIT_EXPIRY_BUFFER_S = 86_400;

export const ACCOUNT_ABI = parseAbi([
  "function owner() view returns (address)",
  "function sessionOf(address key) view returns (bytes32 id, uint48 expiresAt)",
  "function limitsOf(address key, address token) view returns (uint256 maxPerOrder, uint256 maxPermit, bool canReceive)",
  "function grantSession(address key, (uint48 expiresAt, address[] spendTokens, uint256[] maxPerOrder, uint256[] maxPermit, address[] receiveTokens) scope) returns (bytes32)",
  "function revokeSession(address key)",
  "function execute(address target, uint256 value, bytes data) returns (bytes)",
  "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
]);

export const FACTORY_ABI = parseAbi([
  "function IMPLEMENTATION() view returns (address)",
  "function accountOf(address owner) view returns (address)",
  "function create(address owner) returns (address)",
]);

export const ERC20_APPROVE_ABI = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);

/** Deployed addresses, per chain, from env. Unset means not deployed on that chain yet. */
export function sessionContracts(chain: Chain): { factory?: `0x${string}`; implementation?: `0x${string}` } {
  const env = chain === "base"
    ? { factory: process.env.NEXT_PUBLIC_PACT_FACTORY_BASE, implementation: process.env.NEXT_PUBLIC_PACT_ACCOUNT_IMPL_BASE }
    : { factory: process.env.NEXT_PUBLIC_PACT_FACTORY_ARC, implementation: process.env.NEXT_PUBLIC_PACT_ACCOUNT_IMPL_ARC };
  const ok = (v?: string) => (v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as `0x${string}`) : undefined);
  return { factory: ok(env.factory), implementation: ok(env.implementation) };
}

/** The PACT wallet address for an owner, before it exists (CREATE2 of the EIP-1167 clone). */
export function predictAccount(factory: `0x${string}`, implementation: `0x${string}`, owner: `0x${string}`): `0x${string}` {
  const bytecode = concat(["0x3d602d80600a3d3981f3363d3d373d3d3d363d73", implementation, "0x5af43d82803e903d91602b57fd5bf3"]);
  const salt = `0x${owner.slice(2).toLowerCase().padStart(64, "0")}` as Hex;
  return getContractAddress({ opcode: "CREATE2", from: factory, salt, bytecodeHash: keccak256(bytecode) });
}

type Typed = { domain: Record<string, unknown>; types: Record<string, { name: string; type: string }[]>; primaryType: string; message: Record<string, unknown> };

export function parseTyped(json: string): Typed {
  const t = JSON.parse(json) as Typed;
  const types = { ...t.types };
  delete types.EIP712Domain;
  return { ...t, types, domain: { ...t.domain, chainId: Number(t.domain.chainId) } };
}

export function digestOf(t: Typed): Hex {
  return hashTypedData(t as never);
}

const FLASH_ORDER = [
  {
    type: "tuple",
    components: [
      { name: "swapper", type: "address" },
      { name: "vault", type: "address" },
      { name: "recipient", type: "address" },
      { name: "fromToken", type: "address" },
      { name: "toToken", type: "address" },
      { name: "fromAmount", type: "uint256" },
      { name: "salt", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  },
] as const;

const PERMIT_SINGLE = [
  {
    type: "tuple",
    components: [
      {
        name: "details",
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint160" },
          { name: "expiration", type: "uint48" },
          { name: "nonce", type: "uint48" },
        ],
      },
      { name: "spender", type: "address" },
      { name: "sigDeadline", type: "uint256" },
    ],
  },
] as const;

export function flashOrderPayload(m: Record<string, unknown>): Hex {
  return encodeAbiParameters(FLASH_ORDER, [
    {
      swapper: m.swapper as `0x${string}`,
      vault: m.vault as `0x${string}`,
      recipient: m.recipient as `0x${string}`,
      fromToken: m.fromToken as `0x${string}`,
      toToken: m.toToken as `0x${string}`,
      fromAmount: BigInt(String(m.fromAmount)),
      salt: BigInt(String(m.salt)),
      deadline: BigInt(String(m.deadline)),
    },
  ]);
}

export function permitPayload(m: Record<string, unknown>): Hex {
  const d = m.details as Record<string, unknown>;
  return encodeAbiParameters(PERMIT_SINGLE, [
    {
      details: {
        token: d.token as `0x${string}`,
        amount: BigInt(String(d.amount)),
        expiration: Number(d.expiration),
        nonce: Number(d.nonce),
      },
      spender: m.spender as `0x${string}`,
      sigDeadline: BigInt(String(m.sigDeadline)),
    },
  ]);
}

/** The bytes the account's isValidSignature decodes: (kind, sessionKey, payload, 65-byte sig). */
export function encodeSessionSignature(kind: number, sessionKey: `0x${string}`, payload: Hex, signature: Hex): Hex {
  return encodeAbiParameters(
    [{ type: "uint8" }, { type: "address" }, { type: "bytes" }, { type: "bytes" }],
    [kind, sessionKey, payload, signature],
  );
}

/** Onchain scope of one grant, in token base units. */
export type OnchainScope = {
  expiresAt: number;
  spendTokens: `0x${string}`[];
  maxPerOrder: bigint[];
  maxPermit: bigint[];
  receiveTokens: `0x${string}`[];
};

/**
 * A grant's limits in token units. USDC caps come straight from dollars. WETH is spent only by
 * the protective sell of what a copy bought, so its caps are sized from the USD caps at a
 * conservative price floor (half today's price, times the guard's 2.2 bracket allowance).
 */
export function scopeFor(chain: Chain, input: { expiresAt: number; maxPerOrderUsd: number; maxPermitUsd: number; ethPriceUsd: number }): OnchainScope {
  const c = CHAINS[chain];
  const usdc = (usd: number) => BigInt(Math.floor(usd * 1e6));
  const floor = input.ethPriceUsd * 0.5;
  const weth = (usd: number) => BigInt(Math.floor(((usd * 2.2) / floor) * 1e18));
  return {
    expiresAt: input.expiresAt,
    spendTokens: [c.usdc, c.weth],
    maxPerOrder: [usdc(input.maxPerOrderUsd), weth(input.maxPerOrderUsd)],
    maxPermit: [usdc(input.maxPermitUsd), weth(input.maxPermitUsd)],
    receiveTokens: [c.weth, c.usdc],
  };
}

const lower = (v: unknown) => String(v ?? "").toLowerCase();

/** The contract's rules for a FlashOrder or Permit2 payload, as reasons it would reject. */
export function scopeViolations(t: Typed, account: string, scope: OnchainScope, nowS = Math.floor(Date.now() / 1000)): string[] {
  const out: string[] = [];
  if (nowS > scope.expiresAt) out.push("session expired");
  const capOf = (token: unknown, list: bigint[]) => {
    const i = scope.spendTokens.findIndex((s) => s.toLowerCase() === lower(token));
    return i < 0 ? BigInt(0) : list[i];
  };
  if (t.primaryType === "FlashOrder") {
    const m = t.message;
    if (lower(t.domain.verifyingContract) !== FLASH_SPENDER.toLowerCase()) out.push("not Flash's verifying contract");
    if (lower(m.swapper) !== lower(account) || lower(m.recipient) !== lower(account)) out.push("swapper or recipient is not the PACT wallet");
    const cap = capOf(m.fromToken, scope.maxPerOrder);
    if (cap === BigInt(0)) out.push("spent token not in scope");
    else if (BigInt(String(m.fromAmount)) > cap) out.push("over the per-order cap");
    if (!scope.receiveTokens.some((r) => r.toLowerCase() === lower(m.toToken))) out.push("received token not in scope");
    if (Number(m.deadline) > scope.expiresAt) out.push("order outlives the session");
  } else if (t.primaryType === "PermitSingle") {
    const m = t.message;
    const d = m.details as Record<string, unknown>;
    if (lower(t.domain.verifyingContract) !== PERMIT2.toLowerCase()) out.push("not Permit2");
    if (lower(m.spender) !== FLASH_SPENDER.toLowerCase()) out.push("permit spender is not Flash");
    const cap = capOf(d.token, scope.maxPermit);
    if (cap === BigInt(0)) out.push("permit token not in scope");
    else if (BigInt(String(d.amount)) > cap) out.push("over the permit cap");
    // Flash sets both to the order deadline + 24 h (mirrors the contract).
    if (Number(d.expiration) > scope.expiresAt + PERMIT_EXPIRY_BUFFER_S || Number(m.sigDeadline) > scope.expiresAt + PERMIT_EXPIRY_BUFFER_S) {
      out.push("permit outlives the session");
    }
  } else {
    out.push(`cannot sign ${t.primaryType}`);
  }
  return out;
}
