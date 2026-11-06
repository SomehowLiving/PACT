import { publicWorldConfig, verifiedLeaders } from "@/lib/world";

export const dynamic = "force-dynamic";

/** World ID configuration the browser needs (never the signing key) and the verified leaders. */
export async function GET() {
  return Response.json({ ...publicWorldConfig(), verified: verifiedLeaders() });
}
