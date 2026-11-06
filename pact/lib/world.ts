import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { appendEvidence } from "@/lib/evidence";

/*
 * World ID (L6 authority, identity only). A leader proves they are a unique human, bound to
 * their wallet address; one human can back only one leader address. It never authorizes a
 * trade and says nothing about trading skill. See CRITIQUE_AND_WORLD_DECISION.md.
 *
 * Flow: the browser asks PACT to sign the request (RP signature, key stays here), IDKit
 * collects a proof in World App with the leader's address as the signal, and PACT forwards
 * the result to World's /v4/verify, checks the signal and binds the nullifier.
 */

export const LEADER_ACTION = "pact-verified-leader";
const VERIFY_URL = "https://developer.world.org/api/v4/verify";

export type WorldEnvironment = "production" | "staging";

export function worldConfig() {
  const appId = process.env.WORLD_APP_ID?.trim() ?? "";
  const rpId = process.env.WORLD_RP_ID?.trim() ?? "";
  const key = (process.env.WORLD_SIGNING_KEY ?? process.env.WORLD_PRIVATE_KEY ?? "").trim();
  const environment: WorldEnvironment = process.env.WORLD_ENV === "staging" ? "staging" : "production";
  const missing = [
    appId.startsWith("app_") ? null : "WORLD_APP_ID",
    rpId.startsWith("rp_") ? null : "WORLD_RP_ID",
    /^(0x)?[0-9a-fA-F]{64}$/.test(key) ? null : "WORLD_PRIVATE_KEY",
  ].filter((m): m is string => !!m);
  return { enabled: missing.length === 0, appId, rpId, key, environment, missing };
}

/** What the browser may know: never the signing key. */
export function publicWorldConfig() {
  const c = worldConfig();
  return { enabled: c.enabled, app_id: c.appId || undefined, rp_id: c.rpId || undefined, environment: c.environment, action: LEADER_ACTION, missing: c.missing };
}

/** The signal a leader proof is bound to: their address, lowercased. */
export function leaderSignal(address: string) {
  return address.toLowerCase();
}

export function signLeaderRequest() {
  const c = worldConfig();
  if (!c.enabled) throw new WorldError("WORLD_NOT_CONFIGURED", `World ID is not configured: set ${c.missing.join(", ")}`);
  const s = signRequest({ signingKeyHex: c.key, action: LEADER_ACTION, ttl: 300 });
  return { sig: s.sig, nonce: s.nonce, created_at: s.createdAt, expires_at: s.expiresAt };
}

export class WorldError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

type ProofResponse = { identifier?: string; signal_hash?: string; nullifier?: string };
export type WorldProof = { protocol_version?: string; action?: string; environment?: string; nonce?: string; responses?: ProofResponse[] };

