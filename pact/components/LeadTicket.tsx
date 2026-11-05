"use client";

import { useDesk } from "@/components/useDesk";
import { shortAddr, usd } from "@/lib/format";
import { CHAIN_IDS } from "@/lib/chains";
import type { Chain, OrderType, Side } from "@/lib/types";
import { useState } from "react";
import { useAccount } from "wagmi";

export function LeadTicket() {
  const { address } = useAccount();
  const { state, refresh } = useDesk();
  const [side, setSide] = useState<Side>("buy");
  const [orderType, setOrderType] = useState<OrderType>("twap");
  const [qty, setQty] = useState("25");
  const [duration, setDuration] = useState("600");
  const [twapBucketCount, setTwapBucketCount] = useState("6");
  const [chain, setChain] = useState<Chain>("base");
  const [limitPrice, setLimitPrice] = useState("");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [title, setTitle] = useState("ETH accumulation pact");
  const [thesis, setThesis] = useState(
    "Accumulate gradually while the entry window remains valid.",
  );
  const [invalidation, setInvalidation] = useState(
    "Do not chase outside the stated entry window.",
  );
  const [capacity, setCapacity] = useState("60");
  const [expiryMinutes, setExpiryMinutes] = useState("240");
  const [entryReferencePrice, setEntryReferencePrice] = useState("2500");
  const [stopLossPrice, setStopLossPrice] = useState("2450");
  const [takeProfitPrice, setTakeProfitPrice] = useState("2600");
  const [leaderFlashOrderId, setLeaderFlashOrderId] = useState("");
  const [protectionHours, setProtectionHours] = useState("24");
  const exit = orderType === "take-profit" || orderType === "stop-loss";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function publish(payload?: {
    orderType: OrderType;
    qty: string;
    durationSeconds?: number;
  }) {
    if (!address) {
      setError("connect the leader wallet");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        leader: address,
        title,
        thesis,
        invalidation,
        maxFollowerNotionalUsd: Number(capacity),
        entryReferencePrice: entryReferencePrice || undefined,
        stopLossPrice: stopLossPrice || undefined,
        takeProfitPrice: takeProfitPrice || undefined,
        protectionExpiresAt: new Date(
          Date.now() + Number(protectionHours || 0) * 60 * 60 * 1_000,
        ).toISOString(),
        leaderFlashOrderId: leaderFlashOrderId || undefined,
        expiresAt: new Date(
          Date.now() + Number(expiryMinutes || 0) * 60 * 1_000,
        ).toISOString(),
        chain,
        side: exit ? "sell" : side,
        limitNotionalPrice:
          ["limit", "twap"].includes(payload?.orderType ?? orderType) && limitPrice
            ? limitPrice
            : undefined,
        triggerPrice: exit ? triggerPrice : undefined,
        orderType: payload?.orderType ?? orderType,
        qty: payload?.qty ?? qty,
        durationSeconds:
          (payload?.orderType ?? orderType) === "twap"
            ? Number(payload?.durationSeconds ?? duration)
            : undefined,
        twapBucketCount:
          (payload?.orderType ?? orderType) === "twap"
            ? Number(twapBucketCount)
            : undefined,
      };
      const res = await fetch("/api/strategies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "publish failed");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "publish failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="glass rounded-[32px] p-6 md:p-8">
        <div className="text-[11px] uppercase tracking-[0.22em] text-mute">
          intent
        </div>
        <h1 className="mt-2 font-[family-name:var(--font-serif)] text-[36px] italic leading-tight">
          publish a Flash-shaped order
        </h1>
        <p className="mt-2 max-w-md text-sm text-mute">
          Followers copy the intent, not your key. Policy on their desk can still
          BLOCK.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void publish({ orderType: "twap", qty: "25", durationSeconds: 600 })
            }
            className="btn-cream rounded-full px-4 py-2 text-sm"
          >
            demo ALLOW · TWAP $25
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void publish({ orderType: "market", qty: "500" })}
            className="rounded-full bg-rose/15 px-4 py-2 text-sm text-rose"
          >
            demo BLOCK · market $500
          </button>
        </div>

        <div className="mt-8 grid gap-4">
          <label className="text-[12px] text-mute">
            pact plan title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-2xl bg-black/30 px-4 py-3 hairline text-ink outline-none"
            />
          </label>
          <label className="text-[12px] text-mute">
            thesis
            <textarea
              value={thesis}
              onChange={(e) => setThesis(e.target.value)}
              rows={2}
              className="mt-1 w-full resize-none rounded-2xl bg-black/30 px-4 py-3 hairline text-ink outline-none"
            />
          </label>
          <label className="text-[12px] text-mute">
            pair
            <div className="mt-1 flex items-center justify-between rounded-2xl bg-black/30 px-4 py-3 hairline text-ink">
              <span>WETH / USDC</span>
              <span className="text-[11px] uppercase tracking-widest text-mute">
                {chain}
              </span>
            </div>
          </label>
          <Seg
            label="chain"
            value={chain}
            options={CHAIN_IDS}
            onChange={(v) => setChain(v as Chain)}
          />

          {exit ? null : (
            <Seg
              label="side"
              value={side}
              options={["buy", "sell"]}
              onChange={(v) => setSide(v as Side)}
            />
          )}
          <Seg
            label="type"
            value={orderType}
            options={["twap", "limit", "market", "take-profit", "stop-loss"]}
            onChange={(v) => setOrderType(v as OrderType)}
          />

          <label className="text-[12px] text-mute">
            qty {side === "buy" && !exit ? "(USDC spent)" : "(WETH sold)"}
            <input
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="mt-1 w-full rounded-2xl bg-black/30 px-4 py-3 hairline text-ink outline-none"
            />
          </label>

          {orderType === "limit" || orderType === "twap" ? (
            <label className="text-[12px] text-mute">
              execution price bound (USD per WETH, optional)
              <input
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                placeholder="2300"
                className="mt-1 w-full rounded-2xl bg-black/30 px-4 py-3 hairline text-ink outline-none"
              />
              {orderType === "twap" ? (
                <span className="mt-1 block text-[10px] text-mute">
                  This is the leader’s bound. Each follower may tighten it using their entry-drift policy.
                </span>
              ) : null}
            </label>
          ) : null}

          {!exit && orderType !== "limit" ? (
            <label className="text-[12px] text-mute">
              reference entry (USD per WETH)
              <input
                value={entryReferencePrice}
                onChange={(e) => setEntryReferencePrice(e.target.value)}
                placeholder="2500"
                className="mt-1 w-full rounded-2xl bg-black/30 px-4 py-3 hairline text-ink outline-none"
              />
              <span className="mt-1 block text-[10px] text-mute">
                PACT waits if the follower’s Flash quote drifts beyond their entry band.
              </span>
            </label>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-[12px] text-mute">
              plan stop (USD per WETH)
              <input
                value={stopLossPrice}
                onChange={(e) => setStopLossPrice(e.target.value)}
                placeholder={side === "buy" && !exit ? "2450" : "2550"}
                className="mt-1 w-full rounded-2xl bg-black/30 px-4 py-3 hairline text-ink outline-none"
              />
            </label>
            <label className="text-[12px] text-mute">
              plan target (USD per WETH)
              <input
                value={takeProfitPrice}
                onChange={(e) => setTakeProfitPrice(e.target.value)}
                placeholder={side === "buy" && !exit ? "2600" : "2400"}
                className="mt-1 w-full rounded-2xl bg-black/30 px-4 py-3 hairline text-ink outline-none"
              />
            </label>
          </div>
          <p className="-mt-2 text-[10px] text-mute">
            PACT requires a valid entry, stop, target, and at least 1.5R before followers can
            receive this plan. These are plan terms, not live Flash brackets yet.
          </p>

          {exit ? (
            <label className="text-[12px] text-mute">
              trigger price (USD per WETH) —{" "}
              {orderType === "take-profit" ? "sells when price rises to it" : "sells when price falls to it"}
              <input
                value={triggerPrice}
                onChange={(e) => setTriggerPrice(e.target.value)}
                placeholder={orderType === "take-profit" ? "3000" : "2000"}
                className="mt-1 w-full rounded-2xl bg-black/30 px-4 py-3 hairline text-ink outline-none"
              />
            </label>
          ) : null}

          {orderType === "twap" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-[12px] text-mute">
                duration seconds (minimum 300)
                <input
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className="mt-1 w-full rounded-2xl bg-black/30 px-4 py-3 hairline text-ink outline-none"
                />
              </label>
              <label className="text-[12px] text-mute">
                slices (2–2560)
                <input
                  value={twapBucketCount}
                  onChange={(e) => setTwapBucketCount(e.target.value)}
                  inputMode="numeric"
                  className="mt-1 w-full rounded-2xl bg-black/30 px-4 py-3 hairline text-ink outline-none"
                />
              </label>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-[12px] text-mute">
              plan capacity (USDC per follower)
              <input
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                inputMode="decimal"
                className="mt-1 w-full rounded-2xl bg-black/30 px-4 py-3 hairline text-ink outline-none"
              />
            </label>
            <label className="text-[12px] text-mute">
              copy window (minutes)
              <input
                value={expiryMinutes}
                onChange={(e) => setExpiryMinutes(e.target.value)}
                inputMode="numeric"
                className="mt-1 w-full rounded-2xl bg-black/30 px-4 py-3 hairline text-ink outline-none"
              />
            </label>
            <label className="text-[12px] text-mute">
              Flash protection (hours)
              <input
                value={protectionHours}
                onChange={(e) => setProtectionHours(e.target.value)}
                inputMode="numeric"
                className="mt-1 w-full rounded-2xl bg-black/30 px-4 py-3 hairline text-ink outline-none"
              />
            </label>
          </div>
          <label className="text-[12px] text-mute">
            invalidation / protection
            <textarea
              value={invalidation}
              onChange={(e) => setInvalidation(e.target.value)}
              rows={2}
              className="mt-1 w-full resize-none rounded-2xl bg-black/30 px-4 py-3 hairline text-ink outline-none"
            />
          </label>
          <label className="text-[12px] text-mute">
            your Flash order ID (optional proof)
            <input
              value={leaderFlashOrderId}
              onChange={(e) => setLeaderFlashOrderId(e.target.value)}
              placeholder="Paste an existing Flash order ID"
              className="mt-1 w-full rounded-2xl bg-black/30 px-4 py-3 hairline text-ink outline-none"
            />
            <span className="mt-1 block text-[10px] text-mute">
              PACT verifies that Flash recognizes this order for your wallet. It does not yet
              prove every plan term matches the order.
            </span>
          </label>

          <button
            type="button"
            disabled={busy}
            onClick={() => void publish()}
            className="mt-2 rounded-full bg-white/10 py-3 text-sm"
          >
            {busy ? "publishing…" : "publish intent"}
          </button>
          {error ? <p className="text-sm text-rose">{error}</p> : null}
        </div>
      </section>

      <section className="glass rounded-[32px] p-6">
        <div className="text-[13px] text-mute">open intents</div>
        <div className="mt-4 space-y-3">
          {(state?.strategies ?? []).length === 0 ? (
            <p className="text-sm text-mute">Nothing on the tape yet.</p>
          ) : (
            state?.strategies.map((s) => (
              <div key={s.id} className="rounded-2xl bg-black/25 p-4 hairline">
                <div className="flex items-center justify-between">
                  <span className="text-sm">{s.title}</span>
                  <span className="num text-gold">
                    {s.side === "buy" ? usd(Number(s.qty)) : `${s.qty} WETH`}
                  </span>
                </div>
                <div className="mt-1 font-mono text-[11px] text-mute">
                  {s.orderType} {s.side} · {s.chain} · {shortAddr(s.leader)}
                  {s.maxFollowerNotionalUsd ? ` · cap ${usd(s.maxFollowerNotionalUsd)}` : ""}
                </div>
                <p className="mt-2 text-[12px] text-mute">{s.thesis}</p>
                <div className="mt-2 font-mono text-[11px] text-mute">
                  {s.durationSeconds ? ` · ${s.durationSeconds}s` : ""}
                  {s.triggers?.[0] ? ` · trigger $${s.triggers[0].notionalPrice}` : ""}
                  {s.limitNotionalPrice ? ` · limit $${s.limitNotionalPrice}` : ""}
                  {s.entryReferencePrice ? ` · entry $${s.entryReferencePrice}` : ""}
                  {s.stopLossPrice ? ` · stop $${s.stopLossPrice}` : ""}
                  {s.takeProfitPrice ? ` · target $${s.takeProfitPrice}` : ""}
                  {s.protectionExpiresAt ? " · Flash bracket requested" : ""}
                </div>
                <div className="mt-2 text-[10px] uppercase tracking-widest text-gold">
                  {(s.leaderPlanGrade ?? "INCOMPLETE").toLowerCase()} plan
                  {" · "}
                  {(s.leaderEvidenceStatus ?? "UNVERIFIED").toLowerCase()} execution
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function Seg({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="text-[12px] text-mute">{label}</div>
      <div className="mt-1 flex rounded-2xl bg-black/30 p-1 hairline">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className={`flex-1 rounded-xl py-2 text-[12px] ${
              value === o ? "bg-white/10 text-ink" : "text-mute"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
