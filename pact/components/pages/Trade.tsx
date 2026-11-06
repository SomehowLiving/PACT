"use client";

import { useDeskContext, useMine } from "@/components/DeskContext";
import { TradingChart, useMarket } from "@/components/TradingChart";
import { ReferencePrices } from "@/components/ReferencePrices";
import { SignalList } from "@/components/SignalList";
import { ActionBadge, Addr, AddrAvatar, Empty, LayerTag, StatusBadge, type Tone, leaderName, LeaderTag } from "@/components/ui";
import { reasonLabel, usd } from "@/lib/format";
import type { Timeframe } from "@/lib/market";
import { effectiveLimitNotionalPrice } from "@/lib/policy";
import type { CopyAction, Decision, LeaderPlanGrade, Policy, Proposal } from "@/lib/types";
import {
  ACTIONS,
  actionCounts,
  actionOf,
  executionRows,
  isExpired,
  leaderRows,
  orderStatusLabel,
  relativeTime,
  tokenSymbol,
  type ExecutionRow,
} from "@/lib/views";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

const RAIL_KEY = "pact.tradeRailOpen";

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1H" },
  { value: "4h", label: "4H" },
  { value: "1d", label: "1D" },
];

const GRADE_TONE: Record<LeaderPlanGrade, Tone> = { DISCIPLINED: "good", CAUTION: "warn", INCOMPLETE: "bad" };

type Filter = "ALL" | CopyAction;
type Sort = "newest" | "expiring" | "size";
type BlotterTab = "incoming" | "open" | "executions";
type RailTab = "plan" | "leader" | "activity";

function money(n?: number, digits = 2) {
  return n === undefined || !Number.isFinite(n) ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function pct(from: number, to: number) {
  return ((to - from) / from) * 100;
}

function AssetGlyph({ address }: { address: string }) {
  const symbol = tokenSymbol(address);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#627eea] text-[9px] font-bold text-white"
      >
        {symbol === "WETH" ? "Ξ" : symbol.slice(0, 1)}
      </span>
      <span className="text-ink">{symbol === "WETH" ? "ETH" : symbol}</span>
    </span>
  );
}

