"use client";

import { useDeskContext } from "@/components/DeskContext";
import { Panel, StatusBadge } from "@/components/ui";
import { apiPost } from "@/lib/api";
import { useCallback, useEffect, useRef, useState } from "react";

type WorldConfig = { enabled: boolean; app_id?: `app_${string}`; rp_id?: string; environment: "production" | "staging"; action: string; missing: string[]; verified: Record<string, string> };
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
  const [step, setStep] = useState<Step>("idle");
  const [qr, setQr] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const cancelled = useRef(false);
  useEffect(
    () => () => {
      cancelled.current = true;
    },
    [],
  );

  const verifiedAt = address ? config?.verified[address.toLowerCase()] : undefined;

  async function start() {
    if (!address || !config?.enabled || !config.app_id || !config.rp_id) return;
    cancelled.current = false;
    setMessage(null);
    setStep("signing");
    try {
      const sigRes = await apiPost("/api/world/sign", { address });
      const sig = await sigRes.json();
      if (!sigRes.ok) throw new Error(sig.error ?? "could not sign the request");
      const { IDKit, proofOfHuman } = await import("@worldcoin/idkit-core");
      const request = await IDKit.request({
        app_id: config.app_id,
        action: config.action,
        rp_context: { rp_id: config.rp_id, nonce: sig.nonce, created_at: sig.created_at, expires_at: sig.expires_at, signature: sig.sig },
        action_description: "Verify you are a unique human publishing plans on PACT",
        allow_legacy_proofs: false,
        environment: config.environment,
      }).preset(proofOfHuman({ signal: address.toLowerCase() }));
      const QR = await import("qrcode");
      setQr(await QR.toDataURL(request.connectorURI, { margin: 1, width: 220, color: { dark: "#17120d", light: "#efe5d4" } }));
      setLink(request.connectorURI);
      setStep("scan");
      const completion = await request.pollUntilCompletion();
      if (cancelled.current) return;
      if (!completion.success) throw new Error(`World App: ${String(completion.error).replaceAll("_", " ")}`);
      setStep("verifying");
      const res = await apiPost("/api/world/verify", { address, proof: completion.result });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "verification failed");
      setStep("done");
      await reload();
      await refresh();
    } catch (e) {
      if (cancelled.current) return;
      setStep("error");
      setMessage(e instanceof Error ? e.message.split("\n")[0] : "verification failed");
    } finally {
      setQr(null);
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
      ) : step === "scan" && qr ? (
        <div className="flex flex-wrap items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="Scan with World App" width={180} height={180} className="rounded-lg" />
          <div className="min-w-[180px] flex-1 space-y-2 text-[12.5px] text-ink/85">
            <p>Scan with World App and approve. The proof is bound to this wallet.</p>
            {link ? (
              <a href={link} className="btn h-9" target="_blank" rel="noreferrer">
                Open in World App
              </a>
            ) : null}
            <p className="text-[11.5px] text-mute">{config.environment === "staging" ? "Staging: use the World ID simulator." : "Waiting for World App…"}</p>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-primary" disabled={step === "signing" || step === "verifying"} onClick={() => void start()}>
          {step === "signing" ? "Preparing…" : step === "verifying" ? "Verifying…" : "Verify with World ID"}
        </button>
      )}
      {message ? <p className="mt-3 text-[12px] text-bad">{message}</p> : null}
    </Panel>
  );
}
