"use client";

import { useDeskContext } from "@/components/DeskContext";
import { ActionBadge, Empty, KV, LayerTag, Meter, MetricStrip, PageHeader, Panel, Planned, StatusBadge, LeaderTag } from "@/components/ui";
import { mandateFor, MAX_LEADERS, useLeaderActions } from "@/components/pages/following-actions";
import { leaderFidelity } from "@/lib/fidelity";
import { usd } from "@/lib/format";
import { actionOf, capacity, relativeTime } from "@/lib/views";
import type { LeaderMandate, Policy } from "@/lib/types";
import Link from "next/link";
import { useMemo } from "react";

function sizing(policy: Policy, mandate?: LeaderMandate) {
  const mode = mandate?.sizingMode ?? "PROPORTIONAL";
  if (mode === "FIXED") return { mode: "Fixed USD", size: usd(mandate?.fixedNotionalUsd ?? policy.minNotionalUsd) };
  if (mode === "STOP_RISK") return { mode: "Stop-risk", size: `${usd(mandate?.riskBudgetUsd ?? policy.riskBudgetUsd)} at stop` };
  return { mode: "Proportional", size: `${Math.round((mandate?.copyRatio ?? policy.copyRatio) * 100)}% of leader` };
}

function exitLabel(mandate?: LeaderMandate) {
  return (mandate?.exitMode ?? "FOLLOWER_BRACKET") === "FOLLOWER_BRACKET" ? "Flash TP/SL bracket" : "Manual exit";
}

