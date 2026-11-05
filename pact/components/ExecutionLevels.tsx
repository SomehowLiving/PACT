import type { Side } from "@/lib/types";

function price(value?: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function usd(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
  });
}

function percent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function ExecutionLevels({
  side,
  entry,
  stop,
  target,
}: {
  side: Side;
  entry?: string;
  stop?: string;
  target?: string;
}) {
  const entryPrice = price(entry);
  const stopPrice = price(stop);
  const targetPrice = price(target);
  if (!entryPrice || !stopPrice || !targetPrice) return null;

  const stopDistance = side === "buy"
    ? ((stopPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - stopPrice) / entryPrice) * 100;
  const targetDistance = side === "buy"
    ? ((targetPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - targetPrice) / entryPrice) * 100;
  const risk = Math.abs(entryPrice - stopPrice);
  const reward = Math.abs(targetPrice - entryPrice);
  const rewardRisk = risk ? reward / risk : 0;
  const direction = side === "buy" ? "long" : "short";

  return (
    <section className="mt-4 border-y border-line bg-[#0c1219]">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-mute">
          {direction} execution levels
        </div>
        <div className="font-mono text-[11px] text-ink">
          {rewardRisk.toFixed(2)}R <span className="text-mute">declared</span>
        </div>
      </div>
      <div className="grid grid-cols-3 divide-x divide-line">
        <Level
          label="stop / invalidation"
          value={usd(stopPrice)}
          detail={percent(stopDistance)}
          tone="text-rose"
        />
        <Level
          label="reference entry"
          value={usd(entryPrice)}
          detail="leader plan"
          tone="text-ink"
        />
        <Level
          label="target"
          value={usd(targetPrice)}
          detail={percent(targetDistance)}
          tone="text-[#7dd3fc]"
        />
      </div>
    </section>
  );
}

function Level({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: string;
}) {
  return (
    <div className="min-w-0 px-3 py-3">
      <div className="truncate font-mono text-[9px] uppercase tracking-[0.08em] text-mute">{label}</div>
      <div className={`num mt-1 text-sm font-semibold ${tone}`}>{value}</div>
      <div className={`mt-1 font-mono text-[10px] ${tone}`}>{detail}</div>
    </div>
  );
}
