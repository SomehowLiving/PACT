import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tokenDecimals } from "./chains";
import { defaultPolicy, USDC, WETH } from "./constants";
import { toUnits } from "./guard";
import { appendEvidence, hashSync, lastInThread, resetEvidence, threads } from "./evidence";
import { sha256Json } from "./hash";
import {
  assessLeaderPlan,
  decide,
  isLeaderPaused,
  leaderPauseDecision,
  stopRiskSizing,
} from "./policy";
import { assetPrice } from "./price";
import type {
  AuditLog,
  Decision,
  DeskState,
  LeaderEvidence,
  LeaderMandate,
  Policy,
  Proposal,
  Receipt,
  StoredQuote,
  Strategy,
} from "./types";

type Memory = DeskState;

const FILE = process.env.PACT_STORE_FILE ?? join(process.cwd(), ".data", "store.json");
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
    // Runtime data, not source: keep Turbopack from watching or tracing it, otherwise every
    // write looks like a code change and the dev server reloads open pages.
    mkdirSync(/*turbopackIgnore: true*/ dirname(FILE), { recursive: true });
    writeFileSync(/*turbopackIgnore: true*/ FILE, JSON.stringify(m));
  } catch {
    /* demo store is best-effort */
  }
}

function load(): Memory {
  try {
    // The store path is runtime config; keep Turbopack from tracing the whole project into the
    // server bundle because of it.
    return JSON.parse(readFileSync(/*turbopackIgnore: true*/ FILE, "utf8")) as Memory;
  } catch {
    return empty();
  }
}

function mem(): Memory {
  if (!g.__pact) {
    g.__pact = load();
    g.__pact.policies = g.__pact.policies.map(normalizePolicy);
  }
  return g.__pact;
}

export function snapshot(): DeskState {
  const m = mem();
  return structuredClone(m);
}

/** Test helper: an empty store and an empty evidence log. */
export function resetStore() {
  g.__pact = empty();
  persist(g.__pact);
  resetEvidence();
}

function withdraw(proposals: Proposal[], reason: string) {
  for (const p of proposals) {
    appendEvidence("proposal.withdrawn", threads.proposal(p.id), { proposalId: p.id, follower: p.follower, leader: p.leader }, { reason });
  }
}

const isDemo = (address?: string) => !!address && /^0x([0-9a-f])\1{39}$/i.test(address);

/**
 * Clear only what the demo owns: seeded desks, seeded leaders' plans and everything derived from
 * them. Real wallets' mandates, plans, mirrors and receipts survive a demo reload.
 */
export function resetDemoData() {
  const m = mem();
  const strategies = m.strategies.filter((s) => !isDemo(s.leader));
  const kept = new Set(strategies.map((s) => s.id));
  const proposals = m.proposals.filter((p) => !isDemo(p.follower) && kept.has(p.strategyId));
  const ids = new Set(proposals.map((p) => p.id));
  withdraw(m.proposals.filter((p) => !ids.has(p.id)), "DEMO_RELOADED");
  const pick = <T,>(r: Record<string, T>) => Object.fromEntries(Object.entries(r).filter(([k]) => ids.has(k)));
  g.__pact = {
    strategies,
    policies: m.policies.filter((p) => !isDemo(p.follower)),
    proposals,
    decisions: pick(m.decisions),
    quotes: pick(m.quotes),
    receipts: m.receipts.filter((r) => ids.has(r.proposalId)),
    logs: m.logs.filter((l) => ids.has(l.proposalId)),
  };
  persist(g.__pact);
}

export const DEMO_LEADER =
  "0x1111111111111111111111111111111111111111" as const;
export const DEMO_PULLBACK_LEADER =
  "0x5555555555555555555555555555555555555555" as const;
export const DEMO_CHASE_LEADER =
  "0x6666666666666666666666666666666666666666" as const;
