import { CHAINS } from "@/lib/chains";
import { evidenceHead, threadEvents, threads, verifyThread, type EvidenceEvent } from "@/lib/evidence";
import { INTEGRATOR_FEE_BPS } from "@/lib/constants";
import { receiptVerdict, refreshReceipt } from "@/lib/receipts";
import { policyFor, snapshot } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Exports one follower order as a self-contained evidence bundle: PACT's policy
 * decision and quote next to Flash's own order and fill record. The raw Flash
 * response is kept verbatim so later work (plan/order matching, fee and venue
 * fields) can be designed against the real schema instead of a guess.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const state = snapshot();
  const receipt = state.receipts.find((r) => r.flashOrderId === id);
  if (!receipt) {
    return Response.json({ error: "unknown order" }, { status: 404 });
  }
  const proposal = state.proposals.find((p) => p.id === receipt.proposalId);
  const quote = state.quotes[receipt.proposalId];
  const log = state.logs.find((l) => l.proposalId === receipt.proposalId);
  const chain = proposal?.chain ?? receipt.chain ?? "base";

  const refreshed = await refreshReceipt(receipt);
  const current = refreshed.receipt;
  const fetchedAt = new Date().toISOString();
  const flash = refreshed.ok
    ? { live: true, fetchedAt, raw: refreshed.detail, protectionOrder: refreshed.protectionOrder }
    : { live: false, fetchedAt, error: refreshed.pending ? "Flash has not published the order yet" : refreshed.error };
  const verdict = receiptVerdict({
    side: proposal?.side ?? "buy",
    follower: receipt.follower,
    receipt: current,
    quote,
    order: refreshed.ok ? refreshed.detail.order : undefined,
    integratorFeeBps: INTEGRATOR_FEE_BPS,
  });

  // The proposal's own chain of events, plus the mandate and plan records its decision names.
  const trail = threadEvents(threads.proposal(receipt.proposalId));
  const decided = [...trail].reverse().find((e) => e.kind === "decision.made");
  const findIn = (thread: string, key: string, value: unknown): EvidenceEvent | undefined =>
    value ? [...threadEvents(thread)].reverse().find((e) => e.data[key] === value) : undefined;
  const mandateEvent = findIn(threads.mandate(receipt.follower), "policyHash", decided?.data.policyHash);
  const planEvent = proposal ? findIn(threads.plan(proposal.strategyId), "planHash", decided?.data.planHash) : undefined;
  const trailCheck = await verifyThread(trail);

  const txIds = [
    ...new Set(
      [current.transactionId, ...(current.fills ?? []).map((f) => f.transactionId)].filter(
        (tx): tx is string => !!tx,
      ),
    ),
  ];
  const bundle = {
    kind: "pact.execution-evidence",
    version: 3,
    exportedAt: new Date().toISOString(),
    flashOrderId: id,
    chain,
    follower: receipt.follower,
    leader: proposal?.leader,
    transactions: txIds.map((tx) => ({ id: tx, explorer: `${CHAINS[chain].explorerTx}${tx}` })),
    verdict,
    fidelity: {
      declaredEntryPrice: current.declaredEntryPrice,
      quotedExecutionPrice: current.quotedExecutionPrice,
      averageFillPrice: current.averageFillPrice,
      allInPrice: current.allInPrice,
      entryDriftBps: current.entryDriftBps,
      quotedFeeUsd: current.quotedFeeUsd,
      feesUsd: current.feesUsd,
      followerMaxEntryDrift: policyFor(receipt.follower).maxEntryDrift,
      effectiveLimitNotionalPrice: quote?.effectiveLimitNotionalPrice,
      fillCount: current.finalFillCount ?? current.fills?.length ?? 0,
      pendingFillCount: current.pendingFillCount ?? 0,
      twapBucketCount: current.twapBucketCount,
    },
    protection: current.protection,
    pact: {
      decision: receipt.decision,
      proposalHash: log?.proposalHash,
      policyHash: log?.policyHash,
      proposal,
      quote: quote
        ? {
            quoteId: quote.quoteId,
            qty: quote.qty,
            notionalUsd: quote.notionalUsd,
            executionPrice: quote.executionPrice,
            estimatedPriceImpact: quote.estimatedPriceImpact,
            allInPrice: quote.allInPrice,
            feeNotional: quote.feeNotional,
            costRatio: quote.costRatio,
            limitBasis: quote.limitBasis,
            maxPriceImpact: quote.maxPriceImpact,
            declaredLimitNotionalPrice: quote.declaredLimitNotionalPrice,
            effectiveLimitNotionalPrice: quote.effectiveLimitNotionalPrice,
            attachedBracket: quote.attachedBracket?.bracket,
            createdAt: quote.createdAt,
          }
        : undefined,
      receipt: current,
    },
    flash,
    evidence: {
      about:
        "Append-only, hash-chained PACT records. Each event's hash is SHA-256 over its canonical JSON without `hash`; `threadPrev` links the events of this copy, `prev` links the whole log. Recompute with lib/evidence-verify or /api/evidence.",
      verification: trailCheck,
      events: trail,
      mandate: mandateEvent ?? null,
      plan: planEvent ?? null,
      log: evidenceHead(),
    },
    caveats: [
      "Flash is the source of execution facts; PACT fields are its own policy and quote records.",
      "Entry drift compares the average fill to the leader's declared entry, not to a market benchmark.",
      "This bundle does not claim the leader's own Flash order matches the published plan.",
      "The evidence log is tamper-evident, not tamper-proof: PACT could rewrite the whole log. Anchoring the head hash on chain is planned.",
      "A Flash signature binds tokens, maximum spend, recipient and deadline; prices and TP/SL triggers are enforced by Flash's engine, so PACT reads them back and reports MATCH or MISMATCH.",
    ],
  };

  const download = new URL(req.url).searchParams.has("download");
  return Response.json(bundle, {
    headers: download
      ? { "content-disposition": `attachment; filename="pact-evidence-${id}.json"` }
      : undefined,
  });
}
