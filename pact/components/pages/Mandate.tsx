"use client";

import { useDeskContext } from "@/components/DeskContext";
import { AddrAvatar, Addr, LayerTag, PageHeader, Panel, Planned, StatusBadge } from "@/components/ui";
import { CHAIN_IDS } from "@/lib/chains";
import type { AutomationMode, Chain, FollowerExitMode, LeaderMandate, OrderType, Policy, Side } from "@/lib/types";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api";

/* Structured mandate editor: position sizing → risk limits → concentration →
   exit controls → automation. Saves the same Policy shape PolicyEditor saves. */

const TYPES: OrderType[] = ["twap", "limit", "market", "take-profit", "stop-loss"];
const SIDES: Side[] = ["buy", "sell"];

const SECTIONS = [
  { id: "sizing", label: "Leaders & sizing" },
  { id: "risk", label: "Risk limits" },
  { id: "concentration", label: "Concentration" },
  { id: "exit", label: "Exit & plan quality" },
  { id: "automation", label: "Automation" },
] as const;

function defaultMandate(leader: `0x${string}`, policy: Policy): LeaderMandate {
  return {
    leader,
    sizingMode: "PROPORTIONAL",
    copyRatio: policy.copyRatio,
    fixedNotionalUsd: policy.minNotionalUsd,
    riskBudgetUsd: policy.riskBudgetUsd,
    maxDailyUsd: policy.maxLeaderDailyUsd,
    allowOrderTypes: [...policy.allowOrderTypes],
    exitMode: "FOLLOWER_BRACKET",
  };
}

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

/** Display a stored fraction ("0.005") as a percentage without float noise. */
function pct(fraction: string | number) {
  const n = Number(fraction) * 100;
  return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : 0;
}

/* ── Validation, mirroring app/api/policy/route.ts ───────────────────── */

type Errors = Partial<Record<string, string>>;

function validate(p: Policy): Errors {
  const e: Errors = {};
  if (!(p.maxNotionalUsd > 0)) e.maxNotionalUsd = "Must be greater than $0.";
  if (!(p.maxDailyUsd >= p.maxNotionalUsd)) e.maxDailyUsd = "Daily cap must be at least the per-order cap.";
  if (!(p.minNotionalUsd >= 0)) e.minNotionalUsd = "Cannot be negative.";
  if (!(p.copyRatio > 0 && p.copyRatio <= 1)) e.copyRatio = "Copy size must be between 0% and 100%.";
  if (!(p.riskBudgetUsd > 0)) e.riskBudgetUsd = "Must be greater than $0.";
  if (!(p.maxLeaderDailyUsd >= p.minNotionalUsd)) e.maxLeaderDailyUsd = "Must be at least the minimum notional.";
  if (!(p.maxLeaderDailyRealizedLossUsd > 0)) e.maxLeaderDailyRealizedLossUsd = "Must be greater than $0.";
  if (!(p.maxAssetExposureUsd >= p.minNotionalUsd)) e.maxAssetExposureUsd = "Must be at least the minimum notional.";
  if (!(p.maxOpenPlans >= 1)) e.maxOpenPlans = "At least 1.";
  if (!(p.maxOpenPlansPerLeader >= 1)) e.maxOpenPlansPerLeader = "At least 1.";
  if (!(Number(p.maxEntryDrift) >= 0)) e.maxEntryDrift = "Cannot be negative.";
  if (!(Number(p.maxPriceImpact) >= 0)) e.maxPriceImpact = "Cannot be negative.";
  if (!(Number(p.maxSlippage) >= 0)) e.maxSlippage = "Cannot be negative.";
  if (!(p.minRewardRisk >= 1)) e.minRewardRisk = "Minimum reward:risk is 1.";
  if (!p.allowChains?.length) e.allowChains = "Select at least one chain.";
  if (!p.allowOrderTypes.length) e.allowOrderTypes = "Select at least one order type.";
  if (!p.allowSides.length) e.allowSides = "Select at least one side.";
  if ((p.follows?.length ?? 0) > 3) e.follows = "At most three leaders.";
  for (const m of p.mandates ?? []) {
    const k = m.leader.toLowerCase();
    if (!(m.copyRatio > 0 && m.copyRatio <= 1)) e[`m:${k}:copyRatio`] = "Between 0% and 100%.";
    if (!(m.fixedNotionalUsd > 0)) e[`m:${k}:fixedNotionalUsd`] = "Greater than $0.";
    if (!(m.riskBudgetUsd > 0)) e[`m:${k}:riskBudgetUsd`] = "Greater than $0.";
    if (!(m.maxDailyUsd >= p.minNotionalUsd)) e[`m:${k}:maxDailyUsd`] = "At least the minimum notional.";
    if (!m.allowOrderTypes.length) e[`m:${k}:allowOrderTypes`] = "Select at least one order type.";
  }
  return e;
}