export const DEMO_PORTFOLIO_FOLLOWER =
  "0x7777777777777777777777777777777777777777" as const;
export const DEMO_QUALITY_FOLLOWER =
  "0x8888888888888888888888888888888888888888" as const;
export const DEMO_EVIDENCE_FOLLOWER =
  "0x9999999999999999999999999999999999999999" as const;
export const DEMO_HIGH_BETA_FOLLOWER =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
export const DEMO_FOLLOWER =
  "0x2222222222222222222222222222222222222222" as const;
export const DEMO_BOLD = "0x3333333333333333333333333333333333333333" as const;
export const DEMO_CAREFUL =
  "0x4444444444444444444444444444444444444444" as const;

export function followsLeader(policy: Policy, leader: string) {
  const f = policy.follows;
  return !!f?.some((l) => l.toLowerCase() === leader.toLowerCase());
}

function mandateFor(policy: Policy, leader: string): LeaderMandate | undefined {
  return policy.mandates?.find((mandate) => mandate.leader.toLowerCase() === leader.toLowerCase());
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

// Three desks with different risk appetites. The portfolio desk is seeded separately
// so its multi-leader thresholds are not affected by the one-trade desk comparison.
function seedDesks(steady: `0x${string}`, leader: `0x${string}`) {
  upsertPolicy({ ...defaultPolicy(steady), label: "steady", follows: [leader] });
  upsertPolicy({
    ...defaultPolicy(DEMO_BOLD),
    label: "bold",
    follows: [leader],
    maxNotionalUsd: 100,
    maxDailyUsd: 200,
    allowOrderTypes: ["twap", "limit", "take-profit", "stop-loss"],
    allowSides: ["buy", "sell"],
  });
  upsertPolicy({
    ...defaultPolicy(DEMO_CAREFUL),
    label: "careful",
    follows: [leader],
    maxNotionalUsd: 15,
    maxDailyUsd: 30,
    allowOrderTypes: ["limit"],
  });
}

/** Reload the demo scenario. Only demo addresses are written; real desks are left alone. */
export async function seedDemo() {
  resetDemoData();
  const leader = DEMO_LEADER;
  const follower = DEMO_FOLLOWER;
  const pullbackLeader = DEMO_PULLBACK_LEADER;
  const chaseLeader = DEMO_CHASE_LEADER;
  const portfolioFollower = DEMO_PORTFOLIO_FOLLOWER;
  seedDesks(follower, leader);
  const base = { leader, chain: "base" as const, targetAsset: WETH, contraAsset: USDC, side: "buy" as const };
  const plan = {
    title: "ETH accumulation pact",
    thesis: "Accumulate gradually while the entry window remains valid.",
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1_000).toISOString(),
    invalidation: "Do not chase outside the stated entry window.",
    maxFollowerNotionalUsd: 60,
    entryReferencePrice: "2500",
    stopLossPrice: "2450",
    takeProfitPrice: "2600",
    protectionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
  };
  const twap = addStrategy({ ...base, ...plan, orderType: "twap", qty: "25", durationSeconds: 600 });
  const market = addStrategy({ ...base, ...plan, orderType: "market", qty: "500" });
  const allow = await createProposal(twap.id, follower);
  const block = await createProposal(market.id, follower);
  // The headline trade: one TWAP $60, copied by every desk.
  const split = addStrategy({ ...base, ...plan, orderType: "twap", qty: "60", durationSeconds: 600 });
  const desks = await proposeToAll(split.id);

  upsertPolicy({
    ...defaultPolicy(portfolioFollower),
    label: "portfolio",
    follows: [leader, pullbackLeader, chaseLeader],
  });
  upsertPolicy({
    ...defaultPolicy(DEMO_QUALITY_FOLLOWER),
    label: "quality-caution",
    follows: [leader],
  });
  upsertPolicy({
    ...defaultPolicy(DEMO_EVIDENCE_FOLLOWER),
    label: "evidence-required",
    follows: [leader],
    requireLeaderExecutionEvidence: true,
  });
  upsertPolicy({
    ...defaultPolicy(DEMO_HIGH_BETA_FOLLOWER),
    label: "high-beta-refusal",
    follows: [leader],
  });

  // A realistic follower does not allocate independently to every influencer. This compact
  // basket tests a shared daily budget, a per-leader sleeve, and an order-type refusal.
  const trend = addStrategy({
    ...base,
    ...plan,
    title: "Trend entry · leader one",
    demoCase: "CORE_TWAP_COPY",
    orderType: "twap",
    qty: "80",
    durationSeconds: 600,
  });
  const pullback = addStrategy({
    ...base,
    ...plan,
    leader: pullbackLeader,
    title: "Pullback entry · leader two",
    demoCase: "SLEEVE_SCALE",
    orderType: "limit",
    qty: "120",
    limitNotionalPrice: "2500",
  });
  const chase = addStrategy({
    ...base,
    ...plan,
    leader: chaseLeader,
    title: "Late market chase · leader three",
    demoCase: "MARKET_REFUSAL",
    orderType: "market",
    qty: "40",
  });
  const portfolio = [
    await createProposal(trend.id, portfolioFollower),
    await createProposal(pullback.id, portfolioFollower),
    await createProposal(chase.id, portfolioFollower),
  ];

  const expired = addStrategy({
    ...base,
    ...plan,
    title: "Expired entry window",
    demoCase: "EXPIRED_PLAN",
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
    orderType: "limit",
    qty: "20",
    limitNotionalPrice: "2500",
  });
  const lowRewardRisk = addStrategy({
    ...base,
    ...plan,
    title: "Low reward:risk plan",
    demoCase: "LOW_RR_CAUTION",
    stopLossPrice: "2450",
    takeProfitPrice: "2550",
    orderType: "twap",
    qty: "20",
    durationSeconds: 600,
  });
  const evidence = addStrategy({
    ...base,
    ...plan,
    title: "Evidence required by follower",
    demoCase: "EVIDENCE_REVIEW",
    orderType: "limit",
    qty: "20",
    limitNotionalPrice: "2500",
  });
  const highBeta = addStrategy({
    ...base,
    ...plan,
    title: "High-beta asset outside allowlist",
    demoCase: "HIGH_BETA_PAIR_REFUSAL",
    targetAsset: "0x000000000000000000000000000000000000c0de",
    orderType: "limit",
    qty: "15",
    limitNotionalPrice: "1",
  });
  const edgeCases = [
    await createProposal(expired.id, portfolioFollower),
    await createProposal(lowRewardRisk.id, DEMO_QUALITY_FOLLOWER),
    await createProposal(evidence.id, DEMO_EVIDENCE_FOLLOWER),
    await createProposal(highBeta.id, DEMO_HIGH_BETA_FOLLOWER),
  ];

  return { twap, market, allow, block, split, desks, portfolio, edgeCases };
}

