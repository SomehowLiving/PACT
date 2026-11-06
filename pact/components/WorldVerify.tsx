"use client";

import { useDeskContext } from "@/components/DeskContext";
import { Panel, StatusBadge } from "@/components/ui";
import { apiPost } from "@/lib/api";
import { leaderSignal } from "@/lib/world-signal";
import { useCallback, useEffect, useRef, useState } from "react";

type Purpose = "leader" | "autopilot";
type WorldConfig = {
  enabled: boolean;
  app_id?: `app_${string}`;
  rp_id?: string;
  environment: "production" | "staging";
  action: string;
  actions: Record<Purpose, string>;
  missing: string[];
  verified: Record<string, string>;
};
type Step = "idle" | "signing" | "scan" | "verifying" | "done" | "error";

/** World ID config and the verified-leader map, shared by badges and the verify panel. */
export function useWorld() {
  const [config, setConfig] = useState<WorldConfig | null>(null);
  const load = useCallback(async () => {
    const res = await fetch("/api/world").catch(() => null);
    if (res?.ok) setConfig(await res.json());
  }, []);
  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [load]);
  return { config, reload: load };
}

/**
 * One World ID request: PACT signs it (the RP key stays on the server), IDKit shows a QR code
 * for World App, and the proof comes back bound to `signal`. The caller sends the proof to the
 * PACT endpoint that checks it.
 */
export function useWorldProof(config: WorldConfig | null) {
  const { address } = useDeskContext();
  const [step, setStep] = useState<Step>("idle");
  const [qr, setQr] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);
  useEffect(
    () => () => {
      cancelled.current = true;
    },
    [],
  );

  const prove = useCallback(
    async (purpose: Purpose, signal: string, description: string): Promise<unknown | null> => {
      if (!address || !config?.enabled || !config.app_id || !config.rp_id) return null;
      cancelled.current = false;
      setError(null);
      setStep("signing");
      try {
        const sigRes = await apiPost("/api/world/sign", { address, purpose });
        const sig = await sigRes.json();
        if (!sigRes.ok) throw new Error(sig.error ?? "could not sign the request");
        const { IDKit, proofOfHuman } = await import("@worldcoin/idkit-core");
        const request = await IDKit.request({
          app_id: config.app_id,
          action: config.actions[purpose],
          rp_context: { rp_id: config.rp_id, nonce: sig.nonce, created_at: sig.created_at, expires_at: sig.expires_at, signature: sig.sig },
          action_description: description,
          allow_legacy_proofs: false,
          environment: config.environment,
        }).preset(proofOfHuman({ signal }));
        const QR = await import("qrcode");
        setQr(await QR.toDataURL(request.connectorURI, { margin: 1, width: 220, color: { dark: "#17120d", light: "#efe5d4" } }));
        setLink(request.connectorURI);
        setStep("scan");
        const completion = await request.pollUntilCompletion();
        if (cancelled.current) return null;
        if (!completion.success) throw new Error(`World App: ${String(completion.error).replaceAll("_", " ")}`);
        setStep("verifying");
        return completion.result;
      } catch (e) {
        if (!cancelled.current) {
          setStep("error");
          setError(e instanceof Error ? e.message.split("\n")[0] : "World ID request failed");
        }
        return null;
      } finally {
        setQr(null);
      }
    },
    [address, config],
  );

  const finish = useCallback((ok: boolean, message?: string) => {
    setStep(ok ? "done" : "error");
    setError(ok ? null : (message ?? "verification failed"));
  }, []);

  return { prove, finish, step, qr, link, error, environment: config?.environment };
}

