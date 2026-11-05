import { baseWethUsdcMarket } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await baseWethUsdcMarket(), {
      headers: { "cache-control": "public, max-age=60, s-maxage=60" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "market data unavailable" },
      { status: 503 },
    );
  }
}
