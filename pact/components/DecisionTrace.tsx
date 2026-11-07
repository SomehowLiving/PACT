"use client";

import { useDeskContext } from "@/components/DeskContext";
import { mandateFor } from "@/components/pages/following-actions";
import { Panel, StatusBadge } from "@/components/ui";
import { decisionTrace, traceSummary, type TraceResult, type TraceRow, type TraceStage } from "@/lib/decision-trace";
import type { Decision, Proposal } from "@/lib/types";
import { capacity, CLOSED_STATUSES } from "@/lib/views";
import { useEffect, useMemo, useState } from "react";

const ICON: Record<TraceResult, { mark: string; cls: string; label: string }> = {
  pass: { mark: "✓", cls: "bg-[var(--good)] text-white", label: "passed" },
  fail: { mark: "✕", cls: "bg-[var(--bad)] text-white", label: "failed" },
  scaled: { mark: "↓", cls: "bg-[var(--warn)] text-black", label: "scaled" },
  warn: { mark: "!", cls: "bg-[var(--warn)] text-black", label: "note" },
  skip: { mark: "–", cls: "bg-panel-3 text-mute", label: "not required" },
  pending: { mark: "◷", cls: "bg-panel-3 text-ink/70", label: "at signing" },
  info: { mark: "i", cls: "bg-panel-3 text-ink/70", label: "info" },
};
const STAGES: { stage: TraceStage; what: string }[] = [
  { stage: "Holds", what: "Anything that stops the copy outright. Checked first; the first hit decides." },
  { stage: "Mandate fit", what: "Is this the kind of trade your mandate allows?" },
  { stage: "Size and caps", what: "How big, and does it fit every limit you set?" },
  { stage: "At the quote", what: "Re-checked on Flash's real quote, before anything is signed." },
];

function Row({ r }: { r: TraceRow }) {
  const i = ICON[r.result];
  return (
    <li className="grid grid-cols-[22px_minmax(0,1.2fr)_minmax(0,1.3fr)_minmax(0,0.9fr)] items-start gap-3 border-t border-line-2 px-4 py-2.5 text-[12.5px] first:border-t-0">
      <span aria-label={i.label} title={i.label} className={`mt-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full text-[10px] font-semibold ${i.cls}`}>
        {i.mark}
      </span>
      <span className="min-w-0">
        <span className="text-ink">{r.label}</span>
        {r.why ? <span className="block text-[11px] text-mute">{r.why}</span> : null}
      </span>
      <span className="min-w-0 tnum text-ink/85">
        {r.value}
        {r.limit ? <span className="text-mute"> · limit {r.limit}</span> : null}
      </span>
      <span className="min-w-0 truncate text-right text-[11px] text-mute" title={r.source}>
        {r.source}
      </span>
    </li>
  );
}

/**
 * The deep view of one decision: every check PACT ran for this copy, with its numbers and where
 * they came from. Collapsed to what matters; one click shows all of it.
 */
