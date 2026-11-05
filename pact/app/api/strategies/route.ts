import { addStrategy, proposeToAll, snapshot } from "@/lib/store";
import { CHAINS } from "@/lib/chains";
import { getOrder } from "@/lib/flash";
import { assessLeaderPlan } from "@/lib/policy";
import type { Chain, OrderType, Side, Trigger } from "@/lib/types";

export const dynamic = "force-dynamic";

const ORDER_TYPES: OrderType[] = ["market", "limit", "twap", "stop", "stop-loss", "take-profit"];

export async function GET() {
  return Response.json({ strategies: snapshot().strategies });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    leader: `0x${string}`;
    chain?: Chain;
    side?: Side;
    orderType?: OrderType;
    qty?: string;
    durationSeconds?: number;
    limitNotionalPrice?: string;
    triggerPrice?: string;
    targetAsset?: `0x${string}`;
    contraAsset?: `0x${string}`;
    title?: string;
    thesis?: string;
    expiresAt?: string;
    invalidation?: string;
    maxFollowerNotionalUsd?: number;
    entryReferencePrice?: string;
    stopLossPrice?: string;
    takeProfitPrice?: string;
    protectionExpiresAt?: string;
    leaderFlashOrderId?: string;
  };

  if (!body.leader || !/^0x[a-fA-F0-9]{40}$/.test(body.leader)) {
    return Response.json({ error: "leader address required" }, { status: 400 });
  }
  const chain: Chain = body.chain ?? "base";
  if (!(chain in CHAINS)) {
    return Response.json({ error: "unsupported chain" }, { status: 400 });
  }
  const orderType = body.orderType ?? "twap";
  if (!ORDER_TYPES.includes(orderType)) {
    return Response.json({ error: "unsupported order type" }, { status: 400 });
  }
  const qty = body.qty ?? "25";
  if (!(Number(qty) > 0)) {
    return Response.json({ error: "qty must be a positive number" }, { status: 400 });
  }
  const title = body.title?.trim() || "ETH accumulation pact";
  const thesis = body.thesis?.trim() || "A follower-specific Flash execution plan.";
  const expiry = body.expiresAt ? Date.parse(body.expiresAt) : Date.now() + 4 * 60 * 60 * 1_000;
  if (!Number.isFinite(expiry) || expiry <= Date.now()) {
    return Response.json({ error: "expiry must be in the future" }, { status: 400 });
  }
  if (
    body.maxFollowerNotionalUsd !== undefined &&
    !(body.maxFollowerNotionalUsd > 0)
  ) {
    return Response.json({ error: "plan capacity must be positive" }, { status: 400 });
  }
  // Exit orders are sells of the target token with a price trigger (Flash trigger-orders).
  let side: Side = body.side ?? "buy";
  let triggers: Trigger[] | undefined;
  if (orderType === "take-profit" || orderType === "stop-loss") {
    if (!(Number(body.triggerPrice) > 0)) {
      return Response.json({ error: "trigger price required" }, { status: 400 });
    }
    side = "sell";
    triggers = [
      {
        notionalPrice: String(body.triggerPrice),
        triggerType: orderType === "take-profit" ? "upper" : "lower",
      },
    ];
  }
  if (orderType === "limit" && !(Number(body.limitNotionalPrice) > 0)) {
    return Response.json({ error: "limit price required" }, { status: 400 });
  }

  const entryReferencePrice =
    body.entryReferencePrice?.trim() ||
    (orderType === "limit" ? body.limitNotionalPrice : undefined);
  const leaderPlan = assessLeaderPlan(
    {
      side,
      entryReferencePrice,
      stopLossPrice: body.stopLossPrice?.trim(),
      takeProfitPrice: body.takeProfitPrice?.trim(),
    },
    1.5,
  );
  if (leaderPlan.grade === "INCOMPLETE") {
    return Response.json(
      {
        error: "leader plan needs a valid entry, stop, and target",
        reasons: leaderPlan.reasons,
      },
      { status: 400 },
    );
  }
  const protectionExpiry = body.protectionExpiresAt
    ? Date.parse(body.protectionExpiresAt)
    : Date.now() + 24 * 60 * 60 * 1_000;
  if (!Number.isFinite(protectionExpiry) || protectionExpiry <= Date.now()) {
    return Response.json({ error: "protection expiry must be in the future" }, { status: 400 });
  }

  let leaderEvidenceStatus: "UNVERIFIED" | "VERIFIED" = "UNVERIFIED";
  const leaderFlashOrderId = body.leaderFlashOrderId?.trim() || undefined;
  if (leaderFlashOrderId) {
    try {
      await getOrder(leaderFlashOrderId, body.leader);
      leaderEvidenceStatus = "VERIFIED";
    } catch (e) {
      return Response.json(
        {
          error: "could not verify this Flash order for the publishing leader",
          detail: e instanceof Error ? e.message : "Flash verification failed",
        },
        { status: 400 },
      );
    }
  }

  const cfg = CHAINS[chain];
  const strategy = addStrategy({
    leader: body.leader,
    title,
    thesis,
    expiresAt: new Date(expiry).toISOString(),
    invalidation: body.invalidation?.trim() || undefined,
    maxFollowerNotionalUsd: body.maxFollowerNotionalUsd,
    entryReferencePrice,
    stopLossPrice: body.stopLossPrice?.trim(),
    takeProfitPrice: body.takeProfitPrice?.trim(),
    protectionExpiresAt: new Date(protectionExpiry).toISOString(),
    leaderFlashOrderId,
    chain,
    targetAsset: body.targetAsset ?? cfg.weth,
    contraAsset: body.contraAsset ?? cfg.usdc,
    side,
    orderType,
    qty,
    durationSeconds: orderType === "twap" ? body.durationSeconds ?? 600 : undefined,
    limitNotionalPrice: body.limitNotionalPrice,
    triggers,
  }, leaderEvidenceStatus);

  const copies = await proposeToAll(strategy.id);
  return Response.json({ strategy, copies });
}
