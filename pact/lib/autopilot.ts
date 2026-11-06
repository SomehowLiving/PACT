import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { encodeFunctionData, serializeSignature, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, sign } from "viem/accounts";
import { baseClient } from "./base-rpc";
import { CHAINS, PERMIT2 } from "./chains";
import { prepareCopyQuote } from "./copy-quote";
import { appendEvidence, hashSync, threads } from "./evidence";
import { ethUsdReference } from "./oracle";
import { deriveKey } from "./session";
import {
  ACCOUNT_ABI,
  digestOf,
  encodeSessionSignature,
  ERC20_APPROVE_ABI,
  FACTORY_ABI,
  flashOrderPayload,
  KIND_FLASH_ORDER,
  KIND_PERMIT2,
  parseTyped,
  permitPayload,
  predictAccount,
  scopeFor,
  scopeViolations,
  sessionContracts,
  type OnchainScope,
} from "./session-account";
import { decisionFor, policyFor, proposalById, snapshot } from "./store";
import { submitCopy, type CopySignatures } from "./submit-order";
import type { Chain, Proposal } from "./types";

/**
 * L6 Autopilot: a scoped session key signs copies for the follower's PACT wallet while they are
 * away. The scope is enforced on chain by PactSessionAccount (who, until when, which tokens, how
 * much per order and per permit, and that output always returns to the wallet). PACT adds its
 * own limits on top (daily budget, the follower's mandate and every policy check), and records
 * each signature in the evidence chain.
 *
 * Grants live in their own server-side file, never in the desk state the browser reads, and
 * the session key is stored encrypted (AES-256-GCM, key derived from PACT_SESSION_SECRET).
 */

type Address = `0x${string}`;

export type GrantRecord = {
  id: string;
  follower: Address;
  chain: Chain;
  mode: "SMART_WALLET";
  account: Address;
  sessionKey: Address;
  encryptedKey: string;
  expiresAt: number;
  maxPerOrderUsd: number;
  maxPermitUsd: number;
  maxDailyUsd: number;
  scope: { expiresAt: number; spendTokens: Address[]; maxPerOrder: string[]; maxPermit: string[]; receiveTokens: Address[] };
  createdAt: string;
  revokedAt?: string;
};

export type GrantStatus = "NOT_DEPLOYED" | "AWAITING_SETUP" | "ACTIVE" | "EXPIRED" | "REVOKED";

export type PublicGrant = Omit<GrantRecord, "encryptedKey"> & {
  status: GrantStatus;
  onchain?: { accountDeployed: boolean; sessionActive: boolean; usdcBalance?: string; checkedAt: string };
};

const g = globalThis as unknown as { __pactGrants?: GrantRecord[]; __pactGrantStatus?: Map<string, { at: number; value: PublicGrant["onchain"] }> };

function file() {
  const store = process.env.PACT_STORE_FILE ?? join(process.cwd(), ".data", "store.json");
  return store.replace(/\.json$/, "") + ".grants.json";
}

function grants(): GrantRecord[] {
  if (g.__pactGrants) return g.__pactGrants;
  try {
    g.__pactGrants = JSON.parse(readFileSync(/*turbopackIgnore: true*/ file(), "utf8")) as GrantRecord[];
  } catch {
    g.__pactGrants = [];
  }
  return g.__pactGrants;
}

function persist() {
  try {
    mkdirSync(/*turbopackIgnore: true*/ dirname(file()), { recursive: true });
    writeFileSync(/*turbopackIgnore: true*/ file(), JSON.stringify(grants()), { mode: 0o600 });
  } catch {
    /* in-memory for this process */
  }
}

/** Test helper. */
export function resetGrants() {
  g.__pactGrants = [];
  g.__pactGrantStatus = new Map();
}

