export function Gauge({
  value,
  max,
  label,
  sub,
}: {
  value: number;
  max: number;
  label: string;
  sub?: string;
}) {
  const t = max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));
  const r = 54;
  const c = 2 * Math.PI * r;
  const dash = c * 0.72;
  const offset = dash * (1 - t);

  return (
    <div className="relative flex flex-col items-center">
      <svg width="160" height="110" viewBox="0 0 160 110" className="overflow-visible">
        <path
          d="M22 92 A 54 54 0 1 1 138 92"
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <path
          d="M22 92 A 54 54 0 1 1 138 92"
          fill="none"
          stroke="url(#goldArc)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          strokeDashoffset={offset}
        />
        <defs>
          <linearGradient id="goldArc" x1="22" y1="92" x2="138" y2="20">
            <stop stopColor="#f3d5a8" />
            <stop offset="1" stopColor="#c084fc" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-x-0 top-[48px] text-center">
        <div className="num font-[family-name:var(--font-serif)] text-[26px] leading-none text-ink">
          {label}
        </div>
        {sub ? <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-mute">{sub}</div> : null}
      </div>
    </div>
  );
}
