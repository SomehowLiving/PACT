"use client";

import { EvidenceBadge } from "@/components/pages/discover-parts";
import { TrackRecord } from "@/components/pages/track-record";
import { Empty, MetricStrip, PageHeader, Panel, StatusBadge, type Tone } from "@/components/ui";
import type { LeaderRecord } from "@/lib/leader-record";
import type { LeaderEvidence, LeaderEvidenceStatus, ShadowCopy } from "@/lib/types";
import { reasonLabel, shortAddr } from "@/lib/format";
import { relativeTime } from "@/lib/views";
import Link from "next/link";
import { useEffect, useState } from "react";

type PlanRow = {
  id: string;
  title: string;
  createdAt: string;
  expiresAt: string;
  side: string;
  orderType: string;
  qty: string;
  entryReferencePrice?: string;
  stopLossPrice?: string;
  takeProfitPrice?: string;
  status: LeaderEvidenceStatus;
  evidence: LeaderEvidence | null;
  shadow: ShadowCopy | null;
};

const SHADOW_TONE: Record<ShadowCopy["status"], Tone> = {
  TARGET: "good",
  STOPPED: "bad",
  EXPIRED: "neutral",
  OPEN: "neutral",
  WAITING_ENTRY: "neutral",
  NOT_COPYABLE: "warn",
};