function encrypt(privateKey: Hex): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey("autopilot-session-key"), iv);
  const body = Buffer.concat([cipher.update(privateKey.slice(2), "hex"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

function decrypt(blob: string): Hex {
  const [iv, tag, body] = blob.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", deriveKey("autopilot-session-key"), iv);
  decipher.setAuthTag(tag);
  return `0x${Buffer.concat([decipher.update(body), decipher.final()]).toString("hex")}`;
}

const toScope = (s: GrantRecord["scope"]): OnchainScope => ({
  ...s,
  maxPerOrder: s.maxPerOrder.map(BigInt),
  maxPermit: s.maxPermit.map(BigInt),
});

/** The onchain calls the follower's wallet sends once to switch Autopilot on. */
export function setupCalls(grant: GrantRecord) {
  const { factory } = sessionContracts(grant.chain);
  const c = CHAINS[grant.chain];
  const max = BigInt(2) ** BigInt(256) - BigInt(1);
  const approve = () =>
    encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [PERMIT2, max] });
  return [
    factory
      ? { label: "Create your PACT wallet", to: factory, data: encodeFunctionData({ abi: FACTORY_ABI, functionName: "create", args: [grant.follower] }) }
      : undefined,
    {
      label: "Let Permit2 move USDC from the PACT wallet (Flash's own permits stay capped by the session)",
      to: grant.account,
      data: encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "execute", args: [c.usdc, BigInt(0), approve()] }),
    },
    {
      label: "Same for WETH, for the protective sell of what a copy buys",
      to: grant.account,
      data: encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "execute", args: [c.weth, BigInt(0), approve()] }),
    },
    {
      label: "Grant the session key its scope",
      to: grant.account,
      data: encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "grantSession", args: [grant.sessionKey, toScope(grant.scope)] }),
    },
  ].filter((x): x is { label: string; to: Address; data: Hex } => !!x);
}

export function revokeCall(grant: GrantRecord) {
  return {
    label: "Revoke the session key on chain",
    to: grant.account,
    data: encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "revokeSession", args: [grant.sessionKey] }),
  };
}

async function onchainOf(grant: GrantRecord, nowMs: number): Promise<PublicGrant["onchain"]> {
  g.__pactGrantStatus ??= new Map();
  const hit = g.__pactGrantStatus.get(grant.id);
  if (hit && nowMs - hit.at < 30_000) return hit.value;
  if (grant.chain !== "base") return undefined; // only Base RPC is wired
  try {
    const code = await baseClient.getCode({ address: grant.account });
    const accountDeployed = !!code && code !== "0x";
    let sessionActive = false;
    if (accountDeployed) {
      const [id, expiresAt] = await baseClient.readContract({ address: grant.account, abi: ACCOUNT_ABI, functionName: "sessionOf", args: [grant.sessionKey] });
      sessionActive = id !== `0x${"0".repeat(64)}` && Number(expiresAt) * 1000 > nowMs;
    }
    const value = { accountDeployed, sessionActive, checkedAt: new Date(nowMs).toISOString() };
    g.__pactGrantStatus.set(grant.id, { at: nowMs, value });
    return value;
  } catch {
    return undefined;
  }
}

export async function publicGrant(grant: GrantRecord, nowMs = Date.now()): Promise<PublicGrant> {
  const { encryptedKey: _secret, ...rest } = grant;
  void _secret;
  const { factory } = sessionContracts(grant.chain);
  const onchain = factory ? await onchainOf(grant, nowMs) : undefined;
  const status: GrantStatus = grant.revokedAt
    ? "REVOKED"
    : grant.expiresAt * 1000 <= nowMs
      ? "EXPIRED"
      : !factory
        ? "NOT_DEPLOYED"
        : onchain?.sessionActive
          ? "ACTIVE"
          : "AWAITING_SETUP";
  return { ...rest, status, onchain };
}

export function grantsFor(follower: string) {
  return grants().filter((x) => x.follower.toLowerCase() === follower.toLowerCase());
}

