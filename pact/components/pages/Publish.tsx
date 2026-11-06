"use client";

import { useDeskContext } from "@/components/DeskContext";
import { TradingChart } from "@/components/TradingChart";
import { Addr, Empty, KV, LayerTag, PageHeader, Panel, Segmented, StatusBadge, type Tone } from "@/components/ui";
import { CHAIN_IDS } from "@/lib/chains";
import { usd } from "@/lib/format";
import { assessLeaderPlan } from "@/lib/policy";
import type { Chain, LeaderPlanGrade, OrderType, Side } from "@/lib/types";
import { isExpired, pairLabel, relativeTime } from "@/lib/views";
import { useMemo, useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api";

const GRADE_TONE: Record<LeaderPlanGrade, Tone> = { DISCIPLINED: "good", CAUTION: "warn", INCOMPLETE: "bad" };
const GRADE_ICON: Record<LeaderPlanGrade, string> = { DISCIPLINED: "●", CAUTION: "!", INCOMPLETE: "✕" };

function Field({ label, unit, hint, children }: { label: string; unit?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="flex items-baseline justify-between gap-2 text-[11.5px] text-mute">
        {label}
        {unit ? <span className="text-[11px] text-mute/80">{unit}</span> : null}
      </span>
      <span className="mt-1 block">{children}</span>
      {hint ? <span className="mt-1 block text-[10.5px] leading-snug text-mute">{hint}</span> : null}
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-line px-4 py-3.5 first:border-t-0">
      <div className="label mb-2.5">{title}</div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

export function Publish() {
  const { state, refresh, address } = useDeskContext();
  const [side, setSide] = useState<Side>("buy");
  const [orderType, setOrderType] = useState<OrderType>("twap");
  const [qty, setQty] = useState("25");
  const [duration, setDuration] = useState("600");
  const [twapBucketCount, setTwapBucketCount] = useState("6");
  const [chain, setChain] = useState<Chain>("base");
  const [limitPrice, setLimitPrice] = useState("");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [title, setTitle] = useState("ETH accumulation pact");
  const [thesis, setThesis] = useState("Accumulate gradually while the entry window remains valid.");
  const [invalidation, setInvalidation] = useState("Do not chase outside the stated entry window.");
  const [capacityUsd, setCapacityUsd] = useState("60");
  const [expiryMinutes, setExpiryMinutes] = useState("240");
  const [entryReferencePrice, setEntryReferencePrice] = useState("2500");
  const [stopLossPrice, setStopLossPrice] = useState("2450");
  const [takeProfitPrice, setTakeProfitPrice] = useState("2600");
  const [leaderFlashOrderId, setLeaderFlashOrderId] = useState("");
  const [protectionHours, setProtectionHours] = useState("24");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "mine">("all");
  const exit = orderType === "take-profit" || orderType === "stop-loss";
  const effectiveSide: Side = exit ? "sell" : side;

  const assessment = useMemo(
    () => assessLeaderPlan({ side: effectiveSide, entryReferencePrice, stopLossPrice, takeProfitPrice }),
    [effectiveSide, entryReferencePrice, stopLossPrice, takeProfitPrice],
  );
  const entry = Number(entryReferencePrice);
  const stopPct = entry > 0 && Number(stopLossPrice) > 0 ? (Math.abs(entry - Number(stopLossPrice)) / entry) * 100 : undefined;
  const targetPct = entry > 0 && Number(takeProfitPrice) > 0 ? (Math.abs(Number(takeProfitPrice) - entry) / entry) * 100 : undefined;

  async function publish(payload?: { orderType: OrderType; qty: string; durationSeconds?: number }) {
    if (!address) {
      setError("Connect the leader wallet to publish.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const type = payload?.orderType ?? orderType;
      const body = {
        leader: address,
        title,
        thesis,
        invalidation,
        maxFollowerNotionalUsd: Number(capacityUsd),
        entryReferencePrice: entryReferencePrice || undefined,
        stopLossPrice: stopLossPrice || undefined,
        takeProfitPrice: takeProfitPrice || undefined,
        protectionExpiresAt: new Date(Date.now() + Number(protectionHours || 0) * 60 * 60 * 1_000).toISOString(),
        leaderFlashOrderId: leaderFlashOrderId || undefined,
        expiresAt: new Date(Date.now() + Number(expiryMinutes || 0) * 60 * 1_000).toISOString(),
        chain,
        side: effectiveSide,
        limitNotionalPrice: ["limit", "twap"].includes(type) && limitPrice ? limitPrice : undefined,
        triggerPrice: exit ? triggerPrice : undefined,
        orderType: type,
        qty: payload?.qty ?? qty,
        durationSeconds: type === "twap" ? Number(payload?.durationSeconds ?? duration) : undefined,
        twapBucketCount: type === "twap" ? Number(twapBucketCount) : undefined,
      };
      const res = await apiFetch("/api/strategies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "publish failed");
      setNotice("Published. Followers who selected you can mirror it from Proposals.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "publish failed");
    } finally {
      setBusy(false);
    }
  }

  const plans = (state?.strategies ?? []).filter(
    (s) => tab === "all" || (address && s.leader.toLowerCase() === address.toLowerCase()),
  );

  return (
    <div>
      <PageHeader
        eyebrow="Leader"
        title="Publish a plan"
        description="Followers copy the plan, never your key. Each follower's own mandate can still scale, hold or decline it."
        actions={
          <>
            <button type="button" className="btn" disabled={busy} onClick={() => void publish({ orderType: "twap", qty: "25", durationSeconds: 600 })}>
              Demo · TWAP $25 (allowed)
            </button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void publish({ orderType: "market", qty: "500" })}>
              Demo · market $500 (declined)
            </button>
          </>
        }
      />

      <div className="grid gap-5 grid-cols-1 xl:grid-cols-[380px_minmax(0,1fr)]">
        {/* Order ticket */}
        <Panel title="Plan ticket" subtitle={address ? <>Leader <Addr value={address} /></> : "Connect the leader wallet"} className="xl:sticky xl:top-20 xl:self-start">
          <div className="grid grid-cols-2 gap-1 p-3">
            {(["buy", "sell"] as const).map((s) => (
              <button
                key={s}
                type="button"
                disabled={exit}
                onClick={() => setSide(s)}
                className={`rounded-lg py-2 text-[13px] font-semibold capitalize transition disabled:opacity-40 ${
                  effectiveSide === s
                    ? s === "buy"
                      ? "bg-[color-mix(in_oklab,var(--good)_22%,transparent)] text-good"
                      : "bg-[color-mix(in_oklab,var(--bad)_22%,transparent)] text-bad"
                    : "bg-panel-2 text-mute"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <Section title="Market">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pair">
                <div className="field flex items-center justify-between">
                  WETH/USDC <span className="label">{chain}</span>
                </div>
              </Field>
              <Field label="Chain">
                <select className="field" value={chain} onChange={(e) => setChain(e.target.value as Chain)}>
                  {CHAIN_IDS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Order type">
              <select className="field" value={orderType} onChange={(e) => setOrderType(e.target.value as OrderType)}>
                {(["twap", "limit", "market", "take-profit", "stop-loss"] as const).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Quantity" unit={effectiveSide === "buy" ? "USDC spent" : "WETH sold"}>
              <input className="field" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" />
            </Field>
            {orderType === "limit" || orderType === "twap" ? (
              <Field label="Execution price bound" unit="USD / WETH" hint="Optional. Each follower may tighten it with their entry-drift limit.">
                <input className="field" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} placeholder="2300" inputMode="decimal" />
              </Field>
            ) : null}
            {exit ? (
              <Field label="Trigger price" unit="USD / WETH" hint={orderType === "take-profit" ? "Sells when price rises to it." : "Sells when price falls to it."}>
                <input className="field" value={triggerPrice} onChange={(e) => setTriggerPrice(e.target.value)} placeholder={orderType === "take-profit" ? "3000" : "2000"} />
              </Field>
            ) : null}
            {orderType === "twap" ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Duration" unit="sec, ≥300">
                  <input className="field" value={duration} onChange={(e) => setDuration(e.target.value)} inputMode="numeric" />
                </Field>
                <Field label="Slices" unit="2–2560">
                  <input className="field" value={twapBucketCount} onChange={(e) => setTwapBucketCount(e.target.value)} inputMode="numeric" />
                </Field>
              </div>
            ) : null}
          </Section>
          <Section title="Plan levels">
            {!exit && orderType !== "limit" ? (
              <Field label="Reference entry" unit="USD / WETH">
                <input className="field" value={entryReferencePrice} onChange={(e) => setEntryReferencePrice(e.target.value)} inputMode="decimal" />
              </Field>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Stop" unit={stopPct !== undefined ? `−${stopPct.toFixed(2)}%` : undefined}>
                <input className="field" value={stopLossPrice} onChange={(e) => setStopLossPrice(e.target.value)} inputMode="decimal" />
              </Field>
              <Field label="Target" unit={targetPct !== undefined ? `+${targetPct.toFixed(2)}%` : undefined}>
                <input className="field" value={takeProfitPrice} onChange={(e) => setTakeProfitPrice(e.target.value)} inputMode="decimal" />
              </Field>
            </div>
          </Section>
          <Section title="Followers & window">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Capacity" unit="USDC">
                <input className="field" value={capacityUsd} onChange={(e) => setCapacityUsd(e.target.value)} inputMode="decimal" />
              </Field>
              <Field label="Window" unit="min">
                <input className="field" value={expiryMinutes} onChange={(e) => setExpiryMinutes(e.target.value)} inputMode="numeric" />
              </Field>
              <Field label="Bracket" unit="hours">
                <input className="field" value={protectionHours} onChange={(e) => setProtectionHours(e.target.value)} inputMode="numeric" />
              </Field>
            </div>
          </Section>
          <Section title="Thesis & evidence">
            <Field label="Title">
              <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Thesis">
              <textarea className="field resize-none" rows={2} value={thesis} onChange={(e) => setThesis(e.target.value)} />
            </Field>
            <Field label="Invalidation">
              <textarea className="field resize-none" rows={2} value={invalidation} onChange={(e) => setInvalidation(e.target.value)} />
            </Field>
            <Field label="Your Flash order ID" unit="optional" hint="PACT checks Flash finds this order under your wallet (ORDER_FOUND). It does not prove every plan term matches it.">
              <input className="field" value={leaderFlashOrderId} onChange={(e) => setLeaderFlashOrderId(e.target.value)} placeholder="Paste an existing Flash order ID" />
            </Field>
          </Section>
          <div className="border-t border-line p-4">
            <button
              type="button"
              disabled={busy || !address}
              onClick={() => void publish()}
              className={`btn w-full py-2.5 text-[13.5px] font-semibold ${effectiveSide === "buy" ? "btn-primary" : "btn-danger"}`}
            >
              {busy ? "Publishing…" : address ? `Publish ${effectiveSide} ${orderType} plan` : "Connect wallet to publish"}
            </button>
            {error ? <p className="mt-2 text-[12px] text-bad">{error}</p> : null}
            {notice ? <p className="mt-2 text-[12px] text-good">{notice}</p> : null}
          </div>
        </Panel>

        <div className="min-w-0 space-y-5">
          {/* Live preview */}
          <Panel className="overflow-hidden">
            <TradingChart
              entry={!exit && orderType !== "limit" ? entryReferencePrice : undefined}
              stop={stopLossPrice}
              target={takeProfitPrice}
              height={340}
            />
          </Panel>
          <Panel title="Plan quality preview" subtitle="What followers' policies will see" layer="policy" bodyClassName="grid gap-x-8 px-4 py-2 md:grid-cols-2">
            <dl>
              <KV
                k="Grade"
                v={
                  <StatusBadge tone={GRADE_TONE[assessment.grade]} icon={GRADE_ICON[assessment.grade]}>
                    {assessment.grade}
                  </StatusBadge>
                }
              />
              <KV k="Reward : risk" v={assessment.rewardRisk !== undefined ? `${assessment.rewardRisk.toFixed(2)}R` : "—"} />
              <KV k="Risk per WETH" v={entry > 0 && Number(stopLossPrice) > 0 ? usd(Math.abs(entry - Number(stopLossPrice))) : "—"} />
            </dl>
            <dl>
              <KV k="Structure" v={effectiveSide === "buy" ? "stop < entry < target" : "target < entry < stop"} />
              <KV k="Issues" v={assessment.reasons.length ? assessment.reasons.map((r) => r.toLowerCase().replaceAll("_", " ")).join(", ") : "none"} />
              <KV k="Evidence" v={leaderFlashOrderId ? "checked with Flash on publish" : "unverified"} />
            </dl>
          </Panel>

          {/* Published plans */}
          <Panel
            title="Published plans"
            subtitle="Every plan on this PACT store"
            actions={
              <Segmented
                value={tab}
                onChange={setTab}
                options={[
                  { value: "all", label: "All", count: state?.strategies.length ?? 0 },
                  { value: "mine", label: "Mine", count: address ? (state?.strategies ?? []).filter((s) => s.leader.toLowerCase() === address.toLowerCase()).length : 0 },
                ]}
              />
            }
          >
            {plans.length ? (
              <div className="scroll-thin max-h-[520px] overflow-auto">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Plan</th>
                      <th>Leader</th>
                      <th>Type</th>
                      <th className="r">Size</th>
                      <th className="r">Entry</th>
                      <th className="r">Stop</th>
                      <th className="r">Target</th>
                      <th>Grade</th>
                      <th>Evidence</th>
                      <th>Window</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plans.map((s) => (
                      <tr key={s.id}>
                        <td className="max-w-[240px]">
                          <div className="truncate text-ink">{s.title}</div>
                          <div className="text-[11px] text-mute">{pairLabel(s)} · {s.chain}</div>
                        </td>
                        <td>
                          <Addr value={s.leader} />
                        </td>
                        <td className={s.side === "buy" ? "text-good" : "text-bad"}>
                          {s.side} <span className="text-mute">{s.orderType}</span>
                        </td>
                        <td className="r">{s.side === "buy" ? usd(Number(s.qty)) : `${s.qty} WETH`}</td>
                        <td className="r">{s.entryReferencePrice ?? "—"}</td>
                        <td className="r">{s.stopLossPrice ?? "—"}</td>
                        <td className="r">{s.takeProfitPrice ?? "—"}</td>
                        <td>
                          <StatusBadge tone={GRADE_TONE[s.leaderPlanGrade]} icon={GRADE_ICON[s.leaderPlanGrade]}>
                            {s.leaderPlanGrade}
                          </StatusBadge>
                        </td>
                        <td>{s.leaderEvidenceStatus === "ORDER_FOUND" ? <LayerTag layer="execution" /> : <span className="text-mute">unverified</span>}</td>
                        <td className={isExpired(s) ? "text-mute line-through" : "text-mute"}>{relativeTime(s.expiresAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title={tab === "mine" ? "You have not published a plan" : "No plans published yet"}>
                Fill the ticket and publish, or use a demo button above.
              </Empty>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
