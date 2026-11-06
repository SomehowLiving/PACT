import { CHAINS } from "@/lib/chains";
import { executionMetrics, getBalances, postQuote, quoteRequest } from "@/lib/flash";
import { bracketPriceFloor, verifyBracketSigning, verifySigning } from "@/lib/guard";
import { DEFAULT_MAX_EXECUTION_COST } from "@/lib/policy";
import { policyFor } from "@/lib/store";

export const dynamic = "force-dynamic";

type Line = { id: string; label: string; level: "ok" | "warn" | "fail"; detail: string };

// Flash's documented public playground key. Fine for testing; a real run should use PACT's own.
const PLAYGROUND_PREFIX = "dpka_513a2bd7";
// Gas for two approvals on Base. Generous: each approval costs well under a cent.
const MIN_ETH = 0.0002;

/**
 * Live-run preflight for one follower wallet: is the setup and this wallet ready for a real,
 * follower-signed Base TWAP with protection? Reads balances and asks Flash for a quote. Never
 * places an order and never asks for a signature.
 *
 *   GET /api/preflight?funder=0x…&qty=25&buckets=4&duration=600[&stop=2100&target=2450]
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const funder = url.searchParams.get("funder") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(funder)) return Response.json({ error: "funder address required" }, { status: 400 });
  const qty = url.searchParams.get("qty") ?? "25";
  const buckets = Number(url.searchParams.get("buckets") ?? 4);
  const duration = Number(url.searchParams.get("duration") ?? 600);
  const lines: Line[] = [];
  const add = (id: string, label: string, level: Line["level"], detail: string) => lines.push({ id, label, level, detail });
  const { weth, usdc } = CHAINS.base;

  const key = process.env.FLASH_API_KEY ?? "";
  add(
    "key",
    "Flash API key",
    !key ? "fail" : key.startsWith(PLAYGROUND_PREFIX) ? "warn" : "ok",
    !key
      ? "FLASH_API_KEY missing"
      : key.startsWith(PLAYGROUND_PREFIX)
        ? "public playground key: fees go to Definitive's vault and orders share its portfolio"
        : "integrator key",
  );
  const vault = process.env.NEXT_PUBLIC_FLASH_VAULT;
  add("vault", "Fee vault pinned", vault ? "ok" : "warn", vault ?? "set NEXT_PUBLIC_FLASH_VAULT so the guard pins it");

  try {
    const { balances = [] } = await getBalances(funder);
    const onBase = balances.filter((b) => b.chain === "base");
    const usdcBal = Number(onBase.find((b) => b.address?.toLowerCase() === usdc.toLowerCase())?.balance ?? 0);
    const ethBal = Number(onBase.find((b) => b.isNative)?.balance ?? 0);
    add("usdc", "USDC on Base", usdcBal >= Number(qty) ? "ok" : "fail", `${usdcBal} USDC, need ${qty}`);
    add("eth", "ETH on Base for approvals", ethBal >= MIN_ETH ? "ok" : "fail", `${ethBal} ETH, need about ${MIN_ETH}`);
  } catch (e) {
    add("balances", "Wallet balances", "warn", e instanceof Error ? e.message : "could not read balances");
  }

  let quoteSummary: Record<string, unknown> | undefined;
  try {
    // A $1 market quote gives the current mark, to place default protection levels around it.
    const probe = await postQuote(
      quoteRequest({ targetAsset: weth, contraAsset: usdc, side: "buy", qty: "1", orderType: "market", funderAddress: funder }),
    ).catch(() => undefined);
    const mark = probe ? Number(executionMetrics(probe, "buy").executionPrice) : undefined;
    const stop = url.searchParams.get("stop") ?? (mark ? String(Math.round(mark * 0.95)) : "0");
    const target = url.searchParams.get("target") ?? (mark ? String(Math.round(mark * 1.1)) : "0");
    const request = quoteRequest({
      targetAsset: weth,
      contraAsset: usdc,
      side: "buy",
      qty,
      orderType: "twap",
      funderAddress: funder,
      durationSeconds: duration,
      twapBucketCount: buckets,
      attachedBracket: {
        takeProfit: { notionalPrice: target },
        stopLoss: { notionalPrice: stop },
        expireTime: new Date(Date.now() + 24 * 3_600_000).toISOString(),
      },
    });
    const quote = await postQuote(request);
    const m = executionMetrics(quote, "buy");
    const budget = Number(policyFor(funder as `0x${string}`).maxExecutionCost ?? DEFAULT_MAX_EXECUTION_COST);
    const cost = Number(m.costRatio);
    add(
      "cost",
      "Execution cost within budget",
      Number.isFinite(cost) && cost <= budget ? "ok" : "fail",
      `fees $${Number(m.feeNotional).toFixed(3)} = ${(cost * 100).toFixed(2)}% of $${qty} (budget ${(budget * 100).toFixed(1)}%)`,
    );
    const entry = verifySigning({
      chain: "base",
      follower: funder,
      side: "buy",
      targetAsset: weth,
      contraAsset: usdc,
      qty,
      expectedVault: vault || undefined,
      quote: quote.evm ?? {},
    });
    const protection = verifyBracketSigning({
      chain: "base",
      follower: funder,
      targetAsset: weth,
      contraAsset: usdc,
      entryQty: qty,
      priceFloor: bracketPriceFloor({ stopLossPrice: stop }),
      signedMaxFromAmount: quote.attachedBracket?.signedMaxFromAmount,
      expectedVault: vault || undefined,
      quote: quote.attachedBracket?.evm ?? {},
    });
    const checks = [...entry.checks, ...protection.checks];
    const fails = checks.filter((c) => c.level === "fail");
    add(
      "guard",
      "Guard on Flash's real payloads",
      fails.length ? "fail" : "ok",
      fails.length ? fails.map((c) => c.id).join(", ") : `${checks.length} checks, none failing`,
    );
    quoteSummary = {
      qty,
      buckets,
      durationSeconds: request.durationSeconds,
      stop,
      target,
      marketPrice: m.executionPrice,
      allInPrice: m.allInPrice,
      feeUsd: m.feeNotional,
      costRatio: m.costRatio,
      approvalsNeeded: [quote.evm?.approveTx ? "USDC → Permit2" : null, quote.attachedBracket?.evm?.approveTx ? "WETH → Permit2" : null].filter(Boolean),
      signatures: [
        quote.evm?.permitTypedData ? "USDC permit" : null,
        "entry order",
        quote.attachedBracket?.evm?.permitTypedData ? "WETH permit" : null,
        "protection order",
      ].filter(Boolean),
    };
  } catch (e) {
    add("quote", "Flash quote for this run", "fail", e instanceof Error ? e.message : "quote failed");
  }

  const ready = !lines.some((l) => l.level === "fail");
  return Response.json({ ready, funder, lines, quote: quoteSummary });
}
