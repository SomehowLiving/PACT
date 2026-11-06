"use client";

import { useDeskContext } from "@/components/DeskContext";
import { defaultMandate, mandateFor, useLeaderActions } from "@/components/pages/following-actions";
import { ActionBadge, AddrAvatar, LayerTag, StatusBadge, type Tone } from "@/components/ui";
import { copyability, type CopyVerdict, type Mirrored } from "@/lib/copyability";
import { reasonLabel, usd } from "@/lib/format";
import type { CopySizingMode, FollowerExitMode, LeaderMandate, OrderType, Strategy } from "@/lib/types";
import { ACTIONS, capacity, exposureGroups, isExpired, pairLabel, relativeTime, type LeaderRow } from "@/lib/views";
import { useEffect, useMemo, useState, type ReactNode } from "react";

export type DrawerTab = "analysis" | "copy";

const ORDER_TYPES: OrderType[] = ["twap", "limit", "market", "take-profit", "stop-loss"];

const SIZING: { mode: CopySizingMode; label: string; unit: string; presets: number[]; help: string }[] = [
  { mode: "PROPORTIONAL", label: "Proportional", unit: "% of leader", presets: [10, 25, 50, 100], help: "A share of the leader's own order size." },
  { mode: "FIXED", label: "Fixed USD", unit: "USD per plan", presets: [5, 10, 25, 50], help: "The same dollar amount on every copied plan." },
  { mode: "STOP_RISK", label: "Stop-risk", unit: "USD at stop", presets: [1, 2, 5, 10], help: "Sized so a fill stopped at the leader's declared stop loses about this much." },
];

const VERDICT: Record<CopyVerdict, { tone: Tone; label: string }> = {
  COPYABLE: { tone: "good", label: "Copyable" },
  PARTLY: { tone: "warn", label: "Partly copyable" },
  NOT_COPYABLE: { tone: "bad", label: "Not copyable" },
  NO_LIVE_PLANS: { tone: "neutral", label: "No live plans" },
};

function sizeValue(m: LeaderMandate) {
  return m.sizingMode === "PROPORTIONAL" ? Math.round(m.copyRatio * 100) : m.sizingMode === "FIXED" ? m.fixedNotionalUsd : m.riskBudgetUsd;
}

function withSize(m: LeaderMandate, value: number): LeaderMandate {
  if (m.sizingMode === "PROPORTIONAL") return { ...m, copyRatio: Math.min(1, Math.max(0.01, value / 100)) };
  if (m.sizingMode === "FIXED") return { ...m, fixedNotionalUsd: value };
  return { ...m, riskBudgetUsd: value };
}