/** Every followed leader gets a mandate; mandates for unfollowed leaders are dropped. */
function withMandates(p: Policy): Policy {
  const follows = p.follows ?? [];
  return {
    ...p,
    mandates: follows.map(
      (leader) => p.mandates?.find((m) => m.leader.toLowerCase() === leader.toLowerCase()) ?? defaultMandate(leader, p),
    ),
  };
}

/* ── Page ─────────────────────────────────────────────────────────────── */

export function Mandate() {
  const { policy, canAct, isDemo, isConnected, refresh } = useDeskContext();
  const saved = useMemo(() => withMandates({ ...policy, allowChains: policy.allowChains ?? [policy.chain] }), [policy]);
  const savedJson = JSON.stringify(saved);
  // No edits → the draft is the live saved policy, so polling updates show through.
  const [edits, setEdits] = useState<{ base: string; draft: Policy } | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const draft = edits?.draft ?? saved;
  const dirty = !!edits && JSON.stringify(edits.draft) !== savedJson;
  const stale = !!edits && dirty && edits.base !== savedJson;
  const errors = validate(draft);
  const errorCount = Object.keys(errors).length;

  function patch(next: Partial<Policy>) {
    setSavedAt(null);
    setEdits((current) => ({ base: current?.base ?? savedJson, draft: { ...(current?.draft ?? saved), ...next } }));
  }

  function patchMandate(leader: `0x${string}`, next: Partial<LeaderMandate>) {
    const mandates = (draft.mandates ?? []).map((m) =>
      m.leader.toLowerCase() === leader.toLowerCase() ? { ...m, ...next } : m,
    );
    patch({ mandates });
  }

  async function save() {
    if (errorCount) return;
    setSaving(true);
    setServerError(null);
    try {
      const res = await apiFetch("/api/policy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(withMandates(draft)),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "save failed");
      await refresh();
      setEdits(null);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setServerError(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  const readOnlyReason = isDemo
    ? "You are viewing a seeded demo desk. Mandates are read-only; switch to your wallet to edit your own."
    : !isConnected
      ? "Connect the follower wallet to edit your mandate. Showing default limits."
      : null;

  return (
    <div>
      <PageHeader
        eyebrow="Workspace settings"
        title="Mandate & risk controls"
        description="Your mandate is the authority boundary for every copied plan: how much each leader may size, which limits cap it, how concentrated it may get, and how it exits. PACT applies it before any Flash quote."
        actions={<LayerTag layer="policy" />}
      />

      {readOnlyReason ? (
        <div className="mb-4 rounded-lg border border-dashed border-line bg-panel px-4 py-3 text-[12.5px] text-mute">{readOnlyReason}</div>
      ) : null}

      <div className="grid gap-5 grid-cols-1 xl:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="hidden xl:block" aria-label="Mandate sections">
          <ol className="sticky top-20 space-y-0.5">
            {SECTIONS.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[12.5px] text-mute hover:bg-panel-2 hover:text-ink">
                  <span className="w-4 text-[11px] font-medium tnum text-mute/60">{String(i + 1).padStart(2, "0")}</span>
                  {s.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <fieldset disabled={!canAct} className="min-w-0 space-y-4">
          <SizingSection draft={draft} errors={errors} patch={patch} patchMandate={patchMandate} />
          <RiskSection draft={draft} errors={errors} patch={patch} />
          <ConcentrationSection draft={draft} errors={errors} patch={patch} />
          <ExitSection draft={draft} errors={errors} patch={patch} />
          <AutomationSection draft={draft} patch={patch} />

          {canAct ? (
            <div className="sticky bottom-3 z-20">
              <div className="panel flex flex-wrap items-center gap-3 px-4 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.45)]">
                {dirty ? (
                  <StatusBadge tone="warn" icon="●">
                    unsaved changes
                  </StatusBadge>
                ) : savedAt ? (
                  <StatusBadge tone="good" icon="✓">
                    saved {savedAt}
                  </StatusBadge>
                ) : (
                  <span className="text-[12px] text-mute">No unsaved changes.</span>
                )}
                {errorCount ? (
                  <span className="text-[12px] text-bad">
                    Fix {errorCount} field{errorCount === 1 ? "" : "s"} before saving.
                  </span>
                ) : null}
                {stale ? (
                  <span className="text-[12px] text-warn">Your saved mandate changed since you started editing; saving overwrites it.</span>
                ) : null}
                {serverError ? <span className="text-[12px] text-bad">{serverError}</span> : null}
                <div className="ml-auto flex gap-2">
                  <button type="button" className="btn btn-ghost" disabled={!dirty || saving} onClick={() => setEdits(null)}>
                    Discard
                  </button>
                  <button type="button" className="btn btn-primary" disabled={!dirty || saving || errorCount > 0} onClick={() => void save()}>
                    {saving ? "Saving…" : "Save mandate"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </fieldset>
      </div>
    </div>
  );
}

/* ── Sections ─────────────────────────────────────────────────────────── */

type SectionProps = {
  draft: Policy;
  errors: Errors;
  patch: (next: Partial<Policy>) => void;
};

function Section({ id, index, title, intro, children }: { id: string; index: number; title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-20">
      <Panel
        title={
          <span className="flex items-center gap-2">
            <span className="text-[12px] font-semibold tnum text-accent">{String(index).padStart(2, "0")}</span>
            {title}
          </span>
        }
        subtitle={intro}
        bodyClassName="p-4"
      >
        {children}
      </Panel>
    </div>
  );
}

function SizingSection({ draft, errors, patch, patchMandate }: SectionProps & { patchMandate: (leader: `0x${string}`, next: Partial<LeaderMandate>) => void }) {
  const follows = draft.follows ?? [];
  return (
    <Section id="sizing" index={1} title="Leaders & sizing" intro="How much of your capital each selected leader can direct, and how it is sized.">
      <div className="grid gap-4 sm:grid-cols-2">
        <NumField
          label="Default copy size"
          unit="% of leader"
          value={pct(draft.copyRatio)}
          onChange={(v) => patch({ copyRatio: v / 100 })}
          help="Used for proportional sizing when a leader has no specific mandate."
          error={errors.copyRatio}
        />
        <NumField
          label="Default stop-risk budget"
          unit="$ / plan"
          value={draft.riskBudgetUsd}
          onChange={(v) => patch({ riskBudgetUsd: v })}
          help="Planned loss at the leader's declared stop. Not a guaranteed maximum loss."
          error={errors.riskBudgetUsd}
        />
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="label">Per-leader mandates · {follows.length}/3</div>
        <Link href="/discover" className="text-[12px] text-accent hover:underline">
          Choose leaders in Discover
        </Link>
      </div>
      {errors.follows ? <p className="mt-1 text-[11.5px] text-bad">{errors.follows}</p> : null}

      {follows.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-line px-4 py-6 text-center text-[12.5px] text-mute">
          No leaders selected. An empty selection copies nobody.
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {follows.map((leader) => {
            const m = draft.mandates?.find((x) => x.leader.toLowerCase() === leader.toLowerCase()) ?? defaultMandate(leader, draft);
            const k = leader.toLowerCase();
            const paused = draft.pausedLeaders?.some((l) => l.toLowerCase() === k);
            const sizeField =
              m.sizingMode === "PROPORTIONAL" ? (
                <NumField label="Copy size" unit="% of leader" value={pct(m.copyRatio)} onChange={(v) => patchMandate(leader, { copyRatio: v / 100 })} error={errors[`m:${k}:copyRatio`]} />
              ) : m.sizingMode === "FIXED" ? (
                <NumField label="Fixed size" unit="$ / trade" value={m.fixedNotionalUsd} onChange={(v) => patchMandate(leader, { fixedNotionalUsd: v })} error={errors[`m:${k}:fixedNotionalUsd`]} />
              ) : (
                <NumField label="Risk at stop" unit="$ / plan" value={m.riskBudgetUsd} onChange={(v) => patchMandate(leader, { riskBudgetUsd: v })} error={errors[`m:${k}:riskBudgetUsd`]} />
              );
            return (
              <div key={leader} className="rounded-lg border border-line bg-panel-2 p-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  <AddrAvatar value={leader} size={24} />
                  <Addr value={leader} className="text-ink" />
                  {paused ? (
                    <StatusBadge tone="warn" icon="◷">
                      paused
                    </StatusBadge>
                  ) : null}
                  <label className="ml-auto flex items-center gap-2 text-[12px] text-mute">
                    Exit
                    <select
                      className="field w-auto py-1"
                      value={m.exitMode}
                      onChange={(e) => patchMandate(leader, { exitMode: e.target.value as FollowerExitMode })}
                    >
                      <option value="FOLLOWER_BRACKET">Flash TP/SL bracket</option>
                      <option value="MANUAL">Manual exit</option>
                    </select>
                  </label>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Field label="Sizing mode">
                    <select
                      className="field"
                      value={m.sizingMode}
                      onChange={(e) => patchMandate(leader, { sizingMode: e.target.value as LeaderMandate["sizingMode"] })}
                    >
                      <option value="PROPORTIONAL">Proportional</option>
                      <option value="FIXED">Fixed USD</option>
                      <option value="STOP_RISK">Stop-risk budget</option>
                    </select>
                  </Field>
                  {sizeField}
                  <NumField label="Leader sleeve" unit="$ / day" value={m.maxDailyUsd} onChange={(v) => patchMandate(leader, { maxDailyUsd: v })} error={errors[`m:${k}:maxDailyUsd`]} />
                </div>
                {m.sizingMode === "STOP_RISK" ? (
                  <p className="mt-2 text-[11.5px] text-mute">
                    Sized from the leader&apos;s declared entry and stop, then capped by your sleeve and portfolio limits.
                  </p>
                ) : null}
                <Chips
                  label="Order types this leader may use"
                  options={TYPES}
                  on={m.allowOrderTypes}
                  onToggle={(t) => patchMandate(leader, { allowOrderTypes: toggle(m.allowOrderTypes, t) })}
                  error={errors[`m:${k}:allowOrderTypes`]}
                />
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function RiskSection({ draft, errors, patch }: SectionProps) {
  return (
    <Section id="risk" index={2} title="Risk limits" intro="Hard caps applied to every copied order. Oversize orders are scaled or refused.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <NumField label="Max per order" unit="$" value={draft.maxNotionalUsd} onChange={(v) => patch({ maxNotionalUsd: v })} error={errors.maxNotionalUsd} />
        <NumField label="Daily copy budget" unit="$ / day" value={draft.maxDailyUsd} onChange={(v) => patch({ maxDailyUsd: v })} error={errors.maxDailyUsd} />
        <NumField label="Minimum notional" unit="$" value={draft.minNotionalUsd} onChange={(v) => patch({ minNotionalUsd: v })} help="Smaller scaled orders are refused." error={errors.minNotionalUsd} />
        <NumField label="Per-leader default sleeve" unit="$ / day" value={draft.maxLeaderDailyUsd} onChange={(v) => patch({ maxLeaderDailyUsd: v })} help="Used when a leader has no mandate." error={errors.maxLeaderDailyUsd} />
        <NumField
          label="Max entry drift"
          unit="%"
          step={0.1}
          value={pct(draft.maxEntryDrift)}
          onChange={(v) => patch({ maxEntryDrift: String(v / 100) })}
          help="Sent to Flash as the order's limit price on TWAP and limit entries; Flash's engine enforces it."
          error={errors.maxEntryDrift}
        />
        <NumField label="Max quote price impact" unit="%" step={0.1} value={pct(draft.maxPriceImpact)} onChange={(v) => patch({ maxPriceImpact: String(v / 100) })} error={errors.maxPriceImpact} />
        <NumField label="Max market slippage" unit="%" step={0.1} value={pct(draft.maxSlippage)} onChange={(v) => patch({ maxSlippage: String(v / 100) })} error={errors.maxSlippage} />
      </div>
      <div className="mt-5 rounded-lg border border-line bg-panel-2 p-3">
        <Toggle
          checked={draft.enableLeaderLossCircuitBreaker ?? false}
          onChange={(v) => patch({ enableLeaderLossCircuitBreaker: v })}
          label="Leader loss breaker"
          help="Stops new copies from a leader after recorded realized losses reach the limit. It acts only on closed PACT receipts with P&L evidence and cannot cancel live orders."
        />
        <div className="mt-3 max-w-[260px]">
          <NumField
            label="Breaker threshold"
            unit="$ / day"
            value={draft.maxLeaderDailyRealizedLossUsd}
            onChange={(v) => patch({ maxLeaderDailyRealizedLossUsd: v })}
            error={errors.maxLeaderDailyRealizedLossUsd}
          />
        </div>
      </div>
    </Section>
  );
}

function ConcentrationSection({ draft, errors, patch }: SectionProps) {
  const chains = draft.allowChains ?? [draft.chain];
  return (
    <Section id="concentration" index={3} title="Concentration" intro="Stops several leaders from stacking into one directional bet, and limits what can be traded at all.">
      <div className="grid gap-4 sm:grid-cols-3">
        <NumField label="Same-asset, same-side exposure" unit="$" value={draft.maxAssetExposureUsd} onChange={(v) => patch({ maxAssetExposureUsd: v })} error={errors.maxAssetExposureUsd} />
        <NumField label="Max live plans" unit="total" step={1} value={draft.maxOpenPlans} onChange={(v) => patch({ maxOpenPlans: v })} error={errors.maxOpenPlans} />
        <NumField label="Live plans per leader" unit="plans" step={1} value={draft.maxOpenPlansPerLeader} onChange={(v) => patch({ maxOpenPlansPerLeader: v })} error={errors.maxOpenPlansPerLeader} />
      </div>
      <Chips label="Allowed chains" options={CHAIN_IDS} on={chains} onToggle={(c) => patch({ allowChains: toggle(chains, c as Chain) })} error={errors.allowChains} />
      <Chips label="Allowed order types" options={TYPES} on={draft.allowOrderTypes} onToggle={(t) => patch({ allowOrderTypes: toggle(draft.allowOrderTypes, t) })} error={errors.allowOrderTypes} />
      <Chips label="Allowed sides" options={SIDES} on={draft.allowSides} onToggle={(s) => patch({ allowSides: toggle(draft.allowSides, s) })} error={errors.allowSides} />
      <p className="mt-3 text-[11.5px] text-mute">Pairs are fixed to WETH/USDC on Base and Arc in this build.</p>
    </Section>
  );
}

function ExitSection({ draft, errors, patch }: SectionProps) {
  return (
    <Section id="exit" index={4} title="Exit & plan quality" intro="What a plan must declare before you copy it, and what happens when it does not fit.">
      <div className="space-y-3">
        <Toggle
          checked={draft.allowModify}
          onChange={(v) => patch({ allowModify: v })}
          label="Scale oversize orders to my cap (SCALE) instead of refusing"
          help="When off, any plan above a cap is DECLINED."
        />
        <Toggle
          checked={draft.requirePlanProtection ?? false}
          onChange={(v) => patch({ requirePlanProtection: v })}
          label="Require a declared invalidation"
          help="Plans without an exit or invalidation go to REVIEW."
        />
        <Toggle
          checked={draft.requireLeaderPlanQuality ?? false}
          onChange={(v) => patch({ requireLeaderPlanQuality: v })}
          label="Require a valid entry, stop, target and minimum reward:risk"
          help="Off: a low reward:risk plan shows as a caution. On: it is held for REVIEW."
        />
        <div className="max-w-[260px] pl-7">
          <NumField label="Minimum reward:risk" unit=": 1" step={0.1} value={draft.minRewardRisk} onChange={(v) => patch({ minRewardRisk: v })} error={errors.minRewardRisk} />
        </div>
        <Toggle
          checked={draft.requireLeaderExecutionEvidence ?? false}
          onChange={(v) => patch({ requireLeaderExecutionEvidence: v })}
          label="Require a Flash order owned by the leader"
          help="ORDER_FOUND only proves Flash found an order under the leader wallet; it does not prove the order matches the plan."
        />
      </div>
      <p className="mt-4 text-[11.5px] text-mute">Exit mode (Flash TP/SL bracket or manual) is set per leader under Leaders & sizing.</p>
    </Section>
  );
}

function AutomationSection({ draft, patch }: Pick<SectionProps, "draft" | "patch">) {
  const mode = draft.automationMode ?? "REVIEW";
  const options: { value: AutomationMode; title: string; body: string }[] = [
    { value: "REVIEW", title: "Review only", body: "You open and self-sign every order. Nothing is queued for you." },
    {
      value: "ASSIST",
      title: "PACT Assist",
      body: "Deterministic policy orchestration: scans plans and queues allowed ones for your review. It holds no key and never quotes, signs, submits, cancels or edits your mandate.",
    },
  ];
  return (
    <Section id="automation" index={5} title="Automation" intro="How much help you want. Execution authority always stays with your wallet.">
      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={mode === o.value}
            onClick={() => patch({ automationMode: o.value })}
            className={`rounded-lg border p-3 text-left transition ${mode === o.value ? "border-accent bg-panel-3" : "border-line bg-panel-2 hover:border-mute/50"}`}
          >
            <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
              <span className={`h-3 w-3 rounded-full border ${mode === o.value ? "border-accent bg-accent" : "border-mute"}`} aria-hidden />
              {o.title}
            </div>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-mute">{o.body}</p>
          </button>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Planned title="Autopilot">
          Needs a follower-owned smart account with a revocable, expiry-bound session key scoped to Flash, chain, assets, sides and limits, plus a live mainnet test. Never a pasted private key.
        </Planned>
        <Planned title="World ID step-up">
          Optional human confirmation before enabling a material Autopilot mandate. Not wallet authorization, KYC or leader-quality proof.
        </Planned>
      </div>
    </Section>
  );
}

/* ── Fields ───────────────────────────────────────────────────────────── */

function Field({ label, unit, help, error, children }: { label: string; unit?: string; help?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="flex items-baseline justify-between gap-2 text-[12px] text-mute">
        <span className="truncate">{label}</span>
        {unit ? <span className="shrink-0 text-[11px] text-mute/80">{unit}</span> : null}
      </span>
      <span className="mt-1 block">{children}</span>
      {error ? <span className="mt-1 block text-[11.5px] text-bad">{error}</span> : help ? <span className="mt-1 block text-[11px] leading-snug text-mute">{help}</span> : null}
    </label>
  );
}

function NumField({
  label,
  unit,
  value,
  onChange,
  help,
  error,
  step = "any",
}: {
  label: string;
  unit?: string;
  value: number;
  onChange: (v: number) => void;
  help?: string;
  error?: string;
  step?: number | "any";
}) {
  return (
    <Field label={label} unit={unit} help={help} error={error}>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        className={`field ${error ? "border-[var(--bad)]" : ""}`}
        value={Number.isFinite(value) ? value : ""}
        aria-invalid={!!error}
        onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
      />
    </Field>
  );
}

function Toggle({ checked, onChange, label, help }: { checked: boolean; onChange: (v: boolean) => void; label: string; help?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--accent-strong)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="block text-[12.5px] text-ink">{label}</span>
        {help ? <span className="mt-0.5 block text-[11.5px] leading-relaxed text-mute">{help}</span> : null}
      </span>
    </label>
  );
}

function Chips<T extends string>({ label, options, on, onToggle, error }: { label: string; options: readonly T[]; on: T[]; onToggle: (v: T) => void; error?: string }) {
  return (
    <div className="mt-4">
      <div className="text-[12px] text-mute">{label}</div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {options.map((o) => {
          const enabled = on.includes(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={enabled}
              onClick={() => onToggle(o)}
              className={`rounded-md border px-2.5 py-1 text-[12px] transition ${
                enabled ? "border-accent bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] text-ink" : "border-line text-mute hover:text-ink"
              }`}
            >
              {o}
            </button>
          );
        })}
      </div>
      {error ? <p className="mt-1 text-[11.5px] text-bad">{error}</p> : null}
    </div>
  );
}
