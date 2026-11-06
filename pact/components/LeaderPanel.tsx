"use client";

import { leaderFidelity, type LeaderFidelity } from "@/lib/fidelity";
import { reasonLabel, shortAddr } from "@/lib/format";
import { isLeaderPaused } from "@/lib/policy";
import type { DeskState, Policy } from "@/lib/types";
import { useState } from "react";

function bps(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)} bps`;
}

function fidelityLine(row: LeaderFidelity, boundBps: number) {
  if (!row.submitted) return "no PACT orders yet";
  if (!row.driftSamples) {
    return `${row.submitted} order${row.submitted === 1 ? "" : "s"} · no measured fills yet`;
  }
  return [
    `${row.filled}/${row.submitted} filled`,
    `avg ${bps(row.meanDriftBps!)}`,
    `worst ${bps(row.worstDriftBps!)}`,
    `${row.withinBound}/${row.driftSamples} within ${boundBps.toFixed(0)} bps`,
  ].join(" · ");
}

/**
 * Per-leader controls that act immediately: pause/resume new copies and the
 * follower's own execution-fidelity history for that leader.
 */
export function LeaderPanel({
  policy,
  state,
  onSaved,
}: {
  policy: Policy;
  state: Pick<DeskState, "proposals" | "receipts"> | undefined;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const follows = policy.follows ?? [];
  if (!follows.length) return null;

  const boundBps = Number(policy.maxEntryDrift) * 10_000;
  const rows = leaderFidelity(
    policy.follower,
    follows,
    state?.proposals ?? [],
    state?.receipts ?? [],
    policy.maxEntryDrift,
  );

  async function setPaused(leader: `0x${string}`, paused: boolean) {
    setBusy(leader);
    setError(null);
    const others = (policy.pausedLeaders ?? []).filter((item) => item.toLowerCase() !== leader.toLowerCase());
    try {
      const res = await fetch("/api/policy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...policy, pausedLeaders: paused ? [...others, leader] : others }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "could not update leader");
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not update leader");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 border border-line bg-black/25 p-3">
      <div className="terminal-kicker">your leaders</div>
      <p className="mt-1 text-[11px] leading-relaxed text-mute">
        Pause holds new plans from a leader and keeps their mandate. It does not cancel orders
        already on Flash; cancel those from the order card with your signature.
      </p>
      <ul className="mt-3 space-y-2">
        {rows.map((row) => {
          const paused = isLeaderPaused(policy, row.leader);
          const reasons = Object.entries(row.closeReasons);
          return (
            <li key={row.leader} className="border-t border-line pt-2 first:border-t-0 first:pt-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-ink">
                  {shortAddr(row.leader)}
                  <span className={`ml-2 text-[10px] uppercase tracking-[0.08em] ${paused ? "text-rose" : "text-mute"}`}>
                    {paused ? "paused" : "active"}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void setPaused(row.leader, !paused)}
                  className="border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-mute hover:border-gold hover:text-gold disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === row.leader ? "saving…" : paused ? "resume" : "pause"}
                </button>
              </div>
              <div className="mt-1 text-[11px] text-mute">{fidelityLine(row, boundBps)}</div>
              {reasons.length ? (
                <div className="mt-0.5 text-[10px] text-mute">
                  closed: {reasons.map(([reason, count]) => `${reasonLabel(reason.replace("REASON_", ""))} ×${count}`).join(" · ")}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[10px] leading-relaxed text-mute">
        Fidelity is your own fills against each leader&apos;s declared entry; positive drift means
        you paid worse. It is not a skill or profitability score.
      </p>
      {error ? <p className="mt-2 text-[12px] text-rose">{error}</p> : null}
    </div>
  );
}
