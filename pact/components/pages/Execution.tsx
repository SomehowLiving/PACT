"use client";

import { useDeskContext } from "@/components/DeskContext";
import { ActionBadge, AddrAvatar, Empty, KV, PageHeader, Planned, StatusBadge, type Tone, leaderName } from "@/components/ui";
import { mandateFor } from "@/components/pages/following-actions";
import { CHAINS } from "@/lib/chains";
import { reasonLabel, usd } from "@/lib/format";
import { executionRows, orderStatusLabel, pairLabel, relativeTime, type ExecutionRow } from "@/lib/views";
import { receiptVerdict, type VerdictLine } from "@/lib/verdict";
import { verifyThread, type ChainCheck, type EvidenceEvent } from "@/lib/evidence-verify";
import type { Receipt } from "@/lib/types";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

function price(value?: string) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—";
}

function bps(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)} bps`;
}

type Bucket = "working" | "executed" | "partial" | "failed";

/** One bucket per order, from Flash's status and its fill rows. */
function bucketOf(row: ExecutionRow): Bucket {
  const s = row.receipt.status ?? "";
  if (s === "ORDER_STATUS_FILLED") return "executed";
  if (s === "ORDER_STATUS_PARTIALLY_FILLED" || (row.closed && row.fillCount > 0)) return "partial";
  if (row.closed) return "failed";
  return "working";
}

const BUCKET: Record<Bucket, { label: string; tone: Tone }> = {
  working: { label: "Working", tone: "warn" },
  executed: { label: "Executed", tone: "good" },
  partial: { label: "Partial", tone: "warn" },
  failed: { label: "Failed / cancelled", tone: "bad" },
};

function statusTone(row: ExecutionRow): { tone: Tone; icon: string } {
  const s = row.receipt.status ?? "";
  if (s === "ORDER_STATUS_FILLED") return { tone: "good", icon: "●" };
  if (s === "ORDER_STATUS_CANCELLED" || s === "ORDER_STATUS_TERMINATED") return { tone: "neutral", icon: "■" };
  if (s === "ORDER_STATUS_REJECTED") return { tone: "bad", icon: "✕" };
  return { tone: "warn", icon: "◷" };
}

/** Share of the order filled: TWAP buckets when Flash reported them, else filled notional. */
function fillShare(row: ExecutionRow) {
  if (row.progress !== undefined) return row.progress;
  if (row.receipt.notionalUsd > 0 && row.filledUsd > 0) return Math.min(1, row.filledUsd / row.receipt.notionalUsd);
  return row.receipt.status === "ORDER_STATUS_FILLED" ? 1 : 0;
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-3" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-[var(--good)] transition-all" style={{ width: `${value * 100}%` }} />
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: Tone }) {
  const color = tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-ink";
  return (
    <div className="panel min-w-0 p-4">
      <div className="text-[12.5px] text-mute">{label}</div>
      <div className={`mt-1.5 font-[family-name:var(--font-serif)] text-[28px] font-medium leading-none tnum ${color}`}>{value}</div>
      {sub ? <div className="mt-1.5 text-[11.5px] text-mute">{sub}</div> : null}
    </div>
  );
}

type View = "all" | Bucket;
type Range = "all" | "1d" | "7d" | "30d";
const RANGE_MS: Record<Exclude<Range, "all">, number> = { "1d": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 };
const PAGE = 10;
const VIEWS: View[] = ["all", "working", "executed", "partial", "failed"];

export function Execution() {
  const { state, refresh, follower } = useDeskContext();
  const rows = useMemo(() => (state && follower ? executionRows(state, follower) : []), [state, follower]);
  const [view, setView] = useState<View>("all");
  const [query, setQuery] = useState("");
  const [leader, setLeader] = useState("all");
  const [pair, setPair] = useState("all");
  const [range, setRange] = useState<{ key: Range; since: number }>({ key: "all", since: 0 });
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [urlReady, setUrlReady] = useState(false);

  // Status view and the selected order live in the URL (?view=&order=), so links and refresh keep them.
  useEffect(() => {
    const id = setTimeout(() => {
      const p = new URLSearchParams(window.location.search);
      const v = p.get("view") as View | null;
      if (v && VIEWS.includes(v)) setView(v);
      if (p.get("order")) setSelectedId(p.get("order"));
      setUrlReady(true);
    }, 0);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    if (!urlReady) return;
    const p = new URLSearchParams();
    if (view !== "all") p.set("view", view);
    if (selectedId) p.set("order", selectedId);
    const next = `${window.location.pathname}${p.size ? `?${p}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", next);
  }, [urlReady, view, selectedId]);

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = { working: 0, executed: 0, partial: 0, failed: 0 };
    for (const r of rows) c[bucketOf(r)] += 1;
    return c;
  }, [rows]);
  const leaders = [...new Set(rows.map((r) => r.proposal?.leader.toLowerCase()).filter(Boolean) as string[])];
  const pairs = [...new Set(rows.map((r) => (r.proposal ? pairLabel(r.proposal) : "")).filter(Boolean))];
  const q = query.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (view !== "all" && bucketOf(r) !== view) return false;
    if (leader !== "all" && r.proposal?.leader.toLowerCase() !== leader) return false;
    if (pair !== "all" && (!r.proposal || pairLabel(r.proposal) !== pair)) return false;
    if (range.key !== "all" && Date.parse(r.receipt.createdAt) < range.since) return false;
    if (!q) return true;
    return [r.receipt.flashOrderId, r.proposal?.title, r.proposal?.leader, r.proposal ? pairLabel(r.proposal) : ""].some((s) => s?.toLowerCase().includes(q));
  });
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const current = Math.min(page, pages - 1);
  const shown = filtered.slice(current * PAGE, current * PAGE + PAGE);
  const selected = rows.find((r) => r.receipt.id === selectedId || r.receipt.flashOrderId === selectedId) ?? filtered[0];

  const orderId = selected?.receipt.flashOrderId;
  const live = !!selected && !selected.closed;
  // While Flash's order stream is live the server refreshes on every change; polling is a slow safety net.
  const pollMs = state?.tracking?.pollMs ?? 4000;
  useEffect(() => {
    if (!orderId || !live) return;
    const tick = () =>
      void fetch(`/api/orders/${encodeURIComponent(orderId)}`)
        .then(() => refresh())
        .catch(() => undefined);
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, pollMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [orderId, live, refresh, pollMs]);

  const reset = () => setPage(0);

  return (
    <div>
      <PageHeader title="Orders" description="Every copy you signed: its Flash order, fills, the policy that allowed it, and the evidence behind it." />

      {!follower ? (
        <div className="panel">
          <Empty title="No desk selected">Connect your wallet, or choose a DEMO desk from the wallet menu.</Empty>
        </div>
      ) : rows.length === 0 ? (
        <div className="space-y-4">
          <div className="panel">
            <Empty
              title="No Flash orders yet"
              action={
                <Link href="/proposals" className="btn btn-primary">
                  Go to proposals
                </Link>
              }
            >
              Orders appear here after you review a COPY or SCALE proposal and sign it from your own wallet. PACT never submits an order without your signature.
            </Empty>
          </div>
          <PlannedRow />
        </div>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_460px]">
          <div className="min-w-0 space-y-5">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Tile label="Total Orders" value={rows.length} sub={trackingLabel(state?.tracking)} />
              <Tile label="Executed" value={counts.executed} tone="good" />
              <Tile label="Working" value={counts.working} tone={counts.working ? "warn" : undefined} />
              <Tile label="Partial" value={counts.partial} tone={counts.partial ? "warn" : undefined} />
              <Tile label="Failed / cancelled" value={counts.failed} tone={counts.failed ? "bad" : undefined} />
            </div>

            <div className="utabs" role="tablist">
              {VIEWS.map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  data-on={view === v}
                  onClick={() => {
                    setView(v);
                    reset();
                  }}
                >
                  {v === "all" ? "All" : BUCKET[v].label}
                  <span className="ml-1.5 text-[12px] text-mute tnum">{v === "all" ? rows.length : counts[v]}</span>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                className="field h-9 min-w-[220px] flex-1 rounded-full px-4 text-[13px]"
                placeholder="Search order id, plan, leader or pair"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  reset();
                }}
                aria-label="Search orders"
              />
              <select
                className="field h-9 w-auto rounded-full px-4 text-[13px]"
                value={leader}
                onChange={(e) => {
                  setLeader(e.target.value);
                  reset();
                }}
                aria-label="Filter by leader"
              >
                <option value="all">All Leaders</option>
                {leaders.map((l) => (
                  <option key={l} value={l}>
                    {leaderName(l)}
                  </option>
                ))}
              </select>
              <select
                className="field h-9 w-auto rounded-full px-4 text-[13px]"
                value={pair}
                onChange={(e) => {
                  setPair(e.target.value);
                  reset();
                }}
                aria-label="Filter by pair"
              >
                <option value="all">All Pairs</option>
                {pairs.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <select
                className="field h-9 w-auto rounded-full px-4 text-[13px]"
                value={range.key}
                onChange={(e) => {
                  const key = e.target.value as Range;
                  setRange({ key, since: key === "all" ? 0 : Date.now() - RANGE_MS[key] });
                  reset();
                }}
                aria-label="Filter by date"
              >
                <option value="all">All time</option>
                <option value="1d">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
              </select>
            </div>

            {shown.length ? (
              <div className="overflow-x-auto">
                <table className="tbl tbl-tight min-w-[820px]">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Leader</th>
                      <th>Side · type</th>
                      <th className="r">Size</th>
                      <th className="min-w-[130px]">Progress</th>
                      <th className="r">Avg fill</th>
                      <th className="r">Drift</th>
                      <th>Status</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((row) => {
                      const st = statusTone(row);
                      const share = fillShare(row);
                      return (
                        <tr
                          key={row.receipt.id}
                          data-selected={selected?.receipt.id === row.receipt.id}
                          onClick={() => setSelectedId(row.receipt.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedId(row.receipt.id);
                            }
                          }}
                          tabIndex={0}
                          className="cursor-pointer"
                        >
                          <td>
                            <div className="text-[14px] text-ink">{row.proposal ? pairLabel(row.proposal) : "—"}</div>
                            <div className="font-mono text-[11px] text-mute" title={row.receipt.flashOrderId}>
                              {row.receipt.flashOrderId?.slice(0, 10)}…
                            </div>
                          </td>
                          <td>
                            {row.proposal ? (
                              <span className="inline-flex items-center gap-2">
                                <AddrAvatar value={row.proposal.leader} size={22} />
                                <span className="text-ink">{leaderName(row.proposal.leader)}</span>
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="text-mute">
                            <span className="capitalize text-ink">{row.proposal?.side ?? "—"}</span> · {row.proposal?.orderType === "twap" ? "TWAP" : (row.proposal?.orderType ?? "—")}
                          </td>
                          <td className="r text-ink">{usd(row.receipt.notionalUsd)}</td>
                          <td>
                            <div className="flex items-center gap-2">
                              <ProgressBar value={share} />
                              <span className="tnum shrink-0 text-[11px] text-mute">{row.bucketCount ? `${row.fillCount}/${row.bucketCount}` : `${Math.round(share * 100)}%`}</span>
                            </div>
                          </td>
                          <td className="r">{price(row.receipt.averageFillPrice)}</td>
                          <td className="r">{bps(row.receipt.entryDriftBps)}</td>
                          <td>
                            <StatusBadge tone={st.tone} icon={st.icon}>
                              {orderStatusLabel(row.receipt.status)}
                            </StatusBadge>
                          </td>
                          <td className="text-mute">{relativeTime(row.receipt.createdAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="panel">
                <Empty title="No orders match">Change the status tab, search or filters.</Empty>
              </div>
            )}

            {filtered.length > PAGE ? (
              <div className="flex items-center justify-between text-[12.5px] text-mute">
                <span className="tnum">
                  {current * PAGE + 1}–{Math.min(filtered.length, (current + 1) * PAGE)} of {filtered.length}
                </span>
                <div className="flex gap-2">
                  <button type="button" className="btn h-8" disabled={current === 0} onClick={() => setPage(current - 1)}>
                    ← Prev
                  </button>
                  <button type="button" className="btn h-8" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
                    Next →
                  </button>
                </div>
              </div>
            ) : null}

            <PlannedRow />
          </div>

          {selected ? <OrderDetail key={selected.receipt.id} row={selected} /> : null}
        </div>
      )}
    </div>
  );
}

type DetailTab = "execution" | "policy" | "plan" | "evidence";
const DETAIL_TABS: [DetailTab, string][] = [
  ["execution", "Execution"],
  ["policy", "Policy & Mandate"],
  ["plan", "Trade Plan"],
  ["evidence", "On-chain Evidence"],
];

function OrderDetail({ row }: { row: ExecutionRow }) {
  const { policy } = useDeskContext();
  const [tab, setTab] = useState<DetailTab>("execution");
  const { receipt, proposal } = row;
  const chain = proposal?.chain ?? receipt.chain ?? "base";
  const explorer = CHAINS[chain].explorerTx;
  const share = fillShare(row);
  const st = statusTone(row);
  const fills = receipt.fills ?? [];
  const orderId = receipt.flashOrderId!;
  const mandate = proposal ? mandateFor(policy, proposal.leader) : undefined;

  return (
    <aside className="panel overflow-hidden xl:sticky xl:top-[92px]">
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <div className="text-[12px] text-mute">Order Detail</div>
          <div className="mt-1 font-[family-name:var(--font-serif)] text-[28px] leading-tight text-ink">{proposal ? pairLabel(proposal) : "Order"}</div>
          <div className="mt-1 truncate font-mono text-[11px] text-mute" title={orderId}>
            {orderId}
          </div>
        </div>
        <StatusBadge tone={st.tone} icon={st.icon}>
          {orderStatusLabel(receipt.status)}
        </StatusBadge>
      </div>
      {proposal ? (
        <div className="mt-3 flex items-center gap-2 px-5 text-[13px]">
          <AddrAvatar value={proposal.leader} size={26} />
          <span className="text-mute">Copied from</span>
          <Link href={`/leaders/${proposal.leader}`} className="text-ink hover:text-accent">
            {leaderName(proposal.leader)}
          </Link>
        </div>
      ) : null}
      <div className="utabs mt-4 gap-4 overflow-x-auto px-5 [&_button]:text-[13px]" role="tablist">
        {DETAIL_TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} data-on={tab === k} onClick={() => setTab(k)} className="shrink-0 whitespace-nowrap">
            {label}
          </button>
        ))}
      </div>

      <div className="p-5">
        {tab === "execution" ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Figure label="Target size" value={usd(receipt.notionalUsd)} />
              <Figure label="Executed" value={row.filledUsd > 0 ? usd(row.filledUsd) : "—"} />
              <Figure label="Avg fill price" value={price(receipt.averageFillPrice)} />
              <Figure
                label="Entry drift"
                value={bps(receipt.entryDriftBps)}
                note={receipt.entryDriftBps === undefined ? "waiting for fill" : receipt.entryDriftBps > 0 ? "worse than declared" : "at or better than declared"}
              />
            </div>
            <div className="mt-4">
              <div className="flex items-baseline justify-between text-[12.5px]">
                <span className="text-mute">Fill progress</span>
                <span className="tnum text-ink">
                  {Math.round(share * 100)}%{row.bucketCount ? <span className="text-mute"> · slice {row.fillCount} of {row.bucketCount}</span> : null}
                </span>
              </div>
              <div className="mt-1.5">
                <ProgressBar value={share} />
              </div>
            </div>
            <h3 className="panel-title mt-5 text-[18px]">Execution trajectory</h3>
            <p className="text-[11.5px] text-mute">Cumulative filled size over time, from Flash fill rows</p>
            <div className="mt-2">
              <FillStepChart row={row} />
            </div>
            <h3 className="panel-title mt-4 text-[18px]">Fills</h3>
            {fills.length ? (
              <ul className="mt-2 space-y-1.5">
                {fills.map((f, i) => (
                  <li key={f.transactionId ?? i} className="grid grid-cols-[20px_1fr_auto_auto] items-center gap-3 rounded-lg border border-line bg-panel-2 px-3 py-2 text-[12px]">
                    <span className="text-mute tnum">{i + 1}</span>
                    <span className="tnum text-ink/85">
                      {f.filledAt ? new Date(f.filledAt).toLocaleTimeString() : "—"} · {f.notional ? usd(Number(f.notional)) : "—"} @ {price(f.fillPrice)}
                    </span>
                    {f.transactionId ? (
                      <a className="font-mono text-[11px] text-accent hover:underline" href={`${explorer}${f.transactionId}`} target="_blank" rel="noreferrer">
                        {f.transactionId.slice(0, 8)}…{f.transactionId.slice(-4)}
                      </a>
                    ) : (
                      <span className="text-mute">—</span>
                    )}
                    <span aria-hidden className="text-good">
                      ✓
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[12.5px] text-mute">{row.closed ? "Flash closed this order without fill rows." : "Watching Flash while the order is open."}</p>
            )}
            <dl className="mt-4">
              <KV
                k="Fees"
                v={receipt.feesUsd !== undefined ? `$${receipt.feesUsd.toFixed(3)} paid` : receipt.quotedFeeUsd ? `$${Number(receipt.quotedFeeUsd).toFixed(3)} quoted` : "—"}
              />
              {receipt.position ? (
                <KV
                  k="Position"
                  v={
                    receipt.position.closed
                      ? `closed · realized ${receipt.position.realizedPnlUsd < 0 ? "−" : "+"}$${Math.abs(receipt.position.realizedPnlUsd).toFixed(2)}`
                      : `${receipt.position.openUnits.toFixed(5)} WETH open at $${receipt.position.averageCost.toFixed(2)}`
                  }
                />
              ) : null}
              <KV
                k="Protection"
                v={
                  receipt.protection
                    ? `${receipt.protection.status?.replace("_", " ") ?? "—"}${receipt.protection.orderStatus ? ` · ${orderStatusLabel(receipt.protection.orderStatus)}` : ""}`
                    : "none"
                }
              />
              <KV k="Signed by" v={receipt.signedBy === "SESSION_KEY" ? "Autopilot session key" : "Your wallet"} />
              <KV k="Close reason" v={receipt.closeReason ? reasonLabel(receipt.closeReason.replace("REASON_", "")) : "—"} />
              <KV k="Submitted" v={new Date(receipt.createdAt).toLocaleString()} />
            </dl>
          </>
        ) : null}

        {tab === "policy" ? (
          <>
            <div className="flex items-center gap-2">
              <ActionBadge action={receipt.decision.action} verdict={receipt.decision.verdict} />
              <span className="text-[12.5px] text-mute">decided before you signed</span>
            </div>
            {receipt.decision.reasons.length ? (
              <ul className="mt-3 space-y-1.5 text-[12.5px]">
                {receipt.decision.reasons.map((r) => (
                  <li key={r} className="flex gap-2 text-ink/85">
                    <span className="text-warn">•</span>
                    {reasonLabel(r)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[12.5px] text-mute">Every rule passed with no adjustments.</p>
            )}
            <ReceiptVerdict receipt={receipt} side={proposal?.side ?? "buy"} />
            <h3 className="panel-title mt-5 text-[18px]">Your mandate for this leader</h3>
            <dl className="mt-1">
              <KV
                k="Sizing"
                v={
                  mandate
                    ? mandate.sizingMode === "FIXED"
                      ? `fixed ${usd(mandate.fixedNotionalUsd)}`
                      : mandate.sizingMode === "STOP_RISK"
                        ? `risk ${usd(mandate.riskBudgetUsd)} at the stop`
                        : `${Math.round(mandate.copyRatio * 100)}% of the leader`
                    : `${Math.round(policy.copyRatio * 100)}% of the leader (desk default)`
                }
              />
              <KV k="Daily for this leader" v={usd(mandate?.maxDailyUsd ?? policy.maxLeaderDailyUsd)} />
              <KV k="Per order" v={`${usd(policy.minNotionalUsd)} – ${usd(policy.maxNotionalUsd)}`} />
              <KV k="Max entry drift" v={`${(Number(policy.maxEntryDrift) * 100).toFixed(2)}%`} />
              {policy.maxExecutionCost ? <KV k="Max execution cost" v={`${(Number(policy.maxExecutionCost) * 100).toFixed(2)}%`} /> : null}
              <KV k="Exits" v={mandate?.exitMode === "FOLLOWER_BRACKET" ? "Flash stop and target attached" : "Follow the leader"} />
            </dl>
            <Link href="/settings/mandate" className="btn mt-4 w-full">
              Edit mandate
            </Link>
          </>
        ) : null}

        {tab === "plan" ? (
          proposal ? (
            <>
              <div className="text-[15px] text-ink">{proposal.title}</div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink/80">{proposal.thesis}</p>
              <dl className="mt-3">
                <KV k="Declared entry" v={price(receipt.declaredEntryPrice ?? proposal.entryReferencePrice)} />
                <KV k="Target" v={price(proposal.takeProfitPrice)} />
                <KV k="Stop" v={price(proposal.stopLossPrice)} />
                <KV k="Order type" v={proposal.orderType === "twap" ? `TWAP${proposal.twapBucketCount ? ` · ${proposal.twapBucketCount} slices` : ""}` : proposal.orderType} />
                <KV k="Flash quoted" v={price(receipt.quotedExecutionPrice)} />
                <KV k="Quoted all-in" v={price(receipt.allInPrice)} />
                <KV k="Plan expires" v={new Date(proposal.expiresAt).toLocaleString()} />
              </dl>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Link href={`/plans/${proposal.strategyId}`} className="btn">
                  Open plan
                </Link>
                <Link href={`/review/${proposal.id}`} className="btn" title="Cancel needs your wallet signature on the review page">
                  {row.closed ? "Open review" : "Review · cancel"}
                </Link>
              </div>
            </>
          ) : (
            <p className="text-[12.5px] text-mute">The proposal behind this order is no longer in the store.</p>
          )
        ) : null}

        {tab === "evidence" ? (
          <>
            <ul className="space-y-2 text-[12.5px]">
              {[
                { ok: !!orderId, label: "Flash order id recorded", detail: orderId },
                { ok: fills.some((f) => f.transactionId), label: "Fills settled onchain", detail: fills.length ? `${fills.filter((f) => f.transactionId).length} of ${fills.length} with a transaction` : "no fills yet" },
                { ok: !!receipt.quoteId, label: "Quote stored before signing", detail: receipt.quoteId ?? "no quote id" },
                { ok: false, label: "Recipient and fee check", detail: "in evidence.json, against Flash's live order record" },
              ].map((c) => (
                <li key={c.label} className="flex items-start gap-2.5">
                  <span aria-hidden className={c.ok ? "text-good" : "text-mute"}>
                    {c.ok ? "✓" : "○"}
                  </span>
                  <div className="min-w-0">
                    <div className="text-ink">{c.label}</div>
                    <div className="truncate text-[11px] text-mute" title={c.detail}>
                      {c.detail}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <EvidenceTrail receipt={receipt} />
            <a className="btn mt-4 w-full" href={`/api/orders/${encodeURIComponent(orderId)}/evidence?download`}>
              Download evidence.json
            </a>
          </>
        ) : null}
      </div>
    </aside>
  );
}

const VERDICT_TONE: Record<VerdictLine["result"], Tone> = { MATCH: "good", MISMATCH: "bad", PENDING: "neutral", "N/A": "neutral" };

/** Each promise PACT made before signing, checked against Flash's own report. */
function ReceiptVerdict({ receipt, side }: { receipt: Receipt; side: "buy" | "sell" }) {
  const { state } = useDeskContext();
  const verdict = receiptVerdict({
    side,
    follower: receipt.follower,
    receipt,
    quote: state?.quotes[receipt.proposalId],
    integratorFeeBps: "0",
  });
  return (
    <div className="mt-4 rounded-lg border border-line">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="text-[12.5px] font-semibold text-ink">Receipt verdict</span>
        <StatusBadge tone={VERDICT_TONE[verdict.overall]}>{verdict.overall}</StatusBadge>
      </div>
      <ul className="divide-y divide-line-2">
        {verdict.lines.map((l) => (
          <li key={l.id} className="flex items-start justify-between gap-3 px-3 py-2 text-[12px]">
            <div className="min-w-0">
              <div className="text-ink">{l.label}</div>
              <div className="mt-0.5 truncate text-[11px] text-mute" title={l.detail}>
                {l.detail}
              </div>
            </div>
            <StatusBadge tone={VERDICT_TONE[l.result]}>{l.result}</StatusBadge>
          </li>
        ))}
      </ul>
      <p className="px-3 py-2 text-[10.5px] leading-relaxed text-mute">
        Recipient and integrator fee are checked in evidence.json against Flash&apos;s live order record.
      </p>
    </div>
  );
}

const EVENT_LABEL: Record<EvidenceEvent["kind"], string> = {
  "mandate.set": "Mandate set",
  "plan.published": "Plan published",
  "decision.made": "Policy decision",
  "decision.updated": "Decision updated",
  "proposal.withdrawn": "Copy withdrawn",
  "quote.stored": "Flash quote stored",
  "order.submitted": "Order submitted",
  "order.rejected": "Order rejected",
  "order.updated": "Flash status change",
  "order.cancel_requested": "Cancel requested",
  "leader.evidence": "Leader evidence checked",
  "leader.human_verified": "Leader verified as a unique human",
  "leader.conduct": "Leader conduct re-checked",
  "shadow.entry": "Paper copy entered",
  "shadow.settled": "Paper copy settled",
  "autopilot.granted": "Autopilot session granted",
  "autopilot.human_approved": "Autopilot limits approved by a human (World ID)",
  "autopilot.revoked": "Autopilot session revoked",
  "autopilot.run": "Autopilot run",
};

function eventDetail(e: EvidenceEvent) {
  const d = e.data;
  if (e.kind === "decision.made" || e.kind === "decision.updated") return [d.verdict, d.action].filter(Boolean).join(" · ");
  if (e.kind === "quote.stored") return d.feeNotional ? `fees $${Number(d.feeNotional).toFixed(3)}` : String(d.quoteId ?? "");
  if (e.kind === "order.updated") return orderStatusLabel(String(d.status ?? ""));
  if (e.kind === "order.rejected") return String(d.error ?? "").slice(0, 60);
  if (e.kind === "proposal.withdrawn") return reasonLabel(String(d.reason ?? ""));
  return "";
}

/**
 * This copy's append-only record, fetched from PACT and re-verified here in the browser: every
 * hash is recomputed and each event must link to the one before it.
 */
function EvidenceTrail({ receipt }: { receipt: Receipt }) {
  const [trail, setTrail] = useState<{ events: EvidenceEvent[]; check: ChainCheck } | null>(null);
  const thread = `proposal:${receipt.proposalId}`;
  // Re-read when Flash reports something new about the order.
  const version = `${receipt.status}|${receipt.finalFillCount ?? 0}|${receipt.protection?.status ?? ""}|${receipt.protection?.orderStatus ?? ""}`;
  useEffect(() => {
    let live = true;
    void fetch(`/api/evidence?thread=${encodeURIComponent(thread)}`)
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
  }, [thread, version]);

  const check = trail?.check;
  return (
    <div className="mt-4 rounded-lg border border-line">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="text-[12.5px] font-semibold text-ink">Evidence trail</span>
        {check ? (
          <StatusBadge tone={check.ok ? "good" : "bad"}>{check.ok ? "VERIFIED" : "BROKEN"}</StatusBadge>
        ) : (
          <StatusBadge tone="neutral">CHECKING</StatusBadge>
        )}
      </div>
      {trail?.events.length ? (
        <ol className="divide-y divide-line-2">
          {trail.events.map((e) => (
            <li key={e.hash} className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-[12px]">
              <span className="min-w-0 truncate">
                <span className="text-ink">{EVENT_LABEL[e.kind] ?? e.kind}</span>
                {eventDetail(e) ? <span className="text-mute"> · {eventDetail(e)}</span> : null}
              </span>
              <span className="shrink-0 font-mono text-[10.5px] text-mute" title={e.hash}>
                #{e.seq} {e.hash.slice(2, 8)}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="px-3 py-2 text-[10.5px] leading-relaxed text-mute">
        {check && !check.ok
          ? `Check failed: ${check.reason}.`
          : "Append-only and hash-chained. Your browser recomputed every hash above; editing or deleting any event would show as broken."}
      </p>
    </div>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <div className="label">{label}</div>
      <div className="mt-1 truncate tnum text-[17px] font-semibold text-ink">{value}</div>
      {note ? <div className="truncate text-[11px] text-mute">{note}</div> : null}
    </div>
  );
}

const W = 420;
const H = 180;
const PAD = { l: 50, r: 10, t: 14, b: 24 };

/** Single-series step chart: cumulative filled notional against fill time. */
function FillStepChart({ row }: { row: ExecutionRow }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const points = useMemo(() => {
    const timed = (row.receipt.fills ?? [])
      .map((f) => ({ t: Date.parse(f.filledAt ?? ""), v: Number(f.notional) || 0, price: f.fillPrice }))
      .filter((p) => Number.isFinite(p.t))
      .sort((a, b) => a.t - b.t);
    const out: ((typeof timed)[number] & { cum: number })[] = [];
    for (const p of timed) out.push({ ...p, cum: (out.at(-1)?.cum ?? 0) + p.v });
    return out;
  }, [row.receipt.fills]);

  if (points.length < 1) {
    return (
      <p className="py-8 text-center text-[12px] text-mute">
        The step chart appears once Flash reports fill rows with timestamps.
      </p>
    );
  }

  const target = Math.max(row.receipt.notionalUsd, points.at(-1)!.cum);
  const t0 = Date.parse(row.receipt.createdAt);
  const tStart = Number.isFinite(t0) ? Math.min(t0, points[0].t) : points[0].t;
  const tEnd = Math.max(points.at(-1)!.t, tStart + 1);
  const x = (t: number) => PAD.l + ((t - tStart) / (tEnd - tStart)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / target) * (H - PAD.t - PAD.b);

  let d = `M ${x(tStart)} ${y(0)}`;
  for (const p of points) d += ` H ${x(p.t)} V ${y(p.cum)}`;

  const ticks = [0, 0.5, 1].map((f) => f * target);
  const active = hover !== null ? points[hover] : null;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i += 1) {
      if (Math.abs(x(points[i].t) - px) < Math.abs(x(points[best].t) - px)) best = i;
    }
    setHover(best);
  }

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        role="img"
        aria-label={`Cumulative filled notional, ${points.length} fills`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line-2)" strokeWidth={1} />
            <text x={PAD.l - 8} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill="var(--mute)" className="tnum">
              {usd(v)}
            </text>
          </g>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(target)} y2={y(target)} stroke="var(--mute)" strokeDasharray="4 4" strokeWidth={1} />
        <text x={W - PAD.r} y={y(target) - 4} textAnchor="end" fontSize={10} fill="var(--mute)">
          target
        </text>
        <path d={d} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.cum)} r={hover === i ? 5 : 4} fill="var(--series-1)" stroke="var(--panel)" strokeWidth={2} />
        ))}
        {active ? <line x1={x(active.t)} x2={x(active.t)} y1={PAD.t} y2={H - PAD.b} stroke="var(--mute)" strokeWidth={1} /> : null}
        <text x={PAD.l} y={H - 8} fontSize={10} fill="var(--mute)">
          {new Date(tStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </text>
        <text x={W - PAD.r} y={H - 8} textAnchor="end" fontSize={10} fill="var(--mute)">
          {new Date(tEnd).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </text>
      </svg>
      {active ? (
        <div
          className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-panel-3 px-2.5 py-1.5 text-[11.5px] shadow-lg"
          style={{ left: `${Math.min(85, Math.max(15, (x(active.t) / W) * 100))}%` }}
        >
          <div className="text-ink">{new Date(active.t).toLocaleTimeString()}</div>
          <div className="tnum text-mute">
            fill {usd(active.v)} @ {price(active.price)} · cumulative {usd(active.cum)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PlannedRow() {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Planned title="Markouts">Post-fill price movement at fixed horizons, from a labelled market source.</Planned>
      <Planned title="Venue split">Flash reports venues per fill; a per-order venue breakdown comes after the first live fills.</Planned>
      <Planned title="Leader kill switch">Cancel every live copy and protection from one leader with one signature (batch cancel is built per copy).</Planned>
    </div>
  );
}


function trackingLabel(tracking?: { mode: string; status?: string }) {
  if (!tracking || tracking.mode === "off") return "nothing live";
  if (tracking.mode === "stream" && tracking.status === "live") return "live via Flash order stream";
  if (tracking.mode === "stream") return `stream ${tracking.status ?? "connecting"}, polling meanwhile`;
  return "polling Flash";
}
