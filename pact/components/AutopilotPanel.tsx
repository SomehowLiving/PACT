"use client";

import { useDeskContext } from "@/components/DeskContext";
import { Addr, KV, Panel, StatusBadge, type Tone } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { useWorld, useWorldProof, WorldPrompt } from "@/components/WorldVerify";
import { autopilotSignal } from "@/lib/world-signal";
import { useCallback, useEffect, useState } from "react";
import { useSendTransaction } from "wagmi";

type Call = { label: string; to: `0x${string}`; data: `0x${string}` };
type Grant = {
  id: string;
  chain: string;
  account: `0x${string}`;
  sessionKey: `0x${string}`;
  expiresAt: number;
  maxPerOrderUsd: number;
  maxDailyUsd: number;
  status: "NOT_DEPLOYED" | "AWAITING_SETUP" | "ACTIVE" | "EXPIRED" | "REVOKED";
  onchain?: { accountDeployed: boolean; sessionActive: boolean; checkedAt: string };
  createdAt: string;
  revokedAt?: string;
};
type Payload = { grants: Grant[]; setup: Call[]; revoke: Call | null; contracts: { base: { factory?: string } } };

const TONE: Record<Grant["status"], Tone> = { ACTIVE: "good", AWAITING_SETUP: "warn", NOT_DEPLOYED: "neutral", EXPIRED: "neutral", REVOKED: "bad" };
const LABEL: Record<Grant["status"], string> = {
  ACTIVE: "live on chain",
  AWAITING_SETUP: "waiting for your setup",
  NOT_DEPLOYED: "contracts not deployed",
  EXPIRED: "expired",
  REVOKED: "revoked",
};

/**
 * Autopilot (L6): a session key that may sign copies for the follower's PACT wallet, with the
 * limits enforced on chain by PactSessionAccount and on top by PACT's own policy.
 */
