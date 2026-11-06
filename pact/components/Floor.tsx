"use client";

import { DotMeter, Sparkline } from "@/components/Sparkline";
import { DemoLab } from "@/components/DemoLab";
import { Gauge } from "@/components/Gauge";
import { Orb } from "@/components/Orb";
import { VerdictPill } from "@/components/VerdictPill";
import { useDesk, type DeskPayload } from "@/components/useDesk";
import { reasonLabel, shortAddr, usd } from "@/lib/format";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";

type Filter = "all" | "ALLOW" | "BLOCK";
type DashboardMode = "portfolio" | "demo";

type Health = {
  ok?: boolean;
  price?: number | string;
  weth?: string;
  error?: string;
};

function blockedSpark(state: DeskPayload | null): { pts: number[]; labels: string[] } {
  const logs = [...(state?.logs ?? [])].reverse();
  let cum = 0;
  const pts: number[] = [0];
  const labels: string[] = ["start of day"];
  for (const l of logs) {
    const p = state?.proposals.find((x) => x.id === l.proposalId);
    if (l.verdict === "BLOCK") cum += p?.notionalUsd ?? 0;
    pts.push(cum);
    labels.push(
      `${l.verdict}${p ? ` · ${p.orderType} ${usd(p.notionalUsd)}` : ""} · ${new Date(l.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
    );
  }
  return pts.length > 1 ? { pts, labels } : { pts: [0, 0, 0], labels: [] };
}

export function Floor() {
  const { address } = useAccount();
  const { state, refresh } = useDesk(address);
  const [filter, setFilter] = useState<Filter>("all");
  const [mode, setMode] = useState<DashboardMode>("portfolio");
  const [seeding, setSeeding] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    void fetch("/api/health")
      .then((r) => r.json())
      .then((j: Health) => setHealth(j))
      .catch(() => setHealth({ ok: false }));
  }, []);

  const policy = state?.policies.find(
    (item) => address && item.follower.toLowerCase() === address.toLowerCase(),
  ) ?? state?.policies[0];
  const maxDaily = policy?.maxDailyUsd ?? 50;
  const spent = state?.dailySpentUsd ?? 0;
  const remaining = Math.max(0, maxDaily - spent);
  const blocked = state?.blockedNotionalUsd ?? 0;
  const spark = blockedSpark(state);

  const rows = useMemo(() => {
    const proposals = state?.proposals ?? [];
    if (mode === "demo") return proposals;
    if (!address) return [];
    return proposals.filter((proposal) => proposal.follower.toLowerCase() === address.toLowerCase());
  }, [address, mode, state?.proposals]);
  const allows = rows.filter((p) => state?.decisions[p.id]?.verdict === "ALLOW").length;
  const blocks = rows.filter((p) => state?.decisions[p.id]?.verdict === "BLOCK").length;
  const shown = useMemo(() => {
    if (filter === "all") return rows.slice(0, 8);
    return rows
      .filter((p) => state?.decisions[p.id]?.verdict === filter)
      .slice(0, 8);
  }, [filter, rows, state?.decisions]);

  async function loadDemo() {
    setSeeding(true);
    try {
      await fetch("/api/demo", { method: "POST" });
      setMode("demo");
      await refresh();
    } finally {
      setSeeding(false);
    }
  }

  const priceN = Number(health?.price);
  const price = Number.isFinite(priceN) && priceN > 0
    ? priceN.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : null;

  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_0.9fr]">
      <section className="glass overflow-hidden rounded-xl p-5 md:p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-gold">
              Tool · how PACT works
            </div>
            <h1 className="mt-2 font-[family-name:var(--font-serif)] text-[36px] font-medium leading-[1.1] text-ink md:text-[44px]">
              Demo lab
            </h1>
            <div className="mt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-mute">
              remaining today
            </div>
            <div className="num mt-2 font-mono text-[46px] font-medium leading-none md:text-[54px]">
              {usd(remaining)}
            </div>
            <div className="mt-2 text-sm text-mute">
              of {usd(maxDaily)} daily cap · {usd(blocked)} blocked
            </div>
          </div>
          <HealthPill health={health} price={price} />
        </div>
        <div className="mt-1 h-[140px]">
          <Sparkline points={spark.pts} labels={spark.labels} className="h-full w-full" />
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-mute">
          <span>blocked notional</span>
          <span className="text-ink">{usd(blocked)}</span>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/follower" className="btn-cream rounded-md px-4 py-2 text-[12px]">
            set leader mandates
          </Link>
          <button
            type="button"
            disabled={seeding}
            onClick={() => void loadDemo()}
            className="rounded-md bg-white/8 px-4 py-2 text-[12px] text-ink hairline"
          >
            {seeding ? "loading scenario…" : "load demo scenario"}
          </button>
        </div>
      </section>

      <section className="glass rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] text-mute">execution budget</div>
            <div className="mt-1 text-sm text-ink/80">
              what your selected leaders can use
            </div>
          </div>
          <Orb size={44} />
        </div>
        <Gauge
          value={spent}
          max={maxDaily}
          label={`${Math.round((spent / maxDaily) * 100) || 0}`}
          sub={`${usd(spent)} spent`}
        />
        <div className="mt-2 grid grid-cols-2 gap-3 text-[12px] text-mute">
          <div className="bg-black/25 p-3 hairline">
            per order
            <div className="mt-1 text-ink">{usd(policy?.maxNotionalUsd ?? 30)}</div>
          </div>
          <div className="bg-black/25 p-3 hairline">
            chain
            <div className="mt-1 text-ink">base</div>
          </div>
        </div>
      </section>

      <section className="glass rounded-xl p-2 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex bg-black/30 p-1 hairline">
            <ModeButton on={mode === "portfolio"} onClick={() => setMode("portfolio")}>
              your portfolio
            </ModeButton>
            <ModeButton on={mode === "demo"} onClick={() => setMode("demo")}>
              demo lab
            </ModeButton>
          </div>
          <p className="px-2 text-[11px] text-mute">
            {mode === "portfolio"
              ? address
                ? "Your mandates, exposure, and pending decisions."
                : "Connect a wallet to view your personal copy portfolio."
              : "Illustrative policy outcomes. No orders are sent."}
          </p>
        </div>
      </section>

      {mode === "demo" ? (
        <DemoLab state={state} />
      ) : null}

      <section className="glass rounded-xl p-5 lg:col-span-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="text-[15px] tracking-tight">today’s tape</div>
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <FilterChip
              on={filter === "all"}
              onClick={() => setFilter("all")}
              className="bg-white/10"
            >
              all {rows.length}
            </FilterChip>
            <FilterChip
              on={filter === "ALLOW"}
              onClick={() => setFilter("ALLOW")}
              className="bg-[#e8c9a0]/10 text-gold"
            >
              allow {allows}
            </FilterChip>
            <FilterChip
              on={filter === "BLOCK"}
              onClick={() => setFilter("BLOCK")}
              className="bg-[#fb7185]/10 text-rose"
            >
              block {blocks}
            </FilterChip>
            <button
              type="button"
              disabled={seeding}
              onClick={() => void loadDemo()}
              className="rounded-full bg-white/8 px-3 py-1 text-ink"
            >
              {seeding ? "seeding…" : "load demo tape"}
            </button>
          </div>
        </div>

        <div className="mt-4 divide-y divide-white/6">
          {shown.length === 0 ? (
            rows.length === 0 ? (
              <EmptyTape onDemo={() => void loadDemo()} seeding={seeding} />
            ) : (
              <div className="py-8 text-sm text-mute">Nothing in this filter.</div>
            )
          ) : (
            shown.map((p) => {
              const d = state?.decisions[p.id];
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-4 py-4 first:pt-2"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/5">
                    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                      <path
                        d="M8 1.2L3.2 8.1 8 10.4l4.8-2.3L8 1.2zm0 10.1L3.2 8.8 8 14.8l4.8-6-4.8 2.5z"
                        fill="#e8c9a0"
                      />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[15px]">WETH</span>
                      {d ? <VerdictPill verdict={d.verdict} /> : null}
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-mute">
                      {p.orderType} {p.side} · {usd(p.notionalUsd)} ·{" "}
                      {shortAddr(p.follower)}
                      {d?.reasons[0] ? ` · ${reasonLabel(d.reasons[0])}` : ""}
                    </div>
                  </div>
                  <DotMeter
                    filled={d?.verdict === "BLOCK" ? 3 : d?.verdict === "MODIFY" ? 8 : 11}
                  />
                </div>
              );
            })
          )}
        </div>
      </section>

      <p className="px-1 text-[12px] leading-relaxed text-mute lg:col-span-2">
        Copy a trader without giving up your keys or your risk limits. Funds stay in
        the follower’s wallet, the follower signs every order, and the wallet guard
        refuses anything the policy did not allow.
      </p>
    </div>
  );
}

function ModeButton({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 text-[12px] transition ${
        on ? "bg-white/10 text-ink" : "text-mute"
      }`}
    >
      {children}
    </button>
  );
}

function HealthPill({
  health,
  price,
}: {
  health: Health | null;
  price: string | null;
}) {
  const live = health?.ok;
  return (
    <div
      className={`rounded-full px-3 py-1 text-[11px] ${
        live ? "bg-white/5 text-gold" : "bg-rose/10 text-rose"
      }`}
    >
      {health === null
        ? "flash…"
        : live
          ? `flash live${price ? ` · $${price}` : ""}`
          : "flash down"}
    </div>
  );
}

function FilterChip({
  on,
  onClick,
  className,
  children,
}: {
  on: boolean;
  onClick: () => void;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 ${className} ${
        on ? "ring-1 ring-white/25" : "opacity-70"
      }`}
    >
      {children}
    </button>
  );
}

function EmptyTape({
  onDemo,
  seeding,
}: {
  onDemo: () => void;
  seeding: boolean;
}) {
  return (
    <div className="py-8 text-sm text-mute">
      No proposals yet.{" "}
      <button
        type="button"
        disabled={seeding}
        onClick={onDemo}
        className="text-gold"
      >
        Load the demo tape
      </button>
      , or publish a TWAP from{" "}
      <a href="/leader" className="text-gold">
        lead
      </a>
      .
    </div>
  );
}
