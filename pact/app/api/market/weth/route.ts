import { baseWethUsdcMarket, isTimeframe } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const tf = new URL(req.url).searchParams.get("tf");
  try {
    return Response.json(await baseWethUsdcMarket(isTimeframe(tf) ? tf : "5m"), {
      headers: { "cache-control": "public, max-age=60, s-maxage=60" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "market data unavailable" },
      { status: 503 },
    );
  }
}