function bps(v?: number) {
  return v === undefined ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)} bps`;
}

export function Following() {
  const { state, policy, follower, isDemo } = useDeskContext();
  const actions = useLeaderActions();
  const follows = useMemo(() => policy.follows ?? [], [policy.follows]);

  const cap = useMemo(
    () => (state ? capacity({ proposals: state.proposals, decisions: state.decisions, receipts: state.receipts }, policy) : undefined),
    [state, policy],
  );
  const fidelity = useMemo(
    () =>
      follower && state
        ? leaderFidelity(follower, follows, state.proposals, state.receipts, policy.maxEntryDrift)
        : [],
    [follower, state, follows, policy.maxEntryDrift],
  );
  const mine = useMemo(
    () => (follower ? (state?.proposals ?? []).filter((p) => p.follower.toLowerCase() === follower.toLowerCase()) : []),
    [state?.proposals, follower],
  );

  const sleeveOf = (leader: string) => cap?.sleeves.find((s) => s.leader.toLowerCase() === leader.toLowerCase());
  const pausedCount = policy.pausedLeaders?.length ?? 0;
  const boundBps = Number(policy.maxEntryDrift) * 10_000;

  const header = (
    <PageHeader
      title="Following"
      description="The leaders you selected and the individual mandate each one runs under. Every leader has its own daily sleeve inside your portfolio limits."
      actions={
        <>
          <Link href="/discover" className="btn">
            Discover leaders
          </Link>
          <Link href="/settings/mandate" className="btn btn-primary">
            Edit mandate
          </Link>
        </>
      }
    />
  );

  if (!follower) {
    return (
      <div>
        {header}
        <div className="panel">
          <Empty title="Connect a wallet or pick a demo desk">
            Following shows the leaders a specific follower selected. Connect your wallet, or choose a demo desk from
            the Viewing menu.
          </Empty>
        </div>
      </div>
    );
  }

  if (!follows.length) {
    return (
      <div>
        {header}
        <div className="panel">
          <Empty
            title="You are not following anyone"
            action={
              <Link href="/discover" className="btn btn-primary">
                Find leaders to follow
              </Link>
            }
          >
            An empty selection copies nobody. Pick up to {MAX_LEADERS} leaders in Discover; each gets its own mandate and
            daily sleeve.
          </Empty>
        </div>
      </div>
    );
  }

  return (
    <div>
      {header}

      <MetricStrip
        metrics={[
          { label: "Leaders selected", value: `${follows.length} / ${MAX_LEADERS}`, sub: pausedCount ? `${pausedCount} paused` : "all active", layer: "policy" },
          {
            label: "Copied today",
            value: usd(cap?.dailyUsed ?? 0),
            sub: `of ${usd(cap?.dailyMax ?? policy.maxDailyUsd)} daily limit`,
            layer: "execution",
          },
          {
            label: "Open plans",
            value: `${cap?.openPlans ?? 0} / ${cap?.openPlansMax ?? policy.maxOpenPlans}`,
            sub: `${policy.maxOpenPlansPerLeader} per leader`,
            layer: "policy",
          },
          {
            label: "Entry drift bound",
            value: `${boundBps.toFixed(0)} bps`,
            sub: "enforced as a Flash price limit",
            layer: "policy",
          },
        ]}
      />

      {actions.error ? <p className="mt-3 text-[12px] text-bad">{actions.error}</p> : null}

      {/* Selected leaders */}
      <Panel
        className="mt-4"
        title="Selected leaders"
        layer="policy"
        subtitle="Pause holds new plans from a leader and keeps the mandate. It does not cancel orders already live on Flash."
      >
        <div className="scroll-thin overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Leader</th>
                <th>Status</th>
                <th>Sizing</th>
                <th>Exit</th>
                <th className="min-w-[180px]">Sleeve today</th>
                <th className="r">Open plans</th>
                <th className="r">Action</th>
              </tr>
            </thead>
            <tbody>
              {follows.map((leader) => {
                const mandate = mandateFor(policy, leader);
                const size = sizing(policy, mandate);
                const sleeve = sleeveOf(leader);
                const paused = actions.isPaused(leader);
                const reason = actions.blockedReason(leader);
                return (
                  <tr key={leader}>
                    <td>
                      <div className="flex items-center gap-2">
                        <LeaderTag value={leader} size={24} showAddr />
                      </div>
                    </td>
                    <td>
                      {paused ? (
                        <StatusBadge tone="warn" icon="⏸">
                          paused
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="good" icon="●">
                          active
                        </StatusBadge>
                      )}
                    </td>
                    <td>
                      <div className="text-ink">{size.mode}</div>
                      <div className="text-[11px] text-mute">{size.size}</div>
                    </td>
                    <td className="text-mute">{exitLabel(mandate)}</td>
                    <td>
                      <Meter label="" used={sleeve?.used ?? 0} max={sleeve?.max ?? policy.maxLeaderDailyUsd} format={usd} />
                    </td>
                    <td className="r tnum">
                      <span className="text-ink">{sleeve?.openPlans ?? 0}</span>
                      <span className="text-mute"> / {policy.maxOpenPlansPerLeader}</span>
                    </td>
                    <td className="r">
                      <button
                        type="button"
                        className="btn px-2.5 py-1 text-[11.5px]"
                        disabled={!!reason || actions.busy !== null}
                        title={reason ?? (paused ? "Resume new copies from this leader" : "Hold new plans from this leader")}
                        onClick={() => void actions.setPaused(leader, !paused)}
                      >
                        {actions.busy === leader.toLowerCase() ? "Saving…" : paused ? "Resume" : "Pause"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {isDemo ? (
          <div className="border-t border-line px-4 py-2 text-[11px] text-mute">Demo desk: pause and mandate changes are disabled.</div>
        ) : null}
      </Panel>

      {/* Risk sleeves */}
      <Panel className="mt-4" title="Risk sleeves" layer="policy" subtitle="What each leader can still use today, inside your portfolio limits">
        <div className="grid gap-px bg-line-2 md:grid-cols-2 xl:grid-cols-3">
          {follows.map((leader) => {
            const mandate = mandateFor(policy, leader);
            const sleeve = sleeveOf(leader);
            const paused = actions.isPaused(leader);
            return (
              <div key={leader} className="space-y-3 bg-panel p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <LeaderTag value={leader} size={20} />
                  </span>
                  {paused ? <span className="text-[11px] text-warn">⏸ paused</span> : null}
                </div>
                <Meter label="Leader sleeve today" used={sleeve?.used ?? 0} max={sleeve?.max ?? policy.maxLeaderDailyUsd} format={usd} />
                <Meter
                  label="Open plans from this leader"
                  used={sleeve?.openPlans ?? 0}
                  max={policy.maxOpenPlansPerLeader}
                />
                <dl>
                  <KV k="Per-order cap" v={usd(policy.maxNotionalUsd)} />
                  <KV k="Order types" v={(mandate?.allowOrderTypes ?? policy.allowOrderTypes).join(", ")} />
                  <KV
                    k="Loss breaker"
                    v={
                      policy.enableLeaderLossCircuitBreaker
                        ? `${usd(policy.maxLeaderDailyRealizedLossUsd)} / day`
                        : "off"
                    }
                  />
                </dl>
              </div>
            );
          })}
        </div>
        <div className="space-y-3 border-t border-line p-4">
          <Meter label="Portfolio daily limit (all leaders)" used={cap?.dailyUsed ?? 0} max={cap?.dailyMax ?? policy.maxDailyUsd} format={usd} />
          <Meter label="Open plans (all leaders)" used={cap?.openPlans ?? 0} max={cap?.openPlansMax ?? policy.maxOpenPlans} />
        </div>
      </Panel>

      {/* Strategy and execution evidence */}
      <div className="mt-4 mb-2 flex items-center justify-between">
        <h2 className="panel-title">Strategy and execution evidence</h2>
        <span className="text-[11.5px] text-mute">Your own copies only · not a skill or profitability score</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {follows.map((leader) => {
          const f = fidelity.find((row) => row.leader.toLowerCase() === leader.toLowerCase());
          const recent = mine.filter((p) => p.leader.toLowerCase() === leader.toLowerCase()).slice(0, 5);
          const reasons = Object.entries(f?.closeReasons ?? {});
          return (
            <Panel
              key={leader}
              title={
                <span className="flex items-center gap-2">
                  <LeaderTag value={leader} size={18} />
                </span>
              }
              layer="execution"
            >
              <dl className="px-4 py-2">
                <KV k="Orders submitted" v={f?.submitted ?? 0} />
                <KV k="Orders with fills" v={f?.filled ?? 0} />
                <KV k="Mean entry drift" v={bps(f?.meanDriftBps)} />
                <KV k="Worst entry drift" v={bps(f?.worstDriftBps)} />
                <KV
                  k={`Within ${boundBps.toFixed(0)} bps bound`}
                  v={f?.driftSamples ? `${f.withinBound} / ${f.driftSamples}` : "no measured fills"}
                />
                <KV
                  k="Close reasons"
                  v={
                    reasons.length
                      ? reasons.map(([r, n]) => `${r.replace("REASON_", "").toLowerCase()} ×${n}`).join(", ")
                      : "—"
                  }
                  wrap
                />
              </dl>
              <div className="border-t border-line">
                <div className="flex items-center justify-between px-4 pt-3">
                  <span className="label">Recent proposals</span>
                  <LayerTag layer="policy" compact />
                </div>
                {recent.length ? (
                  <ul className="px-2 py-2">
                    {recent.map((p) => (
                      <li key={p.id}>
                        <Link
                          href={`/review/${p.id}`}
                          className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-panel-2"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[12px] text-ink">{p.title}</span>
                            <span className="text-[10.5px] text-mute">
                              {p.side} {p.orderType} · {usd(p.notionalUsd)} · {relativeTime(p.createdAt)}
                            </span>
                          </span>
                          <ActionBadge action={actionOf(state?.decisions[p.id])} verdict={state?.decisions[p.id]?.verdict} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-4 py-3 text-[12px] text-mute">
                    No proposals yet. Mirror this leader&apos;s open plans from Proposals.
                  </p>
                )}
              </div>
            </Panel>
          );
        })}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Planned title="Follower-signed batch cancel per leader">
          Cancel every live Flash order from one leader with a single signature. Waits on Definitive confirming the
          batch-cancel endpoint and signature format.
        </Planned>
        <Planned title="Leader-vs-plan matching (PLAN_MATCHED)">
          Compare each published plan with the leader&apos;s own Flash order once the real order schema has been captured
          from a live fill.
        </Planned>
      </div>
    </div>
  );
}