export function upsertPolicy(policy: Policy) {
  const m = mem();
  const normalized = normalizePolicy(policy);
  const i = m.policies.findIndex(
    (p) => p.follower.toLowerCase() === normalized.follower.toLowerCase(),
  );
  if (i >= 0) m.policies[i] = normalized;
  else m.policies.push(normalized);
  persist(m);
  // Record the mandate when it changes, so every decision can name the mandate it applied.
  const thread = threads.mandate(normalized.follower);
  const policyHash = hashSync(normalized);
  if (lastInThread(thread)?.data.policyHash !== policyHash) {
    appendEvidence("mandate.set", thread, { follower: normalized.follower }, { policyHash, policy: normalized });
  }
  return normalized;
}

export function policyFor(follower: `0x${string}`) {
  const m = mem();
  const found = m.policies.find(
    (p) => p.follower.toLowerCase() === follower.toLowerCase(),
  );
  // Reads must not write: policies are normalized when loaded and when saved, so an
  // existing one is returned as-is. Persisting here rewrote the store on every poll.
  if (found) return found;
  // A wallet with no saved mandate gets the defaults, unsaved: a read must never append evidence.
  return normalizePolicy(defaultPolicy(follower));
}

function normalizePolicy(policy: Policy): Policy {
  const defaults = defaultPolicy(policy.follower);
  const follows = policy.follows ?? [];
  return {
    ...defaults,
    ...policy,
    allowChains: policy.allowChains?.length ? policy.allowChains : defaults.allowChains,
    follows,
    // A pause only applies to a selected leader; unfollowing clears it.
    pausedLeaders: follows.filter((leader) => isLeaderPaused(policy, leader)),
    mandates: (policy.mandates ?? [])
      .filter((mandate) =>
        (policy.follows ?? []).some((leader) => leader.toLowerCase() === mandate.leader.toLowerCase()),
      )
      .map((mandate) => ({ ...mandate, riskBudgetUsd: mandate.riskBudgetUsd ?? defaults.riskBudgetUsd })),
  };
}

