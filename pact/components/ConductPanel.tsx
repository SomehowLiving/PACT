"use client";

import { LayerTag, Panel, StatusBadge } from "@/components/ui";
import type { LeaderConduct } from "@/lib/conduct";
import Link from "next/link";

const pct = (r: number) => `${Math.round(r * 100)}%`;

/** Leader conduct at a glance: a caution after one occurrence, an alert (copies held) after a repeat. */
export function ConductBadge({ conduct, compact = false }: { conduct?: LeaderConduct | null; compact?: boolean }) {
  if (!conduct || conduct.level === "clear") return null;
  const sold = conduct.soldIntoFlow;
  const ran = conduct.frontRuns;
  const label = sold ? (compact ? `sold into followers ×${sold}` : `Sold into followers' buys ×${sold}`) : compact ? `front-ran ×${ran}` : `Traded well before publishing ×${ran}`;
  const title =
    conduct.level === "alert"
      ? "A repeated pattern: PACT holds new copies of this leader for each follower's review."
      : "Seen once. PACT holds copies only if it repeats.";
  return (
    <span title={title}>
      <StatusBadge tone={conduct.level === "alert" ? "bad" : "warn"} icon="!">
        {label}
      </StatusBadge>
    </span>
  );
}

/**
 * Follower fairness: did this leader trade against the followers who copied them? Measured
 * from followers' real Flash fills, the leader's own evidenced trade, and the leader's wallet on
 * Base. Says what it cannot see.
 */
export function ConductPanel({ conduct }: { conduct?: LeaderConduct | null }) {
  const flagged = (conduct?.plans ?? []).filter((p) => p.frontRun || p.sellIntoFlow);
  return (
    <Panel
      title="Follower fairness"
      subtitle="Did this leader trade against the followers who copied them?"
      layer="execution"
      actions={
        <span className="flex items-center gap-2">
          {conduct?.source === "demo" ? <LayerTag layer="demo" /> : null}
          {conduct ? (
            conduct.level === "clear" ? (
              <StatusBadge tone="good" icon="✓">
                nothing found
              </StatusBadge>
            ) : (
              <ConductBadge conduct={conduct} />
            )
          ) : (
            <StatusBadge tone="neutral">not checked yet</StatusBadge>
          )}
        </span>
      }
      bodyClassName="p-4"
    >
      {conduct?.level === "alert" ? (
        <p className="mb-3 rounded-lg border border-[color-mix(in_oklab,var(--bad)_40%,var(--line))] px-3 py-2 text-[12.5px] text-ink/90">
          This has happened more than once, so PACT holds every follower&apos;s new copies of this leader for review ({conduct.reasons.map((r) => r.replaceAll("_", " ").toLowerCase()).join(", ")}).
        </p>
      ) : null}
      {flagged.length ? (
        <div className="overflow-x-auto">
          <table className="tbl tbl-tight min-w-[640px]">
            <thead>
              <tr>
                <th>Plan</th>
                <th>Leader traded before publishing</th>
                <th>Asset left the leader&apos;s wallet while followers bought</th>
              </tr>
            </thead>
            <tbody>
              {flagged.map((p) => (
                <tr key={p.strategyId}>
                  <td>
                    <Link href={`/plans/${p.strategyId}`} className="text-ink hover:text-accent">
                      {p.title}
                    </Link>
                  </td>
                  <td className={p.frontRun?.flagged ? "text-warn" : "text-mute"}>
                    {p.frontRun
                      ? `${Math.round(p.frontRun.leadMinutes)} min before · leader $${p.frontRun.leaderPrice.toFixed(0)}, followers $${p.frontRun.followerPrice.toFixed(0)} (${p.frontRun.advantageBps >= 0 ? "+" : ""}${p.frontRun.advantageBps.toFixed(0)} bps)`
                      : "no evidenced trade"}
                  </td>
                  <td className={p.sellIntoFlow?.flagged ? "text-bad" : "text-mute"}>
                    {p.sellIntoFlow
                      ? p.sellIntoFlow.soldUnits > 0
                        ? `${p.sellIntoFlow.soldUnits.toFixed(4)} WETH · ${pct(p.sellIntoFlow.ratio)} of ${p.sellIntoFlow.basis}`
                        : "none"
                      : "not read"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-[12.5px] text-mute">{conduct ? "No copied plan of this leader has follower fills to measure against yet, or nothing was found." : "Measured once followers' copies of this leader have filled."}</p>
      )}
      <ul className="mt-3 space-y-1 text-[11.5px] leading-relaxed text-mute">
        <li>
          Traded before publishing: the leader&apos;s own trade (from the evidence they attached, read on Base) came ≥30 min before the plan and followers paid ≥1% more. Trading just before publishing is normal.
        </li>
        <li>Sold into followers&apos; buys: the plan&apos;s asset left the leader&apos;s wallet on Base while followers&apos; copies were filling (up to 30 min after), ≥25% of the position.</li>
        <li>PACT reads the leader&apos;s wallet on Base only. Sales on a centralized exchange, another chain or from another wallet are not visible; a transfer out counts like a sale.</li>
      </ul>
    </Panel>
  );
}
