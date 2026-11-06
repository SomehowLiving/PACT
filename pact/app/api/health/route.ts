import { FLASH_BASE } from "@/lib/constants";

export const dynamic = "force-dynamic";

type Health = {
  ok: boolean;
  status?: number;
  weth?: string;
  price?: string;
  riskFlagged?: boolean;
  error?: string;
  /** Round-trip time of the last real Flash request, in milliseconds. */
  latencyMs?: number;
  checkedAt: string;
};

// Several UI surfaces ask for health at once. Flash rate-limits bursts (429), so
// share one in-flight check and reuse the result briefly instead of reporting a
// healthy API as unreachable.
const TTL_MS = 30_000;
let cached: { value: Health; at: number } | undefined;
let inflight: Promise<Health> | undefined;

async function check(key: string): Promise<Health> {
  const started = performance.now();
  try {
    const res = await fetch(`${FLASH_BASE}/search?query=weth&chain=base&limit=1`, {
      headers: { "x-definitive-api-key": key },
      cache: "no-store",
    });
    const body = await res.json().catch(() => null);
    const latencyMs = Math.round(performance.now() - started);
    if (res.status === 429 && cached?.value.ok) {
      return { ...cached.value, checkedAt: new Date().toISOString() };
    }
    const asset = body?.assets?.[0];
    return {
      ok: res.ok,
      status: res.status,
      weth: asset?.symbol,
      price: asset?.price,
      riskFlagged: asset?.riskFlagged,
      error: res.ok ? undefined : res.status === 429 ? "rate limited" : `HTTP ${res.status}`,
      latencyMs,
      checkedAt: new Date().toISOString(),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "flash unreachable", checkedAt: new Date().toISOString() };
  }
}

export async function GET() {
  const key = process.env.FLASH_API_KEY;
  if (!key) {
    return Response.json({ ok: false, error: "FLASH_API_KEY missing" }, { status: 503 });
  }
  if (cached && Date.now() - cached.at < TTL_MS) return Response.json(cached.value);
  inflight ??= check(key).finally(() => {
    inflight = undefined;
  });
  const value = await inflight;
  cached = { value, at: Date.now() };
  return Response.json(value, { status: value.ok ? 200 : 502 });
}
