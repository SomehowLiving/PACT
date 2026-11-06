"use client";

import { useDeskContext, useMine } from "@/components/DeskContext";
import { TradingChart } from "@/components/TradingChart";
import { ActionBadge, ConfirmDialog, Empty, KV, LayerTag, Meter, MetricStrip, PageHeader, Panel, Planned, StatusBadge, LeaderTag } from "@/components/ui";
import { usd } from "@/lib/format";
import {
  actionCounts,
  actionOf,
  approvedNotional,
  capacity,
  executionRows,
  exposureGroups,
  orderStatusLabel,
  pairLabel,
  relativeTime,
} from "@/lib/views";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const DEMO_PORTFOLIO_DESK = "0x7777777777777777777777777777777777777777" as const;

type Health = { ok?: boolean; error?: string };

function useHealth() {
  const [flash, setFlash] = useState<Health | null>(null);
  useEffect(() => {
    const id = setTimeout(() => {
      void fetch("/api/health", { cache: "no-store" })
        .then((r) => r.json())
        .then((j: Health) => setFlash(j))
        .catch(() => setFlash({ ok: false, error: "unreachable" }));
    }, 0);
    return () => clearTimeout(id);
  }, []);
  return flash;
}

export function Overview() {
  const { state, policy, follower, isDemo, canAct, refresh, setViewAs } = useDeskContext();
  const mine = useMine();
  const flash = useHealth();
  const [seeding, setSeeding] = useState(false);

  const decisions = useMemo(() => state?.decisions ?? {}, [state?.decisions]);
  const receipts = useMemo(() => state?.receipts ?? [], [state?.receipts]);
  const receiptOf = useMemo(() => new Map(receipts.map((r) => [r.proposalId, r])), [receipts]);
  const counts = actionCounts(mine, decisions);
  const cap = state ? capacity(state, policy) : undefined;
  const groups = state ? exposureGroups(state, follower) : [];
  const orders = state ? executionRows(state, follower) : [];
  const liveOrders = orders.filter((o) => !o.closed);
  const awaiting = mine.filter((p) => {
    const a = actionOf(decisions[p.id]);
    return (a === "COPY" || a === "SCALE") && !receiptOf.get(p.id)?.flashOrderId;
  });
  const approvedUsd = awaiting.reduce((s, p) => s + approvedNotional(p, decisions[p.id]), 0);
  const drifts = orders.map((o) => o.receipt.entryDriftBps).filter((d): d is number => typeof d === "number");
  const meanDrift = drifts.length ? drifts.reduce((a, b) => a + b, 0) / drifts.length : undefined;
  const incoming = mine.slice(0, 8);
  const topGroup = groups[0];

  const [confirmDemo, setConfirmDemo] = useState(false);
  const loadDemo = () => setConfirmDemo(true);

  async function seedDemo() {
    setSeeding(true);
    try {
      await fetch("/api/demo", { method: "POST" });
      setViewAs(DEMO_PORTFOLIO_DESK);
      await refresh();
      setConfirmDemo(false);
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div>
      <ConfirmDialog
        open={confirmDemo}
        title="Load the demo scenario?"
        confirmLabel="Reset and load demo"
        danger
        busy={seeding}
        onConfirm={() => void seedDemo()}
        onCancel={() => setConfirmDemo(false)}
      >
        This replaces the local PACT store with seven seeded policy cases. Any proposals, quotes and saved
        receipts on this machine are cleared. Nothing on-chain is affected.
      </ConfirmDialog>
      <PageHeader
        eyebrow="01 · Overview"
        title={isDemo ? `Demo desk · ${policy.label}` : "Your desk"}
        description="What needs a decision, how much of your mandate is in use, and whether execution stayed inside it."
        actions={
          <>
            <button type="button" className="btn" onClick={() => void loadDemo()} disabled={seeding}>
              {seeding ? "Loading…" : "Load demo scenario"}
            </button>
            <Link href="/proposals" className="btn btn-primary">
              Review proposals{awaiting.length ? ` · ${awaiting.length}` : ""}
            </Link>
          </>
        }
      />

      {/* 1 · Four key metrics */}
      <MetricStrip
        metrics={[
          {
            label: "Awaiting your signature",
            value: awaiting.length,
            sub: awaiting.length ? `${usd(approvedUsd)} policy-approved` : "nothing approved and unsigned",
            tone: awaiting.length ? "accent" : undefined,
            layer: "policy",
          },
          {
            label: "Daily budget left",
            value: cap ? usd(Math.max(0, cap.dailyMax - cap.dailyUsed)) : "—",
            sub: cap ? `${usd(cap.dailyUsed)} of ${usd(cap.dailyMax)} used today` : undefined,
            tone: cap && cap.dailyUsed >= cap.dailyMax ? "bad" : undefined,
          },
          {
            label: "Live on Flash",
            value: liveOrders.length,
            sub: liveOrders.length ? `${usd(liveOrders.reduce((s, o) => s + o.receipt.notionalUsd, 0))} working` : "no open orders",
            layer: "execution",
          },
          {
            label: "Mean entry drift",
            value: meanDrift === undefined ? "—" : `${meanDrift >= 0 ? "+" : ""}${meanDrift.toFixed(1)} bps`,
            sub: drifts.length ? `${drifts.length} filled order${drifts.length === 1 ? "" : "s"} · + = paid worse` : "no measured fills yet",
            tone: meanDrift === undefined ? undefined : meanDrift > Number(policy.maxEntryDrift) * 10_000 ? "bad" : "good",
            layer: "execution",
          },
        ]}
      />

      <div className="mt-5 grid items-start gap-5 grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* 2 · Incoming plans */}
        <Panel
          title="Incoming plans"
          subtitle="Latest leader plans evaluated against your mandate"
          layer="policy"
          actions={
            <Link href="/proposals" className="text-[12px] text-accent hover:underline">
              All proposals →
            </Link>
          }
        >
          {incoming.length ? (
            <div className="scroll-thin overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Decision</th>
                    <th>Plan</th>
                    <th>Leader</th>
                    <th className="r">Notional</th>
                    <th>Expires</th>
                    <th className="r" />
                  </tr>
                </thead>
                <tbody>
                  {incoming.map((p) => {
                    const d = decisions[p.id];
                    const r = receiptOf.get(p.id);
                    return (
                      <tr key={p.id}>
                        <td>
                          <ActionBadge action={d?.action} verdict={d?.verdict} />
                        </td>
                        <td className="max-w-[260px]">
                          <div className="truncate text-ink">{p.title}</div>
                          <div className="text-[11px] text-mute">
                            {pairLabel(p)} · {p.side} {p.orderType}
                          </div>
                        </td>
                        <td>
                          <LeaderTag value={p.leader} size={20} />
                        </td>
                        <td className="r">{usd(p.notionalUsd)}</td>
                        <td className="text-mute">{relativeTime(p.expiresAt)}</td>
                        <td className="r">
                          {r?.flashOrderId ? (
                            <Link href="/execution" className="text-[12px] text-exec hover:underline">
                              {orderStatusLabel(r.status)}
                            </Link>
                          ) : (
                            <Link href={`/review/${p.id}`} className="text-[12px] text-accent hover:underline">
                              Review
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title={follower ? "No plans for this desk yet" : "Connect a wallet or view a demo desk"}
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Link href="/discover" className="btn">
                    Discover leaders
                  </Link>
                  <button type="button" className="btn" onClick={() => void loadDemo()} disabled={seeding}>
                    Load demo scenario
                  </button>
                </div>
              }
            >
              Select leaders in Discover, then mirror their open plans into proposals. The demo scenario seeds
              seven deterministic policy cases.
            </Empty>
          )}
          <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
            {(["COPY", "SCALE", "WAIT", "REVIEW", "DECLINE"] as const).map((a) => (
              <Link key={a} href={`/proposals?action=${a}`} className="inline-flex items-center gap-1.5">
                <ActionBadge action={a} />
                <span className="tnum text-[12px] text-ink">{counts[a]}</span>
              </Link>
            ))}
          </div>
        </Panel>

        {/* 3 · Mandate and exposure */}
        <Panel
          title="Mandate & exposure"
          subtitle={canAct ? "Your follower-owned limits" : "Read-only view"}
          actions={
            <Link href="/settings/mandate" className="text-[12px] text-accent hover:underline">
              Edit →
            </Link>
          }
          bodyClassName="p-4"
        >
          <dl>
            <KV k="Leaders followed" v={`${policy.follows?.length ?? 0} / 3${policy.pausedLeaders?.length ? ` · ${policy.pausedLeaders.length} paused` : ""}`} />
            <KV k="Per order / daily" v={`${usd(policy.maxNotionalUsd)} / ${usd(policy.maxDailyUsd)}`} />
            <KV k="Entry drift bound" v={`${(Number(policy.maxEntryDrift) * 100).toFixed(2)}%`} />
            <KV k="Quote impact limit" v={`${(Number(policy.maxPriceImpact) * 100).toFixed(2)}%`} />
            <KV
              k="Agent mode"
              v={
                policy.automationMode === "AUTOPILOT"
                  ? "Autopilot · scoped session key signs"
                  : policy.automationMode === "ASSIST"
                    ? "Assist · queues for review"
                    : "Review · self-sign each order"
              }
            />
          </dl>
          {cap ? (
            <div className="mt-4 space-y-3">
              <Meter label="Daily budget" used={cap.dailyUsed} max={cap.dailyMax} format={usd} />
              <Meter label="Live plans" used={cap.openPlans} max={cap.openPlansMax} />
              {topGroup ? (
                <Meter
                  label={`${topGroup.asset} ${topGroup.side} exposure · ${topGroup.leaders.length} leader${topGroup.leaders.length === 1 ? "" : "s"}`}
                  used={topGroup.approvedUsd + topGroup.liveUsd}
                  max={cap.assetMax}
                  format={usd}
                  hint="Approved plus live, same asset and side. Concentration, not a prediction."
                />
              ) : null}
            </div>
          ) : null}
          <Link href="/portfolio" className="mt-4 inline-block text-[12px] text-accent hover:underline">
            Full exposure and capacity →
          </Link>
        </Panel>
      </div>

      {/* 4 · Execution health */}
      <div className="mt-5 grid gap-5 grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel className="overflow-hidden">
          <TradingChart height={300} />
        </Panel>
        <Panel title="Execution health" layer="execution" bodyClassName="p-4">
          <dl>
            <KV
              k="Definitive Flash"
              v={
                flash === null ? (
                  <span className="text-mute">checking…</span>
                ) : flash.ok ? (
                  <StatusBadge tone="good" icon="●">online</StatusBadge>
                ) : (
                  <StatusBadge tone="bad" icon="✕">{flash.error ?? "unreachable"}</StatusBadge>
                )
              }
            />
            <KV k="Orders submitted" v={orders.length} />
            <KV k="Open / closed" v={`${liveOrders.length} / ${orders.length - liveOrders.length}`} />
            <KV
              k="Latest order"
              v={orders[0] ? `${orderStatusLabel(orders[0].receipt.status)} · ${relativeTime(orders[0].receipt.createdAt)}` : "none yet"}
            />
            <KV
              k="Fills within your drift bound"
              v={drifts.length ? `${drifts.filter((d) => d <= Number(policy.maxEntryDrift) * 10_000).length} / ${drifts.length}` : "—"}
            />
          </dl>
          {orders.length === 0 ? (
            <p className="mt-3 text-[11.5px] leading-relaxed text-mute">
              No real follower order has been recorded on this desk yet. Receipts appear after a self-signed Flash
              submit; PACT does not show simulated fills.
            </p>
          ) : null}
          <div className="mt-4 space-y-2">
            <Planned title="Leader exits & markouts">
              Post-fill markouts and leader-exit alerts need a receipt history first.
            </Planned>
          </div>
          <div className="mt-3 flex items-center gap-2 text-[11px] text-mute">
            <LayerTag layer="execution" compact /> facts come from Flash order status and fills only.
          </div>
        </Panel>
      </div>
    </div>
  );
}
