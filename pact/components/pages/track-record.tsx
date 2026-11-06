"use client";

import { KV, Panel } from "@/components/ui";
import type { LeaderRecord } from "@/lib/leader-record";
import { useEffect, useState } from "react";

function bps(v?: number) {
  return v === undefined ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(0)} bps`;
}

function signedUsd(v: number) {
  return `${v > 0 ? "+" : v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
}

/** A leader's record from evidence only: their own verified execution, and what copiers got. */
export function TrackRecord({ leader }: { leader: string }) {
  const [data, setData] = useState<{ leader: string; record: LeaderRecord } | null>(null);
  useEffect(() => {
    let live = true;
    void fetch(`/api/leaders/${leader}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { record: LeaderRecord } | null) => {
        if (live && body) setData({ leader, record: body.record });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [leader]);
  const r = data?.leader === leader ? data.record : undefined;
  const closed = r ? r.copies.closedWins + r.copies.closedLosses : 0;
  return (
    <Panel title="Track record" subtitle="From the leader's verified execution and copiers' Flash fills" layer="execution">
      {!r ? (
        <p className="px-4 py-3 text-[12px] text-mute">Loading…</p>
      ) : (
        <dl className="px-4 py-2">
          <KV
            k="Own execution behind plans"
            v={`${r.evidence.ONCHAIN_VERIFIED} onchain · ${r.evidence.PLAN_MATCHED + r.evidence.ORDER_FOUND} order · ${r.evidence.UNVERIFIED} none`}
          />
          <KV k="Contradicted by own execution" v={<span className={r.evidence.MISMATCH ? "text-bad" : ""}>{r.evidence.MISMATCH}</span>} />
          <KV
            k="Leader's verified volume"
            v={
              r.leaderVolumeUsd > 0
                ? `$${r.leaderVolumeUsd.toFixed(2)}${r.leaderAvgEntryDriftBps !== undefined ? ` · ${bps(r.leaderAvgEntryDriftBps)} vs declared` : ""}`
                : "—"
            }
          />
          <KV k="Copies submitted / filled" v={`${r.copies.submitted} / ${r.copies.filled}`} />
          <KV k="Copiers' mean entry drift" v={bps(r.copies.avgEntryDriftBps)} />
          <KV
            k="Copiers' realized P&L"
            v={
              closed ? (
                <span className={r.copies.realizedPnlUsd < 0 ? "text-bad" : r.copies.realizedPnlUsd > 0 ? "text-good" : ""}>
                  {`${signedUsd(r.copies.realizedPnlUsd)} · ${r.copies.closedWins}W / ${r.copies.closedLosses}L`}
                </span>
              ) : (
                "no closed copies yet"
              )
            }
          />
        </dl>
      )}
    </Panel>
  );
}
