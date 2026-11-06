"use client";

import { Addr, AddrAvatar, LayerTag, StatusBadge, type Tone } from "@/components/ui";
import { isDemoAddress, isExpired, pairLabel, relativeTime, rewardRisk } from "@/lib/views";
import type { LeaderEvidenceStatus, LeaderPlanGrade, Strategy } from "@/lib/types";
import type { ReactNode } from "react";

/* Discovery building blocks. Cards show a leader's declared plan, never a PnL
   curve: PACT has no verified performance history to draw. */

function num(v?: string) {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : undefined;
}

export function price(v?: string) {
  const x = num(v);
  return x === undefined ? "—" : x.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

const GRADE: Record<LeaderPlanGrade, { tone: Tone; icon: string; label: string }> = {
  DISCIPLINED: { tone: "good", icon: "●", label: "disciplined" },
  CAUTION: { tone: "warn", icon: "!", label: "caution" },
  INCOMPLETE: { tone: "bad", icon: "✕", label: "incomplete" },
};

export function GradeBadge({ grade }: { grade: LeaderPlanGrade }) {
  const g = GRADE[grade];
  return (
    <StatusBadge tone={g.tone} icon={g.icon}>
      {g.label}
    </StatusBadge>
  );
}

const EVIDENCE_BADGE: Record<LeaderEvidenceStatus, { tone: Tone; icon?: string; label: string; title: string }> = {
  ONCHAIN_VERIFIED: { tone: "good", icon: "✓", label: "onchain verified", title: "Final Base transactions show the leader's wallet made this trade near the declared entry" },
  PLAN_MATCHED: { tone: "good", icon: "✓", label: "order matches", title: "The leader's Flash order matches the plan; fills not yet confirmed on chain" },
  ORDER_FOUND: { tone: "neutral", icon: "✓", label: "order found", title: "Flash has an order under the leader's wallet (checked before plan matching existed)" },
  MISMATCH: { tone: "bad", icon: "!", label: "contradicted", title: "The leader's own execution contradicts this plan; copies are held for review" },
  UNVERIFIED: { tone: "neutral", label: "unverified", title: "No evidence of the leader's own execution" },
};

/** How far the plan is backed by the leader's own execution. */
export function EvidenceBadge({ status }: { status?: LeaderEvidenceStatus }) {
  const b = EVIDENCE_BADGE[status ?? "UNVERIFIED"];
  return (
    <span title={b.title}>
      <StatusBadge tone={b.tone} icon={b.icon}>
        {b.label}
      </StatusBadge>
    </span>
  );
}

export function formatRR(value?: number) {
  return value === undefined ? "—" : `${value.toFixed(2)}R`;
}

/** Declared stop → entry → target on one axis. Loss side red, reward side green. */
export function PlanRange({ plan }: { plan: Pick<Strategy, "entryReferencePrice" | "stopLossPrice" | "takeProfitPrice"> }) {
  const entry = num(plan.entryReferencePrice);
  const stop = num(plan.stopLossPrice);
  const target = num(plan.takeProfitPrice);
  if (entry === undefined || stop === undefined || target === undefined) {
    return <div className="text-[11px] text-mute">Plan levels incomplete; no range to draw.</div>;
  }
  const lo = Math.min(stop, target, entry);
  const hi = Math.max(stop, target, entry);
  const span = hi - lo || 1;
  const at = (v: number) => ((v - lo) / span) * 100;
  const segment = (a: number, b: number) => ({ left: `${Math.min(at(a), at(b))}%`, width: `${Math.abs(at(b) - at(a))}%` });
  return (
    <div>
      <div className="relative h-2 rounded-full bg-panel-3" role="img" aria-label={`stop ${stop}, entry ${entry}, target ${target}`}>
        <div className="absolute inset-y-0 rounded-l-full bg-[var(--bad)]/70" style={segment(stop, entry)} />
        <div className="absolute inset-y-0 rounded-r-full bg-[var(--good)]/70" style={segment(entry, target)} />
        <div className="absolute -top-1 h-4 w-0.5 rounded bg-accent" style={{ left: `calc(${at(entry)}% - 1px)` }} />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10.5px] tnum">
        <span className="text-bad">stop {price(plan.stopLossPrice)}</span>
        <span className="text-accent">entry {price(plan.entryReferencePrice)}</span>
        <span className="text-good">target {price(plan.takeProfitPrice)}</span>
      </div>
    </div>
  );
}

export function SideType({ plan }: { plan: Pick<Strategy, "side" | "orderType"> }) {
  return (
    <span className="text-[11.5px] font-medium capitalize">
      <span className={plan.side === "buy" ? "text-good" : "text-bad"}>{plan.side}</span>
      <span className="text-mute"> · {plan.orderType}</span>
    </span>
  );
}

/** Binance-style discovery card, with the declared plan where a PnL chart would be. */
export function FeaturedPlanCard({
  plan,
  selected,
  onInspect,
  action,
}: {
  plan: Strategy;
  selected: boolean;
  onInspect: () => void;
  action: ReactNode;
}) {
  const rr = rewardRisk(plan);
  return (
    <article
      className={`panel flex min-w-0 flex-col p-4 transition ${selected ? "border-accent" : "hover:border-[color-mix(in_oklab,var(--accent)_50%,var(--line))]"}`}
    >
      <div className="flex items-center gap-2.5">
        <AddrAvatar value={plan.leader} size={30} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Addr value={plan.leader} className="text-ink" />
            {isDemoAddress(plan.leader) ? <LayerTag layer="demo" compact /> : null}
          </div>
          <div className="mt-0.5 text-[11px] text-mute">
            {pairLabel(plan)} · expires {relativeTime(plan.expiresAt)}
          </div>
        </div>
      </div>
      <h3 className="mt-3 truncate text-[13.5px] font-medium text-ink" title={plan.title}>
        {plan.title}
      </h3>
      <div className="mt-1 flex items-center justify-between">
        <SideType plan={plan} />
        <span className="label">declared plan</span>
      </div>
      <div className="mt-2.5">
        <PlanRange plan={plan} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-[12px]">
        <dt className="text-mute">Reward:risk</dt>
        <dd className="text-right tnum text-ink">{formatRR(rr)}</dd>
        <dt className="text-mute">Leader size</dt>
        <dd className="text-right tnum text-ink">{plan.qty}</dd>
        <dt className="text-mute">Plan grade</dt>
        <dd className="text-right">
          <GradeBadge grade={plan.leaderPlanGrade} />
        </dd>
        <dt className="text-mute">Evidence</dt>
        <dd className="text-right">
          <EvidenceBadge status={plan.leaderEvidenceStatus} />
        </dd>
      </dl>
      <div className="mt-auto flex gap-2 pt-4">
        <button type="button" className="btn flex-1" onClick={onInspect}>
          Inspect
        </button>
        <div className="flex-1 [&>*]:w-full">{action}</div>
      </div>
    </article>
  );
}

export function activePlans(strategies: Strategy[]) {
  return strategies.filter((s) => !isExpired(s));
}
