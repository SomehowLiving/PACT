"use client";

import type { CopyAction, Verdict } from "@/lib/types";
import { useEffect, useRef, type ReactNode } from "react";

/* Shared terminal primitives. Pages compose these; they do not restyle them.
   Rules: tables for analysis, cards for discovery, panels for decisions.
   Status = green allowed / amber caution / red declined, always icon + label. */

export function Panel({
  title,
  subtitle,
  actions,
  layer,
  children,
  className = "",
  bodyClassName = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  layer?: Layer;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`panel flex min-w-0 flex-col ${className}`}>
      {title || actions ? (
        <header className="panel-head">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {title ? <h2 className="panel-title truncate">{title}</h2> : null}
              {layer ? <LayerTag layer={layer} /> : null}
            </div>
            {subtitle ? <p className="mt-0.5 truncate text-[11.5px] text-mute">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={`min-w-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4" data-eyebrow={eyebrow}>
      <div className="min-w-0">
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">{title}</h1>
        {description ? <p className="mt-1 max-w-[760px] text-[13px] text-mute">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export type Metric = {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "good" | "warn" | "bad" | "accent";
  layer?: Layer;
};

/** One strip of headline numbers. Never put each metric in its own card. */
export function MetricStrip({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="panel grid grid-cols-2 divide-line md:grid-cols-4 md:divide-x [&>*]:border-line">
      {metrics.map((m, i) => (
        <div
          key={m.label}
          className={`min-w-0 px-4 py-3.5 ${i >= 2 ? "border-t md:border-t-0" : ""} ${i % 2 === 1 ? "border-l md:border-l-0" : ""}`}
        >
          <div className="flex items-center gap-2">
            <span className="label">{m.label}</span>
            {m.layer ? <LayerTag layer={m.layer} compact /> : null}
          </div>
          <div
            className={`mt-1.5 truncate text-[22px] font-semibold tnum tracking-tight ${
              m.tone === "good"
                ? "text-good"
                : m.tone === "warn"
                  ? "text-warn"
                  : m.tone === "bad"
                    ? "text-bad"
                    : m.tone === "accent"
                      ? "text-accent"
                      : "text-ink"
            }`}
          >
            {m.value}
          </div>
          {m.sub ? <div className="mt-0.5 truncate text-[11.5px] text-mute">{m.sub}</div> : null}
        </div>
      ))}
    </div>
  );
}

/* ── Status ───────────────────────────────────────────────────────────── */

export type Tone = "good" | "warn" | "bad" | "neutral";

type IconName = "check" | "scale" | "clock" | "review" | "x" | "dot";

/** 10px stroke icons so status never relies on colour alone. */
function StatusIcon({ name }: { name: IconName }) {
  const common = { width: 10, height: 10, viewBox: "0 0 10 10", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "check":
      return <svg {...common}><path d="M2 5.2 4.1 7.3 8 2.8" /></svg>;
    case "scale":
      return <svg {...common}><path d="M2 3h6M2 5.5h4M2 8h2" /></svg>;
    case "clock":
      return <svg {...common}><circle cx="5" cy="5" r="3.6" /><path d="M5 3.2V5l1.3.9" /></svg>;
    case "review":
      return <svg {...common}><circle cx="5" cy="5" r="3.6" /><path d="M5 5.6v.1M5 3.3v1.2" /></svg>;
    case "x":
      return <svg {...common}><path d="m2.8 2.8 4.4 4.4M7.2 2.8 2.8 7.2" /></svg>;
    default:
      return <svg {...common}><circle cx="5" cy="5" r="2" fill="currentColor" stroke="none" /></svg>;
  }
}

const GLYPH_ICON: Record<string, IconName> = { "●": "check", "◐": "scale", "◷": "clock", "?": "review", "!": "review", "✕": "x", "✓": "check" };

const ACTION_TONE: Record<CopyAction, { tone: Tone; icon: IconName }> = {
  COPY: { tone: "good", icon: "check" },
  SCALE: { tone: "good", icon: "scale" },
  WAIT: { tone: "warn", icon: "clock" },
  REVIEW: { tone: "warn", icon: "review" },
  DECLINE: { tone: "bad", icon: "x" },
};

export function toneOfAction(action?: CopyAction, verdict?: Verdict): Tone {
  if (action) return ACTION_TONE[action].tone;
  if (verdict === "BLOCK") return "bad";
  if (verdict) return "good";
  return "neutral";
}

const TONE_CLASS: Record<Tone, string> = {
  good: "text-good bg-[color-mix(in_oklab,var(--good)_13%,transparent)]",
  warn: "text-warn bg-[color-mix(in_oklab,var(--warn)_12%,transparent)]",
  bad: "text-bad bg-[color-mix(in_oklab,var(--bad)_15%,transparent)]",
  neutral: "text-mute bg-panel-3",
};

export function StatusBadge({
  tone,
  icon,
  children,
}: {
  tone: Tone;
  /** An icon name, or a legacy glyph which is mapped to the matching icon. */
  icon?: IconName | string;
  children: ReactNode;
}) {
  const name: IconName | undefined = icon ? ((GLYPH_ICON[icon] ?? icon) as IconName) : undefined;
  return (
    <span
      className={`inline-flex h-[20px] items-center gap-1 rounded-[5px] px-1.5 text-[10px] font-semibold uppercase leading-none tracking-[0.05em] ${TONE_CLASS[tone]}`}
    >
      {name ? <StatusIcon name={name} /> : null}
      {children}
    </span>
  );
}

/** COPY / SCALE / WAIT / REVIEW / DECLINE with icon + label + status colour. */
export function ActionBadge({ action, verdict }: { action?: CopyAction; verdict?: Verdict }) {
  const value: CopyAction = action ?? (verdict === "BLOCK" ? "DECLINE" : verdict === "MODIFY" ? "SCALE" : "COPY");
  const spec = ACTION_TONE[value];
  return (
    <StatusBadge tone={spec.tone} icon={spec.icon}>
      {value}
    </StatusBadge>
  );
}

/* ── Data layers ──────────────────────────────────────────────────────── */

export type Layer = "market" | "policy" | "execution" | "wallet" | "demo" | "planned";

const LAYER: Record<Layer, { label: string; dot: string; title: string }> = {
  market: {
    label: "Market",
    dot: "var(--layer-market)",
    title: "External market context (GeckoTerminal). Not Flash route or fill truth.",
  },
  policy: {
    label: "Policy",
    dot: "var(--layer-policy)",
    title: "PACT policy decision computed from the follower's mandate.",
  },
  execution: {
    label: "Flash",
    dot: "var(--layer-exec)",
    title: "Execution facts returned by Definitive Flash.",
  },
  wallet: {
    label: "Wallet",
    dot: "var(--ink)",
    title: "Read from the connected wallet over Base RPC.",
  },
  demo: {
    label: "Demo",
    dot: "transparent",
    title: "Seeded demo data. Not a real account or verified performance.",
  },
  planned: {
    label: "Planned",
    dot: "transparent",
    title: "Not built yet. Shown so the layout has a place for it.",
  },
};

/** Quiet source marker: a coloured dot and a word. Says where a number comes from. */
export function LayerTag({ layer, compact = false }: { layer: Layer; compact?: boolean }) {
  const spec = LAYER[layer];
  const hollow = layer === "demo" || layer === "planned";
  return (
    // `relative` contains the sr-only label; otherwise it escapes table scrollers and widens the page.
    <span title={spec.title} className="relative inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-mute">
      <span
        aria-hidden
        className={`inline-block h-[6px] w-[6px] rounded-full ${hollow ? "border border-mute" : ""}`}
        style={{ background: spec.dot }}
      />
      {compact ? <span className="sr-only">{spec.label}</span> : spec.label}
    </span>
  );
}

/* ── Meters ───────────────────────────────────────────────────────────── */

/** Used-vs-limit bar. Tone shifts to amber at 80% and red at 100%. */
export function Meter({
  label,
  used,
  max,
  format = (n: number) => String(n),
  hint,
}: {
  label: ReactNode;
  used: number;
  max: number;
  format?: (n: number) => string;
  hint?: ReactNode;
}) {
  const ratio = max > 0 ? Math.min(1, used / max) : 0;
  const tone = ratio >= 1 ? "var(--bad)" : ratio >= 0.8 ? "var(--warn)" : "var(--accent)";
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 text-[12px]">
        <span className="truncate text-mute">{label}</span>
        <span className="shrink-0 tnum text-ink">
          {format(used)} <span className="text-mute">/ {format(max)}</span>
        </span>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel-3"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={used}
      >
        <div className="h-full rounded-full transition-all" style={{ width: `${ratio * 100}%`, background: tone }} />
      </div>
      {hint ? <div className="mt-1 text-[11px] text-mute">{hint}</div> : null}
    </div>
  );
}

/* ── Controls ─────────────────────────────────────────────────────────── */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode; count?: number }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          data-on={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined ? <span className="ml-1.5 tnum text-mute">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export type SortDir = "asc" | "desc";

export function SortTh<K extends string>({
  k,
  sort,
  onSort,
  children,
  right = false,
}: {
  k: K;
  sort: { key: K; dir: SortDir };
  onSort: (key: K) => void;
  children: ReactNode;
  right?: boolean;
}) {
  const on = sort.key === k;
  return (
    <th className={right ? "r" : undefined} aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 uppercase ${on ? "text-ink" : ""}`}
      >
        {children}
        <span aria-hidden className={on ? "text-accent" : "opacity-30"}>
          {on && sort.dir === "asc" ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}

/* ── Rows, empty and planned states ───────────────────────────────────── */

export function KV({ k, v, wrap = false }: { k: ReactNode; v: ReactNode; wrap?: boolean }) {
  return (
    <div className={`flex gap-4 border-b border-line-2 py-2 text-[12.5px] last:border-b-0 ${wrap ? "items-start" : "items-center justify-between"}`}>
      <dt className="shrink-0 text-mute">{k}</dt>
      <dd className={`min-w-0 text-right tnum text-ink ${wrap ? "leading-relaxed" : "truncate"}`}>{v}</dd>
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="text-[13px] font-medium text-ink">{title}</div>
      {children ? <p className="max-w-[420px] text-[12px] leading-relaxed text-mute">{children}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** A reserved slot for a feature that is designed but not built. Never fake data in it. */
export function Planned({ title, children, className = "" }: { title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-dashed border-line px-3.5 py-3 ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12.5px] font-medium text-ink/80">{title}</span>
        <span className="shrink-0 text-[10.5px] font-medium text-mute">Coming later</span>
      </div>
      {children ? <p className="mt-1 text-[11.5px] leading-relaxed text-mute">{children}</p> : null}
    </div>
  );
}

/** In-app confirmation, used instead of the browser's native confirm() dialog. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      className="m-auto w-[min(440px,calc(100vw-32px))] rounded-xl border border-line bg-panel p-0 text-ink shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-[2px]"
    >
      <div className="p-5">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {children ? <div className="mt-2 text-[13px] leading-relaxed text-mute">{children}</div> : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className={`btn ${danger ? "btn-danger-solid" : "btn-primary"}`} onClick={onConfirm} disabled={busy} autoFocus>
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

export function Addr({ value, className = "" }: { value?: string; className?: string }) {
  if (!value) return <span className="text-mute">—</span>;
  return (
    <span className={`font-mono text-[12px] ${className}`} title={value}>
      {value.slice(0, 6)}…{value.slice(-4)}
    </span>
  );
}

/** Deterministic identicon so leaders are recognisable without invented names or avatars. */
export function AddrAvatar({ value, size = 28 }: { value: string; size?: number }) {
  const h = parseInt(value.slice(2, 8), 16) || 0;
  const hue = h % 360;
  const cells = Array.from({ length: 9 }, (_, i) => ((h >> i) & 1) === 1);
  return (
    <svg width={size} height={size} viewBox="0 0 6 6" className="shrink-0 rounded-md" aria-hidden>
      <rect width="6" height="6" fill={`hsl(${hue} 30% 16%)`} />
      {cells.map((on, i) => {
        if (!on) return null;
        const x = i % 3;
        const y = Math.floor(i / 3);
        return (
          <g key={i} fill={`hsl(${hue} 70% 62%)`}>
            <rect x={1 + x} y={1.5 + y} width="1" height="1" />
            <rect x={4 - x} y={1.5 + y} width="1" height="1" />
          </g>
        );
      })}
    </svg>
  );
}