function sameField(a?: string, b?: string) {
  try {
    return a !== undefined && b !== undefined && BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
}

/** Nullifiers are 256-bit hex; store them as decimal so casing and padding cannot split one human in two. */
export function normalizeNullifier(n: string) {
  return BigInt(n).toString(10);
}

/**
 * Checks PACT's side of a proof, then asks World to verify it cryptographically. Returns the
 * normalized nullifier. Fails closed on any mismatch.
 */
export async function verifyLeaderProof(address: string, proof: WorldProof, fetchImpl: typeof fetch = fetch) {
  const c = worldConfig();
  if (!c.enabled) throw new WorldError("WORLD_NOT_CONFIGURED", `World ID is not configured: set ${c.missing.join(", ")}`);
  if (!proof || typeof proof !== "object") throw new WorldError("WORLD_PROOF_MISSING", "no World ID proof");
  if (proof.environment !== c.environment) throw new WorldError("WORLD_WRONG_ENVIRONMENT", `proof is from ${proof.environment ?? "an unknown"} environment`);
  if (proof.action !== LEADER_ACTION) throw new WorldError("WORLD_WRONG_ACTION", "proof is for a different action");
  const responses = proof.responses ?? [];
  if (!responses.length) throw new WorldError("WORLD_PROOF_MISSING", "proof has no responses");
  const expected = hashSignal(leaderSignal(address));
  if (!responses.every((r) => sameField(r.signal_hash, expected))) {
    throw new WorldError("WORLD_SIGNAL_MISMATCH", "proof is bound to a different wallet");
  }

  const res = await fetchImpl(`${VERIFY_URL}/${c.rpId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...proof, environment: c.environment }),
  });
  const body = (await res.json().catch(() => null)) as { success?: boolean; environment?: string; results?: { success?: boolean; nullifier?: string }[]; code?: string; detail?: string } | null;
  if (!res.ok || body?.success !== true) {
    throw new WorldError("WORLD_VERIFY_FAILED", body?.detail ?? body?.code ?? `World verify returned ${res.status}`);
  }
  if (body.environment !== undefined && body.environment !== c.environment) {
    throw new WorldError("WORLD_WRONG_ENVIRONMENT", "World verified a proof from another environment");
  }
  const nullifier = body.results?.find((r) => r.success && r.nullifier)?.nullifier ?? responses.find((r) => r.nullifier)?.nullifier;
  if (!nullifier) throw new WorldError("WORLD_VERIFY_FAILED", "no nullifier in the verified proof");
  return { nullifier: normalizeNullifier(nullifier), protocol: proof.protocol_version ?? "unknown" };
}

/* ── One human, one leader address ───────────────────────────────────── */

type HumanRecord = { address: string; verifiedAt: string; protocol: string };
type Humans = { version: 1; byNullifier: Record<string, HumanRecord> };

function humansFile() {
  const store = process.env.PACT_STORE_FILE ?? join(process.cwd(), ".data", "store.json");
  return store.replace(/\.json$/, "") + ".humans.json";
}

function load(): Humans {
  try {
    const v = JSON.parse(readFileSync(/*turbopackIgnore: true*/ humansFile(), "utf8")) as Humans;
    return v?.version === 1 && v.byNullifier ? v : { version: 1, byNullifier: {} };
  } catch {
    return { version: 1, byNullifier: {} };
  }
}

function save(h: Humans) {
  const file = humansFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(h, null, 2));
}

/** Leader address (lowercase) → when it was verified. */
export function verifiedLeaders(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of Object.values(load().byNullifier)) out[r.address] = r.verifiedAt;
  return out;
}

export function isVerifiedHuman(address: string) {
  return address.toLowerCase() in verifiedLeaders();
}

/**
 * Binds a verified nullifier to a leader address. The same human re-verifying the same
 * address is a no-op; a second address for the same human, or a second human for the same
 * address, is refused.
 */
export function bindLeader(address: string, nullifier: string, protocol: string, at = new Date().toISOString()) {
  const addr = address.toLowerCase();
  const h = load();
  const existing = h.byNullifier[nullifier];
  if (existing && existing.address !== addr) {
    throw new WorldError("HUMAN_ALREADY_BOUND", `this human already verified leader ${existing.address.slice(0, 6)}…${existing.address.slice(-4)}`, 409);
  }
  const other = Object.entries(h.byNullifier).find(([n, r]) => r.address === addr && n !== nullifier);
  if (other) throw new WorldError("ADDRESS_ALREADY_VERIFIED", "a different human already verified this address", 409);
  if (existing) return { record: existing, created: false };
  const record: HumanRecord = { address: addr, verifiedAt: at, protocol };
  h.byNullifier[nullifier] = record;
  save(h);
  // The public log carries a digest of the nullifier, not the nullifier itself.
  appendEvidence("leader.human_verified", `leader:${addr}`, { leader: addr }, {
    nullifierDigest: `0x${createHash("sha256").update(nullifier).digest("hex")}`,
    protocol,
    action: LEADER_ACTION,
  });
  return { record, created: true };
}

/** Tests only. */
export function resetHumans() {
  save({ version: 1, byNullifier: {} });
}
