import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultPolicy, USDC, WETH } from "./constants";
import { sha256Json } from "./hash";
import { decide } from "./policy";
import { assetPrice } from "./price";
import type {
  AuditLog,
  Decision,
  DeskState,
  Policy,
  Proposal,
  Receipt,
  StoredQuote,
  Strategy,
} from "./types";

type Memory = DeskState;

const FILE = join(process.cwd(), ".data", "store.json");
const g = globalThis as unknown as { __pact?: Memory };

function empty(): Memory {
  return {
    strategies: [],
    policies: [],
    proposals: [],
    decisions: {},
    quotes: {},
    receipts: [],
    logs: [],
  };
}

function persist(m: Memory) {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(m));
  } catch {
    /* demo store is best-effort */
  }
}

function load(): Memory {
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as Memory;
  } catch {
    return empty();
  }
}

function mem(): Memory {
  if (!g.__pact) g.__pact = load();
  return g.__pact;
}

export function snapshot(): DeskState {
  const m = mem();
  return structuredClone(m);
}

export function resetStore() {
  g.__pact = empty();
  persist(g.__pact);
}

export const DEMO_LEADER =
  "0x1111111111111111111111111111111111111111" as const;
export const DEMO_FOLLOWER =
  "0x2222222222222222222222222222222222222222" as const;
export const DEMO_BOLD = "0x3333333333333333333333333333333333333333" as const;
export const DEMO_CAREFUL =
  "0x4444444444444444444444444444444444444444" as const;

export function followsLeader(policy: Policy, leader: string) {
  const f = policy.follows;
  return !f?.length || f.some((l) => l.toLowerCase() === leader.toLowerCase());
}

export async function proposeToAll(strategyId: string) {
  const strategy = mem().strategies.find((s) => s.id === strategyId);
  const followers = mem()
    .policies.filter((p) => !strategy || followsLeader(p, strategy.leader))
    .map((p) => p.follower);
  const out = [];
  for (const follower of followers) {
    out.push(await createProposal(strategyId, follower));
  }
  return out;
}

// Three desks with different risk appetites. One leader trade, three verdicts.
function seedDesks(steady: `0x${string}`) {
  upsertPolicy({ ...defaultPolicy(steady), label: "steady" });
  upsertPolicy({
    ...defaultPolicy(DEMO_BOLD),
    label: "bold",
    maxNotionalUsd: 100,
    maxDailyUsd: 200,
    allowOrderTypes: ["twap", "limit", "take-profit", "stop-loss"],
    allowSides: ["buy", "sell"],
  });
  upsertPolicy({
    ...defaultPolicy(DEMO_CAREFUL),
    label: "careful",
    maxNotionalUsd: 15,
    maxDailyUsd: 30,
    allowOrderTypes: ["limit"],
  });
}

export async function seedDemo(opts?: {
  leader?: `0x${string}`;
  follower?: `0x${string}`;
}) {
  resetStore();
  const leader = opts?.leader ?? DEMO_LEADER;
  const follower = opts?.follower ?? DEMO_FOLLOWER;
  seedDesks(follower);
  const base = { leader, chain: "base" as const, targetAsset: WETH, contraAsset: USDC, side: "buy" as const };
  const twap = addStrategy({ ...base, orderType: "twap", qty: "25", durationSeconds: 600 });
  const market = addStrategy({ ...base, orderType: "market", qty: "500" });
  const allow = await createProposal(twap.id, follower);
  const block = await createProposal(market.id, follower);
  // The headline trade: one TWAP $60, copied by every desk.
  const split = addStrategy({ ...base, orderType: "twap", qty: "60", durationSeconds: 600 });
  const desks = await proposeToAll(split.id);
  return { twap, market, allow, block, split, desks };
}

export function upsertPolicy(policy: Policy) {
  const m = mem();
  const i = m.policies.findIndex(
    (p) => p.follower.toLowerCase() === policy.follower.toLowerCase(),
  );
  if (i >= 0) m.policies[i] = policy;
  else m.policies.push(policy);
  persist(m);
  return policy;
}

export function policyFor(follower: `0x${string}`) {
  const m = mem();
  const found = m.policies.find(
    (p) => p.follower.toLowerCase() === follower.toLowerCase(),
  );
  if (found) return found;
  return upsertPolicy(defaultPolicy(follower));
}

export function addStrategy(input: Omit<Strategy, "id" | "createdAt">) {
  const strategy: Strategy = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const m = mem();
  m.strategies.unshift(strategy);
  persist(m);
  return strategy;
}

// Buys are sized in USDC (contra), so notional = qty. Sells are sized in the target token,
// so notional = qty × the live USD price from Flash.
export async function notionalFor(
  strategy: Pick<Strategy, "side" | "qty" | "chain" | "targetAsset">,
): Promise<{ notional: number; price?: number }> {
  if (strategy.side === "buy") return { notional: Number(strategy.qty) };
  const price = await assetPrice(strategy.chain, strategy.targetAsset);
  return { notional: Number(strategy.qty) * price, price };
}

export function dailySpent(follower: `0x${string}`) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const t = start.toISOString();
  return mem()
    .receipts.filter(
      (r) =>
        r.follower.toLowerCase() === follower.toLowerCase() &&
        r.createdAt >= t &&
        r.flashOrderId &&
        r.decision.verdict !== "BLOCK",
    )
    .reduce((sum, r) => sum + r.notionalUsd, 0);
}