function PanelIcon({ side, open }: { side: "right"; open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden data-side={side}>
      <rect x="2" y="2.75" width="12" height="10.5" rx="2" />
      <path d="M10 2.75v10.5" />
      {open ? <path d="M5.75 6.5 7.25 8l-1.5 1.5" strokeLinecap="round" strokeLinejoin="round" /> : <path d="M7.25 6.5 5.75 8l1.5 1.5" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

function Tabs<T extends string>({
  value,
  onChange,
  items,
  aside,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: ReactNode }[];
  aside?: ReactNode;
}) {
  return (
    <div className="flex items-end gap-1 border-b border-line px-3" role="tablist">
      {aside ? <div className="order-last ml-auto self-center">{aside}</div> : null}
      {items.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={`-mb-px border-b-2 px-3 py-3 text-[13.5px] transition-colors ${
            value === t.value ? "border-accent font-medium text-ink" : "border-transparent text-mute hover:text-ink"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span className="ml-1.5 rounded bg-panel-3 px-1.5 py-0.5 text-[11px] font-medium tnum text-ink">{n}</span>;
}

/* ── Pair header ──────────────────────────────────────────────────────── */

function PairHeader() {
  // Hourly candles give a true 24h high, low and volume window.
  const { market } = useMarket("1h");
  const day = market?.candles.slice(-24) ?? [];
  const high = day.length ? Math.max(...day.map((c) => c.high)) : undefined;
  const low = day.length ? Math.min(...day.map((c) => c.low)) : undefined;
  const change = market?.priceChange24h;
  const up = (change ?? 0) >= 0;
  return (
    <div className="panel flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
      <div className="flex items-center gap-3">
        <span aria-hidden className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#627eea] text-[16px] font-bold text-white">
          Ξ
        </span>
        <div>
          <div className="text-[17px] font-semibold text-ink">
            ETH <span className="text-mute">/</span> USDC
          </div>
          <div className="text-[11px] text-mute">WETH on Base · {market?.dex ?? "…"}</div>
        </div>
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`text-[24px] font-semibold tracking-[-0.01em] tnum ${up ? "text-good" : "text-bad"}`}>{money(market?.price)}</span>
        {change !== undefined ? (
          <span className={`text-[13px] tnum ${up ? "text-good" : "text-bad"}`}>
            {up ? "+" : ""}
            {change.toFixed(2)}%
          </span>
        ) : null}
      </div>
      {[
        { k: "24h High", v: money(high) },
        { k: "24h Low", v: money(low) },
        { k: "24h Vol", v: market?.volume24h ? `$${(market.volume24h / 1e6).toFixed(1)}M` : "—" },
        { k: "Liquidity", v: market?.liquidityUsd ? `$${(market.liquidityUsd / 1e6).toFixed(1)}M` : "—" },
      ].map((s) => (
        <div key={s.k} className={s.k === "Liquidity" ? "hidden 2xl:block" : undefined}>
          <div className="text-[11.5px] text-mute">{s.k}</div>
          <div className="mt-0.5 text-[13.5px] font-medium tnum text-ink">{s.v}</div>
        </div>
      ))}
      <div className="ml-auto">
        <LayerTag layer="market" />
      </div>
    </div>
  );
}

/* ── Right rail: plan, mandate check, review ──────────────────────────── */

function MandateCheck({ proposal, decision, policy }: { proposal: Proposal; decision?: Decision; policy: Policy }) {
  const action = actionOf(decision);
  const bound = effectiveLimitNotionalPrice(proposal, policy);
  const entry = Number(proposal.entryReferencePrice);
  const drift = Number(bound) > 0 && entry > 0 ? pct(entry, Number(bound)) : undefined;
  const sizing =
    proposal.copySizingMode === "STOP_RISK"
      ? `stop-risk ${money(proposal.riskBudgetUsd, 0)}`
      : proposal.copySizingMode === "FIXED"
        ? "fixed"
        : `${Math.round(((policy.mandates?.find((m) => m.leader.toLowerCase() === proposal.leader.toLowerCase())?.copyRatio ?? policy.copyRatio) || 0) * 100)}%`;
  const bracket = proposal.followerExitMode !== "MANUAL" && proposal.side === "buy" && proposal.takeProfitPrice && proposal.stopLossPrice;
  const usesImpact = proposal.orderType === "twap" || proposal.orderType === "limit";

  const status =
    action === "COPY"
      ? { tone: "good" as const, text: "Within your risk limits" }
      : action === "SCALE"
        ? { tone: "good" as const, text: "Scaled down to fit your limits" }
        : action === "WAIT"
          ? { tone: "warn" as const, text: "Held for now" }
          : action === "REVIEW"
            ? { tone: "warn" as const, text: "Needs a better plan or evidence" }
            : { tone: "bad" as const, text: "Outside your mandate" };

  return (
    <div className="rounded-lg border border-line bg-bg/50">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[13.5px] font-semibold text-ink">Your mandate check</span>
          <LayerTag layer="policy" compact />
        </div>
        <span className="flex items-center gap-2 text-[12px] text-mute">
          PACT decision <ActionBadge action={decision?.action} verdict={decision?.verdict} />
        </span>
      </div>
      <div className="px-4 py-3">
        <div className={`flex items-center gap-2 text-[13px] font-medium ${status.tone === "good" ? "text-good" : status.tone === "warn" ? "text-warn" : "text-bad"}`}>
          <span
            aria-hidden
            className={`inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-[10px] font-bold text-bg ${
              status.tone === "good" ? "bg-[var(--good)]" : status.tone === "warn" ? "bg-[var(--warn)]" : "bg-[var(--bad)]"
            }`}
          >
            {status.tone === "good" ? "✓" : status.tone === "warn" ? "!" : "×"}
          </span>
          {status.text}
        </div>
        {decision?.reasons.length ? (
          <ul className="mt-2 space-y-0.5 pl-[26px] text-[12px] text-mute">
            {decision.reasons.map((r) => (
              <li key={r}>{reasonLabel(r)}</li>
            ))}
          </ul>
        ) : null}
        <dl className="mt-3 divide-y divide-line-2 text-[13px]">
          <div className="flex justify-between py-2">
            <dt className="text-mute">Your size ({sizing})</dt>
            <dd className="tnum text-ink">≈ {money(proposal.notionalUsd)}</dd>
          </div>
          <div className="flex justify-between py-2">
            <dt className="text-mute">Entry bound ({proposal.side === "buy" ? "max" : "min"})</dt>
            <dd className="tnum text-ink">
              {bound ? (
                <>
                  {proposal.side === "buy" ? "≤" : "≥"} {money(Number(bound))}
                  {drift !== undefined ? <span className="ml-1 text-mute">({drift >= 0 ? "+" : ""}{drift.toFixed(1)}%)</span> : null}
                </>
              ) : (
                <span className="text-mute">no bound for {proposal.orderType}</span>
              )}
            </dd>
          </div>
          <div className="flex justify-between py-2">
            <dt className="text-mute">Exit</dt>
            <dd className="tnum text-ink">
              {bracket ? `TP ${money(Number(proposal.takeProfitPrice), 0)} / SL ${money(Number(proposal.stopLossPrice), 0)}` : "manual exit"}
            </dd>
          </div>
          <div className="flex justify-between py-2">
            <dt className="text-mute">{usesImpact ? "Quote impact (max)" : "Slippage (max)"}</dt>
            <dd className="tnum text-ink">{(Number(usesImpact ? policy.maxPriceImpact : policy.maxSlippage) * 100).toFixed(2)}%</dd>
          </div>
          {proposal.copySizingMode === "STOP_RISK" && proposal.estimatedLossAtStopUsd ? (
            <div className="flex justify-between py-2">
              <dt className="text-mute">Planned loss at stop</dt>
              <dd className="tnum text-ink">≈ {money(proposal.estimatedLossAtStopUsd)}</dd>
            </div>
          ) : null}
        </dl>
      </div>
    </div>
  );
}

function CollapsedRail({ decision, onExpand }: { decision?: Decision; onExpand: () => void }) {
  return (
    <div className="panel hidden flex-col items-center gap-3 py-3 xl:sticky xl:top-[72px] xl:flex">
      <button
        type="button"
        onClick={onExpand}
        className="btn btn-ghost h-8 w-8 border-transparent p-0 text-mute hover:text-ink"
        aria-label="Show plan panel"
        title="Show plan panel"
      >
        <PanelIcon side="right" open={false} />
      </button>
      {decision ? <ActionBadge action={decision.action} verdict={decision.verdict} /> : null}
      <button
        type="button"
        onClick={onExpand}
        className="text-[12px] font-medium text-mute hover:text-ink [writing-mode:vertical-rl]"
      >
        PACT Plan
      </button>
    </div>
  );
}

function PlanRail({
  proposal,
  decision,
  tab,
  setTab,
  onCollapse,
}: {
  proposal?: Proposal;
  decision?: Decision;
  tab: RailTab;
  setTab: (t: RailTab) => void;
  onCollapse?: () => void;
}) {
  const { state, policy } = useDeskContext();
  const receipt = proposal ? state?.receipts.find((r) => r.proposalId === proposal.id) : undefined;
  const leader = useMemo(
    () => (proposal && state ? leaderRows(state, policy).find((r) => r.leader.toLowerCase() === proposal.leader.toLowerCase()) : undefined),
    [proposal, state, policy],
  );
  const logs = proposal ? (state?.logs ?? []).filter((l) => l.proposalId === proposal.id) : [];

  if (!proposal) {
    return (
      <div className="panel">
        <Empty title="Select a plan">Pick a plan from Incoming Plans to see the leader&apos;s levels and your mandate check.</Empty>
      </div>
    );
  }

  const entry = Number(proposal.entryReferencePrice);
  const target = Number(proposal.takeProfitPrice);
  const stop = Number(proposal.stopLossPrice);
  const action = actionOf(decision);
  const canReview = action === "COPY" || action === "SCALE";
  const mandate = policy.mandates?.find((m) => m.leader.toLowerCase() === proposal.leader.toLowerCase());

  return (
    <div className="panel flex flex-col xl:sticky xl:top-[72px]">
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "plan", label: "PACT Plan" },
          { value: "leader", label: "Leader" },
          { value: "activity", label: "Activity" },
        ]}
        aside={
          onCollapse ? (
            <button
              type="button"
              onClick={onCollapse}
              className="btn btn-ghost hidden h-8 w-8 border-transparent p-0 text-mute hover:text-ink xl:inline-flex"
              aria-label="Hide plan panel"
              title="Hide plan panel"
            >
              <PanelIcon side="right" open />
            </button>
          ) : null
        }
      />
      {tab === "plan" ? (
        <div className="space-y-4 p-4">
          <div className="flex items-start gap-3">
            <AddrAvatar value={proposal.leader} size={40} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Link href={`/leaders/${proposal.leader}`} className="text-[15px] font-semibold text-ink hover:text-accent">
                  {leaderName(proposal.leader)}
                </Link>
                <Addr value={proposal.leader} className="text-mute" />
                {leader?.isDemo ? <LayerTag layer="demo" compact /> : null}
              </div>
              <div className="mt-0.5 truncate text-[13px] text-mute">{proposal.title}</div>
            </div>
            <StatusBadge tone={GRADE_TONE[proposal.leaderPlanGrade]}>{proposal.leaderPlanGrade}</StatusBadge>
          </div>

          <div className="grid grid-cols-4 divide-x divide-line rounded-lg border border-line">
            {[
              { k: "Side", v: <span className={proposal.side === "buy" ? "text-good" : "text-bad"}>{proposal.side === "buy" ? "Long" : "Short"}</span> },
              { k: "Entry (ref)", v: entry > 0 ? money(entry, 0) : "—" },
              {
                k: "Target",
                v: target > 0 ? (
                  <>
                    {money(target, 0)}
                    {entry > 0 ? <div className="text-[11px] text-good">{pct(entry, target) >= 0 ? "+" : ""}{pct(entry, target).toFixed(1)}%</div> : null}
                  </>
                ) : (
                  "—"
                ),
              },
              {
                k: "Stop",
                v: stop > 0 ? (
                  <>
                    {money(stop, 0)}
                    {entry > 0 ? <div className="text-[11px] text-bad">{pct(entry, stop).toFixed(1)}%</div> : null}
                  </>
                ) : (
                  "—"
                ),
              },
            ].map((s) => (
              <div key={s.k} className="min-w-0 px-2.5 py-2.5">
                <div className="text-[11px] text-mute">{s.k}</div>
                <div className="mt-0.5 text-[13.5px] font-semibold tnum text-ink">{s.v}</div>
              </div>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-ink">Thesis</h3>
              <span className="text-[11px] text-mute">declared by the leader</span>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-ink/85">{proposal.thesis}</p>
            {proposal.invalidation ? <p className="mt-1.5 text-[12px] leading-relaxed text-mute">Invalidation: {proposal.invalidation}</p> : null}
          </div>

          <MandateCheck proposal={proposal} decision={decision} policy={policy} />

          <SignalList signals={proposal.signals} />
          <ReferencePrices check={state?.quotes[proposal.id]?.reference} title={state?.quotes[proposal.id]?.reference ? "Prices at your quote" : "Three prices, live"} />

          <div className="flex gap-2">
            <Link
              href={`/review/${proposal.id}`}
              target="_blank"
              className="btn h-11 w-11 shrink-0 p-0"
              title="Open the full review in a new tab"
              aria-label="Open the full review in a new tab"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                <path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3" />
              </svg>
            </Link>
            {receipt?.flashOrderId ? (
              <Link href="/execution" className="btn h-11 flex-1 text-[14px] font-semibold">
                View order · {orderStatusLabel(receipt.status)}
              </Link>
            ) : canReview ? (
              <Link
                href={`/review/${proposal.id}`}
                className="btn btn-buy h-11 flex-1 text-[14.5px] font-semibold"
              >
                Review &amp; Sign
              </Link>
            ) : (
              <Link href={`/review/${proposal.id}`} className="btn h-11 flex-1 text-[14px]">
                View decision
              </Link>
            )}
          </div>
          <p className="text-[11.5px] leading-relaxed text-mute">
            Signing happens in review, after a live Flash quote is checked against your mandate and the payload is verified in your
            browser.
          </p>
        </div>
      ) : tab === "leader" ? (
        <div className="p-4">
          <dl className="divide-y divide-line-2 text-[13px]">
            {[
              ["Plans live / published", leader ? `${leader.activePlans} / ${leader.plans}` : "—"],
              ["Average declared R:R", leader?.avgRewardRisk !== undefined ? `${leader.avgRewardRisk.toFixed(2)}R` : "—"],
              ["Backed by own execution", leader ? `${leader.evidenceFound} of ${leader.plans}` : "—"],
              ["PACT followers", leader ? String(leader.pactFollowers) : "—"],
              ["Copies filled via PACT", leader ? `${leader.filledOrders} of ${leader.copiedOrders}` : "—"],
              ["Mean entry drift", leader?.meanDriftBps !== undefined ? `${leader.meanDriftBps.toFixed(1)} bps` : "—"],
              ["Your sizing", mandate ? mandate.sizingMode.toLowerCase().replace("_", "-") : "global default"],
              ["Your daily sleeve", money(mandate?.maxDailyUsd ?? policy.maxLeaderDailyUsd, 0)],
              ["Status", leader?.paused ? "paused by you" : leader?.following ? "following" : "not followed"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 py-2">
                <dt className="text-mute">{k}</dt>
                <dd className="tnum text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex gap-2">
            <Link href="/discover" className="btn flex-1">
              Copyability check
            </Link>
            <Link href="/following" className="btn flex-1">
              Manage leader
            </Link>
          </div>
          <p className="mt-3 text-[11.5px] text-mute">No PnL or win rate is shown: none is verified for this leader.</p>
        </div>
      ) : (
        <div className="p-4">
          {logs.length || receipt ? (
            <ol className="space-y-3 text-[12.5px]">
              {receipt?.flashOrderId ? (
                <li className="flex gap-3">
                  <LayerTag layer="execution" compact />
                  <div>
                    <div className="text-ink">Order {orderStatusLabel(receipt.status)}</div>
                    <div className="font-mono text-[11px] text-mute">{receipt.flashOrderId}</div>
                    <div className="text-[11px] text-mute">{relativeTime(receipt.createdAt)}</div>
                  </div>
                </li>
              ) : null}
              {logs.map((l) => (
                <li key={`${l.at}-${l.verdict}`} className="flex gap-3">
                  <LayerTag layer="policy" compact />
                  <div className="min-w-0">
                    <div className="text-ink">
                      Decided {l.verdict}
                      {l.reasons.length ? <span className="text-mute"> · {l.reasons.map(reasonLabel).join(", ")}</span> : null}
                    </div>
                    <div className="truncate font-mono text-[11px] text-mute" title={l.policyHash}>
                      policy {l.policyHash.slice(0, 12)}… · plan {l.proposalHash.slice(0, 12)}…
                    </div>
                    <div className="text-[11px] text-mute">{relativeTime(l.at)}</div>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <Empty title="No activity yet" />
          )}
        </div>
      )}
    </div>
  );
}

/* ── Blotter ──────────────────────────────────────────────────────────── */

function IncomingTable({
  rows,
  decisions,
  selectedId,
  onSelect,
}: {
  rows: Proposal[];
  decisions: Record<string, Decision>;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  if (!rows.length) {
    return (
      <Empty title="No plans here" action={<Link href="/discover" className="btn">Discover leaders</Link>}>
        Plans from leaders you follow land here, each already decided against your mandate.
      </Empty>
    );
  }
  return (
    <div className="scroll-thin max-h-[420px] overflow-auto">
      <table className="tbl tbl-tight">
        <thead>
          <tr>
            <th>Plan</th>
            <th>Leader</th>
            <th>Asset</th>
            <th>Direction</th>
            <th>PACT decision</th>
            <th className="r">Est. size</th>
            <th className="r">Expires in</th>
            <th className="r" />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const d = decisions[p.id];
            const blocked = !d || d.verdict === "BLOCK";
            return (
              <tr key={p.id} data-selected={selectedId === p.id} onClick={() => onSelect(p.id)} className="cursor-pointer">
                <td className="max-w-[220px]">
                  <div className="truncate font-medium text-ink">{p.title}</div>
                  <div className="text-[11.5px] text-mute">
                    {relativeTime(p.createdAt)} · {p.orderType}
                  </div>
                </td>
                <td>
                  <span className="inline-flex items-center gap-2">
                    <LeaderTag value={p.leader} size={20} />
                  </span>
                </td>
                <td>
                  <AssetGlyph address={p.targetAsset} />
                </td>
                <td className={p.side === "buy" ? "text-good" : "text-bad"}>{p.side === "buy" ? "Long" : "Short"}</td>
                <td>
                  <ActionBadge action={d?.action} verdict={d?.verdict} />
                </td>
                <td className="r text-ink">{blocked ? "—" : usd(p.notionalUsd)}</td>
                <td className={`r ${isExpired(p) ? "text-mute line-through" : "text-ink"}`}>{relativeTime(p.expiresAt).replace("in ", "")}</td>
                <td className="r" onClick={(e) => e.stopPropagation()}>
                  <Link href={`/review/${p.id}`} className="btn h-7 px-3 text-[12px]">
                    Review
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OrdersTable({ rows, empty }: { rows: ExecutionRow[]; empty: string }) {
  if (!rows.length) {
    return <Empty title={empty}>Orders appear after you sign a COPY or SCALE plan in review. PACT never submits without your signature.</Empty>;
  }
  return (
    <div className="scroll-thin max-h-[420px] overflow-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th>Status</th>
            <th>Plan</th>
            <th>Asset</th>
            <th className="r">Notional</th>
            <th>Slices</th>
            <th className="r">Avg fill</th>
            <th className="r">Entry drift</th>
            <th className="r">Submitted</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.receipt.id}>
              <td>
                <StatusBadge tone={r.closed ? (r.receipt.status === "ORDER_STATUS_FILLED" ? "good" : "neutral") : "warn"}>
                  {orderStatusLabel(r.receipt.status)}
                </StatusBadge>
              </td>
              <td className="max-w-[220px] truncate text-ink">{r.proposal?.title ?? "—"}</td>
              <td>{r.proposal ? <AssetGlyph address={r.proposal.targetAsset} /> : "—"}</td>
              <td className="r text-ink">{usd(r.receipt.notionalUsd)}</td>
              <td>
                {r.bucketCount ? (
                  <span className="inline-flex items-center gap-1" aria-label={`${r.fillCount} of ${r.bucketCount} slices`}>
                    {Array.from({ length: Math.min(r.bucketCount, 12) }, (_, i) => (
                      <span key={i} className={`h-2 w-2 rounded-full ${i < r.fillCount ? "bg-[var(--layer-exec)]" : "bg-panel-3"}`} />
                    ))}
                    <span className="ml-1 text-[11px] text-mute tnum">
                      {r.fillCount}/{r.bucketCount}
                    </span>
                  </span>
                ) : (
                  <span className="text-mute">{r.fillCount} fills</span>
                )}
              </td>
              <td className="r text-ink">{r.receipt.averageFillPrice ? money(Number(r.receipt.averageFillPrice)) : "—"}</td>
              <td className="r text-ink">
                {r.receipt.entryDriftBps === undefined ? "—" : `${r.receipt.entryDriftBps >= 0 ? "+" : ""}${r.receipt.entryDriftBps.toFixed(1)} bps`}
              </td>
              <td className="r text-mute">{relativeTime(r.receipt.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

export function Trade() {
  const { state, follower } = useDeskContext();
  const mine = useMine();
  const decisions = useMemo(() => state?.decisions ?? {}, [state?.decisions]);
  const [tf, setTf] = useState<Timeframe>("1h");
  const [blotter, setBlotter] = useState<BlotterTab>("incoming");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [sort, setSort] = useState<Sort>("newest");
  const [picked, setPicked] = useState<string | null>(null);
  const [railTab, setRailTab] = useState<RailTab>("plan");
  const [railOpen, setRailOpenState] = useState(true);
  // Per-browser preference, restored after hydration.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        if (localStorage.getItem(RAIL_KEY) === "0") setRailOpenState(false);
      } catch {
        /* storage unavailable */
      }
    }, 0);
    return () => clearTimeout(id);
  }, []);
  const setRailOpen = (open: boolean) => {
    setRailOpenState(open);
    try {
      localStorage.setItem(RAIL_KEY, open ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  };

  const counts = actionCounts(mine, decisions);
  const incoming = useMemo(() => {
    const rows = mine.filter((p) => filter === "ALL" || actionOf(decisions[p.id]) === filter);
    return [...rows].sort((a, b) =>
      sort === "newest"
        ? b.createdAt.localeCompare(a.createdAt)
        : sort === "expiring"
          ? a.expiresAt.localeCompare(b.expiresAt)
          : b.notionalUsd - a.notionalUsd,
    );
  }, [mine, filter, sort, decisions]);
  const orders = useMemo(() => (state ? executionRows(state, follower) : []), [state, follower]);
  const open = orders.filter((o) => !o.closed);

  // Open on the first plan the follower can act on, not on a held or refused one.
  const actionable = incoming.find((p) => {
    const a = actionOf(decisions[p.id]);
    return a === "COPY" || a === "SCALE";
  });
  const selected = mine.find((p) => p.id === picked) ?? actionable ?? incoming[0] ?? mine[0];
  const selectedDecision = selected ? decisions[selected.id] : undefined;
  const { policy } = useDeskContext();
  const bound = selected ? effectiveLimitNotionalPrice(selected, policy) : undefined;

  return (
    <div
      className={`grid grid-cols-1 items-start gap-4 ${
        railOpen ? "xl:grid-cols-[minmax(0,1fr)_390px]" : "xl:grid-cols-[minmax(0,1fr)_44px]"
      }`}
    >
      <div className="min-w-0 space-y-4">
        <PairHeader />

        <section className="panel overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <div className="flex items-center gap-0.5" role="tablist" aria-label="Timeframe">
              {TIMEFRAMES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="tab"
                  aria-selected={tf === t.value}
                  onClick={() => setTf(t.value)}
                  className={`rounded-md px-2.5 py-1 text-[12.5px] tnum transition-colors ${tf === t.value ? "bg-panel-3 font-medium text-ink" : "text-mute hover:text-ink"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {selected ? (
              <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-mute">
                <span className="truncate text-ink/80">{selected.title}</span>
                <Legend color="var(--accent)" label="entry" />
                <Legend color="var(--good)" label="target" />
                <Legend color="var(--bad)" label="stop" />
                {bound ? <Legend color="var(--warn)" label="your bound" dotted /> : null}
              </div>
            ) : null}
          </div>
          <TradingChart
            timeframe={tf}
            showHeader={false}
            showLegend={false}
            height={400}
            entry={selected?.entryReferencePrice}
            stop={selected?.stopLossPrice}
            target={selected?.takeProfitPrice}
            bound={bound}
          />
        </section>

        <section className="panel overflow-hidden">
          <Tabs
            value={blotter}
            onChange={setBlotter}
            items={[
              { value: "incoming", label: <>Incoming plans<Count n={mine.length} /></> },
              { value: "open", label: <>Open positions<Count n={open.length} /></> },
              { value: "executions", label: <>Recent executions<Count n={orders.length} /></> },
            ]}
          />
          {blotter === "incoming" ? (
            <>
              <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                <div className="seg">
                  {(["ALL", ...ACTIONS] as Filter[]).map((f) => (
                    <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f} data-on={filter === f}>
                      {f === "ALL" ? "All" : f}
                      {f !== "ALL" ? <span className="ml-1.5 tnum opacity-70">{counts[f]}</span> : null}
                    </button>
                  ))}
                </div>
                <label className="ml-auto flex items-center gap-2 text-[12.5px] text-mute">
                  Sort
                  <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="field w-auto rounded-full py-1.5 pl-4 pr-8">
                    <option value="newest">Newest</option>
                    <option value="expiring">Expiring soon</option>
                    <option value="size">Largest size</option>
                  </select>
                </label>
              </div>
              <IncomingTable rows={incoming} decisions={decisions} selectedId={selected?.id} onSelect={(id) => {
                setPicked(id);
                setRailTab("plan");
              }} />
            </>
          ) : blotter === "open" ? (
            <OrdersTable rows={open} empty="No open positions" />
          ) : (
            <OrdersTable rows={orders} empty="No executions yet" />
          )}
        </section>
      </div>

      {railOpen ? (
        <PlanRail proposal={selected} decision={selectedDecision} tab={railTab} setTab={setRailTab} onCollapse={() => setRailOpen(false)} />
      ) : (
        <>
          <CollapsedRail decision={selectedDecision} onExpand={() => setRailOpen(true)} />
          {/* Below xl the panel stacks under the blotter and is never collapsed. */}
          <div className="xl:hidden">
            <PlanRail proposal={selected} decision={selectedDecision} tab={railTab} setTab={setRailTab} />
          </div>
        </>
      )}
    </div>
  );
}

function Legend({ color, label, dotted }: { color: string; label: string; dotted?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block w-3.5 border-t-2" style={{ borderColor: color, borderStyle: dotted ? "dotted" : "dashed" }} />
      {label}
    </span>
  );
}