export function addStrategy(
  input: Omit<
    Strategy,
    "id" | "createdAt" | "leaderPlanGrade" | "leaderPlanReasons" | "leaderEvidenceStatus"
  >,
  leaderEvidenceStatus: Strategy["leaderEvidenceStatus"] = "UNVERIFIED",
) {
  const assessment = assessLeaderPlan(input);
  const strategy: Strategy = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    leaderPlanGrade: assessment.grade,
    leaderPlanReasons: assessment.reasons,
    leaderEvidenceStatus,
  };
  const m = mem();
  m.strategies.unshift(strategy);
  persist(m);
  appendEvidence(
    "plan.published",
    threads.plan(strategy.id),
    { strategyId: strategy.id, leader: strategy.leader },
    { planHash: hashSync(strategy), plan: strategy },
  );
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

function isOpenProposal(proposal: Proposal) {
  const decision = mem().decisions[proposal.id];
  if (!decision || decision.verdict === "BLOCK") return false;
  const receipt = mem().receipts.find((r) => r.proposalId === proposal.id);
  return !receipt?.status || !CLOSED_STATUSES.includes(receipt.status);
}

function leaderDailySpent(follower: `0x${string}`, leader: `0x${string}`) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const from = start.toISOString();
  const m = mem();
  return m.receipts
    .filter((receipt) => {
      if (receipt.follower.toLowerCase() !== follower.toLowerCase()) return false;
      if (!receipt.flashOrderId || receipt.decision.verdict === "BLOCK" || receipt.createdAt < from) {
        return false;
      }
      return (
        m.proposals
          .find((proposal) => proposal.id === receipt.proposalId)
          ?.leader?.toLowerCase() === leader.toLowerCase()
      );
    })
    .reduce((sum, receipt) => sum + receipt.notionalUsd, 0);
}

export function leaderDailyRealizedLoss(
  follower: `0x${string}`,
  leader: `0x${string}`,
) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const from = start.toISOString();
  const m = mem();
  return m.receipts
    .filter((receipt) => {
      if (receipt.follower.toLowerCase() !== follower.toLowerCase()) return false;
      // A loss counts on the day it was realized (the exit fill), not the day of the entry.
      const realizedAt = receipt.position?.realizedAt ?? receipt.createdAt;
      if (realizedAt < from || !(receipt.realizedPnlUsd && receipt.realizedPnlUsd < 0)) {
        return false;
      }
      return (
        m.proposals
          .find((proposal) => proposal.id === receipt.proposalId)
          ?.leader?.toLowerCase() === leader.toLowerCase()
      );
    })
    .reduce((sum, receipt) => sum + Math.abs(receipt.realizedPnlUsd ?? 0), 0);
}

