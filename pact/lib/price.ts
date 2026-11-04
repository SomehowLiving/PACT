import { FLASH_BASE } from "./constants";
import type { Chain } from "./types";

const cache = new Map<string, { price: number; at: number }>();

// USD price of a token via Flash /search. Cached because the playground key is 5 req/s.
export async function assetPrice(chain: Chain, address: string): Promise<number> {
  const k = `${chain}:${address.toLowerCase()}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < 30_000) return hit.price;
  const key = process.env.FLASH_API_KEY;
  if (!key) throw new Error("FLASH_API_KEY missing");
  const res = await fetch(
    `${FLASH_BASE}/search?query=${encodeURIComponent(address)}&chain=${chain}&limit=5`,
    { headers: { "x-definitive-api-key": key }, cache: "no-store" },
  );
  if (!res.ok) throw new Error(`price lookup failed (${res.status})`);
  const body = (await res.json()) as {
    assets?: { address: string; price?: string }[];
  };
  const asset = body.assets?.find(
    (a) => a.address.toLowerCase() === address.toLowerCase(),
  );
  const price = Number(asset?.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error("price unavailable");
  cache.set(k, { price, at: Date.now() });
  return price;
}
