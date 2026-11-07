"use client";

import { useDeskContext } from "@/components/DeskContext";
import { ReferencePrices } from "@/components/ReferencePrices";
import { ShareToX, planShareText } from "@/components/ShareToX";
import { SignalList } from "@/components/SignalList";
import { TradingChart } from "@/components/TradingChart";
import { ActionBadge, Addr, AddrAvatar, Empty, Panel, Segmented, StatusBadge, type Tone, leaderName } from "@/components/ui";
import { CopyDrawer, type DrawerTab } from "@/components/pages/copy-drawer";
import { FollowButton } from "@/components/pages/Discover";
import { EvidenceBadge, formatRR, GradeBadge, SideType } from "@/components/pages/discover-parts";
import { useLeaderActions } from "@/components/pages/following-actions";
import { verifyThread, type ChainCheck, type EvidenceEvent } from "@/lib/evidence-verify";
import { reasonLabel, usd } from "@/lib/format";
import type { Timeframe } from "@/lib/market";
import type { ShadowCopy, Strategy } from "@/lib/types";
import { isExpired, leaderRows, orderStatusLabel, pairLabel, relativeTime, rewardRisk, tokenSymbol } from "@/lib/views";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

/*
 * One plan, everything about it on one screen (the token-page pattern): a header strip with
 * the plan's numbers, the chart with its levels, the copy panel on the right, and tabs below
 * for copies, the leader's own execution, PACT's paper copy and the evidence log.
 */

type Tab = "copies" | "execution" | "paper" | "log";

const money = (v?: number, dp = 2) => (v === undefined || !Number.isFinite(v) ? "—" : `$${v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`);
const pctFrom = (from: number, to: number) => ((to - from) / from) * 100;

function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "bad" }) {
  return (
    <div className="min-w-0 px-4 py-2.5">
      <div className="text-[11px] text-mute">{label}</div>
      <div className={`mt-0.5 truncate text-[15px] font-semibold tnum ${tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : "text-ink"}`}>{value}</div>
      {sub ? <div className="truncate text-[11px] text-mute">{sub}</div> : null}
    </div>
  );
}

const SHADOW_TONE: Record<ShadowCopy["status"], Tone> = { TARGET: "good", STOPPED: "bad", EXPIRED: "neutral", OPEN: "neutral", WAITING_ENTRY: "neutral", NOT_COPYABLE: "warn" };