const money = (v?: number) => (v === undefined ? "—" : `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
const pct = (v?: number) => (v === undefined ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(2)}%`);
const bps = (v?: number) => (v === undefined ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(0)} bps`);

/** One leader, everything PACT can show from evidence: own execution, paper copies, copiers. */
export function LeaderPage({ address }: { address: string }) {
  const [data, setData] = useState<{ record: LeaderRecord; plans: PlanRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      void fetch(`/api/leaders/${address}`)
        .then(async (r) => {
          const body = await r.json();
          if (!live) return;
          if (r.ok) setData(body);
          else setError(body.error ?? "could not load leader");
        })
        .catch(() => undefined);
    const first = setTimeout(load, 0);
    const id = setInterval(load, 60_000);
    return () => {
      live = false;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [address]);

  const r = data?.record;
  const plans = [...(data?.plans ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const paper = plans.filter((p) => p.shadow);
  return (
    <div>
      <PageHeader
        eyebrow="Leader"
        title={`Leader ${shortAddr(address)}`}
        description="Everything here comes from evidence: the leader's own Flash orders and Base trades, PACT's paper copies of each plan (real Flash quotes, no signatures), and what followers' real copies did."
        actions={
          r ? (
            <div className="flex flex-wrap items-center gap-2">
              <span title={r.shadow.probationReason}>
                <StatusBadge tone={r.shadow.probation === "GRADUATED" ? "good" : "warn"} icon={r.shadow.probation === "GRADUATED" ? "✓" : "◷"}>
                  {r.shadow.probation === "GRADUATED" ? "passed probation" : "on probation"}
                </StatusBadge>
              </span>
              {r.shadow.uncopyable ? (
                <span title="Most paper copies could not be copied within default limits (drift, cost or stale levels)">
                  <StatusBadge tone="bad" icon="!">
                    hard to copy
                  </StatusBadge>
                </span>
              ) : null}
              <Link className="btn" href="/discover">
                All leaders
              </Link>
            </div>
          ) : null
        }
      />
      {error ? <Empty title="Leader not found">{error}</Empty> : null}
      {r ? (
        <div className="space-y-4">
          <MetricStrip
            metrics={[
              { label: "Plans published", value: r.plans, sub: `${r.backed} backed by own execution` },
              {
                label: "Contradicted",
                value: r.evidence.MISMATCH,
                tone: r.evidence.MISMATCH ? "bad" : undefined,
                sub: "own execution disagrees with the plan",
              },
              {
                label: "Paper copies settled",
                value: `${r.shadow.settled} / ${r.shadow.copies}`,
                sub: `${r.shadow.targets} target · ${r.shadow.stops} stop · ${r.shadow.expired} expired`,
              },
              {
                label: "Paper average",
                value: r.shadow.avgR === undefined ? "—" : `${r.shadow.avgR > 0 ? "+" : ""}${r.shadow.avgR.toFixed(2)}R`,
                tone: r.shadow.avgR === undefined ? undefined : r.shadow.avgR > 0 ? "good" : "bad",
                sub: r.shadow.avgPnlPct === undefined ? r.shadow.probationReason : `${pct(r.shadow.avgPnlPct)} per copy, costs included`,
              },
            ]}
          />

          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
            <Panel
              title="Paper copies"
              subtitle="PACT copies every new buy plan at $100 with a real Flash quote and no signature, then replays the plan's stop and target on market candles"
              layer="execution"
            >
              {paper.length ? (
                <div className="overflow-x-auto">
                  <table className="tbl tbl-tight">
                    <thead>
                      <tr>
                        <th>Plan</th>
                        <th className="r">Declared</th>
                        <th className="r">Paper entry</th>
                        <th className="r">Drift</th>
                        <th className="r">Cost</th>
                        <th>Outcome</th>
                        <th className="r">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paper.map((p) => {
                        const s = p.shadow!;
                        return (
                          <tr key={p.id}>
                            <td className="max-w-[200px]">
                              <div className="truncate text-ink">{p.title}</div>
                              <div className="text-[11px] text-mute">
                                {p.orderType} · {relativeTime(p.createdAt)}
                              </div>
                            </td>
                            <td className="r">{p.entryReferencePrice ? money(Number(p.entryReferencePrice)) : "—"}</td>
                            <td className="r">{money(s.entryPrice)}</td>
                            <td className="r">{bps(s.entryDriftBps)}</td>
                            <td className="r">{(s.costRatio * 100).toFixed(2)}%</td>
                            <td>
                              <span title={s.reasons.map(reasonLabel).join(", ")}>
                                <StatusBadge tone={SHADOW_TONE[s.status]}>{s.status.replace("_", " ").toLowerCase()}</StatusBadge>
                              </span>
                              {s.reasons.length ? <div className="mt-0.5 text-[10.5px] text-mute">{s.reasons.map(reasonLabel).join(", ")}</div> : null}
                            </td>
                            <td className="r">
                              {s.rMultiple !== undefined ? (
                                <span className={s.rMultiple > 0 ? "text-good" : "text-bad"}>{`${s.rMultiple > 0 ? "+" : ""}${s.rMultiple.toFixed(2)}R`}</span>
                              ) : s.markPrice ? (
                                <span className="text-mute" title="last candle close; not an outcome">
                                  mark {money(s.markPrice)}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="No paper copies yet">
                  New buy plans with a stop and target on Base WETH/USDC are paper-copied when published.
                </Empty>
              )}
              <p className="border-t border-line px-4 py-2 text-[11px] leading-relaxed text-mute">
                Paper, not receipts: entry from a Flash quote at publish, exits from GeckoTerminal candles (a candle touching
                both levels counts as the stop), exit cost assumed equal to entry cost. Never mixed with real fills.
              </p>
            </Panel>
            <TrackRecord leader={address} />
          </div>

          <Panel title="Plans and the leader's own execution" subtitle="What PACT checked for each plan, on Flash and on Base" layer="execution">
            {plans.length ? (
              <ul className="divide-y divide-line-2">
                {plans.map((p) => (
                  <li key={p.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-[13px] text-ink">{p.title}</span>
                        <span className="ml-2 text-[11px] text-mute">
                          {p.side} {p.orderType} · entry {p.entryReferencePrice ?? "—"} · stop {p.stopLossPrice ?? "—"} · target{" "}
                          {p.takeProfitPrice ?? "—"} · {relativeTime(p.createdAt)}
                        </span>
                      </div>
                      <EvidenceBadge status={p.status} />
                    </div>
                    {p.evidence?.checks.length ? (
                      <ul className="mt-2 grid gap-x-6 gap-y-1 text-[11.5px] md:grid-cols-2">
                        {p.evidence.checks.map((c) => (
                          <li key={c.id} className="flex min-w-0 items-baseline justify-between gap-2">
                            <span className="truncate text-mute" title={c.detail}>
                              {c.label}: {c.detail}
                            </span>
                            <span className={c.result === "MATCH" ? "text-good" : c.result === "MISMATCH" ? "text-bad" : "text-mute"}>{c.result}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-[11.5px] text-mute">No execution evidence attached.</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="No plans published" />
            )}
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