export function leaderDailyRealizedLosses(follower: `0x${string}`) {
  const policy = policyFor(follower);
  return Object.fromEntries(
    (policy.follows ?? []).map((leader) => [leader.toLowerCase(), leaderDailyRealizedLoss(follower, leader)]),
  );
}

function assetExposure(
  follower: `0x${string}`,
  targetAsset: `0x${string}`,
  side: Strategy["side"],
) {
  const m = mem();
  return m.receipts
    .filter((receipt) => {
      if (receipt.follower.toLowerCase() !== follower.toLowerCase()) return false;
      if (!receipt.flashOrderId || receipt.decision.verdict === "BLOCK") return false;
      if (receipt.status && CLOSED_STATUSES.includes(receipt.status)) return false;
      const proposal = m.proposals.find((item) => item.id === receipt.proposalId);
      return (
        proposal?.targetAsset.toLowerCase() === targetAsset.toLowerCase() && proposal.side === side
      );
    })
    .reduce((sum, receipt) => sum + receipt.notionalUsd, 0);
}

function activePlanCount(follower: `0x${string}`, leader?: `0x${string}`) {
  return mem().proposals.filter(
    (proposal) =>
      proposal.follower.toLowerCase() === follower.toLowerCase() &&
      (!leader || proposal.leader?.toLowerCase() === leader.toLowerCase()) &&
      isOpenProposal(proposal),
  ).length;
}

