"use client";

import { StatusBadge, type Tone } from "@/components/ui";
import type { ReferenceCheck } from "@/lib/signals";
import { useEffect, useState } from "react";

const TONE: Record<ReferenceCheck["status"], Tone> = { OK: "good", DIVERGED: "bad", UNAVAILABLE: "neutral" };
const LABEL: Record<ReferenceCheck["status"], string> = { OK: "prices agree", DIVERGED: "prices disagree", UNAVAILABLE: "oracle unavailable" };

const price = (v?: number) => (v ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—");
const gap = (v?: number) => (v === undefined ? "" : `${v > 0 ? "+" : ""}${v.toFixed(0)} bps`);

/**
 * R11 on screen: the independent oracle, the chart and Flash's executable price side by side.
 * Pass `check` to show a stored quote-time check; without it the live one is polled.
 */
export function ReferencePrices({ check, title = "Three prices" }: { check?: ReferenceCheck; title?: string }) {
  const [live, setLive] = useState<ReferenceCheck | null>(null);
  useEffect(() => {
    if (check) return;
    let on = true;
    const load = () =>
      void fetch("/api/reference")
        .then((r) => (r.ok ? r.json() : null))
        .then((body: ReferenceCheck | null) => {
          if (on && body) setLive(body);
        })
        .catch(() => undefined);
    const first = setTimeout(load, 0);
    const id = setInterval(load, 20_000);
    return () => {
      on = false;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [check]);
  const c = check ?? live;
  return (
    <div className="rounded-lg border border-line">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="text-[12.5px] font-semibold text-ink">{title}</span>
        {c ? <StatusBadge tone={TONE[c.status]}>{LABEL[c.status]}</StatusBadge> : <StatusBadge tone="neutral">loading</StatusBadge>}
      </div>
      <dl className="divide-y divide-line-2 text-[12px]">
        <div className="flex justify-between gap-3 px-3 py-1.5">
          <dt className="text-mute" title={c?.oracleAt ? `last update ${new Date(c.oracleAt).toLocaleTimeString()}` : undefined}>
            Oracle · Chainlink on Base
          </dt>
          <dd className="tnum text-ink">{price(c?.oracle)}</dd>
        </div>
        <div className="flex justify-between gap-3 px-3 py-1.5">
          <dt className="text-mute">Chart · GeckoTerminal pool</dt>
          <dd className="tnum text-ink">
            {price(c?.chart)} <span className="text-mute">{gap(c?.chartVsOracleBps)}</span>
          </dd>
        </div>
        <div className="flex justify-between gap-3 px-3 py-1.5">
          <dt className="text-mute">Flash · executable quote</dt>
          <dd className="tnum text-ink">
            {price(c?.quote)} <span className="text-mute">{gap(c?.quoteVsOracleBps)}</span>
          </dd>
        </div>
      </dl>
      <p className="px-3 py-2 text-[10.5px] leading-relaxed text-mute">
        {c?.status === "DIVERGED"
          ? "Copies wait at quote time until Flash and the chart are back within your limit of the oracle."
          : "At quote time a copy waits if Flash or the chart is more than your limit (default 1%) from the oracle."}
      </p>
    </div>
  );
}
