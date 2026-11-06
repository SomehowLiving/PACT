"use client";

import { CopyDrawer, type DrawerTab } from "@/components/pages/copy-drawer";
import { FollowButton } from "@/components/pages/Discover";
import { EvidenceBadge, formatRR, GradeBadge, SideType } from "@/components/pages/discover-parts";
import { useLeaderActions } from "@/components/pages/following-actions";
import { COPY_VERDICT, useCopyabilityOf } from "@/components/pages/use-copyability";
import { useDeskContext } from "@/components/DeskContext";
import { TrackRecord } from "@/components/pages/track-record";
import { ActionBadge, Empty, LayerTag, MetricStrip, PageHeader, Panel, Segmented, StatusBadge, type Tone } from "@/components/ui";
import type { LeaderRecord } from "@/lib/leader-record";
import type { LeaderEvidence, LeaderEvidenceStatus, ShadowCopy } from "@/lib/types";
import { reasonLabel, shortAddr } from "@/lib/format";
import { isDemoAddress, isExpired, leaderRows, relativeTime, rewardRisk } from "@/lib/views";
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

const TABS = ["overview", "plans", "execution", "paper"] as const;
type Tab = (typeof TABS)[number];

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
  const { state, follower } = useDeskContext();
  const actions = useLeaderActions();
  const copyabilityOf = useCopyabilityOf();
  const copy = copyabilityOf(address);
  const [drawer, setDrawer] = useState<DrawerTab | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  // The tab lives in the URL (?tab=) so a profile view can be shared and survives refresh.
  useEffect(() => {
    const id = setTimeout(() => {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t && (TABS as readonly string[]).includes(t)) setTab(t as Tab);
    }, 0);
    return () => clearTimeout(id);
  }, []);
  const changeTab = (t: Tab) => {
    setTab(t);
    const p = new URLSearchParams(window.location.search);
    if (t === "overview") p.delete("tab");
    else p.set("tab", t);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${p.size ? `?${p}` : ""}`);
  };
  const rows = state ? leaderRows({ strategies: state.strategies, policies: state.policies, proposals: state.proposals, receipts: state.receipts }) : [];
  const row = rows.find((x) => x.leader.toLowerCase() === address.toLowerCase());
  const storePlans = (state?.strategies ?? []).filter((s) => s.leader.toLowerCase() === address.toLowerCase()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const myCopy = (planId: string) =>
    follower ? state?.proposals.find((p) => p.strategyId === planId && p.follower.toLowerCase() === follower.toLowerCase()) : undefined;
  const verdict = copy ? COPY_VERDICT[copy.verdict] : undefined;

  return (
    <div>
      {drawer && row ? <CopyDrawer key={drawer} row={row} tab={drawer} plans={storePlans} onClose={() => setDrawer(null)} /> : null}
      <PageHeader
        eyebrow="Leader profile"
        title={`Leader ${shortAddr(address)}`}
        description="Everything here comes from evidence: the leader's own Flash orders and Base trades, PACT's paper copies of each plan (real Flash quotes, no signatures), and what followers' real copies did."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {r ? (
              <span title={r.shadow.probationReason}>
                <StatusBadge tone={r.shadow.probation === "GRADUATED" ? "good" : "warn"} icon={r.shadow.probation === "GRADUATED" ? "✓" : "◷"}>
                  {r.shadow.probation === "GRADUATED" ? "passed probation" : "on probation"}
                </StatusBadge>
              </span>
            ) : null}
            {r?.shadow.uncopyable ? (
              <span title="Most paper copies could not be copied within default limits (drift, cost or stale levels)">
                <StatusBadge tone="bad" icon="!">
                  hard to copy
                </StatusBadge>
              </span>
            ) : null}
            {isDemoAddress(address) ? <LayerTag layer="demo" /> : null}
            {row ? <FollowButton actions={actions} leader={row.leader} onOpen={(_l, t) => setDrawer(t)} /> : null}
          </div>
        }
      />
      {error ? <Empty title="Leader not found">{error}</Empty> : null}
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-line pb-2">
        <Segmented
          value={tab}
          onChange={changeTab}
          options={[
            { value: "overview", label: "Overview" },
            { value: "plans", label: "Plans", count: plans.length },
            { value: "execution", label: "Execution evidence" },
            { value: "paper", label: "Paper copies", count: paper.length },
          ]}
        />
        <span className="text-[11.5px] text-mute">
          {row ? `${row.pactFollowers} PACT follower${row.pactFollowers === 1 ? "" : "s"}` : ""}
        </span>
      </div>
      {r && tab === "overview" ? (
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
            <Panel title="Copyability for your desk" subtitle="What your mandate would do with this leader's live plans" layer="policy" bodyClassName="p-4">
              {copy && verdict ? (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <StatusBadge tone={verdict.tone}>{verdict.label}</StatusBadge>
                    <span className="text-[12.5px] text-mute">
                      {copy.previews.length
                        ? `${copy.counts.COPY} copy · ${copy.counts.SCALE} scale · ${copy.counts.WAIT + copy.counts.REVIEW} held · ${copy.counts.DECLINE} declined of ${copy.previews.length} live`
                        : "No live plans to evaluate"}
                    </span>
                  </div>
                  {copy.topReasons.length ? (
                    <p className="mt-2 text-[12px] text-mute">
                      Most common hold: {copy.topReasons.map((x) => `${reasonLabel(x.reason)} (${x.count})`).join(", ")}
                    </p>
                  ) : null}
                  <p className="mt-3 text-[11.5px] text-mute">
                    Following saves a mandate for this leader; it never places a trade. Every copy is still checked and signed by you.
                  </p>
                </>
              ) : (
                <p className="text-[12.5px] text-mute">Connect a wallet or view a desk to see copyability.</p>
              )}
            </Panel>
            <TrackRecord leader={address} />
          </div>
        </div>
      ) : null}
      {tab === "plans" ? (
        <Panel title="Published plans" subtitle="Each plan opens its own page" layer="policy">
          {storePlans.length ? (
            <div className="overflow-x-auto">
              <table className="tbl tbl-tight">
                <thead>
                  <tr>
                    <th>Plan</th>
                    <th>Type</th>
                    <th className="r">Entry</th>
                    <th className="r">Stop</th>
                    <th className="r">Target</th>
                    <th className="r">R:R</th>
                    <th>Grade</th>
                    <th>Evidence</th>
                    <th>Your copy</th>
                    <th>Window</th>
                  </tr>
                </thead>
                <tbody>
                  {storePlans.map((p) => {
                    const mine = myCopy(p.id);
                    const d = mine ? state?.decisions[mine.id] : undefined;
                    return (
                      <tr key={p.id}>
                        <td className="max-w-[220px]">
                          <Link href={`/plans/${p.id}`} className="block truncate text-ink hover:text-accent hover:underline">
                            {p.title}
                          </Link>
                        </td>
                        <td>
                          <SideType plan={p} />
                        </td>
                        <td className="r">{p.entryReferencePrice ?? "—"}</td>
                        <td className="r text-bad">{p.stopLossPrice ?? "—"}</td>
                        <td className="r text-good">{p.takeProfitPrice ?? "—"}</td>
                        <td className="r">{formatRR(rewardRisk(p))}</td>
                        <td>
                          <GradeBadge grade={p.leaderPlanGrade} />
                        </td>
                        <td>
                          <EvidenceBadge status={p.leaderEvidenceStatus} />
                        </td>
                        <td>
                          {mine && d ? (
                            <Link href={`/review/${mine.id}`} title="Open your proposal review">
                              <ActionBadge action={d.action} verdict={d.verdict} />
                            </Link>
                          ) : (
                            <span className="text-mute">—</span>
                          )}
                        </td>
                        <td className={isExpired(p) ? "text-mute line-through" : "text-mute"}>{relativeTime(p.expiresAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No plans published" />
          )}
        </Panel>
      ) : null}
      {tab === "execution" ? (
          <Panel title="Plans and the leader's own execution" subtitle="What PACT checked for each plan, on Flash and on Base" layer="execution">
            {plans.length ? (
              <ul className="divide-y divide-line-2">
                {plans.map((p) => (
                  <li key={p.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/plans/${p.id}`} className="text-[13px] text-ink hover:text-accent hover:underline">
                          {p.title}
                        </Link>
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
      ) : null}
      {tab === "paper" ? (
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
                              <Link href={`/plans/${p.id}`} className="block truncate text-ink hover:text-accent hover:underline">
                                {p.title}
                              </Link>
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
      ) : null}
    </div>
  );
}
