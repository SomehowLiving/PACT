"use client";

import { leaderName } from "@/components/ui";
import type { OrderType, Strategy } from "@/lib/types";
import { isDemoAddress, tokenSymbol } from "@/lib/views";
import { useSyncExternalStore } from "react";

/*
 * Share to X: an intent link (no X API, no keys) that opens X's composer with text built only
 * from the plan's own fields. Nothing here is estimated or promised.
 */

/** X counts a link as 23 characters plus a space, so 256 keeps text + URL within 280. */
export const SHARE_TEXT_MAX = 256;

/** X's web intent for a new post, with the text and the link URL-encoded. */
export function xIntentUrl({ text, url }: { text: string; url?: string }) {
  const params = new URLSearchParams({ text });
  if (url) params.set("url", url);
  // URLSearchParams writes spaces as "+"; X accepts both, %20 is the unambiguous form.
  return `https://x.com/intent/post?${params.toString().replace(/\+/g, "%20")}`;
}

export type SharePlan = Pick<
  Strategy,
  "leader" | "side" | "orderType" | "targetAsset" | "entryReferencePrice" | "limitNotionalPrice" | "stopLossPrice" | "takeProfitPrice" | "demoCase"
>;

const HOW: Record<OrderType, string> = {
  market: "at market",
  limit: "via limit",
  twap: "via TWAP",
  stop: "via stop order",
  "stop-loss": "via stop-loss order",
  "take-profit": "via take-profit order",
};

const price = (v?: string) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n > 0 ? n : undefined;
};

const dollars = (n: number) =>
  `$${n.toLocaleString("en-US", Number.isInteger(n) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 4 : 2 })}`;

/** Reward:risk only when entry, stop and target are all present and in the right order for the side. */
export function planRewardRisk(plan: Pick<SharePlan, "side" | "entryReferencePrice" | "limitNotionalPrice" | "stopLossPrice" | "takeProfitPrice">) {
  const entry = price(plan.entryReferencePrice ?? plan.limitNotionalPrice);
  const stop = price(plan.stopLossPrice);
  const target = price(plan.takeProfitPrice);
  if (entry === undefined || stop === undefined || target === undefined) return undefined;
  if (plan.side === "buy" && stop < entry && entry < target) return (target - entry) / (entry - stop);
  if (plan.side === "sell" && target < entry && entry < stop) return (entry - target) / (stop - entry);
  return undefined;
}

/** Seeded demo leaders (0x1111…) and seeded demo cases are labelled as such. */
export function isDemoPlan(plan: Pick<SharePlan, "leader" | "demoCase">) {
  return isDemoAddress(plan.leader) || !!plan.demoCase;
}

/** The post a leader (or anyone) shares for one plan: real fields only, ≤ SHARE_TEXT_MAX chars. */
export function planShareText(plan: SharePlan) {
  const symbol = tokenSymbol(plan.targetAsset);
  const asset = symbol === "WETH" ? "ETH" : symbol;
  const entry = price(plan.entryReferencePrice ?? plan.limitNotionalPrice);
  const stop = price(plan.stopLossPrice);
  const target = price(plan.takeProfitPrice);
  const levels = [
    entry !== undefined ? `entry ${dollars(entry)}` : "",
    stop !== undefined ? `stop ${dollars(stop)}` : "",
    target !== undefined ? `target ${dollars(target)}` : "",
  ].filter(Boolean);
  const rr = planRewardRisk(plan);
  const head =
    `${isDemoPlan(plan) ? "[Demo] " : ""}${leaderName(plan.leader)}'s ${asset} plan on PACT: ${plan.side} ${HOW[plan.orderType] ?? `via ${plan.orderType}`}` +
    (levels.length ? `, ${levels.join(" · ")}` : "") +
    (rr !== undefined ? ` (R:R ${rr.toFixed(1)})` : "") +
    ".";
  for (const tail of [
    " Copy it under your own rules — sizing, caps and your own stop/target on @DefinitiveFi Flash.",
    " Copy it under your own rules on @DefinitiveFi Flash.",
    "",
  ]) {
    if (head.length + tail.length <= SHARE_TEXT_MAX) return head + tail;
  }
  return `${head.slice(0, SHARE_TEXT_MAX - 1)}…`;
}

const noSubscribe = () => () => {};

/** A secondary pill that opens X's composer in a new tab. `url` may be a path ("/plans/…"). */
export function ShareToX({ text, url, label = "Share to X", className = "" }: { text: string; url: string; label?: string; className?: string }) {
  // The page origin is only known in the browser; the server snapshot leaves the path relative.
  const origin = useSyncExternalStore(
    noSubscribe,
    () => window.location.origin,
    () => "",
  );
  const absolute = url.startsWith("/") ? `${origin}${url}` : url;
  return (
    <a
      href={xIntentUrl({ text, url: absolute })}
      target="_blank"
      rel="noopener noreferrer"
      className={`btn h-8 px-3 text-[12px] ${className}`}
      title="Open a post on X with this plan's numbers and link"
    >
      {label}
    </a>
  );
}
