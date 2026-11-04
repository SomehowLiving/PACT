import { FLASH_BASE } from "@/lib/constants";

export const dynamic = "force-dynamic";

export async function GET() {
  const key = process.env.FLASH_API_KEY;
  if (!key) {
    return Response.json({ ok: false, error: "FLASH_API_KEY missing" }, { status: 503 });
  }
  try {
    const res = await fetch(`${FLASH_BASE}/search?query=weth&chain=base&limit=1`, {
      headers: { "x-definitive-api-key": key },
      cache: "no-store",
    });
    const body = await res.json().catch(() => null);
    const asset = body?.assets?.[0];
    return Response.json({
      ok: res.ok,
      status: res.status,
      weth: asset?.symbol,
      price: asset?.price,
      riskFlagged: asset?.riskFlagged,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "flash unreachable" },
      { status: 502 },
    );
  }
}