export async function createProposal(strategyId: string, follower: `0x${string}`) {
  const m = mem();
  const strategy = m.strategies.find((s) => s.id === strategyId);
  if (!strategy) throw new Error("strategy not found");

  const existing = m.proposals.find(
    (p) => p.strategyId === strategyId && p.follower.toLowerCase() === follower.toLowerCase(),
  );
  if (existing) {
    return {
      proposal: existing,
      decision: m.decisions[existing.id],
    };
  }

  const policy = policyFor(follower);
  let sized: { notional: number; price?: number } | undefined;
  let priceError = false;
  try {
    sized = await notionalFor(strategy);
  } catch {
    priceError = true;
  }
  const proposal: Proposal = {
    id: crypto.randomUUID(),
    strategyId,
    follower,
    chain: strategy.chain,
    targetAsset: strategy.targetAsset,
    contraAsset: strategy.contraAsset,
    side: strategy.side,
    orderType: strategy.orderType,
    qty: strategy.qty,
    notionalUsd: sized?.notional ?? 0,
    maxSlippage: strategy.orderType === "market" ? policy.maxSlippage : undefined,
    maxPriceImpact:
      strategy.orderType === "twap" || strategy.orderType === "limit"
        ? policy.maxPriceImpact
        : undefined,
    durationSeconds: strategy.durationSeconds,
    limitNotionalPrice: strategy.limitNotionalPrice,
    triggers: strategy.triggers,
    createdAt: new Date().toISOString(),
  };

  // Fail closed: a sell we cannot price is never sized or signed.
  const decision: Decision = priceError
    ? { verdict: "BLOCK", reasons: ["PRICE_UNAVAILABLE"] }
    : decide(proposal, policy, dailySpent(follower));
  if (decision.verdict === "MODIFY" && decision.modifiedQty) {
    const capUsd = Number(decision.modifiedQty);
    if (proposal.side === "sell" && sized?.price) {
      // decide() caps in USD; a sell is sized in target units.
      decision.modifiedQty = (capUsd / sized.price).toFixed(8);
    }
    proposal.qty = decision.modifiedQty;
    proposal.notionalUsd = capUsd;
  }

  m.proposals.unshift(proposal);
  m.decisions[proposal.id] = decision;

  const log: AuditLog = {
    at: new Date().toISOString(),
    proposalId: proposal.id,
    proposalHash: await sha256Json(proposal),
    policyHash: await sha256Json(policy),
    verdict: decision.verdict,
    reasons: decision.reasons,
  };
  m.logs.unshift(log);
  persist(m);

  return { proposal, decision, log };
}

// After a follower edits their policy, re-decide every proposal they have not acted on.
export async function rebuildFor(follower: `0x${string}`) {
  const m = mem();
  const lower = follower.toLowerCase();
  const acted = new Set(m.receipts.map((r) => r.proposalId));
  const drop = m.proposals.filter(
    (p) => p.follower.toLowerCase() === lower && !acted.has(p.id),
  );
  const dropIds = new Set(drop.map((p) => p.id));
  m.proposals = m.proposals.filter((p) => !dropIds.has(p.id));
  m.logs = m.logs.filter((l) => !dropIds.has(l.proposalId));
  for (const id of dropIds) {
    delete m.decisions[id];
    delete m.quotes[id];
  }
  const strategies = [...m.strategies].reverse();
  for (const st of strategies) {
    if (drop.some((p) => p.strategyId === st.id)) {
      await createProposal(st.id, follower);
    }
  }
  persist(m);
}

export function decisionFor(proposalId: string): Decision | undefined {
  return mem().decisions[proposalId];
}

export function proposalById(id: string) {
  return mem().proposals.find((p) => p.id === id);
}

export function saveQuote(quote: StoredQuote) {
  const m = mem();
  m.quotes[quote.proposalId] = quote;
  persist(m);
  return quote;
}

export function quoteFor(proposalId: string) {
  return mem().quotes[proposalId];
}

export function addReceipt(input: Omit<Receipt, "id" | "createdAt">) {
  const receipt: Receipt = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const m = mem();
  m.receipts.unshift(receipt);
  persist(m);
  return receipt;
}

export function patchReceipt(proposalId: string, patch: Partial<Receipt>) {
  const m = mem();
  const i = m.receipts.findIndex((r) => r.proposalId === proposalId);
  if (i < 0) return undefined;
  m.receipts[i] = { ...m.receipts[i], ...patch };
  persist(m);
  return m.receipts[i];
}

export function attachOrder(proposalId: string, flashOrderId: string) {
  const m = mem();
  const log = m.logs.find((l) => l.proposalId === proposalId);
  if (log) log.flashOrderId = flashOrderId;
  persist(m);
}

export function blockedNotional(follower?: `0x${string}`) {
  const m = mem();
  return m.proposals
    .filter((p) => {
      if (follower && p.follower.toLowerCase() !== follower.toLowerCase()) return false;
      return m.decisions[p.id]?.verdict === "BLOCK";
    })
    .reduce((sum, p) => sum + p.notionalUsd, 0);
}