function formatQty(value: number) {
  if (!Number.isFinite(value) || value <= 0) throw new Error("invalid copy ratio or trade quantity");
  return value.toFixed(8).replace(/\.?(?:0+)$/, "");
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
  if (!followsLeader(policy, strategy.leader)) {
    throw new Error("leader is not selected in this follower policy");
  }
  let sized: { notional: number; price?: number } | undefined;
  let priceError = false;
  try {
    sized = await notionalFor(strategy);
  } catch {
    priceError = true;
  }
  const mandate = mandateFor(policy, strategy.leader);
  const sizingMode = mandate?.sizingMode ?? "PROPORTIONAL";
  const riskBudgetUsd = mandate?.riskBudgetUsd ?? policy.riskBudgetUsd;
  const stopRisk = sizingMode === "STOP_RISK"
    ? stopRiskSizing(strategy, riskBudgetUsd)
    : undefined;
  const copyRatio = mandate?.sizingMode === "PROPORTIONAL" ? mandate.copyRatio : policy.copyRatio;
  const requestedNotionalUsd =
    sizingMode === "STOP_RISK"
      ? stopRisk?.notionalUsd ?? 0
      : mandate?.sizingMode === "FIXED"
        ? mandate.fixedNotionalUsd
        : (sized?.notional ?? 0) * copyRatio;
  const requestedQty =
    sizingMode === "STOP_RISK"
      ? strategy.side === "buy"
        ? stopRisk?.notionalUsd ?? 0
        : stopRisk?.qty ?? 0
      : strategy.side === "sell"
        ? requestedNotionalUsd / (sized?.price ?? 1)
        : requestedNotionalUsd;
  const effectivePolicy: Policy = mandate
    ? {
        ...policy,
        maxLeaderDailyUsd: mandate.maxDailyUsd,
        allowOrderTypes: policy.allowOrderTypes.filter((type) => mandate.allowOrderTypes.includes(type)),
      }
    : policy;
  const proposal: Proposal = {
    id: crypto.randomUUID(),
    strategyId,
    follower,
    leader: strategy.leader,
    title: strategy.title,
    thesis: strategy.thesis,
    expiresAt: strategy.expiresAt,
    invalidation: strategy.invalidation,
    maxFollowerNotionalUsd: strategy.maxFollowerNotionalUsd,
    entryReferencePrice: strategy.entryReferencePrice,
    stopLossPrice: strategy.stopLossPrice,
    takeProfitPrice: strategy.takeProfitPrice,
    protectionExpiresAt: strategy.protectionExpiresAt,
    leaderPlanGrade: strategy.leaderPlanGrade,
    leaderPlanReasons: strategy.leaderPlanReasons,
    leaderFlashOrderId: strategy.leaderFlashOrderId,
    leaderEvidenceStatus: strategy.leaderEvidenceStatus,
    copySizingMode: sizingMode,
    riskBudgetUsd: sizingMode === "STOP_RISK" ? riskBudgetUsd : undefined,
    stopRiskPerUnitUsd: stopRisk?.riskPerUnitUsd,
    estimatedLossAtStopUsd: stopRisk?.estimatedLossAtStopUsd,
    followerExitMode: mandate?.exitMode ?? "FOLLOWER_BRACKET",
    chain: strategy.chain,
    targetAsset: strategy.targetAsset,
    contraAsset: strategy.contraAsset,
    side: strategy.side,
    orderType: strategy.orderType,
    qty: requestedQty > 0 ? formatQty(requestedQty) : "0",
    notionalUsd: requestedNotionalUsd,
    maxSlippage: strategy.orderType === "market" ? effectivePolicy.maxSlippage : undefined,
    maxPriceImpact:
      strategy.orderType === "twap" || strategy.orderType === "limit"
        ? effectivePolicy.maxPriceImpact
        : undefined,
    durationSeconds: strategy.durationSeconds,
    twapBucketCount: strategy.twapBucketCount,
    startTime: strategy.startTime,
    limitNotionalPrice: strategy.limitNotionalPrice,
    triggers: strategy.triggers,
    demoCase: strategy.demoCase,
    createdAt: new Date().toISOString(),
  };

  // A follower pause wins over every other check. Fail closed: a sell we cannot price is
  // never sized or signed.
  const paused = leaderPauseDecision(policy, strategy.leader);
  const decision: Decision = paused
    ? paused
    : priceError
    ? { verdict: "BLOCK", action: "DECLINE", reasons: ["PRICE_UNAVAILABLE"] }
    : sizingMode === "STOP_RISK" && !stopRisk
      ? { verdict: "BLOCK", action: "REVIEW", reasons: ["STOP_RISK_PLAN_INVALID"] }
    : decide(proposal, effectivePolicy, {
        dailySpentUsd: dailySpent(follower),
        leaderDailySpentUsd: leaderDailySpent(follower, strategy.leader),
        leaderDailyRealizedLossUsd: leaderDailyRealizedLoss(follower, strategy.leader),
        assetExposureUsd: assetExposure(follower, strategy.targetAsset, strategy.side),
        activePlanCount: activePlanCount(follower),
        activePlanCountForLeader: activePlanCount(follower, strategy.leader),
      });
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
  appendEvidence(
    "decision.made",
    threads.proposal(proposal.id),
    { proposalId: proposal.id, strategyId: strategy.id, follower: proposal.follower, leader: proposal.leader },
    {
      proposalHash: log.proposalHash,
      policyHash: log.policyHash,
      planHash: lastInThread(threads.plan(strategy.id))?.data.planHash,
      verdict: decision.verdict,
      action: decision.action,
      reasons: decision.reasons,
      qty: proposal.qty,
      notionalUsd: proposal.notionalUsd,
    },
  );

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
  withdraw(drop, "MANDATE_CHANGED");
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
  const proposal = m.proposals.find((p) => p.id === quote.proposalId);
  appendEvidence(
    "quote.stored",
    threads.proposal(quote.proposalId),
    { proposalId: quote.proposalId, follower: proposal?.follower },
    {
      quoteId: quote.quoteId,
      qty: quote.qty,
      notionalUsd: quote.notionalUsd,
      executionPrice: quote.executionPrice,
      allInPrice: quote.allInPrice,
      feeNotional: quote.feeNotional,
      costRatio: quote.costRatio,
      estimatedPriceImpact: quote.estimatedPriceImpact,
      effectiveLimitNotionalPrice: quote.effectiveLimitNotionalPrice,
      limitBasis: quote.limitBasis,
      maxPriceImpact: quote.maxPriceImpact,
      maxSlippage: quote.maxSlippage,
      protection: quote.attachedBracket?.bracket,
      // What the wallet is asked to sign, by hash: the entry and the protection order.
      orderTypedDataHash: quote.orderTypedData ? hashSync(quote.orderTypedData) : undefined,
      protectionTypedDataHash: quote.attachedBracket?.orderTypedData ? hashSync(quote.attachedBracket.orderTypedData) : undefined,
    },
  );
  return quote;
}

