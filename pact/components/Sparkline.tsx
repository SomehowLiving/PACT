"use client";

import { useState } from "react";

export function Sparkline({
  points,
  labels = [],
  format = (v: number) => `$${v.toFixed(0)}`,
  className = "",
}: {
  points: number[];
  labels?: string[];
  format?: (v: number) => string;
  className?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 320;
  const h = 140;
  const PAD_TOP = 60; // headroom so the tooltip sits above the line, never over the text
  const max = Math.max(1, ...points);
  const min = Math.min(0, ...points);
  const span = max - min || 1;
  const anchors = points.length > 1 ? points : [0, 0];
  const step = w / (anchors.length - 1);
  const yOf = (p: number) => h - 8 - ((p - min) / span) * (h - 8 - PAD_TOP);
  // Ease each segment (smoothstep) so jumps read as soft S-curves, not straight lines.
  const SAMPLES = 28;
  const coords: (readonly [number, number])[] = [];
  for (let i = 0; i < anchors.length - 1; i++) {
    for (let k = 0; k < SAMPLES; k++) {
      const t = k / SAMPLES;
      const e = t * t * t * (t * (t * 6 - 15) + 10);
      const v = anchors[i] + (anchors[i + 1] - anchors[i]) * e;
      coords.push([i * step + t * step, yOf(v)] as const);
    }
  }
  coords.push([w, yOf(anchors[anchors.length - 1])] as const);
  const d = coords
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const area = `${d} L ${w} ${h} L 0 ${h} Z`;

  const hi = hover === null ? null : Math.min(coords.length - 1, Math.max(0, Math.round(hover * (coords.length - 1))));
  const hp = hi === null ? null : coords[hi];
  const hv = hi === null ? 0 : min + ((h - 8 - coords[hi][1]) / (h - 8 - PAD_TOP)) * span;
  // Which step (part) of the line the cursor is over.
  const seg = hover === null || anchors.length < 2 ? 0 : Math.min(anchors.length - 2, Math.floor(hover * (anchors.length - 1)));
  const delta = anchors[seg + 1] - anchors[seg];

  return (
    <div className="relative h-full w-full">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className={className}
        preserveAspectRatio="none"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#c9a46a" stopOpacity="0.35" />
            <stop offset="1" stopColor="#c9a46a" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#sparkFill)" />
        <path d={d} fill="none" stroke="#e8c9a0" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {hp ? (
          <line x1={hp[0]} x2={hp[0]} y1={hp[1]} y2={h} stroke="rgba(255,255,255,0.25)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ) : null}
        {!hp && coords.length ? (
          <circle cx={coords[coords.length - 1][0]} cy={coords[coords.length - 1][1]} r="3.4" fill="#e8c9a0" />
        ) : null}
      </svg>
      {hp ? (
        <>
          <span
            className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#e8c9a0] ring-4 ring-[#e8c9a0]/20"
            style={{ left: `${(hp[0] / w) * 100}%`, top: `${(hp[1] / h) * 100}%` }}
          />
          <div
            className="pointer-events-none absolute z-10 whitespace-nowrap rounded-xl bg-black/80 px-3 py-1.5 text-[11px] text-ink shadow-lg backdrop-blur"
            style={{
              left: `${Math.min(86, Math.max(14, (hp[0] / w) * 100))}%`,
              top: `${(hp[1] / h) * 100}%`,
              transform: "translate(-50%, calc(-100% - 14px))",
            }}
          >
            <div className="font-medium">{labels[seg + 1] ?? "no activity"}</div>
            <div className="text-mute">
              {delta > 0 ? `+${format(delta)} blocked` : "nothing blocked"} · {format(hv)} total
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function DotMeter({ filled = 8, total = 14 }: { filled?: number; total?: number }) {
  return (
    <div className="flex gap-[3px]">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className="h-[6px] w-[6px] rounded-full"
          style={{
            background:
              i < filled
                ? i > filled - 3
                  ? "#e8c9a0"
                  : "#8a7a66"
                : "rgba(255,255,255,0.12)",
          }}
        />
      ))}
    </div>
  );
}
