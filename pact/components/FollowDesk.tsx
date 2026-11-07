"use client";

import { DecisionTrace } from "@/components/DecisionTrace";
import { MAX_LEADERS } from "@/lib/constants";
import { Gauge } from "@/components/Gauge";
import { CopyActionPill } from "@/components/CopyActionPill";
import { LeaderPanel } from "@/components/LeaderPanel";
import { TradingChart } from "@/components/TradingChart";
import { useDeskContext } from "@/components/DeskContext";
import { ActionBadge, Addr, AddrAvatar, KV, LayerTag, Panel, StatusBadge } from "@/components/ui";
import { effectiveLimitNotionalPrice } from "@/lib/policy";
import { useDesk } from "@/components/useDesk";
import { defaultPolicy, WETH } from "@/lib/constants";
import { CHAINS, CHAIN_IDS } from "@/lib/chains";
import { bracketPriceFloor, verifyBracketSigning, verifySigning, type GuardResult } from "@/lib/guard";
import { batchCancelMessage, cancelMessage, parseOrderTypedData } from "@/lib/typed";
import { capacity, protectionCancellable, relativeTime, stillLive } from "@/lib/views";
import { reasonLabel, shortAddr, usd } from "@/lib/format";
import Link from "next/link";
import type {
  AutomationMode,
  Chain,
  Decision,
  FollowerExitMode,
  LeaderMandate,
  OrderType,
  Policy,
  Proposal,
  Side,
} from "@/lib/types";
import { useEffect, useState } from "react";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSwitchChain,
  useSendTransaction,
  useSignMessage,
  useSignTypedData,
} from "wagmi";
import { apiFetch } from "@/lib/api";
import { mandateFor } from "@/components/pages/following-actions";
import { EvidenceBadge } from "@/components/pages/discover-parts";
import { ReferencePrices } from "@/components/ReferencePrices";
import { SignalList } from "@/components/SignalList";

const PREVIEW_POLICY = defaultPolicy(
  "0x0000000000000000000000000000000000000000",
);

