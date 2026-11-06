import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { recoverMessageAddress, type Hex } from "viem";
import { baseClient } from "./base-rpc";
import { base } from "viem/chains";
import { createSiweMessage, generateSiweNonce, parseSiweMessage, validateSiweMessage } from "viem/siwe";

/**
 * Wallet sessions. A wallet signs one gasless Sign-In with Ethereum (EIP-4361) message; the
 * server answers with an httpOnly cookie that names that address until it expires. Every route
 * that changes a desk (mandate, plan, mirror, quote, order) refuses a body whose owner is not
 * the session address. The session never authorises funds: Flash orders still need the
 * wallet's own EIP-712 signature.
 */

export const SESSION_COOKIE = "pact_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const NONCE_TTL_MS = 10 * 60 * 1000;
const CHAIN_ID = base.id;
export const SIGN_IN_STATEMENT =
  "Sign in to PACT. This signature only proves you own this wallet. It cannot move funds, approve tokens or place orders.";

type Address = `0x${string}`;
type Pending = Map<string, { address: string; expiresAt: number }>;
const g = globalThis as unknown as { __pactSessionSecret?: Buffer; __pactNonces?: Pending };

function secretFile() {
  const store = process.env.PACT_STORE_FILE ?? join(process.cwd(), ".data", "store.json");
  return join(dirname(store), "session-secret");
}

/** PACT_SESSION_SECRET in production; otherwise a random secret kept beside the store. */
function secret(): Buffer {
  const fromEnv = process.env.PACT_SESSION_SECRET;
  if (fromEnv) return Buffer.from(fromEnv, "utf8");
  if (g.__pactSessionSecret) return g.__pactSessionSecret;
  const file = secretFile();
  try {
    const hex = readFileSync(/*turbopackIgnore: true*/ file, "utf8").trim();
    if (/^[0-9a-f]{64}$/.test(hex)) return (g.__pactSessionSecret = Buffer.from(hex, "hex"));
  } catch {
    /* first run */
  }
  const fresh = randomBytes(32);
  try {
    mkdirSync(/*turbopackIgnore: true*/ dirname(file), { recursive: true });
    writeFileSync(/*turbopackIgnore: true*/ file, fresh.toString("hex"), { mode: 0o600 });
  } catch {
    /* sessions then last for this process only */
  }
  return (g.__pactSessionSecret = fresh);
}

const b64 = (v: Buffer | string) => Buffer.from(v).toString("base64url");
const mac = (payload: string) => createHmac("sha256", secret()).update(payload).digest();

export type Session = { address: Address; expiresAt: number };

export function issueToken(address: string, nowMs = Date.now()): { token: string; session: Session } {
  const session: Session = { address: address.toLowerCase() as Address, expiresAt: nowMs + SESSION_TTL_MS };
  const payload = b64(JSON.stringify({ a: session.address, e: session.expiresAt }));
  return { token: `${payload}.${b64(mac(payload))}`, session };
}

export function readToken(token: string | undefined, nowMs = Date.now()): Session | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const want = mac(payload);
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const { a, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { a: string; e: number };
    if (!/^0x[0-9a-f]{40}$/.test(a) || !(e > nowMs)) return null;
    return { address: a as Address, expiresAt: e };
  } catch {
    return null;
  }
}

function cookieValue(req: Request, name: string) {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function sessionFrom(req: Request): Session | null {
  return readToken(cookieValue(req, SESSION_COOKIE));
}

/** Host and origin the browser used, so the signed message names the site the wallet sees. */
export function siteOf(req: Request) {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return { host, origin: `${proto}://${host}`, secure: proto === "https" };
}

function nonces(): Pending {
  return (g.__pactNonces ??= new Map());
}

/** Build the sign-in message for one address and remember its single-use nonce. */
export function signInMessage(req: Request, address: Address, nowMs = Date.now()): string {
  const pending = nonces();
  for (const [n, p] of pending) if (p.expiresAt <= nowMs) pending.delete(n);
  const nonce = generateSiweNonce();
  pending.set(nonce, { address: address.toLowerCase(), expiresAt: nowMs + NONCE_TTL_MS });
  const { host, origin } = siteOf(req);
  return createSiweMessage({
    domain: host,
    address,
    statement: SIGN_IN_STATEMENT,
    uri: origin,
    version: "1",
    chainId: CHAIN_ID,
    nonce,
    issuedAt: new Date(nowMs),
    expirationTime: new Date(nowMs + NONCE_TTL_MS),
  });
}

const rpc = baseClient;

/** EOA signatures are checked locally; anything else is asked of the chain (ERC-1271 / 6492). */
async function signatureValid(address: Address, message: string, signature: Hex) {
  try {
    const recovered = await recoverMessageAddress({ message, signature });
    if (recovered.toLowerCase() === address.toLowerCase()) return true;
  } catch {
    /* not a plain 65-byte signature: may be a smart wallet */
  }
  try {
    return await rpc.verifyMessage({ address, message, signature });
  } catch {
    return false;
  }
}

export type SignInResult = { ok: true; session: Session; token: string } | { ok: false; error: string };

/** Check a signed sign-in message: our domain, our chain, a live nonce we issued, a valid signature. */
export async function completeSignIn(
  req: Request,
  message: string,
  signature: Hex,
  nowMs = Date.now(),
): Promise<SignInResult> {
  let parsed: ReturnType<typeof parseSiweMessage>;
  try {
    parsed = parseSiweMessage(message);
  } catch {
    return { ok: false, error: "not a sign-in message" };
  }
  const { address, nonce, chainId } = parsed;
  if (!address || !nonce) return { ok: false, error: "sign-in message is missing its address or nonce" };
  const pending = nonces().get(nonce);
  if (!pending || pending.expiresAt <= nowMs || pending.address !== address.toLowerCase()) {
    return { ok: false, error: "sign-in request expired or already used; try again" };
  }
  const { host } = siteOf(req);
  const valid =
    chainId === CHAIN_ID &&
    parsed.statement === SIGN_IN_STATEMENT &&
    validateSiweMessage({ message: parsed, domain: host, nonce, address, time: new Date(nowMs) });
  if (!valid) return { ok: false, error: "sign-in message does not match this site" };
  // Consume before the slow check so a replay cannot race it.
  nonces().delete(nonce);
  if (!(await signatureValid(address, message, signature))) return { ok: false, error: "signature does not match the address" };
  const { token, session } = issueToken(address, nowMs);
  return { ok: true, session, token };
}

export function sessionCookie(req: Request, token: string, maxAgeSeconds = SESSION_TTL_MS / 1000) {
  const { secure } = siteOf(req);
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/**
 * Gate for a write on behalf of `owner`. Returns a response to send back when the caller is not
 * signed in as that wallet, or null when the write may go ahead.
 */
export function requireOwner(req: Request, owner: string | undefined): Response | null {
  const session = sessionFrom(req);
  if (!session) {
    return Response.json(
      { error: "sign in with this wallet first", code: "SIGN_IN_REQUIRED" },
      { status: 401 },
    );
  }
  if (!owner || session.address !== owner.toLowerCase()) {
    return Response.json(
      { error: "signed in as a different wallet", code: "SESSION_MISMATCH", signedInAs: session.address },
      { status: 403 },
    );
  }
  return null;
}