export function currentGrant(follower: string, chain: Chain) {
  return grantsFor(follower)
    .filter((x) => x.chain === chain && !x.revokedAt && x.expiresAt * 1000 > Date.now())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export async function createGrant(input: {
  follower: Address;
  chain: Chain;
  hours: number;
  maxPerOrderUsd: number;
  maxDailyUsd: number;
  nowMs?: number;
}): Promise<GrantRecord> {
  const now = input.nowMs ?? Date.now();
  const { factory, implementation } = sessionContracts(input.chain);
  // Before the contracts are deployed the wallet address cannot be predicted; the follower's
  // EOA stands in and the grant stays NOT_DEPLOYED (dry runs only).
  const account = factory && implementation ? predictAccount(factory, implementation, input.follower) : input.follower;
  const pk = generatePrivateKey();
  const expiresAt = Math.floor(now / 1000) + Math.round(input.hours * 3600);
  const eth = await ethUsdReference(now).then((r) => r.price).catch(() => 2000);
  const maxPermitUsd = input.maxDailyUsd;
  const s = scopeFor(input.chain, { expiresAt, maxPerOrderUsd: input.maxPerOrderUsd, maxPermitUsd, ethPriceUsd: eth });
  // One active grant per follower and chain: a new one supersedes the old.
  for (const old of grants()) {
    if (old.follower.toLowerCase() === input.follower.toLowerCase() && old.chain === input.chain && !old.revokedAt) {
      old.revokedAt = new Date(now).toISOString();
    }
  }
  const grant: GrantRecord = {
    id: crypto.randomUUID(),
    follower: input.follower,
    chain: input.chain,
    mode: "SMART_WALLET",
    account,
    sessionKey: privateKeyToAccount(pk).address,
    encryptedKey: encrypt(pk),
    expiresAt,
    maxPerOrderUsd: input.maxPerOrderUsd,
    maxPermitUsd,
    maxDailyUsd: input.maxDailyUsd,
    scope: { ...s, maxPerOrder: s.maxPerOrder.map(String), maxPermit: s.maxPermit.map(String) },
    createdAt: new Date(now).toISOString(),
  };
  grants().push(grant);
  persist();
  appendEvidence("autopilot.granted", threads.mandate(input.follower), { follower: input.follower }, {
    grantId: grant.id,
    chain: grant.chain,
    account: grant.account,
    sessionKey: grant.sessionKey,
    expiresAt: grant.expiresAt,
    maxPerOrderUsd: grant.maxPerOrderUsd,
    maxDailyUsd: grant.maxDailyUsd,
    scopeHash: hashSync(grant.scope),
  });
  return grant;
}

/** PACT stops signing at once; the onchain revoke (one call) makes old signatures fail at Flash too. */
export function revokeGrant(follower: string, grantId: string, nowMs = Date.now()) {
  const grant = grantsFor(follower).find((x) => x.id === grantId);
  if (!grant) return undefined;
  if (!grant.revokedAt) {
    grant.revokedAt = new Date(nowMs).toISOString();
    persist();
    appendEvidence("autopilot.revoked", threads.mandate(follower), { follower: follower as Address }, { grantId });
  }
  return grant;
}

/** Sign one Flash or Permit2 payload with the grant's session key, if its scope allows it. */
export async function sessionSign(grant: GrantRecord, typedJson: string, nowS = Math.floor(Date.now() / 1000)) {
  const typed = parseTyped(typedJson);
  const violations = scopeViolations(typed, grant.account, toScope(grant.scope), nowS);
  if (violations.length) return { ok: false as const, violations };
  const digest = digestOf(typed);
  const sig = serializeSignature(await sign({ hash: digest, privateKey: decrypt(grant.encryptedKey) }));
  const kind = typed.primaryType === "FlashOrder" ? KIND_FLASH_ORDER : KIND_PERMIT2;
  const payload = kind === KIND_FLASH_ORDER ? flashOrderPayload(typed.message) : permitPayload(typed.message);
  return { ok: true as const, digest, signature: encodeSessionSignature(kind, grant.sessionKey, payload, sig) };
}

/** USD Autopilot has already committed for this follower today (UTC). */
function autopilotSpentToday(follower: string) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return snapshot()
    .receipts.filter((r) => r.follower.toLowerCase() === follower.toLowerCase() && r.signedBy === "SESSION_KEY" && r.createdAt >= start.toISOString())
    .reduce((s, r) => s + r.notionalUsd, 0);
}

export type AutopilotRun = {
  proposalId: string;
  outcome: "SUBMITTED" | "DRY_RUN" | "SKIPPED" | "FAILED";
  reasons: string[];
  orderId?: string;
  signatures?: { kind: string; digest: string; signatureHash: string }[];
};

/**
 * Execute one copy under Autopilot. Every gate the review flow has still applies (policy,
 * quote-time checks, guard) plus the grant's limits. It submits only when the grant is live on
 * chain and PACT_AUTOPILOT_SUBMIT=1; otherwise it signs, records the dry run, and stops.
 */
