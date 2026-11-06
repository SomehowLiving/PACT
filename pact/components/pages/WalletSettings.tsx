"use client";

import { Connect } from "@/components/Connect";
import { useDeskContext } from "@/components/DeskContext";
import { KV, LayerTag, PageHeader, Panel, Planned, StatusBadge, type Tone } from "@/components/ui";
import { USDC, WETH } from "@/lib/constants";
import { useEffect, useState } from "react";
import { erc20Abi, formatUnits } from "viem";
import { useAccount, useBalance, useReadContracts, useSwitchChain } from "wagmi";
import { base } from "wagmi/chains";

/* Wallet & connections: what is connected, what it holds on Base (read over RPC),
   which services PACT can reach, and where authority sits. */

type Check = { tone: Tone; label: string; detail: string };

function fmtUnits(value: bigint | undefined, decimals: number, digits: number) {
  if (value === undefined) return "—";
  const n = Number(formatUnits(value, decimals));
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function WalletSettings() {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { isDemo, state } = useDeskContext();
  const [flash, setFlash] = useState<Check | null>(null);
  const [market, setMarket] = useState<Check | null>(null);

  const eth = useBalance({ address, chainId: base.id, query: { enabled: !!address } });
  const tokens = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [address ?? "0x0000000000000000000000000000000000000000"], chainId: base.id },
      { address: WETH, abi: erc20Abi, functionName: "balanceOf", args: [address ?? "0x0000000000000000000000000000000000000000"], chainId: base.id },
    ],
    query: { enabled: !!address },
  });
  const usdc = tokens.data?.[0]?.result as bigint | undefined;
  const weth = tokens.data?.[1]?.result as bigint | undefined;

  useEffect(() => {
    let alive = true;
    void fetch("/api/health", { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, body: (await r.json()) as { ok?: boolean; status?: number; error?: string } }))
      .then(({ ok, body }) => {
        if (!alive) return;
        setFlash(
          ok && body.ok
            ? { tone: "good", label: "online", detail: "API key accepted; asset search reachable." }
            : { tone: "bad", label: "unreachable", detail: body.error ?? `HTTP ${body.status ?? "error"}` },
        );
      })
      .catch(() => alive && setFlash({ tone: "bad", label: "unreachable", detail: "Request failed." }));
    void fetch("/api/market/weth", { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, body: (await r.json()) as { updatedAt?: string; error?: string } }))
      .then(({ ok, body }) => {
        if (!alive) return;
        setMarket(
          ok
            ? { tone: "good", label: "online", detail: `Base WETH/USDC candles${body.updatedAt ? ` · updated ${new Date(body.updatedAt).toLocaleTimeString()}` : ""}` }
            : { tone: "warn", label: "degraded", detail: body.error ?? "Market data unavailable; charts are hidden, never substituted." },
        );
      })
      .catch(() => alive && setMarket({ tone: "warn", label: "degraded", detail: "Request failed." }));
    return () => {
      alive = false;
    };
  }, []);

  const onBase = chainId === base.id;
  const storeCheck: Check = state
    ? { tone: "good", label: "loaded", detail: `${state.strategies.length} plans · ${state.proposals.length} proposals · ${state.receipts.length} receipts (local JSON demo store)` }
    : { tone: "neutral", label: "loading", detail: "Reading /api/state." };

  return (
    <div>
      <PageHeader
        eyebrow="Workspace settings"
        title="Wallet & connections"
        description="Your wallet is the only authority that can sign a PACT order. This page shows what is connected and which services PACT can reach."
      />

      {isDemo ? (
        <div className="mb-4 rounded-lg border border-dashed border-line bg-panel px-4 py-3 text-[12.5px] text-mute">
          The Viewing selector is on a demo desk. This page always shows your own connected wallet.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Wallet" layer="wallet" actions={<Connect />} bodyClassName="px-4 py-2">
          {isConnected && address ? (
            <dl>
              <KV k="Address" v={<span className="font-mono text-[12px]">{address}</span>} />
              <KV
                k="Network"
                v={
                  onBase ? (
                    <StatusBadge tone="good" icon="●">
                      Base mainnet
                    </StatusBadge>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <StatusBadge tone="warn" icon="!">
                        chain {chainId ?? "unknown"}
                      </StatusBadge>
                      <button type="button" className="btn py-1" disabled={switching} onClick={() => switchChain({ chainId: base.id })}>
                        {switching ? "Switching…" : "Switch to Base"}
                      </button>
                    </span>
                  )
                }
              />
              <KV k="Connector" v="Injected browser wallet" />
            </dl>
          ) : (
            <p className="py-6 text-center text-[12.5px] text-mute">Connect a dedicated follower wallet. PACT never asks for a private key or seed phrase.</p>
          )}
        </Panel>

        <Panel title="Balances on Base" subtitle="Read from Base RPC; independent of PACT's store" layer="wallet" bodyClassName="px-4 py-2">
          {address ? (
            <dl>
              <KV k="ETH (gas)" v={eth.isLoading ? "…" : fmtUnits(eth.data?.value, 18, 6)} />
              <KV k="USDC" v={tokens.isLoading ? "…" : fmtUnits(usdc, 6, 2)} />
              <KV k="WETH" v={tokens.isLoading ? "…" : fmtUnits(weth, 18, 6)} />
              {eth.error || tokens.error ? <p className="py-2 text-[11.5px] text-bad">Could not read balances over Base RPC.</p> : null}
            </dl>
          ) : (
            <p className="py-6 text-center text-[12.5px] text-mute">No wallet connected.</p>
          )}
        </Panel>

        <Panel title="Connections" subtitle="Services PACT depends on" bodyClassName="px-4 py-2">
          <dl>
            <ConnectionRow name="Definitive Flash" layer={<LayerTag layer="execution" compact />} check={flash} />
            <ConnectionRow name="GeckoTerminal market data" layer={<LayerTag layer="market" compact />} check={market} />
            <ConnectionRow name="PACT policy store" layer={<LayerTag layer="policy" compact />} check={storeCheck} />
          </dl>
        </Panel>

        <Panel title="Trust boundaries" subtitle="Who can do what" bodyClassName="px-4 py-3">
          <ul className="space-y-2.5 text-[12.5px] leading-relaxed">
            {[
              ["PACT never holds a private key or custody of funds.", "good"],
              ["You self-sign every approval, permit, order, bracket and cancel in your wallet.", "good"],
              ["Your browser re-checks Flash's signing payload before the wallet prompt.", "good"],
              ["Assist can only queue reviews; it cannot quote, sign, submit or cancel.", "good"],
              ["Pausing a leader stops new copies; it does not cancel orders already on Flash.", "warn"],
            ].map(([text, tone]) => (
              <li key={text} className="flex gap-2.5">
                <span aria-hidden className={tone === "good" ? "text-good" : "text-warn"}>
                  {tone === "good" ? "✓" : "!"}
                </span>
                <span className="text-ink/90">{text}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <Planned title="Smart-account session key">
          Revocable, expiry-bound authority scoped to Flash contracts, assets, sides and limits. Required before Autopilot exists.
        </Planned>
        <Planned title="World ID">
          Unique-human eligibility for a public leader directory, or a step-up before a material Autopilot mandate. Never wallet authorization.
        </Planned>
        <Planned title="Arc live validation">
          Arc is configured (chain 5042) but has no recorded PACT quote, sign and fill yet.
        </Planned>
      </div>
    </div>
  );
}

function ConnectionRow({ name, layer, check }: { name: string; layer: React.ReactNode; check: Check | null }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line-2 py-2.5 last:border-b-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[12.5px] text-ink">
          {name}
          {layer}
        </div>
        <div className="mt-0.5 text-[11.5px] text-mute">{check?.detail ?? "Checking…"}</div>
      </div>
      <StatusBadge tone={check?.tone ?? "neutral"} icon={check?.tone === "good" ? "●" : check?.tone === "bad" ? "✕" : "◷"}>
        {check?.label ?? "checking"}
      </StatusBadge>
    </div>
  );
}
