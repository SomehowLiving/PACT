"use client";

import { CopyActionPill } from "@/components/CopyActionPill";
import type { DeskPayload } from "@/components/useDesk";
import { reasonLabel, shortAddr, usd } from "@/lib/format";

export function PortfolioSimulation({ state }: { state: DeskPayload | null }) {
  const policy = state?.policies.find((item) => item.label === "portfolio") ?? state?.policies[0];
  if (!state || !policy) return null;

  const proposals = state.proposals.filter(
    (proposal) => proposal.follower.toLowerCase() === policy.follower.toLowerCase(),
  );
  const selectedLeaders = policy.follows ?? [];
  const portfolioRows = proposals
    .filter((proposal) => selectedLeaders.some((leader) => leader.toLowerCase() === proposal.leader.toLowerCase()))
    .slice(0, 6);
  if (portfolioRows.length < 2) return null;

  const approved = portfolioRows.reduce((sum, proposal) => {
    const decision = state.decisions[proposal.id];
    if (decision?.verdict === "BLOCK") return sum;
    return sum + Number(decision?.modifiedQty ?? proposal.notionalUsd);
  }, 0);
  const blocked = portfolioRows.reduce((sum, proposal) => {
    const decision = state.decisions[proposal.id];
    return decision?.verdict === "BLOCK" ? sum + proposal.notionalUsd : sum;
  }, 0);

  return (
    <section className="glass rounded-[32px] p-6 lg:col-span-2">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-mute">
            simulated portfolio run
          </div>
          <h2 className="mt-2 font-[family-name:var(--font-serif)] text-[30px] font-medium leading-tight md:text-[38px]">
            one follower, three leaders, one risk budget
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-mute">
            This uses persisted demo proposals and the same policy engine as the signing path.
            It is not a return forecast or an execution claim.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[12px]">
          <Metric label="leaders selected" value={`${selectedLeaders.length}/3`} />
          <Metric label="per-leader sleeve" value={usd(policy.maxLeaderDailyUsd)} />
          <Metric label="loss breaker" value={`${usd(policy.maxLeaderDailyRealizedLossUsd)}/day`} />
          <Metric label="approved capacity" value={usd(approved)} />
          <Metric label="refused notional" value={usd(blocked)} />
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-3xl border border-white/6">
        <div className="grid grid-cols-[1.3fr_0.7fr_0.7fr] gap-3 bg-black/25 px-4 py-2 text-[10px] uppercase tracking-[0.16em] text-mute sm:grid-cols-[1.4fr_0.8fr_0.7fr_0.8fr]">
          <span>leader plan</span>
          <span className="hidden sm:block">requested</span>
          <span>decision</span>
          <span className="text-right">follower size</span>
        </div>
        {portfolioRows.map((proposal) => {
          const decision = state.decisions[proposal.id];
          const followerSize = decision?.verdict === "BLOCK"
            ? 0
            : Number(decision?.modifiedQty ?? proposal.notionalUsd);
          return (
            <div
              key={proposal.id}
              className="grid grid-cols-[1.3fr_0.7fr_0.7fr] items-center gap-3 border-t border-white/6 px-4 py-3 text-[12px] sm:grid-cols-[1.4fr_0.8fr_0.7fr_0.8fr]"
            >
              <div className="min-w-0">
                <div className="truncate text-ink">{proposal.title}</div>
                <div className="mt-0.5 font-mono text-[10px] text-mute">
                  {shortAddr(proposal.leader)} · {proposal.orderType}
                </div>
              </div>
              <span className="hidden text-mute sm:block">{usd(proposal.notionalUsd)}</span>
              <div>
                <CopyActionPill action={decision?.action} verdict={decision?.verdict} />
                {decision?.reasons[0] ? (
                  <div className="mt-1 truncate text-[10px] text-mute">
                    {reasonLabel(decision.reasons[0])}
                  </div>
                ) : null}
              </div>
              <span className="num text-right text-ink">{usd(followerSize)}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-mute">
        Threshold order: plan quality and allowed order type fail closed; then per-order,
        daily, per-leader, recorded-loss, same-asset, and open-plan limits can scale or
        refuse the trade.
      </p>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-black/25 px-3 py-2 hairline">
      <div className="text-[10px] uppercase tracking-[0.12em] text-mute">{label}</div>
      <div className="num mt-1 text-[15px] text-ink">{value}</div>
    </div>
  );
}
