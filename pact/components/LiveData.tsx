"use client";

import { LayerTag, Panel, StatusBadge } from "@/components/ui";
import { usd } from "@/lib/format";
import { relativeTime } from "@/lib/views";
import type { DemoWallet, WalletFacts } from "@/lib/wallet-facts";
import { useEffect, useState } from "react";

/* Real-world data for the terminal: a leader's wallet on Base, and the live WETH/USDC market. */

type Market = { price?: number; priceChange24h?: number; volume24h?: number; liquidityUsd?: number; dex?: string; pair?: string };
type Reference = { oracle?: number; oracleAt?: string; quote?: number; status?: string; quoteVsOracleBps?: number };

function usePoll<T>(url: string | null, everyMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!url) return;
    let live = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // A public source can fail once (rate limit); retry soon rather than wait a full period.
    const miss = () => {
      if (!live) return;
      setFailed(true);
      clearTimeout(retry);
      retry = setTimeout(load, 5_000);
    };
    const load = () =>
      void fetch(url)
        .then(async (r) => {
          const body = await r.json();
          if (!live) return;
          if (r.ok) {
            setData(body as T);
            setFailed(false);
          } else miss();
        })
        .catch(miss);
    const first = setTimeout(load, 0);
    const id = setInterval(load, everyMs);
    return () => {
      live = false;
      clearTimeout(first);
      clearTimeout(retry);
      clearInterval(id);
    };
  }, [url, everyMs]);
  return { data, failed };
}

const compact = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : usd(n));
const amount = (n: number, d = 4) => (n === 0 ? "0" : n < 10 ** -d ? `<${10 ** -d}` : n.toLocaleString("en-US", { maximumFractionDigits: d }));

/** The live market under the page title: pool price, 24h change, volume, liquidity, Chainlink. */
export function MarketStrip() {
  const { data: m } = usePoll<Market>("/api/market/weth", 60_000);
  const { data: r } = usePoll<Reference>("/api/reference", 60_000);
  const change = m?.priceChange24h;
  const cells: [string, React.ReactNode][] = [
    ["WETH / USDC", m?.price ? <span className="text-ink">${m.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span> : "—"],
    ["24h", change === undefined ? "—" : <span className={change >= 0 ? "text-good" : "text-bad"}>{`${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}</span>],
    ["Vol 24h", m?.volume24h ? compact(m.volume24h) : "—"],
    ["Liquidity", m?.liquidityUsd ? compact(m.liquidityUsd) : "—"],
    ["Chainlink", r?.oracle ? `$${r.oracle.toLocaleString("en-US", { maximumFractionDigits: 2 })}${r.oracleAt ? ` · ${relativeTime(r.oracleAt)}` : ""}` : "—"],
    ["Flash vs oracle", r?.quoteVsOracleBps !== undefined ? `${r.quoteVsOracleBps >= 0 ? "+" : ""}${r.quoteVsOracleBps.toFixed(0)} bps` : "—"],
  ];
  return (
    <div
      className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-line bg-panel px-4 py-2.5 text-[12.5px]"
      aria-label="Live market"
      title={`${m?.dex ? `${m.dex} pool via GeckoTerminal` : "GeckoTerminal"} · Chainlink ETH/USD on Base · Flash quote`}
    >
      <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-mute">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--good-ink)]" />
        Live
      </span>
      {cells.map(([k, v]) => (
        <span key={k} className="inline-flex items-baseline gap-2">
          <span className="text-mute">{k}</span>
          <span className="tnum text-ink/90">{v}</span>
        </span>
      ))}
    </div>
  );
}

function useWallet(address?: string) {
  return usePoll<WalletFacts | DemoWallet>(address ? `/api/wallets/${address}` : null, 120_000);
}

function FlowLine({ label, f, unit, d }: { label: string; f?: { in: number; out: number; transfers: number }; unit: string; d: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
      <span className="text-mute">{label}</span>
      <span className="tnum text-ink/90">
        {f ? (
          <>
            <span className="text-good">+{amount(f.in, d)}</span> / <span className="text-bad">−{amount(f.out, d)}</span> {unit}
            <span className="text-mute"> · {f.transfers} transfers</span>
          </>
        ) : (
          <span className="text-mute">not read</span>
        )}
      </span>
    </div>
  );
}

/** A leader's wallet as Base sees it: real balances, activity and recent flows. */
export function OnchainPanel({ address, compactView = false }: { address: string; compactView?: boolean }) {
  const { data, failed } = useWallet(address);
  const demo = data && "demo" in data && data.demo;
  const w = data && !demo ? (data as WalletFacts) : null;
  const body = demo ? (
    <p className="text-[12.5px] text-mute">A DEMO address: no real wallet stands behind it, so PACT shows no on-chain data for it.</p>
  ) : failed && !w ? (
    <p className="text-[12.5px] text-mute">Base did not answer; try again shortly.</p>
  ) : !w ? (
    <p className="text-[12.5px] text-mute">Reading Base…</p>
  ) : (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {[
          ["ETH", amount(w.eth)],
          ["USDC", amount(w.usdc, 2)],
          ["WETH", amount(w.weth)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line bg-panel-2 px-3 py-2">
            <div className="text-[11px] text-mute">{k}</div>
            <div className="tnum text-[14px] text-ink">{v}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-mute">
        <span>
          <span className="tnum text-ink">{w.txCount.toLocaleString()}</span> transactions sent
        </span>
        <span>{w.isContract ? "a contract (smart account)" : "a plain wallet (EOA)"}</span>
        <span>{w.lastActivityAt ? `last token move ${relativeTime(w.lastActivityAt)}` : `no USDC/WETH moves in ${w.windowHours}h`}</span>
      </div>
      {compactView ? null : (
        <div className="space-y-1 border-t border-line-2 pt-2">
          <div className="text-[11.5px] text-mute">Last {w.windowHours} hours</div>
          <FlowLine label="USDC in / out" f={w.flows?.usdc} unit="USDC" d={2} />
          <FlowLine label="WETH in / out" f={w.flows?.weth} unit="WETH" d={4} />
        </div>
      )}
      <a href={`https://basescan.org/address/${address}`} target="_blank" rel="noreferrer" className="inline-block text-[12px] text-accent hover:underline">
        View on Basescan ↗
      </a>
    </div>
  );
  if (compactView) {
    return (
      <div className="rounded-xl border border-line p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[12.5px] font-medium text-ink">On Base</span>
          {demo ? <LayerTag layer="demo" compact /> : w ? <StatusBadge tone="neutral">live</StatusBadge> : null}
        </div>
        {body}
      </div>
    );
  }
  return (
    <Panel title="On-chain profile" subtitle="This wallet on Base, read live from chain" layer="wallet" actions={demo ? <LayerTag layer="demo" /> : w ? <StatusBadge tone="neutral">read {relativeTime(w.readAt)}</StatusBadge> : null} bodyClassName="p-4">
      {body}
      <p className="mt-3 text-[11px] leading-relaxed text-mute">Balances and activity are facts about the wallet, not a performance record. PACT reads Base only.</p>
    </Panel>
  );
}