export function FollowDesk({ reviewProposalId }: { reviewProposalId?: string }) {
  const { address, isConnected } = useAccount();
  const { state, refresh } = useDesk(address);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const policy: Policy =
    state?.policies.find(
      (p) => address && p.follower.toLowerCase() === address.toLowerCase(),
    ) ?? (address ? defaultPolicy(address) : PREVIEW_POLICY);

  useEffect(() => {
    if (!address) return;
    // Reads the saved mandate; a wallet with none gets the defaults. Never overwrites edits.
    void fetch(`/api/policy?follower=${address}`).then(() => refresh());
  }, [address, refresh]);

  async function pull() {
    if (!address) return;
    setPulling(true);
    setError(null);
    try {
      const follows = policy.follows ?? [];
      for (const s of state?.strategies ?? []) {
        if (!follows.some((l) => l.toLowerCase() === s.leader.toLowerCase())) {
          continue;
        }
        await apiFetch("/api/proposals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ strategyId: s.id, follower: address }),
        });
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "pull failed");
    } finally {
      setPulling(false);
    }
  }

  const spent = state?.dailySpentUsd ?? 0;
  const recordedLeaderLoss = Object.values(state?.leaderDailyRealizedLossesUsd ?? {}).reduce(
    (sum, loss) => sum + loss,
    0,
  );
  const maxDaily = policy.maxDailyUsd;
  const all = state?.proposals ?? [];
  const mine = all.filter(
    (p) => address && p.follower.toLowerCase() === address.toLowerCase(),
  );
  const tape = mine.length ? mine : all;
  const preview = mine.length === 0 && tape.length > 0;
  const concentration = Object.values(
    mine.reduce<Record<string, { label: string; notionalUsd: number; leaders: Set<string> }>>(
      (groups, proposal) => {
        const decision = state?.decisions[proposal.id];
        if (!decision || decision.verdict === "BLOCK") return groups;
        const key = `${proposal.targetAsset.toLowerCase()}:${proposal.side}`;
        const group = groups[key] ?? {
          label: `${proposal.targetAsset.toLowerCase() === WETH.toLowerCase() ? "WETH" : shortAddr(proposal.targetAsset)} ${proposal.side}`,
          notionalUsd: 0,
          leaders: new Set<string>(),
        };
        group.notionalUsd += Number(decision.modifiedQty ?? proposal.notionalUsd);
        group.leaders.add(proposal.leader.toLowerCase());
        groups[key] = group;
        return groups;
      },
      {},
    ),
  );
  const approvedCapacity = concentration.reduce((sum, item) => sum + item.notionalUsd, 0);

  if (reviewProposalId) {
    const proposal = tape.find((item) => item.id === reviewProposalId);
    if (!proposal) {
      return (
        <section className="terminal-panel p-6">
          <div className="terminal-kicker">review unavailable</div>
          <h1 className="mt-2 text-xl font-semibold">Proposal not found</h1>
          <p className="mt-2 text-sm text-mute">
            This proposal is not in the current local PACT store. Return to mandates and mirror
            open intents again.
          </p>
          <Link href="/follower" className="btn-cream mt-5 inline-block rounded-md px-4 py-2 text-sm">
            back to mandates
          </Link>
        </section>
      );
    }
    return (
      <ReviewWorkspace
        proposal={proposal}
        decision={state?.decisions[proposal.id]}
        receipt={state?.receipts.find((item) => item.proposalId === proposal.id)}
        onDone={refresh}
      />
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
      <section className="glass rounded-[32px] p-6">
        <div className="text-[11px] uppercase tracking-[0.12em] text-mute">
          Tool · the original follower desk
        </div>
        <h1 className="mt-2 font-[family-name:var(--font-serif)] text-[36px] font-medium leading-[1.1] text-ink md:text-[44px]">
          Classic desk
        </h1>
        <p className="mt-2 text-sm text-mute">
          Pick leaders, define a budget and exit choice for each, then review every Flash
          order before you sign. PACT never holds a trading key.
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-[10px] uppercase tracking-[0.12em] text-mute">
          <div className="rounded-xl bg-white/[0.04] px-2 py-2 hairline">1 · mandate</div>
          <div className="rounded-xl bg-white/[0.04] px-2 py-2 hairline">2 · review</div>
          <div className="rounded-xl bg-white/[0.04] px-2 py-2 hairline">3 · self-sign</div>
        </div>

        <Gauge
          value={spent}
          max={maxDaily}
          label={usd(Math.max(0, maxDaily - spent)).replace(".00", "")}
          sub="left today"
        />

        <dl className="mt-2 space-y-2 text-[13px]">
          <Row k="max / order" v={usd(policy.maxNotionalUsd)} />
          <Row k="daily" v={usd(policy.maxDailyUsd)} />
          <Row k="copy size" v={`${Math.round(policy.copyRatio * 100)}% of leader`} />
          <Row k="stop-risk budget" v={`${usd(policy.riskBudgetUsd)} / plan`} />
          <Row k="leaders selected" v={`${policy.follows?.length ?? 0} / 3`} />
          <Row k="per-leader sleeve" v={usd(policy.maxLeaderDailyUsd)} />
          <Row
            k="loss breaker / leader"
            v={policy.enableLeaderLossCircuitBreaker ? `${usd(policy.maxLeaderDailyRealizedLossUsd)} / day` : "off"}
          />
          <Row k="recorded losses today" v={usd(recordedLeaderLoss)} />
          <Row k="same-asset exposure" v={usd(policy.maxAssetExposureUsd)} />
          <Row k="live plans" v={`${policy.maxOpenPlans} total · ${policy.maxOpenPlansPerLeader} / leader`} />
          <Row k="chains" v={(policy.allowChains ?? [policy.chain]).join(" · ")} />
          <Row k="types" v={policy.allowOrderTypes.join(" · ")} />
          <Row k="sides" v={policy.allowSides.join(" · ")} />
          <Row k="pair" v="WETH / USDC" />
          <Row k="fee bps" v="0" />
        </dl>
        <div className="mt-4 rounded-2xl bg-black/25 p-3 hairline">
          <div className="text-[11px] uppercase tracking-[0.14em] text-mute">
            concentration, not a prediction
          </div>
          {concentration.length ? (
            <div className="mt-2 space-y-1.5 text-[12px]">
              {concentration.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-3">
                  <span className="text-ink">{item.label}</span>
                  <span className="text-mute">
                    {usd(item.notionalUsd)} · {approvedCapacity > 0 ? Math.round((item.notionalUsd / approvedCapacity) * 100) : 0}% · {item.leaders.size} leader{item.leaders.size === 1 ? "" : "s"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[12px] text-mute">No allowed copy intents yet.</p>
          )}
          <p className="mt-2 text-[10px] leading-relaxed text-mute">
            {approvedCapacity ? `Approved capacity ${usd(approvedCapacity)}. ` : ""}
            PACT shows same-asset, same-side concentration. It does not claim a statistical
            correlation estimate from insufficient history.
          </p>
        </div>
        {isConnected && address ? (
          <LeaderPanel policy={policy} state={state ?? undefined} onSaved={refresh} />
        ) : null}
        {isConnected && address ? (
          <AssistPanel policy={policy} onSaved={refresh} />
        ) : null}
        {isConnected && address ? (
          <PolicyEditor
            key={JSON.stringify(policy)}
            policy={policy}
            leaders={[...new Set((state?.strategies ?? []).map((st) => st.leader))]}
            onSaved={refresh}
          />
        ) : (
          <p className="mt-4 text-sm text-mute">
            Connect the follower wallet to set your limits and sign ALLOW. Preview is locked.
          </p>
        )}

        <button
          type="button"
          disabled={!isConnected || pulling}
          onClick={() => void pull()}
          className={`btn-cream mt-6 w-full rounded-full py-3 text-sm ${
            isConnected ? "" : "opacity-40"
          }`}
        >
          {pulling ? "mirroring…" : "mirror open intents"}
        </button>
        {error ? <p className="mt-3 text-sm text-rose">{error}</p> : null}
      </section>

      <section className="space-y-3">
        {tape.length === 0 ? (
          <div className="glass rounded-[32px] p-8 text-sm text-mute">
            No proposals yet. Load the demo tape on the floor, or publish from
            lead and mirror.
          </div>
        ) : (
          <>
            {preview ? (
              <p className="px-1 text-[12px] text-mute">
                Locked preview of the tape. Connect as the follower to sign
                ALLOW.
              </p>
            ) : null}
            {tape.map((p) => (
              <ProposalCard
                key={p.id}
                proposal={p}
                decision={state?.decisions[p.id]}
                receipt={state?.receipts.find((r) => r.proposalId === p.id)}
                onDone={refresh}
              />
            ))}
          </>
        )}
      </section>
    </div>
  );
}

export function ReviewWorkspace({
  proposal,
  decision,
  receipt,
  onDone,
}: {
  proposal: Proposal;
  decision?: Decision;
  receipt?: CardReceipt;
  onDone: () => Promise<void>;
}) {
  const { state } = useDeskContext();
  const supportsLiveMarket =
    proposal.chain === "base" && proposal.targetAsset.toLowerCase() === WETH.toLowerCase();
  const expiresAt = new Date(proposal.expiresAt);
  const strategy = state?.strategies.find((s) => s.id === proposal.strategyId);
  const followerPolicy = state?.policies.find(
    (p) => p.follower.toLowerCase() === proposal.follower.toLowerCase(),
  );
  const bound = followerPolicy ? effectiveLimitNotionalPrice(proposal, followerPolicy) : undefined;
  const boundsEntry = proposal.orderType === "twap" || proposal.orderType === "limit";
  const approvedQty = decision?.modifiedQty ?? proposal.qty;
  const blocked = !decision || decision.verdict === "BLOCK";
  const bracket =
    proposal.followerExitMode === "FOLLOWER_BRACKET" &&
    proposal.side === "buy" &&
    !!proposal.stopLossPrice &&
    !!proposal.takeProfitPrice &&
    !!proposal.protectionExpiresAt;
  const price = (v?: string) => (v ? `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "not declared");
  const leaderSize = strategy
    ? strategy.side === "buy"
      ? usd(Number(strategy.qty))
      : `${strategy.qty} units`
    : "—";
  const sizing =
    proposal.copySizingMode === "STOP_RISK"
      ? `stop-risk · ${usd(proposal.riskBudgetUsd ?? 0)} at stop`
      : proposal.copySizingMode === "FIXED"
        ? "fixed USD"
        : "proportional";
  const rows: { k: string; leader: string; yours: string; changed?: boolean }[] = [
    {
      k: "Order",
      leader: `${proposal.orderType} ${proposal.side} · ${proposal.chain}`,
      yours: `${proposal.orderType} ${proposal.side} · ${proposal.chain}${proposal.durationSeconds ? ` · ${Math.round(proposal.durationSeconds / 60)}m` : ""}${proposal.twapBucketCount ? ` · ${proposal.twapBucketCount} buckets` : ""}`,
    },
    {
      k: "Size",
      leader: leaderSize,
      yours: blocked ? "not approved" : `${usd(proposal.notionalUsd)} · qty ${approvedQty}`,
      changed: !blocked && decision?.verdict === "MODIFY",
    },
    { k: "Sizing", leader: "leader's own size", yours: sizing },
    {
      k: "Entry",
      leader: price(proposal.entryReferencePrice),
      yours: boundsEntry
        ? bound
          ? `Flash bound ${proposal.side === "buy" ? "≤" : "≥"} ${price(bound)}`
          : "no bound (no declared entry)"
        : proposal.maxSlippage
          ? `market · slippage ≤ ${(Number(proposal.maxSlippage) * 100).toFixed(2)}%`
          : "market",
      changed: boundsEntry && !!bound,
    },
    {
      k: "Stop / target",
      leader: `${price(proposal.stopLossPrice)} / ${price(proposal.takeProfitPrice)}`,
      yours: bracket ? "Flash TP/SL bracket at declared levels" : "manual exit",
    },
    {
      k: "Window",
      leader: Number.isFinite(expiresAt.valueOf()) ? `entry until ${expiresAt.toLocaleString()}` : "invalid",
      yours: proposal.protectionExpiresAt && bracket
        ? `protection until ${new Date(proposal.protectionExpiresAt).toLocaleString()}`
        : "same entry window",
    },
  ];

  // Derived checks shown as a checklist. The binding decision is the server's (badge above);
  // these restate the mandate limits the decision applied, from the same policy fields.
  const cap = state && followerPolicy ? capacity(state, followerPolicy) : undefined;
  const sleeve = cap?.sleeves.find((x) => x.leader.toLowerCase() === proposal.leader.toLowerCase());
  const mandate = followerPolicy ? mandateFor(followerPolicy, proposal.leader) : undefined;
  const pct = (a?: string, b?: string) => (Number(a) > 0 && Number(b) > 0 ? ((Number(b) - Number(a)) / Number(a)) * 100 : undefined);
  const rr =
    Number(proposal.entryReferencePrice) > 0 && Number(proposal.stopLossPrice) > 0 && Number(proposal.takeProfitPrice) > 0
      ? Math.abs(Number(proposal.takeProfitPrice) - Number(proposal.entryReferencePrice)) / Math.abs(Number(proposal.entryReferencePrice) - Number(proposal.stopLossPrice))
      : undefined;
  const reasons = new Set(decision?.reasons ?? []);
  const checks: { label: string; ok: boolean }[] = followerPolicy
    ? [
        {
          label: `Order type allowed (${proposal.orderType.toUpperCase()})`,
          ok: (mandate?.allowOrderTypes ?? followerPolicy.allowOrderTypes).includes(proposal.orderType) && !reasons.has("ORDER_TYPE_NOT_ALLOWED"),
        },
        { label: `Chain allowed (${proposal.chain})`, ok: (followerPolicy.allowChains ?? []).includes(proposal.chain) && !reasons.has("CHAIN_NOT_ALLOWED") },
        {
          label: `Within the per-order cap (${usd(proposal.notionalUsd)} ≤ ${usd(followerPolicy.maxNotionalUsd)})`,
          ok: proposal.notionalUsd <= followerPolicy.maxNotionalUsd,
        },
        ...(sleeve
          ? [
              {
                label: `Within the daily sleeve (${usd(sleeve.used + (blocked ? 0 : proposal.notionalUsd))} / ${usd(sleeve.max)})`,
                ok: sleeve.used + proposal.notionalUsd <= sleeve.max,
              },
            ]
          : []),
        ...(rr !== undefined ? [{ label: `Reward : risk ${rr.toFixed(2)} ≥ ${followerPolicy.minRewardRisk}`, ok: rr >= followerPolicy.minRewardRisk }] : []),
        ...(boundsEntry && bound ? [{ label: `Entry bound sent to Flash (≤ ${(Number(followerPolicy.maxEntryDrift) * 100).toFixed(2)}% drift)`, ok: true }] : []),
        { label: bracket ? "Exit protection: Flash TP/SL bracket" : "Exit: manual (no bracket)", ok: bracket || proposal.followerExitMode === "MANUAL" },
      ]
    : [];
  const verdictLine =
    !decision
      ? "No decision"
      : decision.verdict === "ALLOW"
        ? "PASS (Copy)"
        : decision.verdict === "MODIFY"
          ? "PASS (Scale)"
          : decision.action === "WAIT"
            ? "WAIT"
            : decision.action === "REVIEW"
              ? "REVIEW"
              : "DECLINE";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link href="/proposals" className="inline-flex items-center gap-2 text-[13.5px] text-ink/75 hover:text-ink">
            <span aria-hidden>←</span> Back to Proposals
          </Link>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="font-[family-name:var(--font-serif)] text-[38px] font-medium leading-none text-ink">Proposal Review</h1>
            {decision ? <ActionBadge action={decision.action} verdict={decision.verdict} /> : null}
          </div>
          <p className="mt-2 text-[14px] text-ink/70">Review the trade, policy checks and execution quote before signing.</p>
        </div>
        <div className="flex items-center gap-3 text-[13px]">
          <AddrAvatar value={proposal.leader} size={40} />
          <span className="text-mute">From</span>
          <Link href={`/leaders/${proposal.leader}`} className="font-medium text-ink hover:text-accent">
            Leader {proposal.leader.slice(2, 6).toUpperCase()}
          </Link>
          <Addr value={proposal.leader} />
          <span className="ml-3 text-mute">{relativeTime(proposal.createdAt)}</span>
        </div>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(340px,1fr)]">
        <Panel className="overflow-hidden">
          {supportsLiveMarket ? (
            <TradingChart
              entry={proposal.entryReferencePrice}
              stop={proposal.stopLossPrice}
              target={proposal.takeProfitPrice}
              bound={boundsEntry ? bound : undefined}
              height={330}
              fitLevels
            />
          ) : (
            <div className="p-5">
              <div className="flex items-center gap-2">
                <span className="panel-title">Market context unavailable</span>
                <LayerTag layer="market" />
              </div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-mute">
                PACT renders a real DEX chart only for Base WETH/USDC. This proposal can still be policy-reviewed, but it does not get a substituted chart.
              </p>
            </div>
          )}
        </Panel>

        <Panel title="Leader's Trade Plan" subtitle="A plan claim, not execution truth" bodyClassName="px-5 py-3">
          <dl>
            <KV k="Strategy" v={<Link href={`/plans/${proposal.strategyId}`} className="hover:text-accent">{proposal.title}</Link>} />
            <KV k="Direction" v={<StatusBadge tone={proposal.side === "buy" ? "good" : "bad"}>{proposal.side === "buy" ? "Long" : "Sell"}</StatusBadge>} />
            <KV k="Order Type" v={proposal.orderType === "twap" ? "TWAP" : proposal.orderType} />
            <KV k="Entry (Ref.)" v={price(proposal.entryReferencePrice)} />
            <KV
              k="Target"
              v={
                <span className="text-good">
                  {price(proposal.takeProfitPrice)}
                  {pct(proposal.entryReferencePrice, proposal.takeProfitPrice) !== undefined ? ` (+${pct(proposal.entryReferencePrice, proposal.takeProfitPrice)!.toFixed(2)}%)` : ""}
                </span>
              }
            />
            <KV
              k="Stop"
              v={
                <span className="text-bad">
                  {price(proposal.stopLossPrice)}
                  {pct(proposal.entryReferencePrice, proposal.stopLossPrice) !== undefined ? ` (${pct(proposal.entryReferencePrice, proposal.stopLossPrice)!.toFixed(2)}%)` : ""}
                </span>
              }
            />
            <KV k="Reward : Risk" v={rr === undefined ? "—" : rr.toFixed(2)} />
            <KV k="Plan grade" v={proposal.leaderPlanGrade.toLowerCase()} />
            <KV k="Execution evidence" v={<EvidenceBadge status={proposal.leaderEvidenceStatus} />} />
            <KV k="Thesis" v={proposal.thesis || "No thesis declared."} wrap />
            <KV k="Invalidation" v={proposal.invalidation?.trim() || "not declared"} wrap />
          </dl>
        </Panel>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(340px,1fr)]">
        <div className="space-y-5">
          <Panel title="Your Execution" subtitle="Mandate applied" layer="policy" bodyClassName="px-5 py-3">
            <dl>
              <KV k="Sizing Mode" v={proposal.copySizingMode === "PROPORTIONAL" && mandate ? `Proportional (${Math.round(mandate.copyRatio * 100)}%)` : sizing} />
              <KV k="Leader Size" v={leaderSize} />
              <KV k="Your Size" v={<span className={blocked ? "text-mute" : decision?.verdict === "MODIFY" ? "text-warn" : "text-good"}>{blocked ? "not approved" : `${usd(proposal.notionalUsd)} · qty ${approvedQty}`}</span>} />
              {sleeve ? <KV k="Daily Sleeve (Used / Max)" v={`${usd(sleeve.used)} / ${usd(sleeve.max)}`} /> : null}
              <KV k="Exit Strategy" v={<StatusBadge tone="neutral">{bracket ? "Follower bracket" : "Manual"}</StatusBadge>} />
              {rows
                .filter((r) => r.k === "Entry" || r.k === "Window")
                .map((r) => (
                  <KV key={r.k} k={r.k === "Entry" ? "Your entry bound" : "Window"} v={<span className={r.changed ? "text-warn" : ""}>{r.yours}</span>} />
                ))}
            </dl>
          </Panel>
          <SignalList signals={proposal.signals} />
        </div>

        <div className="space-y-5">
          <Panel
            title="Policy Check"
            subtitle="Your mandate's decision"
            layer="policy"
            actions={decision ? <StatusBadge tone={decision.verdict === "BLOCK" ? (decision.action === "DECLINE" ? "bad" : "warn") : "good"}>{verdictLine}</StatusBadge> : null}
            bodyClassName="px-5 py-4"
          >
            {decision?.reasons.length ? (
              <ul className="mb-3 space-y-2">
                {decision.reasons.map((reason) => (
                  <li key={reason} className="flex items-start gap-2.5 text-[13px]">
                    <span aria-hidden className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${decision.verdict === "BLOCK" ? "bg-[var(--bad)] text-white" : "bg-[var(--warn)] text-black"}`}>
                      {decision.verdict === "BLOCK" ? "✕" : "!"}
                    </span>
                    <span className="text-ink">{reasonLabel(reason)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <ul className="space-y-2">
              {checks.map((c) => (
                <li key={c.label} className="flex items-start gap-2.5 text-[13px]">
                  <span aria-hidden className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${c.ok ? "bg-[var(--good)] text-white" : "bg-panel-3 text-mute"}`}>
                    {c.ok ? "✓" : "–"}
                  </span>
                  <span className={c.ok ? "text-ink/90" : "text-mute"}>{c.label}</span>
                </li>
              ))}
            </ul>
            {proposal.leaderPlanReasons.length ? (
              <div className="mt-4 border-t border-line-2 pt-3">
                <div className="label">Plan quality notes</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {proposal.leaderPlanReasons.map((reason) => (
                    <StatusBadge key={reason} tone="warn" icon="!">
                      {reasonLabel(reason)}
                    </StatusBadge>
                  ))}
                </div>
              </div>
            ) : null}
          </Panel>
          <ReferencePrices check={state?.quotes[proposal.id]?.reference} title={state?.quotes[proposal.id]?.reference ? "Prices at your quote" : "Three prices, live"} />
        </div>

        <div className="min-w-0">
          <ProposalCard proposal={proposal} decision={decision} receipt={receipt} onDone={onDone} reviewMode />
        </div>
      </div>

      <DecisionTrace proposal={proposal} decision={decision} />

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line px-5 py-3.5 text-[13px] text-ink/75">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 7.2v3.6M8 5.2v.1" strokeLinecap="round" />
        </svg>
        You are in control. Signing happens in your wallet, for exactly the order shown, after PACT&apos;s guard checks Flash&apos;s payload in your browser. Nothing is executed until you sign.
      </div>
    </div>
  );
}

function ReviewRow({ k, v, wrap = false }: { k: string; v: string; wrap?: boolean }) {
  return (
    <div className={`flex gap-3 border-b border-line px-0 py-2.5 last:border-b-0 ${wrap ? "items-start" : "items-center justify-between"}`}>
      <dt className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-mute">{k}</dt>
      <dd className={`text-right text-ink ${wrap ? "leading-relaxed" : "truncate"}`}>{v}</dd>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between border-b border-white/6 py-2">
      <dt className="text-mute">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

type AssistResponse = {
  mode: AutomationMode;
  recommendations: {
    proposalId: string;
    action: "PREPARE_REVIEW" | "HOLD" | "DECLINE";
    headline: string;
    reasons: string[];
  }[];
  constraints: string[];
};

export function AssistPanel({ policy, onSaved }: { policy: Policy; onSaved: () => Promise<void> }) {
  const follower = policy.follower;
  const mode = policy.automationMode ?? "REVIEW";
  const [result, setResult] = useState<AssistResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setAssistMode(nextMode: AutomationMode) {
    setSavingMode(true);
    setError(null);
    try {
      const res = await apiFetch("/api/policy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...policy, automationMode: nextMode }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "could not update Assist mode");
      if (nextMode === "REVIEW") setResult(null);
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not update Assist mode");
    } finally {
      setSavingMode(false);
    }
  }

  async function scan() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agent?follower=${follower}`, { cache: "no-store" });
      const json = (await res.json()) as AssistResponse & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "agent scan failed");
      setResult(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "agent scan failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 border border-line bg-black/25 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="terminal-kicker">PACT Assist</div>
          <p className="mt-1 text-[11px] leading-relaxed text-mute">
            {mode === "ASSIST"
              ? "Scans your follower-owned mandate and queues only policy-compliant plans for review."
              : "Turn on Assist to scan your existing mandates into a review queue."}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={savingMode}
            onClick={() => void setAssistMode(mode === "ASSIST" ? "REVIEW" : "ASSIST")}
            className="border border-line px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-mute hover:border-gold hover:text-gold disabled:cursor-not-allowed"
          >
            {savingMode ? "saving…" : mode === "ASSIST" ? "turn off" : "enable"}
          </button>
          {mode === "ASSIST" ? (
            <button
              type="button"
              disabled={loading}
              onClick={() => void scan()}
              className="border border-gold px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-gold disabled:cursor-not-allowed"
            >
              {loading ? "scanning…" : "scan plans"}
            </button>
          ) : null}
        </div>
      </div>
      {mode !== "ASSIST" ? (
        <p className="mt-2 text-[10px] leading-relaxed text-mute">
          Assist never signs or trades. Autopilot is not enabled in this version because it needs a
          follower-owned session-key smart account with explicit onchain limits and revocation.
        </p>
      ) : null}
      {error ? <p className="mt-2 text-[11px] text-rose">{error}</p> : null}
      {result ? (
        <div className="mt-3 space-y-2">
          {result.recommendations.length ? result.recommendations.map((item) => (
            <div key={item.proposalId} className="border border-line p-2 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink">{item.headline}</span>
                {item.action === "PREPARE_REVIEW" ? (
                  <Link href={`/review/${item.proposalId}`} className="text-gold">review →</Link>
                ) : (
                  <span className="font-mono text-[10px] text-mute">{item.action.toLowerCase()}</span>
                )}
              </div>
              {item.reasons.length ? <p className="mt-1 text-mute">{item.reasons.map(reasonLabel).join(" · ")}</p> : null}
            </div>
          )) : <p className="text-[11px] text-mute">No follower proposals to assess.</p>}
          <p className="text-[10px] leading-relaxed text-mute">{result.constraints[0]}</p>
        </div>
      ) : null}
    </div>
  );
}

type StepId = "quote" | "guard" | "approve" | "permit" | "sign" | "bracket" | "submit";
type StepState = "idle" | "active" | "done" | "fail" | "skip";
const STEPS: { id: StepId; label: string }[] = [
  { id: "quote", label: "Flash quote" },
  { id: "guard", label: "wallet guard" },
  { id: "approve", label: "approve allowance" },
  { id: "permit", label: "sign Permit2" },
  { id: "sign", label: "sign order" },
  { id: "bracket", label: "sign TP/SL bracket" },
  { id: "submit", label: "submit to Flash" },
];
const IDLE: Record<StepId, StepState> = {
  quote: "idle",
  guard: "idle",
  approve: "idle",
  permit: "idle",
  sign: "idle",
  bracket: "idle",
  submit: "idle",
};
const CANCELLABLE = [
  "ORDER_STATUS_PENDING",
  "ORDER_STATUS_ACCEPTED",
  "ORDER_STATUS_PARTIALLY_FILLED",
];

type CardReceipt = {
  protection?: {
    status?: string;
    bracketOrderId?: string;
    orderStatus?: string;
    levelsMatch?: boolean;
    takeProfit?: string;
    stopLoss?: string;
    intendedTakeProfit?: string;
    intendedStopLoss?: string;
  };
  flashOrderId?: string;
  transactionId?: string;
  status?: string;
  closeReason?: string;
  fills?: { transactionId?: string; fillPrice?: string; notional?: string; filledAt?: string }[];
  completedFillCount?: number;
  twapBucketCount?: number;
  quotedExecutionPrice?: string;
  declaredEntryPrice?: string;
  averageFillPrice?: string;
  entryDriftBps?: number;
};

export function ProposalCard({
  proposal,
  decision,
  receipt,
  onDone,
  reviewMode = false,
}: {
  proposal: Proposal;
  decision?: Decision;
  receipt?: CardReceipt;
  onDone: () => Promise<void>;
  reviewMode?: boolean;
}) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { signTypedDataAsync } = useSignTypedData();
  const { signMessageAsync } = useSignMessage();
  const { sendTransactionAsync } = useSendTransaction();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const [guard, setGuard] = useState<GuardResult | null>(null);
  const [steps, setSteps] = useState<Record<StepId, StepState>>(IDLE);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [approveHash, setApproveHash] = useState<`0x${string}` | undefined>();
  const [executionQuote, setExecutionQuote] = useState<{
    executionPrice?: string;
    estimatedPriceImpact?: string;
    declaredLimitNotionalPrice?: string;
    effectiveLimitNotionalPrice?: string;
  } | null>(null);
  const blocked = !decision || decision.verdict === "BLOCK";
  const isFollower = Boolean(
    address && address.toLowerCase() === proposal.follower.toLowerCase(),
  );
  const canSign = isFollower && !blocked && !busy && !receipt?.flashOrderId;
  const explorer = CHAINS[proposal.chain].explorerTx;
  const orderId = receipt?.flashOrderId;
  // Keep watching after the entry ends while its protection pair is still pending or live.
  const watching = Boolean(receipt && stillLive(receipt));
  // While Flash's order stream is live the server refreshes on every change; polling is a slow safety net.
  const pollMs = useDeskContext().state?.tracking?.pollMs ?? 4000;

  // Keep the order fresh after submit: Flash order status, TWAP slices, fills, protection.
  useEffect(() => {
    if (!orderId || !watching) return;
    const tick = () =>
      void fetch(`/api/orders/${orderId}`)
        .then(() => onDone())
        .catch(() => undefined);
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, pollMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [orderId, watching, onDone, pollMs]);

  async function run() {
    if (!canSign || !address) return;
    setBusy(true);
    setStarted(true);
    setGuard(null);
    setSteps(IDLE);
    setMsg(null);
    let current: StepId = "quote";
    const mark = (id: StepId, st: StepState) => {
      current = id;
      setSteps((p) => ({ ...p, [id]: st }));
    };
    try {
      const wantChain = CHAINS[proposal.chain].id;
      if (chainId !== wantChain) {
        setMsg(`switch your wallet to ${CHAINS[proposal.chain].name}`);
        await switchChainAsync({ chainId: wantChain as 8453 | 5042 });
      }
      mark("quote", "active");
      const qRes = await apiFetch("/api/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proposalId: proposal.id }),
      });
      const qJson = await qRes.json();
      if (!qRes.ok) throw new Error(qJson.error ?? "quote failed");
      const quote = qJson.quote as {
        orderTypedData?: string;
        permitTypedData?: string;
        approveTx?: { to: `0x${string}`; data: `0x${string}` };
        executionPrice?: string;
        estimatedPriceImpact?: string;
        declaredLimitNotionalPrice?: string;
        effectiveLimitNotionalPrice?: string;
        attachedBracket?: {
          orderTypedData?: string;
          permitTypedData?: string;
          approveTx?: { to: `0x${string}`; data: `0x${string}` };
          signedMaxFromAmount?: string;
        };
      };
      setExecutionQuote({
        executionPrice: quote.executionPrice,
        estimatedPriceImpact: quote.estimatedPriceImpact,
        declaredLimitNotionalPrice: quote.declaredLimitNotionalPrice,
        effectiveLimitNotionalPrice: quote.effectiveLimitNotionalPrice,
      });
      mark("quote", "done");

      // Independent check in the browser, before any wallet prompt. Does not trust the server.
      mark("guard", "active");
      const result = verifySigning({
        chain: proposal.chain,
        follower: address,
        side: proposal.side,
        targetAsset: proposal.targetAsset,
        contraAsset: proposal.contraAsset,
        qty: decision?.modifiedQty ?? proposal.qty,
        // Shown in the guard panel. The order signature stays capped to this order's size either way.
        otherOpenUnits: qJson.otherOpenUnits as string | undefined,
        expectedVault: process.env.NEXT_PUBLIC_FLASH_VAULT || undefined,
        quote,
      });
      // The protection pair is a second set of signatures (WETH approval, permit, sell order):
      // it gets the same independent check before any of it is signed.
      if (quote.attachedBracket) {
        const bracketResult = verifyBracketSigning({
          chain: proposal.chain,
          follower: address,
          targetAsset: proposal.targetAsset,
          contraAsset: proposal.contraAsset,
          entryQty: decision?.modifiedQty ?? proposal.qty,
          priceFloor: bracketPriceFloor(proposal),
          signedMaxFromAmount: quote.attachedBracket.signedMaxFromAmount,
          expectedVault: process.env.NEXT_PUBLIC_FLASH_VAULT || undefined,
          quote: quote.attachedBracket,
        });
        result.checks.push(...bracketResult.checks);
        result.ok = result.ok && bracketResult.ok;
      }
      setGuard(result);
      if (!result.ok) {
        const bad = result.checks.filter((c) => c.level === "fail").map((c) => c.label);
        throw new Error(`guard refused to sign: ${bad.join(", ")}`);
      }
      mark("guard", "done");

      let evmPermitSignature: string | undefined;
      if (quote.approveTx) {
        mark("approve", "active");
        const tx = await sendTransactionAsync({
          to: quote.approveTx.to,
          data: quote.approveTx.data,
        });
        setApproveHash(tx);
        if (!publicClient) throw new Error("no public client");
        await publicClient.waitForTransactionReceipt({ hash: tx });
        mark("approve", "done");
      } else {
        mark("approve", "skip");
      }
      if (quote.attachedBracket?.approveTx) {
        mark("approve", "active");
        const tx = await sendTransactionAsync({
          to: quote.attachedBracket.approveTx.to,
          data: quote.attachedBracket.approveTx.data,
        });
        setApproveHash(tx);
        if (!publicClient) throw new Error("no public client");
        await publicClient.waitForTransactionReceipt({ hash: tx });
        mark("approve", "done");
      }
      if (quote.permitTypedData) {
        mark("permit", "active");
        const permit = parseOrderTypedData(quote.permitTypedData);
        evmPermitSignature = await signTypedDataAsync({
          domain: permit.domain as never,
          types: permit.types,
          primaryType: permit.primaryType,
          message: permit.message,
        });
        mark("permit", "done");
      } else {
        mark("permit", "skip");
      }
      let attachedBracketPermitSignature: string | undefined;
      if (quote.attachedBracket?.permitTypedData) {
        mark("permit", "active");
        const permit = parseOrderTypedData(quote.attachedBracket.permitTypedData);
        attachedBracketPermitSignature = await signTypedDataAsync({
          domain: permit.domain as never,
          types: permit.types,
          primaryType: permit.primaryType,
          message: permit.message,
        });
        mark("permit", "done");
      }
      if (!quote.orderTypedData) {
        throw new Error("empty orderTypedData — funderAddress missing?");
      }
      mark("sign", "active");
      const typed = parseOrderTypedData(quote.orderTypedData);
      const userSignature = await signTypedDataAsync({
        domain: typed.domain as never,
        types: typed.types,
        primaryType: typed.primaryType,
        message: typed.message,
      });
      mark("sign", "done");
      let attachedBracketSignature: string | undefined;
      if (quote.attachedBracket?.orderTypedData) {
        mark("bracket", "active");
        const bracket = parseOrderTypedData(quote.attachedBracket.orderTypedData);
        attachedBracketSignature = await signTypedDataAsync({
          domain: bracket.domain as never,
          types: bracket.types,
          primaryType: bracket.primaryType,
          message: bracket.message,
        });
        mark("bracket", "done");
      } else {
        mark("bracket", "skip");
      }
      mark("submit", "active");
      const oRes = await apiFetch("/api/order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          proposalId: proposal.id,
          userSignature,
          evmPermitSignature,
          attachedBracketSignature,
          attachedBracketPermitSignature,
          funderAddress: address,
        }),
      });
      const oJson = await oRes.json();
      if (!oRes.ok) throw new Error(oJson.error ?? "order failed");
      mark("submit", "done");
      await onDone();
    } catch (e) {
      setSteps((p) => ({ ...p, [current]: "fail" }));
      setMsg(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!orderId || !receipt) return;
    // Cancelling the entry leaves an active protection pair live, so cancel both together.
    const ids = [orderId, ...(protectionCancellable(receipt) && receipt.protection?.bracketOrderId ? [receipt.protection.bracketOrderId] : [])];
    setMsg(ids.length > 1 ? "sign one message to cancel the order and its protection (gasless)…" : "sign the cancel message in your wallet (gasless)…");
    try {
      const message = ids.length > 1 ? batchCancelMessage(ids) : cancelMessage(orderId);
      const userSignature = await signMessageAsync({ message });
      const res = await fetch(`/api/orders/${orderId}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userSignature, orderIds: ids }),
      });
      const j = (await res.json()) as { error?: string; results?: { ok: boolean; alreadyFilled?: boolean }[] };
      if (!res.ok) throw new Error(j.error ?? "cancel failed");
      const filled = j.results?.some((r) => r.alreadyFilled);
      setMsg(filled ? "already filled before the cancel landed — see the receipt" : ids.length > 1 ? "order and protection cancelled" : "cancelled");
      await onDone();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "cancel failed");
    }
  }

  const lockLabel = receipt?.flashOrderId
    ? "submitted"
    : blocked
      ? "sign locked"
      : !address
        ? "connect to sign"
        : !isFollower
          ? "wrong wallet"
          : busy
            ? "working…"
            : "sign";
  const showSteps = started || Boolean(receipt?.flashOrderId);
  const stepView: Record<StepId, StepState> = receipt?.flashOrderId && !started
    ? {
        quote: "done",
        guard: "done",
        approve: "done",
        permit: "done",
        sign: "done",
        bracket: proposal.protectionExpiresAt ? "done" : "skip",
        submit: "done",
      }
    : steps;
  const progress =
    receipt?.twapBucketCount && receipt.twapBucketCount > 0
      ? Math.min(1, (receipt.completedFillCount ?? 0) / receipt.twapBucketCount)
      : null;
  const cancellable = Boolean(
    receipt && isFollower && ((receipt.status && CANCELLABLE.includes(receipt.status)) || protectionCancellable(receipt)),
  );

  return (
    <article className={reviewMode ? "panel p-4" : "glass rounded-[28px] p-5"}>
      {reviewMode ? (
        <div className="mb-3 flex items-center gap-2 border-b border-line pb-3">
          <span className="panel-title">Flash quote &amp; wallet signing</span>
          <LayerTag layer="execution" />
        </div>
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={reviewMode ? "text-[14px] font-medium" : "text-[16px]"}>{proposal.title}</span>
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-widest text-mute">
              {proposal.chain}
            </span>
            {decision ? <CopyActionPill action={decision.action} verdict={decision.verdict} /> : null}
          </div>
          <div className="mt-1 text-[13px] text-mute">
            {proposal.orderType} {proposal.side} · {usd(proposal.notionalUsd)}
            {proposal.durationSeconds ? ` · ${proposal.durationSeconds / 60}m` : ""}
            {proposal.triggers?.[0] ? ` · trigger $${proposal.triggers[0].notionalPrice}` : ""}
            {decision?.modifiedQty ? ` · clipped to ${decision.modifiedQty}` : ""}
            {proposal.copySizingMode === "STOP_RISK" && proposal.estimatedLossAtStopUsd
              ? ` · planned stop risk ${usd(proposal.estimatedLossAtStopUsd)}`
              : ""}
            {` · ${(proposal.copySizingMode ?? "PROPORTIONAL").toLowerCase()} copy · ${(proposal.followerExitMode ?? "FOLLOWER_BRACKET") === "FOLLOWER_BRACKET" ? "Flash bracket" : "manual exit"}`}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!reviewMode ? (
            <Link
              href={`/review/${proposal.id}`}
              className="border border-line px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-mute transition hover:border-gold hover:text-gold"
            >
              review
            </Link>
          ) : null}
          {reviewMode ? (
            <button
              type="button"
              disabled={!canSign}
              onClick={() => void run()}
              className={`btn ${canSign ? "btn-primary" : ""}`}
            >
              {lockLabel}
            </button>
          ) : null}
        </div>
      </div>
      {!reviewMode ? <div className="mt-3 rounded-2xl bg-black/20 p-3 hairline">
        <p className="text-[12px] text-ink/90">{proposal.thesis}</p>
        <p className="mt-1 text-[11px] text-mute">
          Copy window ends{" "}
          {new Date(proposal.expiresAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
          {proposal.maxFollowerNotionalUsd
            ? ` · plan cap ${usd(proposal.maxFollowerNotionalUsd)}`
            : ""}
          {proposal.entryReferencePrice
            ? ` · reference $${proposal.entryReferencePrice}`
            : ""}
        </p>
        {proposal.invalidation ? (
          <p className="mt-1 text-[11px] text-gold">
            invalidation · {proposal.invalidation}
          </p>
        ) : null}
        <p className="mt-1 text-[11px] text-mute">
          leader plan · {(proposal.leaderPlanGrade ?? "INCOMPLETE").toLowerCase()}
          {proposal.stopLossPrice ? ` · stop $${proposal.stopLossPrice}` : ""}
          {proposal.takeProfitPrice ? ` · target $${proposal.takeProfitPrice}` : ""}
        </p>
        <p className="mt-1 text-[11px] text-mute">
          Flash execution evidence · {(proposal.leaderEvidenceStatus ?? "UNVERIFIED").toLowerCase()}
        </p>
        {proposal.side === "buy" && proposal.protectionExpiresAt ? (
          <p className="mt-1 text-[11px] text-gold">
            Flash TP/SL bracket · attaches on signature · protects received WETH until{" "}
            {new Date(proposal.protectionExpiresAt).toLocaleString([], {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        ) : null}
      </div> : null}
      {decision?.reasons.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {decision.reasons.map((r) => (
            <span
              key={r}
              className="rounded-full bg-rose/10 px-2.5 py-1 text-[11px] text-rose"
            >
              {reasonLabel(r)}
            </span>
          ))}
        </div>
      ) : null}

      {showSteps ? (
        <ol className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          {STEPS.map((st) => (
            <li key={st.id} className="flex items-center gap-2 text-[11px]">
              <StepDot state={stepView[st.id]} />
              <span
                className={
                  stepView[st.id] === "fail"
                    ? "text-rose"
                    : stepView[st.id] === "idle" || stepView[st.id] === "skip"
                      ? "text-mute"
                      : "text-ink"
                }
              >
                {st.label}
                {stepView[st.id] === "skip" ? " (not needed)" : ""}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {guard ? <GuardPanel result={guard} /> : null}
      {executionQuote ? (
        <div className="mt-4 border border-line bg-black/20 p-3">
          <div className="terminal-kicker">Flash quote terms</div>
          <dl className="mt-2 space-y-0 text-xs">
            <ReviewRow
              k="quoted execution price"
              v={executionQuote.executionPrice ? `$${Number(executionQuote.executionPrice).toLocaleString("en-US", { maximumFractionDigits: 4 })}` : "not returned"}
            />
            <ReviewRow
              k="Flash price impact"
              v={executionQuote.estimatedPriceImpact ? `${(Number(executionQuote.estimatedPriceImpact) * 100).toFixed(3)}%` : "not returned"}
            />
            <ReviewRow
              k="leader price bound"
              v={executionQuote.declaredLimitNotionalPrice ? `$${executionQuote.declaredLimitNotionalPrice}` : "none"}
            />
            <ReviewRow
              k="your execution bound"
              v={executionQuote.effectiveLimitNotionalPrice ? `$${executionQuote.effectiveLimitNotionalPrice}` : "none"}
            />
          </dl>
          <p className="mt-2 text-[10px] leading-relaxed text-mute">
            The bound is sent to Flash for this quote; it is not a chart prediction or a guaranteed fill.
          </p>
        </div>
      ) : null}
      {msg ? <p className="mt-3 text-[12px] text-mute">{msg}</p> : null}
      {approveHash ? (
        <a
          className="mt-2 inline-block text-[11px] text-mute underline"
          href={`${explorer}${approveHash}`}
          target="_blank"
          rel="noreferrer"
        >
          approve tx {approveHash.slice(0, 10)}…
        </a>
      ) : null}

      {receipt?.flashOrderId ? (
        <div className="mt-4 rounded-2xl bg-black/25 p-3 hairline">
          <div className="flex items-center justify-between gap-2 text-[12px]">
            <span className="text-ink">
              {statusLabel(receipt.status)}
              {receipt.closeReason ? (
                <span className="ml-2 text-mute">{reasonLabel(receipt.closeReason.replace("REASON_", ""))}</span>
              ) : null}
            </span>
            {cancellable ? (
              <button
                type="button"
                onClick={() => void cancel()}
                className="rounded-full bg-rose/15 px-3 py-1 text-[11px] text-rose"
              >
                cancel order
              </button>
            ) : null}
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[10px] text-mute">
            <span>order {receipt.flashOrderId}</span>
            <a
              className="text-gold"
              href={`/api/orders/${encodeURIComponent(receipt.flashOrderId)}/evidence?download`}
              title="Re-reads the order from Flash and saves PACT's decision, quote, fills and tx links as JSON"
            >
              evidence.json
            </a>
          </div>
          {(receipt.quotedExecutionPrice || receipt.averageFillPrice) ? (
            <dl className="mt-3 border-y border-line text-[11px]">
              <ReviewRow
                k="quoted price"
                v={receipt.quotedExecutionPrice ? `$${Number(receipt.quotedExecutionPrice).toLocaleString("en-US", { maximumFractionDigits: 4 })}` : "not recorded"}
              />
              <ReviewRow
                k="average fill"
                v={receipt.averageFillPrice ? `$${Number(receipt.averageFillPrice).toLocaleString("en-US", { maximumFractionDigits: 4 })}` : "waiting for fill"}
              />
              <ReviewRow
                k="entry drift"
                v={receipt.entryDriftBps === undefined ? "waiting for fill" : `${receipt.entryDriftBps >= 0 ? "+" : ""}${receipt.entryDriftBps.toFixed(1)} bps`}
              />
            </dl>
          ) : null}
          {progress !== null ? (
            <div className="mt-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[#e8c9a0] transition-all duration-500"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
              <div className="mt-1 text-[10px] text-mute">
                slice {receipt.completedFillCount ?? 0} of {receipt.twapBucketCount}
              </div>
            </div>
          ) : null}
          {receipt.fills?.length ? (
            <ul className="mt-3 space-y-1">
              {receipt.fills.map((f, i) => (
                <li key={f.transactionId ?? i} className="flex justify-between text-[11px]">
                  <span className="text-mute">
                    fill {i + 1}
                    {f.notional ? ` · ${usd(Number(f.notional))}` : ""}
                    {f.fillPrice ? ` @ ${Number(f.fillPrice).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : ""}
                  </span>
                  {f.transactionId ? (
                    <a
                      className="text-gold"
                      href={`${explorer}${f.transactionId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {f.transactionId.slice(0, 10)}…
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[11px] text-mute">Waiting for the first fill…</p>
          )}
        </div>
      ) : null}
    </article>
  );
}

function statusLabel(status?: string) {
  if (!status) return "submitted";
  return status.replace("ORDER_STATUS_", "").replaceAll("_", " ").toLowerCase();
}

function StepDot({ state }: { state: StepState }) {
  const base = "inline-block h-2.5 w-2.5 rounded-full";
  if (state === "done") return <span className={`${base} bg-[#e8c9a0]`} />;
  if (state === "active")
    return <span className={`${base} animate-pulse bg-[#c084fc] ring-4 ring-[#c084fc]/20`} />;
  if (state === "fail") return <span className={`${base} bg-rose`} />;
  return <span className={`${base} bg-white/15`} />;
}

const TONE = {
  pass: "text-gold",
  warn: "text-[#e9d5ff]",
  fail: "text-rose",
} as const;
const MARK = { pass: "✓", warn: "!", fail: "✕" } as const;

export function GuardPanel({ result }: { result: GuardResult }) {
  const fails = result.checks.filter((c) => c.level === "fail").length;
  const warns = result.checks.filter((c) => c.level === "warn").length;
  return (
    <details className="mt-3 rounded-2xl bg-black/25 p-3 hairline" open={!result.ok}>
      <summary className="cursor-pointer text-[12px] text-ink">
        wallet guard · {result.ok ? "safe to sign" : "REFUSED"}
        <span className="ml-2 text-mute">
          {result.checks.length - fails - warns} passed
          {warns ? ` · ${warns} note${warns > 1 ? "s" : ""}` : ""}
          {fails ? ` · ${fails} failed` : ""}
        </span>
      </summary>
      <ul className="mt-2 space-y-1.5">
        {result.checks.map((c) => (
          <li key={c.id} className="text-[11px] leading-snug">
            <span className={`mr-1.5 font-mono ${TONE[c.level]}`}>{MARK[c.level]}</span>
            <span className="text-ink">{c.label}</span>
            <span className="block pl-4 text-mute">{c.detail}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] text-mute">
        Checked in your browser from the raw payloads Flash returned, before any wallet prompt.
        Your hard spend limit is the signed Permit2 amount.
      </p>
    </details>
  );
}

const TYPES: OrderType[] = ["twap", "limit", "market", "take-profit", "stop-loss"];
const SIDES: Side[] = ["buy", "sell"];

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function defaultMandate(leader: `0x${string}`, policy: Policy): LeaderMandate {
  return {
    leader,
    sizingMode: "PROPORTIONAL",
    copyRatio: policy.copyRatio,
    fixedNotionalUsd: policy.minNotionalUsd,
    riskBudgetUsd: policy.riskBudgetUsd,
    maxDailyUsd: policy.maxLeaderDailyUsd,
    allowOrderTypes: [...policy.allowOrderTypes],
    exitMode: "FOLLOWER_BRACKET",
  };
}

export function PolicyEditor({
  policy,
  leaders,
  onSaved,
}: {
  policy: Policy;
  leaders: `0x${string}`[];
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Policy>({
    ...policy,
    allowChains: policy.allowChains ?? [policy.chain],
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const chains = draft.allowChains ?? [];

  function updateMandate(leader: `0x${string}`, patch: Partial<LeaderMandate>) {
    const current =
      draft.mandates?.find((mandate) => mandate.leader.toLowerCase() === leader.toLowerCase()) ??
      defaultMandate(leader, draft);
    const mandates = draft.mandates?.filter(
      (mandate) => mandate.leader.toLowerCase() !== leader.toLowerCase(),
    ) ?? [];
    setDraft({ ...draft, mandates: [...mandates, { ...current, ...patch }] });
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/policy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "save failed");
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-5 rounded-2xl bg-black/25 p-4 hairline">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] text-ink">your copy plan</div>
          <p className="mt-1 text-[11px] leading-relaxed text-mute">
            Leader mandates define how each trader can use your portfolio. The controls below
            are shared guardrails across every mandate.
          </p>
        </div>
        <span className="rounded-full bg-[#e8c9a0]/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-gold">
          step 1
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <NumField
          label="max / order $"
          value={draft.maxNotionalUsd}
          onChange={(v) => setDraft({ ...draft, maxNotionalUsd: v })}
        />
        <NumField
          label="daily $"
          value={draft.maxDailyUsd}
          onChange={(v) => setDraft({ ...draft, maxDailyUsd: v })}
        />
        <NumField
          label="copy size %"
          value={Math.round(draft.copyRatio * 100)}
          onChange={(v) => setDraft({ ...draft, copyRatio: v / 100 })}
        />
        <NumField
          label="stop-risk / plan $"
          value={draft.riskBudgetUsd}
          onChange={(v) => setDraft({ ...draft, riskBudgetUsd: v })}
        />
        <NumField
          label="per leader / day $"
          value={draft.maxLeaderDailyUsd}
          onChange={(v) => setDraft({ ...draft, maxLeaderDailyUsd: v })}
        />
        <NumField
          label="leader loss breaker / day $"
          value={draft.maxLeaderDailyRealizedLossUsd}
          onChange={(v) => setDraft({ ...draft, maxLeaderDailyRealizedLossUsd: v })}
        />
        <NumField
          label="same-asset exposure $"
          value={draft.maxAssetExposureUsd}
          onChange={(v) => setDraft({ ...draft, maxAssetExposureUsd: v })}
        />
        <NumField
          label="max live plans"
          value={draft.maxOpenPlans}
          onChange={(v) => setDraft({ ...draft, maxOpenPlans: v })}
        />
        <NumField
          label="plans / leader"
          value={draft.maxOpenPlansPerLeader}
          onChange={(v) => setDraft({ ...draft, maxOpenPlansPerLeader: v })}
        />
        <NumField
          label="entry drift %"
          value={Number(draft.maxEntryDrift) * 100}
          onChange={(v) => setDraft({ ...draft, maxEntryDrift: String(v / 100) })}
        />
        <NumField
          label="max quote impact %"
          value={Number(draft.maxPriceImpact) * 100}
          onChange={(v) => setDraft({ ...draft, maxPriceImpact: String(v / 100) })}
        />
        <NumField
          label="max slippage %"
          value={Number(draft.maxSlippage) * 100}
          onChange={(v) => setDraft({ ...draft, maxSlippage: String(v / 100) })}
        />
        <NumField
          label="minimum reward:risk"
          value={draft.minRewardRisk}
          onChange={(v) => setDraft({ ...draft, minRewardRisk: v })}
        />
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-mute">
        The loss breaker stops new copies from a leader after recorded realized losses reach
        this value. It only acts on closed PACT receipts with P&amp;L evidence; it is not a
        prediction or a substitute for the attached stop.
      </p>
      <label className="mt-3 block text-[11px] text-mute">
        agent mode
        <select
          value={draft.automationMode ?? "REVIEW"}
          onChange={(event) =>
            setDraft({ ...draft, automationMode: event.target.value as AutomationMode })
          }
          className="mt-1 w-full rounded-lg bg-black/30 px-2 py-2 text-[11px] text-ink hairline"
        >
          <option value="REVIEW">review only — self-sign every order</option>
          <option value="ASSIST">PACT Assist — scan and queue for review</option>
        </select>
        <span className="mt-1 block text-[10px] leading-relaxed">
          Assist is deterministic policy orchestration. It does not hold a key, quote, sign, submit,
          cancel, or alter a mandate.
        </span>
      </label>
      <Chips
        label="chains"
        options={CHAIN_IDS}
        on={chains}
        onToggle={(c) => setDraft({ ...draft, allowChains: toggle(chains, c as Chain) })}
      />
      <Chips
        label="order types"
        options={TYPES}
        on={draft.allowOrderTypes}
        onToggle={(t) =>
          setDraft({ ...draft, allowOrderTypes: toggle(draft.allowOrderTypes, t as OrderType) })
        }
      />
      <Chips
        label="sides"
        options={SIDES}
        on={draft.allowSides}
        onToggle={(x) =>
          setDraft({ ...draft, allowSides: toggle(draft.allowSides, x as Side) })
        }
      />
      {leaders.length ? (
        <div id="leader-mandates" className="mt-4">
          <div className="text-[11px] text-mute">
            choose leaders {draft.follows?.length ? `· ${draft.follows.length}/${MAX_LEADERS} selected` : `(up to ${MAX_LEADERS})`}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {leaders.map((l) => {
              const list = draft.follows ?? [];
              const on = list.some((x) => x.toLowerCase() === l.toLowerCase());
              const capped = !on && list.length >= MAX_LEADERS;
              return (
                <button
                  key={l}
                  type="button"
                  disabled={capped}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      follows: on
                        ? list.filter((x) => x.toLowerCase() !== l.toLowerCase())
                        : [...list, l],
                      mandates: on
                        ? (draft.mandates ?? []).filter(
                            (mandate) => mandate.leader.toLowerCase() !== l.toLowerCase(),
                          )
                        : [...(draft.mandates ?? []), defaultMandate(l, draft)],
                      pausedLeaders: (draft.pausedLeaders ?? []).filter(
                        (paused) => paused.toLowerCase() !== l.toLowerCase(),
                      ),
                    })
                  }
                  className={`rounded-full px-2.5 py-1 font-mono text-[11px] ${
                    on
                      ? "bg-[#e8c9a0]/20 text-gold"
                      : capped
                        ? "cursor-not-allowed bg-white/[0.025] text-mute/40"
                        : "bg-white/5 text-mute"
                  }`}
                  title={capped ? "Remove a leader before adding another" : undefined}
                >
                  {shortAddr(l)}
                </button>
              );
            })}
          </div>
          {(draft.follows ?? []).length ? (
            <div className="mt-3 space-y-2">
              <div className="text-[11px] uppercase tracking-[0.14em] text-mute">
                per-leader mandates
              </div>
              {(draft.follows ?? []).map((leader) => {
                const mandate =
                  draft.mandates?.find(
                    (item) => item.leader.toLowerCase() === leader.toLowerCase(),
                  ) ?? defaultMandate(leader, draft);
                return (
                  <div key={leader} className="rounded-2xl bg-white/[0.035] p-3 hairline">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-ink">{shortAddr(leader)}</span>
                      <select
                        value={mandate.exitMode}
                        onChange={(event) =>
                          updateMandate(leader, {
                            exitMode: event.target.value as FollowerExitMode,
                          })
                        }
                        className="rounded-lg bg-black/30 px-2 py-1 text-[11px] text-ink hairline"
                      >
                        <option value="FOLLOWER_BRACKET">Flash TP/SL</option>
                        <option value="MANUAL">manual exit</option>
                      </select>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <label className="text-[10px] text-mute">
                        copy mode
                        <select
                          value={mandate.sizingMode}
                          onChange={(event) =>
                            updateMandate(leader, {
                              sizingMode: event.target.value as LeaderMandate["sizingMode"],
                            })
                          }
                          className="mt-1 w-full rounded-lg bg-black/30 px-2 py-1.5 text-[11px] text-ink hairline"
                        >
                          <option value="PROPORTIONAL">proportional</option>
                          <option value="FIXED">fixed USD</option>
                          <option value="STOP_RISK">stop-risk budget</option>
                        </select>
                      </label>
                      <NumField
                        label={
                          mandate.sizingMode === "PROPORTIONAL"
                            ? "copy size %"
                            : mandate.sizingMode === "FIXED"
                              ? "fixed / trade $"
                              : "risk at stop $"
                        }
                        value={
                          mandate.sizingMode === "PROPORTIONAL"
                            ? Math.round(mandate.copyRatio * 100)
                            : mandate.sizingMode === "FIXED"
                              ? mandate.fixedNotionalUsd
                              : mandate.riskBudgetUsd
                        }
                        onChange={(value) =>
                          updateMandate(
                            leader,
                            mandate.sizingMode === "PROPORTIONAL"
                              ? { copyRatio: value / 100 }
                              : mandate.sizingMode === "FIXED"
                                ? { fixedNotionalUsd: value }
                                : { riskBudgetUsd: value },
                          )
                        }
                      />
                      <NumField
                        label="leader / day $"
                        value={mandate.maxDailyUsd}
                        onChange={(value) => updateMandate(leader, { maxDailyUsd: value })}
                      />
                    </div>
                    {mandate.sizingMode === "STOP_RISK" ? (
                      <p className="mt-2 text-[10px] leading-relaxed text-mute">
                        PACT sizes from the leader’s declared entry and stop, then applies your
                        sleeve and portfolio caps. A stop is not a guaranteed maximum loss.
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {TYPES.map((type) => {
                        const enabled = mandate.allowOrderTypes.includes(type);
                        return (
                          <button
                            key={type}
                            type="button"
                            onClick={() =>
                              updateMandate(leader, {
                                allowOrderTypes: toggle(mandate.allowOrderTypes, type),
                              })
                            }
                            className={`rounded-full px-2 py-0.5 text-[10px] ${
                              enabled ? "bg-[#e8c9a0]/15 text-gold" : "bg-white/5 text-mute"
                            }`}
                          >
                            {type}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
      <label className="mt-3 flex items-center gap-2 text-[12px] text-mute">
        <input
          type="checkbox"
          checked={draft.allowModify}
          onChange={(e) => setDraft({ ...draft, allowModify: e.target.checked })}
        />
        clip oversize orders to my cap (MODIFY) instead of blocking
      </label>
      <label className="mt-3 flex items-center gap-2 text-[12px] text-mute">
        <input
          type="checkbox"
          checked={draft.requireLeaderExecutionEvidence ?? false}
          onChange={(e) =>
            setDraft({ ...draft, requireLeaderExecutionEvidence: e.target.checked })
          }
        />
        require a Flash order owned by the leader before copying
      </label>
      <label className="mt-3 flex items-center gap-2 text-[12px] text-mute">
        <input
          type="checkbox"
          checked={draft.requireLeaderPlanQuality ?? false}
          onChange={(e) => setDraft({ ...draft, requireLeaderPlanQuality: e.target.checked })}
        />
        require the selected minimum reward:risk instead of showing it as a caution
      </label>
      <label className="mt-3 flex items-center gap-2 text-[12px] text-mute">
        <input
          type="checkbox"
          checked={draft.enableLeaderLossCircuitBreaker ?? false}
          onChange={(e) =>
            setDraft({ ...draft, enableLeaderLossCircuitBreaker: e.target.checked })
          }
        />
        enable the evidence-backed leader loss breaker
      </label>
      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="mt-4 w-full rounded-full bg-white/10 py-2 text-[13px]"
      >
        {saving ? "saving…" : "save limits"}
      </button>
      {err ? <p className="mt-2 text-[12px] text-rose">{err}</p> : null}
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="text-[11px] text-mute">
      {label}
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-xl bg-black/30 px-3 py-2 text-[13px] text-ink outline-none hairline"
      />
    </label>
  );
}

function Chips({
  label,
  options,
  on,
  onToggle,
}: {
  label: string;
  options: readonly string[];
  on: readonly string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div className="mt-3">
      <div className="text-[11px] text-mute">{label}</div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onToggle(o)}
            className={`rounded-full px-2.5 py-1 text-[11px] ${
              on.includes(o) ? "bg-[#e8c9a0]/20 text-gold" : "bg-white/5 text-mute"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