export function quoteFor(proposalId: string) {
  return mem().quotes[proposalId];
}

export function updateDecision(proposalId: string, decision: Decision) {
  const m = mem();
  if (!m.proposals.some((proposal) => proposal.id === proposalId)) return undefined;
  m.decisions[proposalId] = decision;
  persist(m);
  appendEvidence("decision.updated", threads.proposal(proposalId), { proposalId }, { ...decision });
  return decision;
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
  appendEvidence(
    "order.submitted",
    threads.proposal(receipt.proposalId),
    { proposalId: receipt.proposalId, follower: receipt.follower, flashOrderId: receipt.flashOrderId },
    {
      flashOrderId: receipt.flashOrderId,
      quoteId: receipt.quoteId,
      status: receipt.status,
      notionalUsd: receipt.notionalUsd,
      verdict: receipt.decision.verdict,
      protection: receipt.protection,
    },
  );
  return receipt;
}

export function patchReceipt(proposalId: string, patch: Partial<Receipt>) {
  const m = mem();
  const i = m.receipts.findIndex((r) => r.proposalId === proposalId);
  if (i < 0) return undefined;
  const before = orderFacts(m.receipts[i]);
  m.receipts[i] = { ...m.receipts[i], ...patch };
  persist(m);
  // Polling re-reads the same order many times; log only what changed.
  const after = orderFacts(m.receipts[i]);
  if (hashSync(before) !== hashSync(after)) {
    const r = m.receipts[i];
    appendEvidence(
      "order.updated",
      threads.proposal(proposalId),
      { proposalId, follower: r.follower, flashOrderId: r.flashOrderId },
      after,
    );
  }
  return m.receipts[i];
}

/** Transaction hash → the plan it already backs, so one trade cannot back two plans. */
export function evidenceTxIndex(): Map<string, string> {
  const index = new Map<string, string>();
  for (const st of mem().strategies) {
    for (const h of st.leaderEvidence?.txHashes ?? st.leaderTxHashes ?? []) {
      if (!index.has(h.toLowerCase())) index.set(h.toLowerCase(), st.id);
    }
  }
  return index;
}

/**
 * Record what PACT verified about a leader's execution for one plan. When the status changes,
 * followers' waiting copies of that plan are re-decided, since evidence is a policy input.
 */
export async function setLeaderEvidence(strategyId: string, evidence: LeaderEvidence) {
  const m = mem();
  const strategy = m.strategies.find((s) => s.id === strategyId);
  if (!strategy) return undefined;
  const changed = strategy.leaderEvidenceStatus !== evidence.status;
  const facts = (e?: LeaderEvidence) =>
    e ? hashSync({ status: e.status, checks: e.checks, onchain: e.onchain, txHashes: e.txHashes, flashOrderId: e.flashOrderId, open: e.open }) : undefined;
  if (facts(strategy.leaderEvidence) === facts(evidence)) {
    // Same facts, re-checked later: note when, but there is nothing new to record.
    strategy.leaderEvidence = { ...strategy.leaderEvidence!, checkedAt: evidence.checkedAt };
    persist(m);
    return strategy;
  }
  strategy.leaderEvidence = evidence;
  strategy.leaderEvidenceStatus = evidence.status;
  strategy.leaderTxHashes = evidence.txHashes;
  if (evidence.flashOrderId) strategy.leaderFlashOrderId = evidence.flashOrderId;
  persist(m);
  appendEvidence(
    "leader.evidence",
    threads.plan(strategy.id),
    { strategyId: strategy.id, leader: strategy.leader },
    {
      status: evidence.status,
      flashOrderId: evidence.flashOrderId,
      txHashes: evidence.txHashes,
      onchain: evidence.onchain,
      checks: evidence.checks.map((c) => ({ id: c.id, result: c.result })),
    },
  );
  if (changed) {
    const acted = new Set(m.receipts.map((r) => r.proposalId));
    const followers = new Set(
      m.proposals.filter((p) => p.strategyId === strategyId && !acted.has(p.id)).map((p) => p.follower),
    );
    for (const follower of followers) await rebuildFor(follower);
  }
  return strategy;
}