export function DecisionTrace({ proposal, decision }: { proposal: Proposal; decision?: Decision }) {
  const { state, policy } = useDeskContext();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  const rows = useMemo(() => {
    if (!state || now === null) return [];
    const leader = proposal.leader.toLowerCase();
    const f = proposal.follower.toLowerCase();
    const sleeve = capacity(state, policy, now).sleeves.find((s) => s.leader.toLowerCase() === leader);
    // Rebuild the context PACT decided against: only what existed before this proposal was decided.
    const before = proposal.createdAt;
    const dayStart = new Date(before);
    dayStart.setUTCHours(0, 0, 0, 0);
    const receiptOf = new Map(state.receipts.map((r) => [r.proposalId, r]));
    const leaderOf = new Map(state.proposals.map((p) => [p.id, p.leader.toLowerCase()]));
    const spentToday = state.receipts.filter(
      (r) => r.follower.toLowerCase() === f && r.flashOrderId && r.decision.verdict !== "BLOCK" && r.createdAt >= dayStart.toISOString() && r.createdAt < before && r.proposalId !== proposal.id,
    );
    const openBefore = state.proposals.filter((p) => {
      if (p.id === proposal.id || p.follower.toLowerCase() !== f || p.createdAt >= before) return false;
      const d = state.decisions[p.id];
      if (!d || d.verdict === "BLOCK") return false;
      const r = receiptOf.get(p.id);
      return !(r?.status && CLOSED_STATUSES.includes(r.status));
    });
    const sameAsset = openBefore.filter((p) => p.targetAsset.toLowerCase() === proposal.targetAsset.toLowerCase() && p.side === proposal.side);
    return decisionTrace({
      proposal,
      decision,
      policy,
      mandate: mandateFor(policy, proposal.leader),
      dailySpentUsd: spentToday.reduce((s, r) => s + r.notionalUsd, 0),
      leaderSpentUsd: spentToday.filter((r) => leaderOf.get(r.proposalId) === leader).reduce((s, r) => s + r.notionalUsd, 0),
      leaderSleeveMax: sleeve?.max ?? mandateFor(policy, proposal.leader)?.maxDailyUsd ?? policy.maxLeaderDailyUsd,
      assetExposureUsd: sameAsset.reduce((s, p) => s + (receiptOf.get(p.id)?.flashOrderId ? receiptOf.get(p.id)!.notionalUsd : p.notionalUsd), 0),
      otherOpenPlans: openBefore.length,
      otherOpenPlansForLeader: openBefore.filter((p) => p.leader.toLowerCase() === leader).length,
      conduct: state.conduct?.[leader] ?? null,
      verifiedHuman: !!state.humans?.[leader],
      leaderPaused: !!policy.pausedLeaders?.some((l) => l.toLowerCase() === leader),
      quote: state.quotes[proposal.id],
      nowMs: now,
    });
  }, [state, policy, proposal, decision, now]);

  if (!rows.length) return null;
  const s = traceSummary(rows);
  const notable = rows.filter((r) => r.result === "fail" || r.result === "scaled" || r.result === "warn");
  const parts = [
    `${s.pass} passed`,
    s.fail ? `${s.fail} failed` : "",
    s.scaled ? `${s.scaled} scaled` : "",
    s.warn ? `${s.warn} note${s.warn === 1 ? "" : "s"}` : "",
    s.pending ? `${s.pending} at signing` : "",
    s.skip ? `${s.skip} not required` : "",
  ].filter(Boolean);

  return (
    <Panel
      title="How PACT decided"
      subtitle={`${s.total} checks, in the order PACT runs them · ${parts.join(" · ")}`}
      layer="policy"
      actions={
        <button type="button" className="btn h-9 px-4" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Show less" : `See all ${s.total} checks`}
        </button>
      }
      bodyClassName="p-0"
    >
      {!open ? (
        notable.length ? (
          <ul>
            {notable.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-[12.5px] text-ink/80">Every check that applies passed. Open the full trace to see each number and where it came from.</p>
        )
      ) : (
        <div>
          {STAGES.map(({ stage, what }) => {
            const list = rows.filter((r) => r.stage === stage);
            if (!list.length) return null;
            const passed = list.filter((r) => r.result === "pass").length;
            return (
              <section key={stage} className="border-t border-line first:border-t-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2 bg-panel-2 px-4 py-2">
                  <span className="text-[12.5px] font-medium text-ink">
                    {stage} <span className="text-mute">· {what}</span>
                  </span>
                  <StatusBadge tone={list.some((r) => r.result === "fail") ? "bad" : list.some((r) => r.result === "scaled" || r.result === "warn") ? "warn" : "good"}>
                    {passed}/{list.length} passed
                  </StatusBadge>
                </div>
                <ul>
                  {list.map((r) => (
                    <Row key={r.id} r={r} />
                  ))}
                </ul>
              </section>
            );
          })}
          <p className="border-t border-line px-4 py-2.5 text-[11px] leading-relaxed text-mute">
            After these, your browser checks Flash&apos;s exact payload (recipient, tokens, amount, spender, fee vault, deadline) before your wallet is asked to sign.
            Formulas: docs/trading-principles.md.
          </p>
        </div>
      )}
    </Panel>
  );
}
