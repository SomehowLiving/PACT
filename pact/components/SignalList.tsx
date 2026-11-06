import { StatusBadge, type Tone } from "@/components/ui";
import type { Signal } from "@/lib/types";

const TONE: Record<Signal["level"], Tone> = { info: "neutral", caution: "warn", alert: "bad" };
const LABEL: Record<Signal["id"], string> = {
  STYLE_DRIFT: "Size vs the leader's usual",
  REVENGE_PATTERN: "Re-entry after a stop-out",
  REFERENCE_DIVERGENCE: "Price vs the oracle",
};

/** L3 signals on a copy, each with its source. Nothing shown when there is nothing to say. */
export function SignalList({ signals }: { signals?: Signal[] }) {
  if (!signals?.length) return null;
  return (
    <div className="rounded-lg border border-line">
      <div className="border-b border-line px-3 py-2 text-[12.5px] font-semibold text-ink">Leader signals</div>
      <ul className="divide-y divide-line-2">
        {signals.map((s) => (
          <li key={s.id} className="flex items-start justify-between gap-3 px-3 py-2 text-[12px]">
            <div className="min-w-0">
              <div className="text-ink">{LABEL[s.id]}</div>
              <div className="mt-0.5 text-[11px] text-mute">
                {s.detail} · {s.source}
              </div>
            </div>
            <StatusBadge tone={TONE[s.level]}>{s.level}</StatusBadge>
          </li>
        ))}
      </ul>
    </div>
  );
}
