"use client";

import { Gauge } from "@/components/Gauge";
import { VerdictPill } from "@/components/VerdictPill";
import { useDesk } from "@/components/useDesk";
import { defaultPolicy } from "@/lib/constants";
import { CHAINS, CHAIN_IDS } from "@/lib/chains";
import { verifySigning, type GuardResult } from "@/lib/guard";
import { cancelMessage, parseOrderTypedData } from "@/lib/typed";
import { reasonLabel, shortAddr, usd } from "@/lib/format";
import type { Chain, Decision, OrderType, Policy, Proposal, Side } from "@/lib/types";
import { useEffect, useState } from "react";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSwitchChain,
  useSendTransaction,
  useSignMessage,
  useSignTypedData,
} from "wagmi";

const PREVIEW_POLICY = defaultPolicy(
  "0x0000000000000000000000000000000000000000",
);

export function FollowDesk() {
  const { address, isConnected } = useAccount();
  const { state, refresh } = useDesk(address);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const policy: Policy =
    state?.policies.find(
      (p) => address && p.follower.toLowerCase() === address.toLowerCase(),
    ) ?? (address ? defaultPolicy(address) : PREVIEW_POLICY);

  useEffect(() => {
    if (!address) return;
    // GET creates the default policy only if this follower has none. Never overwrite edits.
    void fetch(`/api/policy?follower=${address}`).then(() => refresh());
  }, [address, refresh]);

  async function pull() {
    if (!address) return;
    setPulling(true);
    setError(null);
    try {
      const follows = policy.follows ?? [];
      for (const s of state?.strategies ?? []) {
        if (follows.length && !follows.some((l) => l.toLowerCase() === s.leader.toLowerCase())) {
          continue;
        }
        await fetch("/api/proposals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ strategyId: s.id, follower: address }),
        });
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "pull failed");
    } finally {
      setPulling(false);
    }
  }

  const spent = state?.dailySpentUsd ?? 0;
  const maxDaily = policy.maxDailyUsd;
  const all = state?.proposals ?? [];
  const mine = all.filter(
    (p) => address && p.follower.toLowerCase() === address.toLowerCase(),
  );
  const tape = mine.length ? mine : all;
  const preview = mine.length === 0 && tape.length > 0;

  return (
    <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
      <section className="glass rounded-[32px] p-6">
        <div className="text-[11px] uppercase tracking-[0.22em] text-mute">
          follower policy
        </div>
        <h1 className="mt-2 font-[family-name:var(--font-serif)] text-[32px] italic leading-tight">
          sign, or don’t
        </h1>
        <p className="mt-2 text-sm text-mute">
          Flash never reads this policy. BLOCK means no signature, no{" "}
          <span className="font-mono text-[11px]">/order</span>.
        </p>

        <Gauge
          value={spent}
          max={maxDaily}
          label={usd(Math.max(0, maxDaily - spent)).replace(".00", "")}
          sub="left today"
        />

        <dl className="mt-2 space-y-2 text-[13px]">
          <Row k="max / order" v={usd(policy.maxNotionalUsd)} />
          <Row k="daily" v={usd(policy.maxDailyUsd)} />
          <Row k="chains" v={(policy.allowChains ?? [policy.chain]).join(" · ")} />
          <Row k="types" v={policy.allowOrderTypes.join(" · ")} />
          <Row k="sides" v={policy.allowSides.join(" · ")} />
          <Row k="pair" v="WETH / USDC" />
          <Row k="fee bps" v="0" />
        </dl>
        {isConnected && address ? (
          <PolicyEditor
            key={JSON.stringify(policy)}
            policy={policy}
            leaders={[...new Set((state?.strategies ?? []).map((st) => st.leader))]}
            onSaved={refresh}
          />
        ) : (
          <p className="mt-4 text-sm text-mute">
            Connect the follower wallet to set your limits and sign ALLOW. Preview is locked.
          </p>
        )}

        <button
          type="button"
          disabled={!isConnected || pulling}
          onClick={() => void pull()}
          className={`btn-cream mt-6 w-full rounded-full py-3 text-sm ${
            isConnected ? "" : "opacity-40"
          }`}
        >
          {pulling ? "mirroring…" : "mirror open intents"}
        </button>
        {error ? <p className="mt-3 text-sm text-rose">{error}</p> : null}
      </section>

      <section className="space-y-3">
        {tape.length === 0 ? (
          <div className="glass rounded-[32px] p-8 text-sm text-mute">
            No proposals yet. Load the demo tape on the floor, or publish from
            lead and mirror.
          </div>
        ) : (
          <>
            {preview ? (
              <p className="px-1 text-[12px] text-mute">
                Locked preview of the tape. Connect as the follower to sign
                ALLOW.
              </p>
            ) : null}
            {tape.map((p) => (
              <ProposalCard
                key={p.id}
                proposal={p}
                decision={state?.decisions[p.id]}
                receipt={state?.receipts.find((r) => r.proposalId === p.id)}
                onDone={refresh}
              />
            ))}
          </>
        )}
      </section>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between border-b border-white/6 py-2">
      <dt className="text-mute">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

type StepId = "quote" | "guard" | "approve" | "permit" | "sign" | "submit";
type StepState = "idle" | "active" | "done" | "fail" | "skip";
const STEPS: { id: StepId; label: string }[] = [
  { id: "quote", label: "Flash quote" },
  { id: "guard", label: "wallet guard" },
  { id: "approve", label: "approve allowance" },
  { id: "permit", label: "sign Permit2" },
  { id: "sign", label: "sign order" },
  { id: "submit", label: "submit to Flash" },
];
const IDLE: Record<StepId, StepState> = {
  quote: "idle",
  guard: "idle",
  approve: "idle",
  permit: "idle",
  sign: "idle",
  submit: "idle",
};
const TERMINAL = [
  "ORDER_STATUS_FILLED",
  "ORDER_STATUS_CANCELLED",
  "ORDER_STATUS_REJECTED",
  "ORDER_STATUS_TERMINATED",
];
const CANCELLABLE = [
  "ORDER_STATUS_PENDING",
  "ORDER_STATUS_ACCEPTED",
  "ORDER_STATUS_PARTIALLY_FILLED",
];

type CardReceipt = {
  flashOrderId?: string;
  transactionId?: string;
  status?: string;
  closeReason?: string;
  fills?: { transactionId?: string; fillPrice?: string; notional?: string }[];
  completedFillCount?: number;
  twapBucketCount?: number;
};

function ProposalCard({
  proposal,
  decision,
  receipt,
  onDone,
}: {
  proposal: Proposal;
  decision?: Decision;
  receipt?: CardReceipt;
  onDone: () => Promise<void>;
}) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { signTypedDataAsync } = useSignTypedData();
  const { signMessageAsync } = useSignMessage();
  const { sendTransactionAsync } = useSendTransaction();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const [guard, setGuard] = useState<GuardResult | null>(null);
  const [steps, setSteps] = useState<Record<StepId, StepState>>(IDLE);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [approveHash, setApproveHash] = useState<`0x${string}` | undefined>();
  const blocked = !decision || decision.verdict === "BLOCK";
  const isFollower = Boolean(
    address && address.toLowerCase() === proposal.follower.toLowerCase(),
  );
  const canSign = isFollower && !blocked && !busy && !receipt?.flashOrderId;
  const explorer = CHAINS[proposal.chain].explorerTx;
  const orderId = receipt?.flashOrderId;
  const terminal = Boolean(receipt?.status && TERMINAL.includes(receipt.status));

  // Keep the order fresh after submit: Flash order status, TWAP slices, fills.
  useEffect(() => {
    if (!orderId || terminal) return;
    const tick = () =>
      void fetch(`/api/orders/${orderId}`)
        .then(() => onDone())
        .catch(() => undefined);
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 4000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [orderId, terminal, onDone]);

  async function run() {
    if (!canSign || !address) return;
    setBusy(true);
    setStarted(true);
    setGuard(null);
    setSteps(IDLE);
    setMsg(null);
    let current: StepId = "quote";
    const mark = (id: StepId, st: StepState) => {
      current = id;
      setSteps((p) => ({ ...p, [id]: st }));
    };
    try {
      const wantChain = CHAINS[proposal.chain].id;
      if (chainId !== wantChain) {
        setMsg(`switch your wallet to ${CHAINS[proposal.chain].name}`);
        await switchChainAsync({ chainId: wantChain as 8453 | 5042 });
      }
      mark("quote", "active");
      const qRes = await fetch("/api/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proposalId: proposal.id }),
      });
      const qJson = await qRes.json();
      if (!qRes.ok) throw new Error(qJson.error ?? "quote failed");
      const quote = qJson.quote as {
        orderTypedData?: string;
        permitTypedData?: string;
        approveTx?: { to: `0x${string}`; data: `0x${string}` };
      };
      mark("quote", "done");

      // Independent check in the browser, before any wallet prompt. Does not trust the server.
      mark("guard", "active");
      const result = verifySigning({
        chain: proposal.chain,
        follower: address,
        side: proposal.side,
        targetAsset: proposal.targetAsset,
        contraAsset: proposal.contraAsset,
        qty: decision?.modifiedQty ?? proposal.qty,
        // Shown in the guard panel. The order signature stays capped to this order's size either way.
        otherOpenUnits: qJson.otherOpenUnits as string | undefined,
        quote,
      });
      setGuard(result);
      if (!result.ok) {
        const bad = result.checks.filter((c) => c.level === "fail").map((c) => c.label);
        throw new Error(`guard refused to sign: ${bad.join(", ")}`);
      }
      mark("guard", "done");

      let evmPermitSignature: string | undefined;
      if (quote.approveTx) {
        mark("approve", "active");
        const tx = await sendTransactionAsync({
          to: quote.approveTx.to,
          data: quote.approveTx.data,
        });
        setApproveHash(tx);
        if (!publicClient) throw new Error("no public client");
        await publicClient.waitForTransactionReceipt({ hash: tx });
        mark("approve", "done");
      } else {
        mark("approve", "skip");
      }
      if (quote.permitTypedData) {
        mark("permit", "active");
        const permit = parseOrderTypedData(quote.permitTypedData);
        evmPermitSignature = await signTypedDataAsync({
          domain: permit.domain as never,
          types: permit.types,
          primaryType: permit.primaryType,
          message: permit.message,
        });
        mark("permit", "done");
      } else {
        mark("permit", "skip");
      }
      if (!quote.orderTypedData) {
        throw new Error("empty orderTypedData — funderAddress missing?");
      }
      mark("sign", "active");
      const typed = parseOrderTypedData(quote.orderTypedData);
      const userSignature = await signTypedDataAsync({
        domain: typed.domain as never,
        types: typed.types,
        primaryType: typed.primaryType,
        message: typed.message,
      });
      mark("sign", "done");
      mark("submit", "active");
      const oRes = await fetch("/api/order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          proposalId: proposal.id,
          userSignature,
          evmPermitSignature,
          funderAddress: address,
        }),
      });
      const oJson = await oRes.json();
      if (!oRes.ok) throw new Error(oJson.error ?? "order failed");
      mark("submit", "done");
      await onDone();
    } catch (e) {
      setSteps((p) => ({ ...p, [current]: "fail" }));
      setMsg(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!orderId) return;
    setMsg("sign the cancel message in your wallet (gasless)…");
    try {
      const userSignature = await signMessageAsync({ message: cancelMessage(orderId) });
      const res = await fetch(`/api/orders/${orderId}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userSignature }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "cancel failed");
      setMsg("cancelled");
      await onDone();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "cancel failed");
    }
  }

  const lockLabel = receipt?.flashOrderId
    ? "submitted"
    : blocked
      ? "sign locked"
      : !address
        ? "connect to sign"
        : !isFollower
          ? "wrong wallet"
          : busy
            ? "working…"
            : "sign";
  const showSteps = started || Boolean(receipt?.flashOrderId);
  const stepView: Record<StepId, StepState> = receipt?.flashOrderId && !started
    ? { quote: "done", guard: "done", approve: "done", permit: "done", sign: "done", submit: "done" }
    : steps;
  const progress =
    receipt?.twapBucketCount && receipt.twapBucketCount > 0
      ? Math.min(1, (receipt.completedFillCount ?? 0) / receipt.twapBucketCount)
      : null;
  const cancellable = Boolean(
    receipt?.status && CANCELLABLE.includes(receipt.status) && isFollower,
  );

  return (
    <article className="glass rounded-[28px] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[16px]">WETH {proposal.orderType}</span>
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-widest text-mute">
              {proposal.chain}
            </span>
            {decision ? <VerdictPill verdict={decision.verdict} /> : null}
          </div>
          <div className="mt-1 text-[13px] text-mute">
            {proposal.side} · {usd(proposal.notionalUsd)}
            {proposal.durationSeconds ? ` · ${proposal.durationSeconds / 60}m` : ""}
            {proposal.triggers?.[0] ? ` · trigger $${proposal.triggers[0].notionalPrice}` : ""}
            {decision?.modifiedQty ? ` · clipped to ${decision.modifiedQty}` : ""}
          </div>
        </div>
        <button
          type="button"
          disabled={!canSign}
          onClick={() => void run()}
          className={`rounded-full px-4 py-2 text-[13px] ${
            canSign ? "btn-cream" : "cursor-not-allowed bg-white/5 text-mute"
          }`}
        >
          {lockLabel}
        </button>
      </div>
      {decision?.reasons.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {decision.reasons.map((r) => (
            <span
              key={r}
              className="rounded-full bg-rose/10 px-2.5 py-1 text-[11px] text-rose"
            >
              {reasonLabel(r)}
            </span>
          ))}
        </div>
      ) : null}

      {showSteps ? (
        <ol className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          {STEPS.map((st) => (
            <li key={st.id} className="flex items-center gap-2 text-[11px]">
              <StepDot state={stepView[st.id]} />
              <span
                className={
                  stepView[st.id] === "fail"
                    ? "text-rose"
                    : stepView[st.id] === "idle" || stepView[st.id] === "skip"
                      ? "text-mute"
                      : "text-ink"
                }
              >
                {st.label}
                {stepView[st.id] === "skip" ? " (not needed)" : ""}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {guard ? <GuardPanel result={guard} /> : null}
      {msg ? <p className="mt-3 text-[12px] text-mute">{msg}</p> : null}
      {approveHash ? (
        <a
          className="mt-2 inline-block text-[11px] text-mute underline"
          href={`${explorer}${approveHash}`}
          target="_blank"
          rel="noreferrer"
        >
          approve tx {approveHash.slice(0, 10)}…
        </a>
      ) : null}

      {receipt?.flashOrderId ? (
        <div className="mt-4 rounded-2xl bg-black/25 p-3 hairline">
          <div className="flex items-center justify-between gap-2 text-[12px]">
            <span className="text-ink">
              {statusLabel(receipt.status)}
              {receipt.closeReason ? (
                <span className="ml-2 text-mute">{reasonLabel(receipt.closeReason.replace("REASON_", ""))}</span>
              ) : null}
            </span>
            {cancellable ? (
              <button
                type="button"
                onClick={() => void cancel()}
                className="rounded-full bg-rose/15 px-3 py-1 text-[11px] text-rose"
              >
                cancel order
              </button>
            ) : null}
          </div>
          <div className="mt-1 font-mono text-[10px] text-mute">order {receipt.flashOrderId}</div>
          {progress !== null ? (
            <div className="mt-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[#e8c9a0] transition-all duration-500"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
              <div className="mt-1 text-[10px] text-mute">
                slice {receipt.completedFillCount ?? 0} of {receipt.twapBucketCount}
              </div>
            </div>
          ) : null}
          {receipt.fills?.length ? (
            <ul className="mt-3 space-y-1">
              {receipt.fills.map((f, i) => (
                <li key={f.transactionId ?? i} className="flex justify-between text-[11px]">
                  <span className="text-mute">
                    fill {i + 1}
                    {f.notional ? ` · ${usd(Number(f.notional))}` : ""}
                    {f.fillPrice ? ` @ ${Number(f.fillPrice).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : ""}
                  </span>
                  {f.transactionId ? (
                    <a
                      className="text-gold"
                      href={`${explorer}${f.transactionId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {f.transactionId.slice(0, 10)}…
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[11px] text-mute">Waiting for the first fill…</p>
          )}
        </div>
      ) : null}
    </article>
  );
}

function statusLabel(status?: string) {
  if (!status) return "submitted";
  return status.replace("ORDER_STATUS_", "").replaceAll("_", " ").toLowerCase();
}

function StepDot({ state }: { state: StepState }) {
  const base = "inline-block h-2.5 w-2.5 rounded-full";
  if (state === "done") return <span className={`${base} bg-[#e8c9a0]`} />;
  if (state === "active")
    return <span className={`${base} animate-pulse bg-[#c084fc] ring-4 ring-[#c084fc]/20`} />;
  if (state === "fail") return <span className={`${base} bg-rose`} />;
  return <span className={`${base} bg-white/15`} />;
}

const TONE = {
  pass: "text-gold",
  warn: "text-[#e9d5ff]",
  fail: "text-rose",
} as const;
const MARK = { pass: "✓", warn: "!", fail: "✕" } as const;

function GuardPanel({ result }: { result: GuardResult }) {
  const fails = result.checks.filter((c) => c.level === "fail").length;
  const warns = result.checks.filter((c) => c.level === "warn").length;
  return (
    <details className="mt-3 rounded-2xl bg-black/25 p-3 hairline" open={!result.ok}>
      <summary className="cursor-pointer text-[12px] text-ink">
        wallet guard · {result.ok ? "safe to sign" : "REFUSED"}
        <span className="ml-2 text-mute">
          {result.checks.length - fails - warns} passed
          {warns ? ` · ${warns} note${warns > 1 ? "s" : ""}` : ""}
          {fails ? ` · ${fails} failed` : ""}
        </span>
      </summary>
      <ul className="mt-2 space-y-1.5">
        {result.checks.map((c) => (
          <li key={c.id} className="text-[11px] leading-snug">
            <span className={`mr-1.5 font-mono ${TONE[c.level]}`}>{MARK[c.level]}</span>
            <span className="text-ink">{c.label}</span>
            <span className="block pl-4 text-mute">{c.detail}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] text-mute">
        Checked in your browser from the raw payloads Flash returned, before any wallet prompt.
        Your hard spend limit is the signed Permit2 amount.
      </p>
    </details>
  );
}

const TYPES: OrderType[] = ["twap", "limit", "market", "take-profit", "stop-loss"];
const SIDES: Side[] = ["buy", "sell"];

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function PolicyEditor({
  policy,
  leaders,
  onSaved,
}: {
  policy: Policy;
  leaders: `0x${string}`[];
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Policy>({
    ...policy,
    allowChains: policy.allowChains ?? [policy.chain],
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const chains = draft.allowChains ?? [];

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/policy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "save failed");
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-5 rounded-2xl bg-black/25 p-4 hairline">
      <div className="text-[12px] text-ink">your limits</div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <NumField
          label="max / order $"
          value={draft.maxNotionalUsd}
          onChange={(v) => setDraft({ ...draft, maxNotionalUsd: v })}
        />
        <NumField
          label="daily $"
          value={draft.maxDailyUsd}
          onChange={(v) => setDraft({ ...draft, maxDailyUsd: v })}
        />
      </div>
      <Chips
        label="chains"
        options={CHAIN_IDS}
        on={chains}
        onToggle={(c) => setDraft({ ...draft, allowChains: toggle(chains, c as Chain) })}
      />
      <Chips
        label="order types"
        options={TYPES}
        on={draft.allowOrderTypes}
        onToggle={(t) =>
          setDraft({ ...draft, allowOrderTypes: toggle(draft.allowOrderTypes, t as OrderType) })
        }
      />
      <Chips
        label="sides"
        options={SIDES}
        on={draft.allowSides}
        onToggle={(x) =>
          setDraft({ ...draft, allowSides: toggle(draft.allowSides, x as Side) })
        }
      />
      {leaders.length ? (
        <div className="mt-3">
          <div className="text-[11px] text-mute">
            leaders I copy {draft.follows?.length ? "" : "(all — pick to narrow)"}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {leaders.map((l) => {
              const list = draft.follows ?? [];
              const on = list.some((x) => x.toLowerCase() === l.toLowerCase());
              return (
                <button
                  key={l}
                  type="button"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      follows: on
                        ? list.filter((x) => x.toLowerCase() !== l.toLowerCase())
                        : [...list, l],
                    })
                  }
                  className={`rounded-full px-2.5 py-1 font-mono text-[11px] ${
                    on ? "bg-[#e8c9a0]/20 text-gold" : "bg-white/5 text-mute"
                  }`}
                >
                  {shortAddr(l)}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <label className="mt-3 flex items-center gap-2 text-[12px] text-mute">
        <input
          type="checkbox"
          checked={draft.allowModify}
          onChange={(e) => setDraft({ ...draft, allowModify: e.target.checked })}
        />
        clip oversize orders to my cap (MODIFY) instead of blocking
      </label>
      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="mt-4 w-full rounded-full bg-white/10 py-2 text-[13px]"
      >
        {saving ? "saving…" : "save limits"}
      </button>
      {err ? <p className="mt-2 text-[12px] text-rose">{err}</p> : null}
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="text-[11px] text-mute">
      {label}
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-xl bg-black/30 px-3 py-2 text-[13px] text-ink outline-none hairline"
      />
    </label>
  );
}

function Chips({
  label,
  options,
  on,
  onToggle,
}: {
  label: string;
  options: readonly string[];
  on: readonly string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div className="mt-3">
      <div className="text-[11px] text-mute">{label}</div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onToggle(o)}
            className={`rounded-full px-2.5 py-1 text-[11px] ${
              on.includes(o) ? "bg-[#e8c9a0]/20 text-gold" : "bg-white/5 text-mute"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
