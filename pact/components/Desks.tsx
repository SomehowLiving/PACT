"use client";

import { VerdictPill } from "@/components/VerdictPill";
import type { DeskPayload } from "@/components/useDesk";
import { reasonLabel, shortAddr, usd } from "@/lib/format";
import { decide } from "@/lib/policy";
import { useState } from "react";

const RING = {
  ALLOW: "ring-[#e8c9a0]/40",
  MODIFY: "ring-[#c084fc]/50",
  BLOCK: "ring-[#fb7185]/40",
} as const;

// One leader trade, every desk's own policy. Sliders are a local what-if that runs the real
// decide() in the browser; they never touch saved policies.
export function Desks({ state }: { state: DeskPayload | null }) {
  const [trade, setTrade] = useState<number | null>(null);
  const [caps, setCaps] = useState<Record<string, number>>({});

  const strategy = state?.strategies.find(
    (s) =>
      s.side === "buy" &&
      state.proposals.filter((p) => p.strategyId === s.id).length >= 2,
  );
  if (!state || !strategy) return null;

  const desks = state.policies.filter((pol) =>
    state.proposals.some(
      (p) =>
        p.strategyId === strategy.id &&
        p.follower.toLowerCase() === pol.follower.toLowerCase(),
    ),
  );
  if (desks.length < 2) return null;

  const size = trade ?? Number(strategy.qty);

  return (
    <section className="glass rounded-[32px] p-6 md:p-8 lg:col-span-2">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-mute">
            one leader trade · {desks.length} desks
          </div>
          <h2 className="mt-2 font-[family-name:var(--font-serif)] text-[30px] font-medium leading-tight md:text-[38px]">
            same trade, your rules
          </h2>
          <p className="mt-1 text-sm text-mute">
            Leader posts a {strategy.orderType} buy. Each follower’s own policy decides.
            Drag a slider.
          </p>
        </div>
        <label className="w-full max-w-xs text-[12px] text-mute">
          leader’s trade size
          <div className="num mt-1 text-[28px] text-ink">{usd(size)}</div>
          <input
            type="range"
            min={5}
            max={150}
            step={5}
            value={size}
            onChange={(e) => setTrade(Number(e.target.value))}
            className="w-full accent-[#e8c9a0]"
          />
        </label>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {desks.map((pol) => {
          const cap = caps[pol.follower] ?? pol.maxNotionalUsd;
          const d = decide(
            {
              chain: strategy.chain,
              targetAsset: strategy.targetAsset,
              contraAsset: strategy.contraAsset,
              side: strategy.side,
              orderType: strategy.orderType,
              qty: String(size),
              notionalUsd: size,
              maxSlippage: strategy.orderType === "market" ? pol.maxSlippage : undefined,
              maxPriceImpact:
                strategy.orderType === "twap" || strategy.orderType === "limit"
                  ? pol.maxPriceImpact
                  : undefined,
            },
            { ...pol, maxNotionalUsd: cap },
            0,
          );
          const outcome =
            d.verdict === "ALLOW"
              ? `signs ${usd(size)}`
              : d.verdict === "MODIFY"
                ? `clipped to ${usd(Number(d.modifiedQty))}`
                : "sign locked, nothing sent to Flash";
          return (
            <div
              key={pol.follower}
              className={`rounded-3xl bg-black/25 p-5 ring-1 transition-all duration-300 ${RING[d.verdict]}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[15px]">{pol.label ?? shortAddr(pol.follower)}</div>
                  <div className="text-[11px] text-mute">
                    daily {usd(pol.maxDailyUsd)} · {pol.allowOrderTypes.join(" ")}
                  </div>
                </div>
                <VerdictPill verdict={d.verdict} />
              </div>
              <div className="num mt-4 text-[22px]">{outcome}</div>
              <div className="mt-2 flex min-h-[26px] flex-wrap gap-1.5">
                {d.reasons.map((r) => (
                  <span
                    key={r}
                    className="rounded-full bg-rose/10 px-2 py-0.5 text-[10px] text-rose"
                  >
                    {reasonLabel(r)}
                  </span>
                ))}
              </div>
              <label className="mt-3 block text-[11px] text-mute">
                max per order · {usd(cap)}
                <input
                  type="range"
                  min={5}
                  max={150}
                  step={5}
                  value={cap}
                  onChange={(e) =>
                    setCaps({ ...caps, [pol.follower]: Number(e.target.value) })
                  }
                  className="w-full accent-[#e8c9a0]"
                />
              </label>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-[11px] text-mute">
        What-if only: sliders run the same policy engine locally and do not change saved
        limits. Flash never sees any of this. The follower’s signature is the only way money
        moves.
      </p>
    </section>
  );
}