export function PlanPage({ id }: { id: string }) {
  const { state, policy, follower } = useDeskContext();
  const actions = useLeaderActions();
  const [tab, setTab] = useState<Tab>("copies");
  const [tf, setTf] = useState<Timeframe>("5m");
  const [drawer, setDrawer] = useState<{ leader: `0x${string}`; tab: DrawerTab } | null>(null);
  const plan: Strategy | undefined = state?.strategies.find((s) => s.id === id);

  const rows = useMemo(
    () => (state ? leaderRows({ strategies: state.strategies, policies: state.policies, proposals: state.proposals, receipts: state.receipts }, policy) : []),
    [state, policy],
  );
  const leaderRow = plan ? rows.find((r) => r.leader.toLowerCase() === plan.leader.toLowerCase()) : undefined;
  const copies = useMemo(() => (state && plan ? state.proposals.filter((p) => p.strategyId === plan.id) : []), [state, plan]);
  const mine = follower ? copies.find((p) => p.follower.toLowerCase() === follower.toLowerCase()) : undefined;
  const myDecision = mine ? state?.decisions[mine.id] : undefined;
  const myReceipt = mine ? state?.receipts.find((r) => r.proposalId === mine.id) : undefined;

  if (!state) return <p className="p-6 text-[13px] text-mute">Loading…</p>;
  if (!plan) {
    return (
      <Empty title="Plan not found" action={<Link href="/discover" className="btn">Back to leaders</Link>}>
        This plan is not on this PACT store.
      </Empty>
    );
  }

  const entry = Number(plan.entryReferencePrice ?? plan.limitNotionalPrice);
  const stop = Number(plan.stopLossPrice);
  const target = Number(plan.takeProfitPrice);
  const expired = isExpired(plan);
  // Market data is wired for Base WETH/USDC only; anything else gets no stand-in chart.
  const chartable = plan.chain === "base" && tokenSymbol(plan.targetAsset) === "WETH" && tokenSymbol(plan.contraAsset) === "USDC";
  const rr = rewardRisk(plan);
  const copiedUsd = copies.reduce((s, p) => s + (state.receipts.some((r) => r.proposalId === p.id && r.flashOrderId) ? p.notionalUsd : 0), 0);

  return (
    <div>
      {/* Header: identity and the plan's numbers */}
      <div className="panel mb-4">
        <div className="border-b border-line px-5 pt-4">
          {/* A plan belongs to its leader: back goes to the leader's plans. */}
          <Link href={`/leaders/${plan.leader}?tab=plans`} className="text-[13px] text-mute hover:text-ink">
            ← {leaderName(plan.leader)}
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
          <AddrAvatar value={plan.leader} size={40} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="truncate font-[family-name:var(--font-serif)] text-[30px] font-medium leading-tight text-ink">{plan.title}</h1>
              <SideType plan={plan} />
              <GradeBadge grade={plan.leaderPlanGrade} />
              <EvidenceBadge status={plan.leaderEvidenceStatus} />
              {expired ? <StatusBadge tone="neutral">expired</StatusBadge> : <StatusBadge tone="good" icon="●">live</StatusBadge>}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12px] text-mute">
              <span>
                by{" "}
                <Link href={`/leaders/${plan.leader}`} className="text-accent hover:underline" title={plan.leader}>
                  {leaderName(plan.leader)}
                </Link>
              </span>
              <span>{pairLabel(plan)} · {plan.chain}</span>
              <span>published {relativeTime(plan.createdAt)}</span>
              <span>{expired ? "window closed" : `window ends ${relativeTime(plan.expiresAt)}`}</span>
            </div>
          </div>
          <div className="ml-auto">
            <ShareToX text={planShareText(plan)} url={`/plans/${plan.id}`} />
          </div>
        </div>
        <div className="grid grid-cols-2 divide-line sm:grid-cols-4 lg:grid-cols-8 lg:divide-x [&>*]:border-line">
          <Stat label="Entry" value={money(entry)} sub={plan.orderType} />
          <Stat label="Stop" value={money(stop)} sub={entry > 0 && stop > 0 ? `${pctFrom(entry, stop).toFixed(2)}%` : undefined} tone="bad" />
          <Stat label="Target" value={money(target)} sub={entry > 0 && target > 0 ? `+${pctFrom(entry, target).toFixed(2)}%` : undefined} tone="good" />
          <Stat label="Reward : risk" value={formatRR(rr)} />
          <Stat label="Leader size" value={plan.side === "buy" ? usd(Number(plan.qty)) : `${plan.qty} WETH`} />
          <Stat label="Copy capacity" value={plan.maxFollowerNotionalUsd ? usd(plan.maxFollowerNotionalUsd) : "—"} sub="per follower" />
          <Stat label="Copies" value={copies.length} sub={`${usd(copiedUsd)} submitted`} />
          <Stat
            label="Paper copy"
            value={plan.shadow ? plan.shadow.status.replace("_", " ").toLowerCase() : "—"}
            sub={plan.shadow?.rMultiple !== undefined ? `${plan.shadow.rMultiple > 0 ? "+" : ""}${plan.shadow.rMultiple.toFixed(2)}R` : plan.shadow ? `entry ${money(plan.shadow.entryPrice)}` : undefined}
          />
        </div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* Chart with the plan's levels */}
        <div className="space-y-4">
          <Panel
            title="Plan levels on the market"
            subtitle="Entry, stop and target are the leader's declaration; candles are GeckoTerminal"
            layer="market"
            actions={
              <Segmented
                value={tf}
                onChange={setTf}
                options={[
                  { value: "1m", label: "1m" },
                  { value: "5m", label: "5m" },
                  { value: "15m", label: "15m" },
                  { value: "1h", label: "1H" },
                ]}
              />
            }
            bodyClassName="overflow-hidden"
          >
            {chartable ? (
              <TradingChart key={tf} entry={plan.entryReferencePrice} stop={plan.stopLossPrice} target={plan.takeProfitPrice} height={420} timeframe={tf} fitLevels />
            ) : (
              <p className="px-4 py-16 text-center text-[12.5px] text-mute">
                PACT renders a real chart only for Base WETH/USDC. This plan trades {pairLabel(plan)} on {plan.chain}, so no substitute chart is drawn.
              </p>
            )}
          </Panel>

          {/* Tabs */}
          <div className="panel">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <Segmented
                value={tab}
                onChange={setTab}
                options={[
                  { value: "copies", label: "Copies", count: copies.length },
                  { value: "execution", label: "Leader execution" },
                  { value: "paper", label: "Paper copy" },
                  { value: "log", label: "Evidence log" },
                ]}
              />
            </div>
            {tab === "copies" ? <CopiesTab plan={plan} /> : null}
            {tab === "execution" ? <ExecutionTab plan={plan} /> : null}
            {tab === "paper" ? <PaperTab plan={plan} /> : null}
            {tab === "log" ? <LogTab planId={plan.id} /> : null}
          </div>
        </div>

        {/* Right: your copy */}
        <div className="space-y-4">
          <Panel title="Your copy" subtitle="What your mandate does with this plan" layer="policy" bodyClassName="p-4">
            {!follower ? (
              <p className="text-[12.5px] text-mute">Connect your wallet, or view a demo desk, to see your copy.</p>
            ) : mine && myDecision ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <ActionBadge action={myDecision.action} verdict={myDecision.verdict} />
                  <span className="tnum text-[15px] font-semibold text-ink">{usd(mine.notionalUsd)}</span>
                </div>
                {myDecision.reasons.length ? (
                  <ul className="space-y-1 text-[12px] text-mute">
                    {myDecision.reasons.map((r) => (
                      <li key={r}>· {reasonLabel(r)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12px] text-mute">Fits every limit in your mandate.</p>
                )}
                {myReceipt?.flashOrderId ? (
                  <Link href="/execution" className="btn h-10 w-full">
                    View order · {orderStatusLabel(myReceipt.status)}
                  </Link>
                ) : (
                  <Link href={`/review/${mine.id}`} className={`btn h-10 w-full ${myDecision.verdict === "BLOCK" ? "" : "btn-buy"}`}>
                    {myDecision.verdict === "BLOCK" ? "View decision" : "Review & sign"}
                  </Link>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-[12.5px] text-mute">
                  {actions.isFollowing(plan.leader)
                    ? "You follow this leader, but this plan was published before your mandate covered it."
                    : "You do not follow this leader. Copy sets a per-leader mandate; every copy is still checked and signed by you."}
                </p>
                <FollowButton actions={actions} leader={plan.leader} onOpen={(leader, t) => setDrawer({ leader, tab: t })} />
              </div>
            )}
          </Panel>
          <SignalList signals={mine?.signals} />
          <ReferencePrices check={mine ? state.quotes[mine.id]?.reference : undefined} title="Three prices, live" />
          <Panel title="Leader" layer="execution" bodyClassName="p-4">
            <div className="flex items-center gap-3">
              <AddrAvatar value={plan.leader} size={30} />
              <div className="min-w-0 flex-1">
                <Link href={`/leaders/${plan.leader}`} className="block text-[14px] text-ink hover:text-accent">
                  {leaderName(plan.leader)}
                </Link>
                <Addr value={plan.leader} className="text-mute" />
                <div className="text-[11.5px] text-mute">
                  {leaderRow ? `${leaderRow.plans} plans · ${leaderRow.evidenceFound} backed · ${leaderRow.pactFollowers} followers` : ""}
                </div>
              </div>
              <Link href={`/leaders/${plan.leader}`} className="btn h-8 px-3 text-[12px]">
                Profile
              </Link>
            </div>
            {plan.thesis ? <p className="mt-3 text-[12.5px] leading-relaxed text-ink/85">{plan.thesis}</p> : null}
            {plan.invalidation ? <p className="mt-1.5 text-[12px] text-mute">Invalidation: {plan.invalidation}</p> : null}
          </Panel>
        </div>
      </div>

      {drawer && leaderRow ? (
        <CopyDrawer
          key={`${drawer.leader}:${drawer.tab}`}
          row={leaderRow}
          tab={drawer.tab}
          plans={state.strategies.filter((s) => s.leader.toLowerCase() === drawer.leader.toLowerCase()).sort((a, b) => b.createdAt.localeCompare(a.createdAt))}
          onClose={() => setDrawer(null)}
        />
      ) : null}
    </div>
  );
}

function CopiesTab({ plan }: { plan: Strategy }) {
  const { state } = useDeskContext();
  const copies = (state?.proposals ?? []).filter((p) => p.strategyId === plan.id);
  if (!copies.length) return <Empty title="No copies yet">Followers whose mandate covers this leader get a copy when the plan is published.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="tbl tbl-tight">
        <thead>
          <tr>
            <th>Follower</th>
            <th>Decision</th>
            <th className="r">Size</th>
            <th>Why</th>
            <th>Order</th>
          </tr>
        </thead>
        <tbody>
          {copies.map((p) => {
            const d = state?.decisions[p.id];
            const r = state?.receipts.find((x) => x.proposalId === p.id);
            return (
              <tr key={p.id}>
                <td>
                  <Addr value={p.follower} />
                </td>
                <td>{d ? <ActionBadge action={d.action} verdict={d.verdict} /> : "—"}</td>
                <td className="r">{usd(p.notionalUsd)}</td>
                <td className="max-w-[260px] truncate text-[12px] text-mute" title={d?.reasons.map(reasonLabel).join(", ")}>
                  {d?.reasons.length ? d.reasons.map(reasonLabel).join(", ") : "within limits"}
                </td>
                <td className="text-[12px]">
                  {r?.flashOrderId ? `${orderStatusLabel(r.status)}${r.signedBy === "SESSION_KEY" ? " · autopilot" : ""}` : <span className="text-mute">not signed</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ExecutionTab({ plan }: { plan: Strategy }) {
  const ev = plan.leaderEvidence;
  if (!ev?.checks.length) {
    return <Empty title="No execution evidence">The leader has not attached a Flash order or trade transactions to this plan.</Empty>;
  }
  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-2 text-[12px]">
        <EvidenceBadge status={plan.leaderEvidenceStatus} />
        <span className="text-mute">checked {relativeTime(ev.checkedAt)}</span>
        {ev.onchain?.averagePrice ? <span className="text-mute">· leader average {money(ev.onchain.averagePrice)}</span> : null}
      </div>
      <ul className="divide-y divide-line-2 rounded-lg border border-line">
        {ev.checks.map((c) => (
          <li key={c.id} className="flex items-start justify-between gap-3 px-3 py-2 text-[12px]">
            <div className="min-w-0">
              <div className="text-ink">{c.label}</div>
              <div className="mt-0.5 truncate text-[11px] text-mute" title={c.detail}>
                {c.detail}
              </div>
            </div>
            <StatusBadge tone={c.result === "MATCH" ? "good" : c.result === "MISMATCH" ? "bad" : "neutral"}>{c.result}</StatusBadge>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PaperTab({ plan }: { plan: Strategy }) {
  const s = plan.shadow;
  if (!s) return <Empty title="No paper copy">PACT paper-copies new Base WETH/USDC buy plans that declare a stop and a target.</Empty>;
  return (
    <div className="grid gap-x-6 gap-y-2 p-4 text-[12.5px] sm:grid-cols-2">
      <div className="flex justify-between">
        <span className="text-mute">Outcome</span>
        <StatusBadge tone={SHADOW_TONE[s.status]}>{s.status.replace("_", " ").toLowerCase()}</StatusBadge>
      </div>
      <div className="flex justify-between">
        <span className="text-mute">Paper size</span>
        <span className="tnum text-ink">{usd(s.sizeUsd)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-mute">Entry (Flash all-in)</span>
        <span className="tnum text-ink">{money(s.entryPrice)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-mute">Drift vs declared</span>
        <span className="tnum text-ink">{s.entryDriftBps === undefined ? "—" : `${s.entryDriftBps > 0 ? "+" : ""}${s.entryDriftBps.toFixed(0)} bps`}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-mute">Cost</span>
        <span className="tnum text-ink">{(s.costRatio * 100).toFixed(2)}%</span>
      </div>
      <div className="flex justify-between">
        <span className="text-mute">{s.exitPrice ? "Exit" : "Mark"}</span>
        <span className="tnum text-ink">{money(s.exitPrice ?? s.markPrice)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-mute">Result</span>
        <span className={`tnum ${s.rMultiple === undefined ? "text-mute" : s.rMultiple > 0 ? "text-good" : "text-bad"}`}>
          {s.rMultiple === undefined ? "open" : `${s.rMultiple > 0 ? "+" : ""}${s.rMultiple.toFixed(2)}R · ${((s.pnlPct ?? 0) * 100).toFixed(2)}%`}
        </span>
      </div>
      {s.reasons.length ? (
        <div className="sm:col-span-2 text-[12px] text-mute">Not copyable: {s.reasons.map(reasonLabel).join(", ")}</div>
      ) : null}
      <p className="sm:col-span-2 mt-1 text-[11px] text-mute">Paper, not a receipt: entry from a Flash quote at publish, exits from GeckoTerminal candles.</p>
    </div>
  );
}

function LogTab({ planId }: { planId: string }) {
  const [trail, setTrail] = useState<{ events: EvidenceEvent[]; check: ChainCheck } | null>(null);
  useEffect(() => {
    let live = true;
    void fetch(`/api/evidence?thread=${encodeURIComponent(`plan:${planId}`)}`)
      .then((r) => r.json())
      .then(async (body: { events?: EvidenceEvent[] }) => {
        const events = body.events ?? [];
        const check = await verifyThread(events);
        if (live) setTrail({ events, check });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [planId]);
  if (!trail) return <p className="px-4 py-3 text-[12px] text-mute">Loading…</p>;
  return (
    <div className="p-4">
      <div className="mb-2 flex items-center gap-2 text-[12px]">
        <StatusBadge tone={trail.check.ok ? "good" : "bad"}>{trail.check.ok ? "VERIFIED" : "BROKEN"}</StatusBadge>
        <span className="text-mute">re-checked in your browser · {trail.events.length} events</span>
      </div>
      <ol className="divide-y divide-line-2 rounded-lg border border-line">
        {trail.events.map((e) => (
          <li key={e.hash} className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-[12px]">
            <span className="text-ink">{e.kind}</span>
            <span className="shrink-0 font-mono text-[10.5px] text-mute" title={e.hash}>
              #{e.seq} {e.hash.slice(2, 8)} · {relativeTime(e.at)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
