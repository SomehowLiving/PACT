"use client";

import { useDeskContext } from "@/components/DeskContext";
import { Addr, Empty, KV, PageHeader, Panel, Planned, StatusBadge, type Tone } from "@/components/ui";
import { CHAINS } from "@/lib/chains";
import { reasonLabel, usd } from "@/lib/format";
import { executionRows, orderStatusLabel, pairLabel, relativeTime, type ExecutionRow } from "@/lib/views";
import { receiptVerdict, type VerdictLine } from "@/lib/verdict";
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
      <div className="h-full rounded-full bg-[var(--layer-exec)] transition-all" style={{ width: `${value * 100}%` }} />
    </div>
  );
}

export function Execution() {
  const { state, refresh, follower } = useDeskContext();
  const rows = useMemo(() => (state && follower ? executionRows(state, follower) : []), [state, follower]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = rows.find((r) => r.receipt.id === selectedId) ?? rows[0];

  const orderId = selected?.receipt.flashOrderId;
  const live = !!selected && !selected.closed;
  useEffect(() => {
    if (!orderId || !live) return;
    const tick = () =>
      void fetch(`/api/orders/${encodeURIComponent(orderId)}`)
        .then(() => refresh())
        .catch(() => undefined);
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 4000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [orderId, live, refresh]);

  return (
    <div>
      <PageHeader
        eyebrow="06 · Execution"
        title="Execution"
        description="Flash order status, TWAP progress, individual fills and the receipt comparing your fill to the leader's declared entry."
      />

      {!follower ? (
        <div className="panel">
          <Empty title="No follower selected">Connect your wallet, or choose a demo desk in the top bar.</Empty>
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
              Orders appear here after you review a COPY or SCALE proposal and sign it from your own wallet. PACT never
              submits an order without your signature.
            </Empty>
          </div>
          <PlannedRow />
        </div>
      ) : (
        <div className="space-y-4">
          <Panel title="Orders" subtitle={`${rows.length} submitted to Flash`} layer="execution">
            <div className="scroll-thin max-h-[420px] overflow-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Plan</th>
                    <th>Pair</th>
                    <th>Side · type</th>
                    <th className="r">Notional</th>
                    <th className="min-w-[140px]">Progress</th>
                    <th className="r">Avg fill</th>
                    <th className="r">Entry drift</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
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
                          <StatusBadge tone={st.tone} icon={st.icon}>
                            {orderStatusLabel(row.receipt.status)}
                          </StatusBadge>
                        </td>
                        <td className="max-w-[200px] truncate text-ink" title={row.proposal?.title}>
                          {row.proposal?.title ?? "—"}
                        </td>
                        <td>{row.proposal ? pairLabel(row.proposal) : "—"}</td>
                        <td className="text-mute">
                          <span className="text-ink">{row.proposal?.side ?? "—"}</span> · {row.proposal?.orderType ?? "—"}
                        </td>
                        <td className="r text-ink">{usd(row.receipt.notionalUsd)}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <ProgressBar value={share} />
                            <span className="tnum shrink-0 text-[11px] text-mute">
                              {row.bucketCount ? `${row.fillCount}/${row.bucketCount}` : `${Math.round(share * 100)}%`}
                            </span>
                          </div>
                        </td>
                        <td className="r">{price(row.receipt.averageFillPrice)}</td>
                        <td className="r">{bps(row.receipt.entryDriftBps)}</td>
                        <td className="text-mute">{relativeTime(row.receipt.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          {selected ? <OrderDetail row={selected} /> : null}
          <PlannedRow />
        </div>
      )}
    </div>
  );
}

function OrderDetail({ row }: { row: ExecutionRow }) {
  const { receipt, proposal } = row;
  const chain = proposal?.chain ?? receipt.chain ?? "base";
  const explorer = CHAINS[chain].explorerTx;
  const share = fillShare(row);
  const st = statusTone(row);
  const fills = receipt.fills ?? [];
  const orderId = receipt.flashOrderId!;

  return (
    <div className="grid items-start gap-4 grid-cols-1 xl:grid-cols-[400px_minmax(0,1fr)]">
      <Panel
        title="Execution receipt"
        subtitle={<span className="font-mono">order {orderId}</span>}
        layer="execution"
        actions={
          <StatusBadge tone={st.tone} icon={st.icon}>
            {orderStatusLabel(receipt.status)}
          </StatusBadge>
        }
        bodyClassName="p-4"
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Figure label="Target notional" value={usd(receipt.notionalUsd)} />
          <Figure label="Executed" value={row.filledUsd > 0 ? usd(row.filledUsd) : "—"} />
          <Figure label="Avg fill price" value={price(receipt.averageFillPrice)} />
          <Figure
            label="Entry drift"
            value={bps(receipt.entryDriftBps)}
            note={receipt.entryDriftBps === undefined ? "waiting for fill" : receipt.entryDriftBps > 0 ? "worse than declared" : "at or better than declared"}
          />
        </div>

        <div className="mt-4">
          <div className="flex items-baseline justify-between text-[12px]">
            <span className="label">Fill percentage</span>
            <span className="tnum text-ink">
              {Math.round(share * 100)}%
              {row.bucketCount ? <span className="text-mute"> · slice {row.fillCount} of {row.bucketCount}</span> : null}
            </span>
          </div>
          <div className="mt-1.5">
            <ProgressBar value={share} />
          </div>
        </div>

        <ReceiptVerdict receipt={receipt} side={proposal?.side ?? "buy"} />

        <dl className="mt-4">
          <KV k="Leader declared entry" v={price(receipt.declaredEntryPrice)} />
          <KV k="Flash quoted price" v={price(receipt.quotedExecutionPrice)} />
          <KV k="Quoted all-in price" v={price(receipt.allInPrice)} />
          <KV
            k="Fees"
            v={
              receipt.feesUsd !== undefined
                ? `$${receipt.feesUsd.toFixed(3)} paid`
                : receipt.quotedFeeUsd
                  ? `$${Number(receipt.quotedFeeUsd).toFixed(3)} quoted`
                  : "—"
            }
          />
          <KV
            k="Protection"
            v={
              receipt.protection
                ? `${receipt.protection.status?.replace("_", " ") ?? "—"}${receipt.protection.orderStatus ? ` · ${orderStatusLabel(receipt.protection.orderStatus)}` : ""}`
                : "none"
            }
          />
          <KV k="Policy decision" v={`${receipt.decision.action ?? receipt.decision.verdict}`} />
          <KV k="Leader" v={<Addr value={proposal?.leader} />} />
          <KV k="Close reason" v={receipt.closeReason ? reasonLabel(receipt.closeReason.replace("REASON_", "")) : "—"} />
          <KV k="Submitted" v={new Date(receipt.createdAt).toLocaleString()} />
        </dl>

        <p className="mt-3 text-[11px] leading-relaxed text-mute">
          Drift compares your average fill to the leader&apos;s declared entry; positive means you paid worse. It is a fidelity
          check, not a P&amp;L figure.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <a className="btn" href={`/api/orders/${encodeURIComponent(orderId)}/evidence?download`}>
            evidence.json
          </a>
          {proposal ? (
            <Link className="btn" href={`/review/${proposal.id}`} title="Cancel needs your wallet signature on the review page">
              {row.closed ? "Open review" : "Review · cancel"}
            </Link>
          ) : null}
        </div>
      </Panel>

      <div className="space-y-4">
        <Panel title="Cumulative fills" subtitle="Filled notional over time, from Flash fill rows" layer="execution" bodyClassName="p-4">
          <FillStepChart row={row} />
        </Panel>

        <Panel title="Fills" subtitle={`${fills.length} fill row${fills.length === 1 ? "" : "s"} from Flash`} layer="execution">
          {fills.length ? (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Time</th>
                    <th className="r">Notional</th>
                    <th className="r">Fill price</th>
                    <th>Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {fills.map((f, i) => (
                    <tr key={f.transactionId ?? i}>
                      <td className="text-mute">{i + 1}</td>
                      <td className="text-mute">{f.filledAt ? new Date(f.filledAt).toLocaleTimeString() : "—"}</td>
                      <td className="r text-ink">{f.notional ? usd(Number(f.notional)) : "—"}</td>
                      <td className="r">{price(f.fillPrice)}</td>
                      <td>
                        {f.transactionId ? (
                          <a className="font-mono text-[12px] text-accent hover:underline" href={`${explorer}${f.transactionId}`} target="_blank" rel="noreferrer">
                            {f.transactionId.slice(0, 10)}…{f.transactionId.slice(-4)}
                          </a>
                        ) : (
                          <span className="text-mute">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No fills yet">
              {row.closed ? "Flash closed this order without fill rows." : "Polling Flash every 4 seconds while the order is open."}
            </Empty>
          )}
        </Panel>
      </div>
    </div>
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

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <div className="label">{label}</div>
      <div className="mt-1 truncate tnum text-[17px] font-semibold text-ink">{value}</div>
      {note ? <div className="truncate text-[11px] text-mute">{note}</div> : null}
    </div>
  );
}

const W = 640;
const H = 200;
const PAD = { l: 52, r: 14, t: 12, b: 26 };

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
        <path d={d} fill="none" stroke="var(--layer-exec)" strokeWidth={2} strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.cum)} r={hover === i ? 5 : 4} fill="var(--layer-exec)" stroke="var(--panel)" strokeWidth={2} />
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

