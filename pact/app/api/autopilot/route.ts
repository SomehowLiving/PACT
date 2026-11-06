import { createGrant, currentGrant, grantsFor, publicGrant, revokeCall, revokeGrant, setupCalls } from "@/lib/autopilot";
import { sessionContracts } from "@/lib/session-account";
import { requireOwner } from "@/lib/session";
import type { Chain } from "@/lib/types";

export const dynamic = "force-dynamic";

const CHAINS_OK: Chain[] = ["base", "arc"];

/** A follower's Autopilot grants (never the session key itself) and the calls to set one up. */
export async function GET(req: Request) {
  const follower = new URL(req.url).searchParams.get("follower") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(follower)) return Response.json({ error: "follower required" }, { status: 400 });
  const all = await Promise.all(grantsFor(follower).map((g) => publicGrant(g)));
  const current = currentGrant(follower, "base");
  return Response.json({
    contracts: { base: sessionContracts("base"), arc: sessionContracts("arc") },
    grants: all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    setup: current ? setupCalls(current) : [],
    revoke: current ? revokeCall(current) : null,
  });
}

/** Create a session grant for the signed-in follower: a fresh key, a scope, an expiry. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    follower?: `0x${string}`;
    chain?: Chain;
    hours?: number;
    maxPerOrderUsd?: number;
    maxDailyUsd?: number;
  };
  if (!body.follower) return Response.json({ error: "follower required" }, { status: 400 });
  const denied = requireOwner(req, body.follower);
  if (denied) return denied;
  const chain = body.chain ?? "base";
  const hours = Number(body.hours);
  const perOrder = Number(body.maxPerOrderUsd);
  const daily = Number(body.maxDailyUsd);
  if (!CHAINS_OK.includes(chain) || !(hours > 0 && hours <= 24 * 30) || !(perOrder > 0 && perOrder <= 10_000) || !(daily >= perOrder && daily <= 50_000)) {
    return Response.json({ error: "expiry up to 30 days, a per-order cap up to $10,000 and a daily cap at least the per-order cap" }, { status: 400 });
  }
  const grant = await createGrant({ follower: body.follower, chain, hours, maxPerOrderUsd: perOrder, maxDailyUsd: daily });
  return Response.json({ grant: await publicGrant(grant), setup: setupCalls(grant) });
}

/** Revoke: PACT stops signing now; the returned call revokes the key on chain. */
export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { follower?: `0x${string}`; grantId?: string };
  if (!body.follower || !body.grantId) return Response.json({ error: "follower and grantId required" }, { status: 400 });
  const denied = requireOwner(req, body.follower);
  if (denied) return denied;
  const grant = revokeGrant(body.follower, body.grantId);
  if (!grant) return Response.json({ error: "unknown grant" }, { status: 404 });
  return Response.json({ grant: await publicGrant(grant), revoke: revokeCall(grant) });
}
