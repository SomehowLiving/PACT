import { addStrategy, proposeToAll, snapshot } from "@/lib/store";
import { CHAINS } from "@/lib/chains";
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

  const cfg = CHAINS[chain];
  const strategy = addStrategy({
    leader: body.leader,
    chain,
    targetAsset: body.targetAsset ?? cfg.weth,
    contraAsset: body.contraAsset ?? cfg.usdc,
    side,
    orderType,
    qty,
    durationSeconds: orderType === "twap" ? body.durationSeconds ?? 600 : undefined,
    limitNotionalPrice: body.limitNotionalPrice,
    triggers,
  });

  const copies = await proposeToAll(strategy.id);
  return Response.json({ strategy, copies });
}