/** The execution facts worth recording each time Flash reports a change. */
function orderFacts(r: Receipt) {
  return JSON.parse(
    JSON.stringify({
      status: r.status,
      closeReason: r.closeReason,
      finalFillCount: r.finalFillCount,
      pendingFillCount: r.pendingFillCount,
      averageFillPrice: r.averageFillPrice,
      entryDriftBps: r.entryDriftBps,
      feesUsd: r.feesUsd,
      position: r.position
        ? {
            entryUnits: r.position.entryUnits,
            entryCostUsd: r.position.entryCostUsd,
            exitUnits: r.position.exitUnits,
            exitProceedsUsd: r.position.exitProceedsUsd,
            realizedPnlUsd: r.position.realizedPnlUsd,
            closed: r.position.closed,
          }
        : undefined,
      transactions: [...new Set((r.fills ?? []).map((f) => f.transactionId).filter(Boolean))],
      protection: r.protection
        ? {
            status: r.protection.status,
            bracketOrderId: r.protection.bracketOrderId,
            orderStatus: r.protection.orderStatus,
            closeReason: r.protection.closeReason,
            levelsMatch: r.protection.levelsMatch,
          }
        : undefined,
    }),
  ) as Record<string, unknown>;
}

export function attachOrder(proposalId: string, flashOrderId: string) {
  const m = mem();
  const log = m.logs.find((l) => l.proposalId === proposalId);
  if (log) log.flashOrderId = flashOrderId;
  persist(m);
}

const CLOSED_STATUSES = [
  "ORDER_STATUS_FILLED",
  "ORDER_STATUS_CANCELLED",
  "ORDER_STATUS_REJECTED",
  "ORDER_STATUS_TERMINATED",
];

/**
 * Base units of `spentToken` this follower has committed to other submitted orders that are not
 * closed yet. Flash sizes the Permit2 permit to the new order plus these, so the guard needs the
 * number. It uses each order's full size, which is never smaller than what is still unfilled.
 * Orders placed outside PACT are invisible here.
 */
export function openSpendUnits(
  follower: string,
  chain: string,
  spentToken: string,
  excludeProposalId: string,
): string {
  const m = mem();
  let total = BigInt(0);
  for (const r of m.receipts) {
    if (!r.flashOrderId || r.proposalId === excludeProposalId) continue;
    if (r.follower.toLowerCase() !== follower.toLowerCase()) continue;
    if (r.status && CLOSED_STATUSES.includes(r.status)) continue;
    const p = m.proposals.find((x) => x.id === r.proposalId);
    if (!p || p.chain !== chain) continue;
    const spent = p.side === "buy" ? p.contraAsset : p.targetAsset;
    if (spent.toLowerCase() !== spentToken.toLowerCase()) continue;
    const dec = tokenDecimals(p.chain, spent);
    const units = dec === undefined ? undefined : toUnits(r.decision.modifiedQty ?? p.qty, dec);
    if (units !== undefined) total += units;
  }
  return total.toString();
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