export function AutopilotPanel() {
  const { address, canAct, policy, refresh } = useDeskContext();
  const { sendTransactionAsync } = useSendTransaction();
  const [data, setData] = useState<Payload | null>(null);
  // Longer than a copy's protection window (24 h by default): a stop or target signed by the
  // session is checked again on chain when it fires, so it must not outlive the session.
  const [hours, setHours] = useState("72");
  const [perOrder, setPerOrder] = useState("25");
  const [daily, setDaily] = useState("100");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { config: worldConfig } = useWorld();
  const world = useWorldProof(worldConfig);
  const needsHuman = !!policy.requireHumanForAutopilot;

  const load = useCallback(async () => {
    if (!address) return;
    const res = await fetch(`/api/autopilot?follower=${address}`);
    if (res.ok) setData(await res.json());
  }, [address]);

  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [load]);

  // The server sets EXPIRED and REVOKED; everything else is the current grant.
  const grant = data?.grants.find((g) => g.status !== "EXPIRED" && g.status !== "REVOKED");
  const on = policy.automationMode === "AUTOPILOT";

  async function create() {
    if (!address) return;
    setBusy("create");
    setMessage(null);
    try {
      const limits = { chain: "base", hours: Number(hours), maxPerOrderUsd: Number(perOrder), maxDailyUsd: Number(daily) };
      // Mandate step-up: approve these exact limits as a human before the key exists.
      let worldProof: unknown;
      if (needsHuman) {
        worldProof = await world.prove("autopilot", autopilotSignal(address, limits), `Approve Autopilot: $${limits.maxPerOrderUsd}/order, $${limits.maxDailyUsd}/day for ${limits.hours}h`);
        if (!worldProof) return;
      }
      const res = await apiFetch("/api/autopilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ follower: address, ...limits, worldProof }),
      });
      const json = await res.json();
      if (needsHuman) world.finish(res.ok, json.error);
      setMessage(res.ok ? `Session created${needsHuman ? " after your World ID approval" : ""}. Its key never leaves PACT's server and is stored encrypted.` : json.error);
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function setMode(mode: "AUTOPILOT" | "REVIEW") {
    setBusy("mode");
    try {
      const res = await apiFetch("/api/policy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...policy, automationMode: mode }),
      });
      if (!res.ok) setMessage((await res.json()).error);
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function revoke() {
    if (!address || !grant) return;
    setBusy("revoke");
    try {
      const res = await apiFetch("/api/autopilot", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ follower: address, grantId: grant.id }),
      });
      const json = await res.json();
      if (res.ok && json.grant?.onchain?.sessionActive && json.revoke) {
        await sendTransactionAsync({ to: json.revoke.to, data: json.revoke.data });
      }
      setMessage(res.ok ? "PACT stopped signing for this session." : json.error);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message.split("\n")[0] : "revoke failed");
    } finally {
      setBusy(null);
    }
  }

  async function send(call: Call) {
    setBusy(call.label);
    try {
      await sendTransactionAsync({ to: call.to, data: call.data });
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message.split("\n")[0] : "transaction failed");
    } finally {
      setBusy(null);
    }
  }

  const deployed = !!data?.contracts.base.factory;
  return (
    <Panel
      title="Autopilot session key"
      subtitle="Copies signed while you are away, by a key whose limits your PACT wallet enforces on chain"
      layer="wallet"
      actions={grant ? <StatusBadge tone={TONE[grant.status]}>{LABEL[grant.status]}</StatusBadge> : null}
      bodyClassName="p-4"
    >
      <ul className="mb-4 grid gap-1.5 text-[12px] leading-relaxed text-ink/90 md:grid-cols-2">
        <li>
          <span className="text-good">✓ On chain:</span> who signs, until when, which tokens, the most per order and per permit, and
          that every order pays out to your PACT wallet. Revoking is one call.
        </li>
        <li>
          <span className="text-good">✓ By PACT on top:</span> your mandate, every policy check, the wallet guard, the daily cap, and a
          record of each signature in the evidence log.
        </li>
      </ul>

      {!canAct || !address ? (
        <p className="text-[12.5px] text-mute">Connect your wallet to set up Autopilot.</p>
      ) : grant ? (
        <>
          <dl>
            <KV
              k="PACT wallet"
              v={grant.status === "NOT_DEPLOYED" ? <span className="text-mute">address known once the factory is deployed</span> : <Addr value={grant.account} />}
            />
            <KV k="Session key" v={<Addr value={grant.sessionKey} />} />
            <KV k="Limits" v={`$${grant.maxPerOrderUsd} per order · $${grant.maxDailyUsd} per day`} />
            <KV k="Expires" v={new Date(grant.expiresAt * 1000).toLocaleString()} />
            <KV
              k="On chain"
              v={
                grant.onchain
                  ? `${grant.onchain.accountDeployed ? "wallet created" : "wallet not created"} · ${grant.onchain.sessionActive ? "session active" : "session not granted"}`
                  : deployed
                    ? "checking…"
                    : "PACT's contracts are not deployed on Base yet"
              }
            />
            <KV k="Mode" v={on ? "Autopilot on" : "Review (you sign each copy)"} />
          </dl>

          {data?.setup.length && grant.status !== "ACTIVE" ? (
            <div className="mt-4">
              <div className="text-[12px] font-semibold text-ink">One-time setup, sent from your wallet</div>
              <ol className="mt-2 space-y-2">
                {data.setup.map((c, i) => (
                  <li key={c.label} className="flex items-center justify-between gap-3 text-[12px]">
                    <span className="min-w-0 text-ink/90">
                      {i + 1}. {c.label}
                    </span>
                    <button type="button" className="btn shrink-0" disabled={!deployed || !!busy} onClick={() => void send(c)}>
                      {busy === c.label ? "Sending…" : "Send"}
                    </button>
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-[11px] text-mute">
                {deployed
                  ? "Then fund the PACT wallet with the USDC Autopilot may use. Until the session shows active on chain, Autopilot only dry-runs."
                  : "Deploy contracts/script/Deploy.s.sol and set NEXT_PUBLIC_PACT_FACTORY_BASE and NEXT_PUBLIC_PACT_ACCOUNT_IMPL_BASE. Until then Autopilot quotes, checks and signs as a dry run and never submits."}
              </p>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={on ? "btn" : "btn btn-primary"} disabled={!!busy} onClick={() => void setMode(on ? "REVIEW" : "AUTOPILOT")}>
              {on ? "Turn Autopilot off" : "Turn Autopilot on"}
            </button>
            <button type="button" className="btn btn-danger-solid" disabled={!!busy} onClick={() => void revoke()}>
              {busy === "revoke" ? "Revoking…" : "Revoke session"}
            </button>
          </div>
        </>
      ) : (
        <div className="grid gap-3 md:grid-cols-[repeat(3,minmax(0,1fr))_auto] md:items-end">
          <label className="block text-[12px]">
            <span className="label">Expires after</span>
            <div className="mt-1 flex items-center gap-1.5">
              <input className="field" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} />
              <span className="text-mute">hours</span>
            </div>
          </label>
          <label className="block text-[12px]">
            <span className="label">Most per order</span>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="text-mute">$</span>
              <input className="field" inputMode="decimal" value={perOrder} onChange={(e) => setPerOrder(e.target.value)} />
            </div>
          </label>
          <label className="block text-[12px]">
            <span className="label">Most per day</span>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="text-mute">$</span>
              <input className="field" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} />
            </div>
          </label>
          <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void create()}>
            {busy === "create" ? (world.step === "scan" ? "Waiting for World App…" : "Creating…") : needsHuman ? "Approve with World ID & create" : "Create session"}
          </button>
        </div>
      )}
      {world.step === "scan" ? (
        <div className="mt-3">
          <WorldPrompt qr={world.qr} link={world.link} environment={world.environment} text="Approve these Autopilot limits in World App. The approval is bound to exactly these limits." />
        </div>
      ) : null}
      {world.error ? <p className="mt-2 text-[12px] text-bad">{world.error}</p> : null}
      {!grant && canAct ? (
        <p className="mt-2 text-[11px] text-mute">
          The session must outlast your copies&apos; protection (stop and target, 24 h by default): its signatures are checked again on chain when a stop fires, so Autopilot will not sign a protective order that ends after the session.
        </p>
      ) : null}
      {message ? <p className="mt-3 text-[12px] text-ink/80">{message}</p> : null}
    </Panel>
  );
}
