"use client";

import { LayerTag } from "@/components/ui";
import type { MarketSnapshot, Timeframe } from "@/lib/market";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useCallback, useEffect, useRef, useState } from "react";

/* TradingView lightweight-charts (Apache-2.0) over GeckoTerminal Base WETH/USDC
   candles. Plan levels are drawn as labelled price lines: they are the leader's
   declaration, never a Flash route or fill. */

type Level = { price?: string; title: string; color: string };

function n(v?: string) {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : undefined;
}

function fmt(v?: number, digits = 2) {
  return v === undefined ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function useMarket(timeframe: Timeframe = "5m", refreshMs = 60_000) {
  const [market, setMarket] = useState<MarketSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/market/weth?tf=${timeframe}`, { cache: "no-store" });
      const body = (await res.json()) as MarketSnapshot & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "market data unavailable");
      setMarket(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "market data unavailable");
    }
  }, [timeframe]);
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const id = setInterval(() => void load(), refreshMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load, refreshMs]);
  return { market, error, reload: load };
}

export function TradingChart({
  entry,
  stop,
  target,
  bound,
  height = 360,
  showHeader = true,
  showLegend = true,
  timeframe = "5m",
}: {
  entry?: string;
  stop?: string;
  target?: string;
  /** Follower execution bound sent to Flash as limitNotionalPrice. */
  bound?: string;
  height?: number;
  showHeader?: boolean;
  showLegend?: boolean;
  timeframe?: Timeframe;
}) {
  const { market, error } = useMarket(timeframe);
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [hover, setHover] = useState<{ o: number; h: number; l: number; c: number } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el || !market?.candles.length) return;
    const css = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const up = v("--good", "#22b14c");
    const down = v("--bad", "#d03b3b");

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: v("--mute", "#8b98a5"),
        fontSize: 11,
        fontFamily: "var(--font-ibm), ui-monospace, monospace",
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: v("--line-2", "#1b242e") },
        horzLines: { color: v("--line-2", "#1b242e") },
      },
      rightPriceScale: { borderColor: v("--line", "#24303c") },
      timeScale: { borderColor: v("--line", "#24303c"), timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
    });
    chartRef.current = chart;

    // lightweight-charts requires strictly ascending, unique times. GeckoTerminal can
    // return a repeated bar for the current interval; keep the latest one.
    const byTime = new Map<number, (typeof market.candles)[number]>();
    for (const c of market.candles) byTime.set(c.time, c);
    const bars = [...byTime.values()].sort((a, b) => a.time - b.time);

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: up,
      downColor: down,
      borderUpColor: up,
      borderDownColor: down,
      wickUpColor: up,
      wickDownColor: down,
    });
    candles.setData(
      bars.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })),
    );

    const volume = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volume.setData(
      bars.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? "rgba(34,177,76,0.28)" : "rgba(208,59,59,0.28)",
      })),
    );

    const levels: Level[] = [
      { price: entry, title: "entry", color: v("--accent", "#60a5fa") },
      { price: stop, title: "stop", color: down },
      { price: target, title: "target", color: up },
      { price: bound, title: "your bound", color: v("--warn", "#fab219") },
    ];
    for (const level of levels) {
      const price = n(level.price);
      if (price === undefined) continue;
      candles.createPriceLine({
        price,
        color: level.color,
        lineWidth: 1,
        lineStyle: level.title === "your bound" ? LineStyle.Dotted : LineStyle.Dashed,
        axisLabelVisible: true,
        title: level.title,
      });
    }

    chart.subscribeCrosshairMove((param) => {
      const bar = param.seriesData.get(candles) as { open: number; high: number; low: number; close: number } | undefined;
      setHover(bar ? { o: bar.open, h: bar.high, l: bar.low, c: bar.close } : null);
    });
    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [market, entry, stop, target, bound]);

  const last = market?.candles.at(-1);
  const shown = hover ?? (last ? { o: last.open, h: last.high, l: last.low, c: last.close } : null);
  const change = market?.priceChange24h;

  return (
    <div className="flex min-w-0 flex-col">
      {showHeader ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line px-4 py-2.5 text-[12px]">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-ink">WETH/USDC</span>
            <span className="label">Base · {timeframe}</span>
            <LayerTag layer="market" />
          </div>
          <span className="tnum text-[15px] font-semibold text-ink">{market ? `$${fmt(market.price)}` : "—"}</span>
          {change !== undefined ? (
            <span className={`tnum ${change >= 0 ? "text-good" : "text-bad"}`}>
              {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}% 24h
            </span>
          ) : null}
          {shown ? (
            <span className="tnum font-mono text-[11px] text-mute">
              O <span className="text-ink">{fmt(shown.o)}</span> H <span className="text-ink">{fmt(shown.h)}</span> L{" "}
              <span className="text-ink">{fmt(shown.l)}</span> C <span className="text-ink">{fmt(shown.c)}</span>
            </span>
          ) : null}
          <span className="ml-auto text-[11px] text-mute">{market ? `${market.dex} · GeckoTerminal` : ""}</span>
        </div>
      ) : null}
      <div className="relative" style={{ height }}>
        {error && !market ? (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-[12px] text-mute">
            Market data unavailable ({error}). PACT does not substitute a generated chart.
          </div>
        ) : !market ? (
          <div className="absolute inset-0 animate-pulse bg-panel-2/40" />
        ) : null}
        <div ref={host} className="absolute inset-0" />
      </div>
      {showLegend ? <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-[11px] text-mute">
        <LegendSwatch color="var(--accent)" label="declared entry" dashed />
        <LegendSwatch color="var(--bad)" label="declared stop" dashed />
        <LegendSwatch color="var(--good)" label="declared target" dashed />
        {bound ? <LegendSwatch color="var(--warn)" label="your Flash price bound" dashed /> : null}
        <span className="ml-auto">Levels are plan declarations, not fills.</span>
      </div> : null}
    </div>
  );
}

function LegendSwatch({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block w-4 border-t-2" style={{ borderColor: color, borderStyle: dashed ? "dashed" : "solid" }} />
      {label}
    </span>
  );
}