/** The QR code and link while World App is open; nothing otherwise. */
export function WorldPrompt({ qr, link, environment, text }: { qr: string | null; link: string | null; environment?: string; text: string }) {
  if (!qr) return null;
  return (
    <div className="flex flex-wrap items-center gap-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt="Scan with World App" width={180} height={180} className="rounded-lg" />
      <div className="min-w-[180px] flex-1 space-y-2 text-[12.5px] text-ink/85">
        <p>{text}</p>
        {link ? (
          <a href={link} className="btn h-9" target="_blank" rel="noreferrer">
            Open in World App
          </a>
        ) : null}
        <p className="text-[11.5px] text-mute">{environment === "staging" ? "Staging: use the World ID simulator." : "Waiting for World App…"}</p>
      </div>
    </div>
  );
}

/** Badge for a leader who proved with World ID that they are a unique human. */
export function HumanBadge({ verifiedAt, compact = false }: { verifiedAt?: string; compact?: boolean }) {
  if (!verifiedAt) return null;
  return (
    <span title={`Verified with World ID ${new Date(verifiedAt).toLocaleDateString()}: one unique human behind this leader address. Not a measure of trading skill.`}>
      <StatusBadge tone="good" icon="◉">
        {compact ? "human" : "Verified human"}
      </StatusBadge>
    </span>
  );
}

/**
 * Leader verification: World ID proves a unique human is behind this wallet, and one human can
 * back only one leader address. It does not authorize trades or say anything about skill.
 */
export function WorldVerifyPanel() {
  const { address, canAct, refresh } = useDeskContext();
  const { config, reload } = useWorld();
  const world = useWorldProof(config);
  const verifiedAt = address ? config?.verified[address.toLowerCase()] : undefined;

  async function start() {
    if (!address) return;
    const proof = await world.prove("leader", leaderSignal(address), "Verify you are a unique human publishing plans on PACT");
    if (!proof) return;
    const res = await apiPost("/api/world/verify", { address, proof });
    const body = await res.json();
    world.finish(res.ok, body.error);
    if (res.ok) {
      await reload();
      await refresh();
    }
  }

  return (
    <Panel
      title="Verified human"
      subtitle="World ID: one unique human per leader address, without revealing who you are"
      layer="wallet"
      actions={verifiedAt ? <HumanBadge verifiedAt={verifiedAt} /> : config && !config.enabled ? <StatusBadge tone="neutral">not configured</StatusBadge> : null}
      bodyClassName="p-4"
    >
      <ul className="mb-3 space-y-1 text-[12.5px] leading-relaxed text-ink/85">
        <li>
          <span className="text-good">✓</span> Followers see the badge, and can choose to copy only verified-human leaders.
        </li>
        <li>
          <span className="text-good">✓</span> One human backs one leader address, so a leader cannot restart under a fresh wallet after losses.
        </li>
        <li>
          <span className="text-mute">✕</span> It does not authorize trades, and it is not a measure of trading skill.
        </li>
      </ul>

      {!config ? (
        <p className="text-[12.5px] text-mute">Checking World ID…</p>
      ) : !config.enabled ? (
        <p className="text-[12.5px] text-mute">
          World ID is not configured on this PACT server. Set {config.missing.join(", ")} in <code>.env.local</code> (from the World Developer Portal) and restart.
        </p>
      ) : !canAct || !address ? (
        <p className="text-[12.5px] text-mute">Connect the leader wallet to verify.</p>
      ) : verifiedAt ? (
        <p className="text-[12.5px] text-ink/85">This wallet was verified on {new Date(verifiedAt).toLocaleString()}.</p>
      ) : world.step === "scan" ? (
        <WorldPrompt qr={world.qr} link={world.link} environment={world.environment} text="Scan with World App and approve. The proof is bound to this wallet." />
      ) : (
        <button type="button" className="btn btn-primary" disabled={world.step === "signing" || world.step === "verifying"} onClick={() => void start()}>
          {world.step === "signing" ? "Preparing…" : world.step === "verifying" ? "Verifying…" : "Verify with World ID"}
        </button>
      )}
      {world.error ? <p className="mt-3 text-[12px] text-bad">{world.error}</p> : null}
    </Panel>
  );
}