function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="grid gap-1 rounded-lg bg-bg p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2 py-2 text-[12.5px] font-medium transition-colors ${
            value === o.value ? "bg-panel-3 text-ink" : "text-mute hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-line px-5 py-4">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-[12.5px] font-semibold text-ink">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function CopyDrawer({
  row,
  plans,
  tab: initialTab,
  onClose,
}: {
  row: LeaderRow;
  plans: Strategy[];
  tab: DrawerTab;
  onClose: () => void;
}) {
  const { state, policy } = useDeskContext();
  const actions = useLeaderActions();
  const [tab, setTab] = useState<DrawerTab>(initialTab);
  const existing = mandateFor(policy, row.leader);
  const following = actions.isFollowing(row.leader);
  const [draft, setDraft] = useState<LeaderMandate>(() => existing ?? defaultMandate(row.leader, policy));
  const [advanced, setAdvanced] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ctx = useMemo(() => {
    if (!state) return { dailySpentUsd: 0, leaderDailySpentUsd: 0, activePlanCount: 0, activePlanCountForLeader: 0, assetExposureUsd: 0 };
    const cap = capacity(state, policy);
    const sleeve = cap.sleeves.find((s) => s.leader.toLowerCase() === row.leader.toLowerCase());
    const weth = exposureGroups(state, policy.follower).find((g) => g.asset === "WETH" && g.side === "buy");
    return {
      dailySpentUsd: cap.dailyUsed,
      leaderDailySpentUsd: sleeve?.used ?? 0,
      activePlanCount: cap.openPlans,
      activePlanCountForLeader: sleeve?.openPlans ?? 0,
      assetExposureUsd: weth?.liveUsd ?? 0,
    };
  }, [state, policy, row.leader]);

  // Plans this desk already mirrored keep their stored, binding decision.
  const mirrored = useMemo(() => {
    const map: Mirrored = new Map();
    for (const p of state?.proposals ?? []) {
      if (p.follower.toLowerCase() !== policy.follower.toLowerCase()) continue;
      const decision = state?.decisions[p.id];
      if (decision) map.set(p.strategyId, { decision, notionalUsd: p.notionalUsd });
    }
    return map;
  }, [state?.proposals, state?.decisions, policy.follower]);
  const current = useMemo(() => copyability(plans, policy, existing, ctx, mirrored), [plans, policy, existing, ctx, mirrored]);
  const preview = useMemo(() => copyability(plans, policy, draft, ctx, mirrored), [plans, policy, draft, ctx, mirrored]);
  const shown = tab === "analysis" ? current : preview;
  const live = plans.filter((p) => !isExpired(p));
  const latest = live[0] ?? plans[0];
  const latestPreview = preview.previews.find((p) => p.plan.id === latest?.id);
  const spec = SIZING.find((s) => s.mode === draft.sizingMode)!;
  const blocked = actions.blockedReason(row.leader);
  const busy = actions.busy === row.leader.toLowerCase();
  const advancedCount = ORDER_TYPES.filter((t) => draft.allowOrderTypes.includes(t)).length;
  const stopDistances = plans
    .map((p) => {
      const e = Number(p.entryReferencePrice);
      const s = Number(p.stopLossPrice);
      return e > 0 && s > 0 ? (Math.abs(e - s) / e) * 100 : undefined;
    })
    .filter((v): v is number => v !== undefined);
  const avgStop = stopDistances.length ? stopDistances.reduce((a, b) => a + b, 0) / stopDistances.length : undefined;

  async function confirm() {
    const ok = await actions.saveMandate(draft);
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  function copyAddress() {
    void navigator.clipboard?.writeText(row.leader).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }

  const ok = shown.counts.COPY + shown.counts.SCALE;
  const verdictLine =
    shown.verdict === "NO_LIVE_PLANS"
      ? "This leader has no live plans to evaluate right now."
      : `${ok} of ${shown.previews.length} live plan${shown.previews.length === 1 ? "" : "s"} fit${ok === 1 ? "s" : ""} ${tab === "analysis" && !existing ? "your default limits" : "this mandate"} today.`;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Copy leader ${row.leader}`}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/55 backdrop-blur-[1px]" />
      <aside className="absolute inset-y-0 right-0 flex w-[460px] max-w-full flex-col border-l border-line bg-panel shadow-2xl">
        {/* Header */}
        <header className="flex items-center justify-between gap-3 px-5 pb-3 pt-4">
          <h2 className="text-[16px] font-semibold text-ink">{following ? "Edit copy" : "Copy leader"}</h2>
          <button type="button" onClick={onClose} className="btn btn-ghost h-8 w-8 p-0" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <path d="m3 3 8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {/* Copy from */}
        <div className="px-5">
          <div className="text-[12px] font-medium text-mute">Copy from</div>
          <div className="mt-1.5 flex items-center gap-2.5 rounded-lg border border-line bg-bg px-3 py-2.5">
            <AddrAvatar value={row.leader} size={26} />
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink" title={row.leader}>
              {row.leader}
            </span>
            {row.isDemo ? <LayerTag layer="demo" /> : null}
            <button type="button" onClick={copyAddress} className="shrink-0 text-[12px] font-medium text-accent hover:underline">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="mt-3 grid grid-cols-3 divide-x divide-line rounded-lg border border-line">
            {[
              { k: "Live plans", v: `${row.activePlans} / ${row.plans}` },
              { k: "Avg declared R:R", v: row.avgRewardRisk === undefined ? "—" : `${row.avgRewardRisk.toFixed(2)}R` },
              { k: "Flash evidence", v: `${row.evidenceFound} / ${row.plans}` },
            ].map((s) => (
              <div key={s.k} className="px-3 py-2.5">
                <div className="tnum text-[14px] font-semibold text-ink">{s.v}</div>
                <div className="mt-0.5 text-[11px] text-mute">{s.k}</div>
              </div>
            ))}
          </div>
          <div className="mt-3">
            <Tabs
              value={tab}
              onChange={setTab}
              options={[
                { value: "analysis", label: "Copyability" },
                { value: "copy", label: "Copy settings" },
              ]}
            />
          </div>
        </div>

        <div className="scroll-thin mt-3 flex-1 overflow-y-auto">
          {tab === "analysis" ? (
            <>
              <Section title="Verdict for your mandate" aside={<LayerTag layer="policy" />}>
                <div className="flex items-start gap-3">
                  <StatusBadge tone={VERDICT[shown.verdict].tone}>{VERDICT[shown.verdict].label}</StatusBadge>
                  <p className="text-[12.5px] leading-relaxed text-ink">{verdictLine}</p>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
                  {ACTIONS.map((a) => (
                    <span key={a} className="inline-flex items-center gap-1.5">
                      <ActionBadge action={a} />
                      <span className="tnum text-[12px] text-ink">{shown.counts[a]}</span>
                    </span>
                  ))}
                </div>
                {shown.topReasons.length ? (
                  <ul className="mt-3 space-y-1 text-[12px] text-mute">
                    {shown.topReasons.map((r) => (
                      <li key={r.reason} className="flex justify-between gap-3">
                        <span>{reasonLabel(r.reason)}</span>
                        <span className="tnum text-ink">{r.count}×</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Section>

              <Section title="Live plans through your limits">
                {shown.previews.length ? (
                  <ul className="divide-y divide-line-2">
                    {shown.previews.map((p) => (
                      <li key={p.plan.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <div className="truncate text-[12.5px] text-ink">{p.plan.title}</div>
                          <div className="mt-0.5 text-[11px] text-mute">
                            {pairLabel(p.plan)} · <span className="capitalize">{p.plan.side}</span> {p.plan.orderType} · ends {relativeTime(p.plan.expiresAt)}
                            {p.mirrored ? <span className="text-ink"> · in your proposals</span> : <span> · preview</span>}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <ActionBadge action={p.action} />
                          <div className="mt-1 tnum text-[11px] text-mute">
                            {p.decision.verdict === "BLOCK" ? reasonLabel(p.decision.reasons[0] ?? "") : `${usd(p.approvedUsd)}${p.estimated ? " est." : ""}`}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12px] text-mute">Nothing live to test. New plans appear in Proposals once you follow.</p>
                )}
              </Section>

              <Section title="Plan discipline">
                <dl className="space-y-1.5 text-[12.5px]">
                  <div className="flex justify-between">
                    <dt className="text-mute">Grade mix (disciplined / caution / incomplete)</dt>
                    <dd className="tnum text-ink">
                      {row.grades.DISCIPLINED} / {row.grades.CAUTION} / {row.grades.INCOMPLETE}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-mute">Average stop distance</dt>
                    <dd className="tnum text-ink">{avgStop === undefined ? "—" : `${avgStop.toFixed(2)}%`}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-mute">Order types used</dt>
                    <dd className="text-ink">{row.orderTypes.join(", ")}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-mute">Copies filled via PACT</dt>
                    <dd className="tnum text-ink">
                      {row.filledOrders} of {row.copiedOrders}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-[11.5px] leading-relaxed text-mute">
                  A preview with today&apos;s spend and limits. PACT makes the binding decision when a plan is mirrored, with
                  a live Flash quote. It says nothing about future profit: there is no verified PnL for this leader yet.
                </p>
              </Section>
            </>
          ) : (
            <>
              <Section title="Position sizing">
                <Tabs
                  value={draft.sizingMode}
                  onChange={(mode) => setDraft({ ...draft, sizingMode: mode })}
                  options={SIZING.map((s) => ({ value: s.mode, label: s.label }))}
                />
                <div className="mt-3 flex items-center justify-between rounded-t-lg border border-line bg-bg px-3 py-2.5">
                  <input
                    aria-label="Amount"
                    inputMode="decimal"
                    value={sizeValue(draft)}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v >= 0) setDraft(withSize(draft, v));
                    }}
                    className="w-full bg-transparent text-[14px] font-semibold tnum text-ink outline-none"
                  />
                  <span className="shrink-0 text-[12px] text-mute">{spec.unit}</span>
                </div>
                <div className="grid grid-cols-4 divide-x divide-line rounded-b-lg border border-t-0 border-line">
                  {spec.presets.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setDraft(withSize(draft, v))}
                      className={`py-2 text-[12.5px] tnum transition-colors ${sizeValue(draft) === v ? "bg-panel-3 text-ink" : "text-mute hover:bg-panel-2 hover:text-ink"}`}
                    >
                      {draft.sizingMode === "PROPORTIONAL" ? `${v}%` : `$${v}`}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11.5px] text-mute">
                  {spec.help}
                  {latestPreview ? (
                    <>
                      {" "}On “{latest?.title}”: <span className="text-ink">{usd(latestPreview.requestedUsd)}</span> requested
                      {latestPreview.decision.verdict === "MODIFY" ? (
                        <>, scaled to <span className="text-ink">{usd(latestPreview.approvedUsd)}</span></>
                      ) : null}
                      .
                    </>
                  ) : null}
                </p>
              </Section>

              <Section title="Leader sleeve" aside={<span className="text-[11.5px] text-mute">per day</span>}>
                <div className="grid grid-cols-4 gap-1.5">
                  {[10, 25, 50, 100].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setDraft({ ...draft, maxDailyUsd: v })}
                      className={`rounded-md border py-2 text-[12.5px] tnum transition-colors ${
                        draft.maxDailyUsd === v ? "border-accent bg-panel-3 text-ink" : "border-line text-mute hover:text-ink"
                      }`}
                    >
                      ${v}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11.5px] text-mute">
                  Your portfolio limits still apply: {usd(policy.maxNotionalUsd)} per order, {usd(policy.maxDailyUsd)} per day across all leaders.
                </p>
              </Section>

              <Section title="Exit method">
                <Tabs<FollowerExitMode>
                  value={draft.exitMode}
                  onChange={(exitMode) => setDraft({ ...draft, exitMode })}
                  options={[
                    { value: "FOLLOWER_BRACKET", label: "Flash TP/SL bracket" },
                    { value: "MANUAL", label: "Manual exit" },
                  ]}
                />
                <p className="mt-2 text-[11.5px] text-mute">
                  {draft.exitMode === "FOLLOWER_BRACKET"
                    ? "A Flash take-profit and stop on your position at the leader's declared levels. PACT reads the live levels back and flags any change."
                    : "Enter only. You close the position yourself; PACT does not mirror the leader's exit."}
                </p>
              </Section>

              <section className="border-t border-line px-5 py-3">
                <button type="button" onClick={() => setAdvanced(!advanced)} className="flex w-full items-center justify-between text-left">
                  <span className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
                    Advanced settings
                    <span className="rounded bg-panel-3 px-1.5 text-[11px] tnum text-mute">{advancedCount}</span>
                  </span>
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className={`text-mute transition-transform ${advanced ? "rotate-180" : ""}`}>
                    <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
                  </svg>
                </button>
                {advanced ? (
                  <div className="mt-3">
                    <div className="text-[12px] text-mute">Order types this leader may use</div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {ORDER_TYPES.map((t) => {
                        const allowedGlobally = policy.allowOrderTypes.includes(t);
                        const on = draft.allowOrderTypes.includes(t);
                        return (
                          <button
                            key={t}
                            type="button"
                            disabled={!allowedGlobally}
                            title={allowedGlobally ? undefined : "Blocked by your global mandate"}
                            onClick={() =>
                              setDraft({
                                ...draft,
                                allowOrderTypes: on ? draft.allowOrderTypes.filter((x) => x !== t) : [...draft.allowOrderTypes, t],
                              })
                            }
                            className={`rounded-md border px-2.5 py-1 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                              on && allowedGlobally ? "border-accent bg-panel-3 text-ink" : "border-line text-mute hover:text-ink"
                            }`}
                          >
                            {t}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-[11.5px] text-mute">
                      Pairs, sides ({policy.allowSides.join(" & ")}), entry drift and quote impact come from your mandate settings.
                    </p>
                  </div>
                ) : null}
              </section>

              <Section title="With these settings" aside={<LayerTag layer="policy" />}>
                <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                  {ACTIONS.map((a) => (
                    <span key={a} className="inline-flex items-center gap-1.5">
                      <ActionBadge action={a} />
                      <span className="tnum text-[12px] text-ink">{preview.counts[a]}</span>
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-[11.5px] text-mute">{verdictLine}</p>
              </Section>
            </>
          )}
        </div>

        {/* Footer */}
        <footer className="border-t border-line px-5 py-4">
          {actions.error ? <p className="mb-2 text-[12px] text-bad">{actions.error}</p> : null}
          {tab === "analysis" ? (
            <button type="button" className="btn btn-primary w-full py-2.5" onClick={() => setTab("copy")}>
              {following ? "Edit copy settings" : "Set up copy"}
            </button>
          ) : (
            <div className="flex gap-2">
              {following ? (
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={!!blocked || busy}
                  onClick={() => void actions.unfollow(row.leader)?.then(() => onClose())}
                >
                  Unfollow
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-primary flex-1 py-2.5"
                disabled={!!blocked || busy}
                title={blocked}
                onClick={() => void confirm()}
              >
                {busy ? "Saving…" : saved ? "Saved" : blocked ? blocked : following ? "Save copy settings" : "Confirm copy"}
              </button>
            </div>
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-mute">
            Confirming saves a mandate only. No order is placed; every copied plan still opens a review you sign yourself.
          </p>
        </footer>
      </aside>
    </div>
  );
}
