import { USDC, WETH } from "./constants";

const GECKO_BASE = "https://api.geckoterminal.com/api/v2";
const CACHE_MS = 60_000;

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MarketSnapshot = {
  source: "GeckoTerminal";
  pair: string;
  poolAddress: string;
  dex: string;
  price: number;
  priceChange5m?: number;
  priceChange24h?: number;
  volume24h?: number;
  liquidityUsd?: number;
  candles: Candle[];
  updatedAt: string;
};

type CacheEntry = { value: MarketSnapshot; at: number };

const cache = new Map<string, CacheEntry>();

type Pool = {
  attributes?: {
    address?: string;
    name?: string;
    base_token_price_usd?: string;
    quote_token_price_usd?: string;
    price_change_percentage?: { m5?: string; h24?: string };
    volume_usd?: { h24?: string };
    reserve_in_usd?: string;
  };
  relationships?: {
    base_token?: { data?: { id?: string } };
    quote_token?: { data?: { id?: string } };
    dex?: { data?: { id?: string } };
  };
};

function number(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function tokenId(address: string) {
  return `base_${address.toLowerCase()}`;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${GECKO_BASE}${path}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`market data unavailable (${response.status})`);
  return response.json() as Promise<T>;
}

function asCandle(row: unknown): Candle | undefined {
  if (!Array.isArray(row) || row.length < 6) return undefined;
  const [time, open, high, low, close, volume] = row.map(Number);
  if (![time, open, high, low, close, volume].every(Number.isFinite)) return undefined;
  return { time, open, high, low, close, volume };
}

export async function baseWethUsdcMarket(): Promise<MarketSnapshot> {
  const key = "base-weth-usdc-5m";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const pools = await getJson<{ data?: Pool[] }>(
    `/networks/base/tokens/${WETH}/pools?page=1`,
  );
  const weth = tokenId(WETH);
  const usdc = tokenId(USDC);
  const pool = pools.data?.find((candidate) => {
    const base = candidate.relationships?.base_token?.data?.id?.toLowerCase();
    const quote = candidate.relationships?.quote_token?.data?.id?.toLowerCase();
    return (base === weth && quote === usdc) || (base === usdc && quote === weth);
  });
  const address = pool?.attributes?.address;
  if (!pool || !address) throw new Error("WETH/USDC market pool unavailable");

  const token = pool.relationships?.base_token?.data?.id?.toLowerCase() === weth ? "base" : "quote";
  const ohlcv = await getJson<{
    data?: { attributes?: { ohlcv_list?: unknown[] } };
  }>(
    `/networks/base/pools/${address}/ohlcv/minute?aggregate=5&limit=96&currency=usd&token=${token}`,
  );
  const candles = (ohlcv.data?.attributes?.ohlcv_list ?? [])
    .map(asCandle)
    .filter((candle): candle is Candle => Boolean(candle))
    .reverse();
  if (candles.length < 2) throw new Error("market candles unavailable");

  const currentPrice = candles.at(-1)?.close;
  if (!currentPrice) throw new Error("market price unavailable");
  const value: MarketSnapshot = {
    source: "GeckoTerminal",
    pair: pool.attributes?.name ?? "WETH / USDC",
    poolAddress: address,
    dex: pool.relationships?.dex?.data?.id ?? "unknown",
    price: currentPrice,
    priceChange5m: number(pool.attributes?.price_change_percentage?.m5),
    priceChange24h: number(pool.attributes?.price_change_percentage?.h24),
    volume24h: number(pool.attributes?.volume_usd?.h24),
    liquidityUsd: number(pool.attributes?.reserve_in_usd),
    candles,
    updatedAt: new Date().toISOString(),
  };
  cache.set(key, { value, at: Date.now() });
  return value;
}
