"use client";

import { shortAddr } from "@/lib/format";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { base } from "wagmi/chains";

export function Connect() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const injected = connectors.find((c) => c.id === "injected") ?? connectors[0];

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        {chainId !== base.id ? (
          <button
            type="button"
            onClick={() => switchChain({ chainId: base.id })}
            className="rounded-full bg-rose/20 px-3 py-1.5 text-xs text-rose"
          >
            switch to base
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => disconnect()}
          className="hairline rounded-full bg-white/5 px-3 py-1.5 font-mono text-[11px] tracking-wide text-ink/90"
        >
          {shortAddr(address)}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={!injected || isPending}
      onClick={() => injected && connect({ connector: injected })}
      className="btn-cream rounded-full px-4 py-1.5 text-[13px] font-medium"
    >
      {isPending ? "waiting…" : "connect"}
    </button>
  );
}
