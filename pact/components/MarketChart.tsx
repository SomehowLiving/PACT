"use client";

import type { Candle, MarketSnapshot } from "@/lib/market";
import { useCallback, useEffect, useMemo, useState } from "react";

const WIDTH = 760;
const HEIGHT = 300;
const LEFT = 54;
const RIGHT = 18;
const TOP = 16;
const BOTTOM = 64;

function formatUsd(value: number, digits = 2) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  });
}

function formatCompactUsd(value?: number) {
  if (value === undefined) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  });
}

function percentage(value?: number) {
  if (value === undefined) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function value(input?: string) {
  const parsed = Number(input);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function MarketChart({
  entry,
  stop,
  target,
}: {
  entry?: string;
  stop?: string;
  target?: string;
}) {
  const [market, setMarket] = useState<MarketSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/market/weth", { cache: "no-store" });
      const body = (await response.json()) as MarketSnapshot & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "market data unavailable");
      setMarket(body);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "market data unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);

  const chart = useMemo(() => {
    if (!market) return null;
    return makeChart(market.candles, [value(entry), value(stop), value(target)]);
  }, [entry, market, stop, target]);

  return (
    <section className="mt-4 border border-line bg-[#0c1219]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-mute">
            live market context
          </div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="text-sm font-semibold text-ink">Base WETH / USDC</span>
            <span className="font-mono text-[10px] text-mute">5m · 8h window</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-mute transition hover:border-gold hover:text-gold disabled:opacity-50"
        >
          {loading ? "loading" : "refresh"}
        </button>
      </div>

      {chart && market ? (
        <>
          <div className="grid grid-cols-2 divide-x divide-line border-b border-line sm:grid-cols-4">
            <Metric label="last" value={formatUsd(market.price)} tone="text-ink" />
            <Metric
              label="5m move"
              value={percentage(market.priceChange5m)}
              tone={(market.priceChange5m ?? 0) >= 0 ? "text-emerald-300" : "text-rose"}
            />
            <Metric label="24h volume" value={formatCompactUsd(market.volume24h)} tone="text-ink" />
            <Metric label="liquidity" value={formatCompactUsd(market.liquidityUsd)} tone="text-ink" />
          </div>
          <div className="overflow-x-auto">
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              className="block min-w-[620px] w-full"
              role="img"
              aria-label="Live five-minute WETH USDC candlestick chart from Base DEX data"
            >
              <rect width={WIDTH} height={HEIGHT} fill="#0c1219" />
              {chart.grid.map((grid) => (
                <g key={grid.value}>
                  <line
                    x1={LEFT}
                    x2={WIDTH - RIGHT}
                    y1={grid.y}
                    y2={grid.y}
                    stroke="#24303c"
                    strokeWidth="1"
                  />
                  <text x={6} y={grid.y + 3} fill="#8b98a5" fontSize="10" fontFamily="monospace">
                    {formatUsd(grid.value, 0)}
                  </text>
                </g>
              ))}
              {chart.levels.map((level) => (
                <g key={level.label}>
                  <line
                    x1={LEFT}
                    x2={WIDTH - RIGHT}
                    y1={level.y}
                    y2={level.y}
                    stroke={level.color}
                    strokeDasharray="4 4"
                    strokeWidth="1"
                  />
                  <text
                    x={WIDTH - RIGHT - 2}
                    y={level.y - 4}
                    fill={level.color}
                    fontSize="10"
                    textAnchor="end"
                    fontFamily="monospace"
                  >
                    {level.label} {formatUsd(level.value)}
                  </text>
                </g>
              ))}
              {chart.candles.map((candle) => (
                <g key={candle.time}>
                  <line
                    x1={candle.x}
                    x2={candle.x}
                    y1={candle.highY}
                    y2={candle.lowY}
                    stroke={candle.up ? "#34d399" : "#fb7185"}
                    strokeWidth="1"
                  />
                  <rect
                    x={candle.x - candle.width / 2}
                    y={Math.min(candle.openY, candle.closeY)}
                    width={candle.width}
                    height={Math.max(1, Math.abs(candle.openY - candle.closeY))}
                    fill={candle.up ? "#34d399" : "#fb7185"}
                  />
                </g>
              ))}
              {chart.labels.map((label) => (
                <text
                  key={label.time}
                  x={label.x}
                  y={HEIGHT - 22}
                  fill="#8b98a5"
                  fontSize="10"
                  textAnchor="middle"
                  fontFamily="monospace"
                >
                  {new Date(label.time * 1000).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </text>
              ))}
              <text x={LEFT} y={HEIGHT - 6} fill="#8b98a5" fontSize="10" fontFamily="monospace">
                Base DEX candles · actual pool data
              </text>
              <text
                x={WIDTH - RIGHT}
                y={HEIGHT - 6}
                fill="#8b98a5"
                fontSize="10"
                textAnchor="end"
                fontFamily="monospace"
              >
                96 candles
              </text>
            </svg>
          </div>
          <div className="flex flex-wrap justify-between gap-2 border-t border-line px-3 py-2 font-mono text-[10px] text-mute">
            <span>{market.dex.replaceAll("-", " ")}</span>
            <span>updated {new Date(market.updatedAt).toLocaleTimeString()}</span>
            <a
              href="https://www.geckoterminal.com/base/pools"
              target="_blank"
              rel="noreferrer"
              className="text-gold hover:underline"
            >
              data by GeckoTerminal
            </a>
          </div>
        </>
      ) : (
        <div className="px-3 py-8 text-xs text-mute">
          {loading ? "Loading live Base DEX candles…" : `No chart rendered: ${error}`}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-mute">{label}</div>
      <div className={`num mt-1 text-xs font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function makeChart(candles: Candle[], declaredLevels: Array<number | undefined>) {
  const values = candles.flatMap((candle) => [candle.high, candle.low]);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = Math.max(high - low, high * 0.002);
  const min = low - span * 0.08;
  const max = high + span * 0.08;
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const y = (current: number) => TOP + ((max - current) / (max - min)) * plotHeight;
  const x = (index: number) => LEFT + ((index + 0.5) / candles.length) * plotWidth;
  const candleWidth = Math.max(1.5, (plotWidth / candles.length) * 0.62);
  const grid = Array.from({ length: 5 }, (_, index) => {
    const amount = max - ((max - min) * index) / 4;
    return { value: amount, y: y(amount) };
  });
  const levelSpecs = [
    { label: "target", value: declaredLevels[2], color: "#7dd3fc" },
    { label: "entry", value: declaredLevels[0], color: "#60a5fa" },
    { label: "stop", value: declaredLevels[1], color: "#fb7185" },
  ];
  const levels = levelSpecs
    .filter((level): level is { label: string; value: number; color: string } => Boolean(level.value))
    .filter((level) => level.value >= min && level.value <= max)
    .map((level) => ({ ...level, y: y(level.value) }));
  const labels = [0, Math.floor(candles.length / 2), candles.length - 1].map((index) => ({
    time: candles[index].time,
    x: x(index),
  }));

  return {
    grid,
    levels,
    labels,
    candles: candles.map((candle, index) => ({
      ...candle,
      x: x(index),
      width: candleWidth,
      highY: y(candle.high),
      lowY: y(candle.low),
      openY: y(candle.open),
      closeY: y(candle.close),
      up: candle.close >= candle.open,
    })),
  };
}