export async function runAutopilot(proposalId: string, nowMs = Date.now()): Promise<AutopilotRun> {
  const proposal: Proposal | undefined = proposalById(proposalId);
  const done = (outcome: AutopilotRun["outcome"], reasons: string[], extra: Partial<AutopilotRun> = {}): AutopilotRun => {
    const run = { proposalId, outcome, reasons, ...extra };
    if (proposal) {
      appendEvidence("autopilot.run", threads.proposal(proposalId), { proposalId, follower: proposal.follower }, { outcome, reasons, orderId: extra.orderId, signatures: extra.signatures });
    }
    return run;
  };
  if (!proposal) return { proposalId, outcome: "SKIPPED", reasons: ["UNKNOWN_PROPOSAL"] };
  if (policyFor(proposal.follower).automationMode !== "AUTOPILOT") return { proposalId, outcome: "SKIPPED", reasons: ["AUTOPILOT_OFF"] };
  const decision = decisionFor(proposal.id);
  if (!decision || decision.verdict === "BLOCK") return done("SKIPPED", ["POLICY_BLOCKED", ...(decision?.reasons ?? [])]);
  const grant = currentGrant(proposal.follower, proposal.chain);
  if (!grant) return done("SKIPPED", ["NO_ACTIVE_GRANT"]);
  if (proposal.notionalUsd > grant.maxPerOrderUsd) return done("SKIPPED", ["OVER_GRANT_PER_ORDER"]);
  if (autopilotSpentToday(proposal.follower) + proposal.notionalUsd > grant.maxDailyUsd) return done("SKIPPED", ["OVER_GRANT_DAILY"]);

  const status = (await publicGrant(grant, nowMs)).status;
  const live = status === "ACTIVE" && process.env.PACT_AUTOPILOT_SUBMIT === "1";
  const quoted = await prepareCopyQuote(proposal, grant.account);
  if (!quoted.ok) return done("FAILED", [String(quoted.body.error ?? "quote failed")]);

  const q = quoted.quote;
  const toSign: { kind: string; json?: string }[] = [
    { kind: "order", json: q.orderTypedData },
    { kind: "permit", json: q.permitTypedData },
    { kind: "protection", json: q.attachedBracket?.orderTypedData },
    { kind: "protection-permit", json: q.attachedBracket?.permitTypedData },
  ].filter((x) => !!x.json);
  const signed: Record<string, string> = {};
  const record: NonNullable<AutopilotRun["signatures"]> = [];
  for (const item of toSign) {
    const r = await sessionSign(grant, item.json!, Math.floor(nowMs / 1000));
    if (!r.ok) return done("FAILED", r.violations.map((v) => `${item.kind}: ${v}`));
    signed[item.kind] = r.signature;
    record.push({ kind: item.kind, digest: r.digest, signatureHash: hashSync(r.signature) });
  }
  if (q.approveTx || q.attachedBracket?.approveTx) {
    // The PACT wallet's one-time approvals are part of setup, sent by the follower.
    return done(live ? "FAILED" : "DRY_RUN", ["WALLET_APPROVAL_MISSING", ...(live ? [] : [`GRANT_${status}`])], { signatures: record });
  }
  if (!live) return done("DRY_RUN", [`GRANT_${status}`], { signatures: record });

  const sigs: CopySignatures = {
    userSignature: signed.order,
    evmPermitSignature: signed.permit,
    attachedBracketSignature: signed.protection,
    attachedBracketPermitSignature: signed["protection-permit"],
  };
  const submitted = await submitCopy(proposal, sigs, "SESSION_KEY");
  return submitted.ok
    ? done("SUBMITTED", [], { orderId: submitted.orderId, signatures: record })
    : done("FAILED", [submitted.error], { signatures: record });
}

/** Run Autopilot for every new copy of a plan whose follower has it on. */
export async function runAutopilotFor(proposalIds: string[]) {
  const runs: AutopilotRun[] = [];
  for (const id of proposalIds) {
    const p = proposalById(id);
    if (p && policyFor(p.follower).automationMode === "AUTOPILOT") runs.push(await runAutopilot(id));
  }
  return runs;
}
