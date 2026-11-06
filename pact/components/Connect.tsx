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
          <button type="button" onClick={() => switchChain({ chainId: base.id })} className="btn btn-danger">
            Switch to Base
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => disconnect()}
          title="Disconnect"
          className="btn gap-2 font-mono text-[12px]"
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--good)]" />
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
      className="btn btn-primary"
    >
      {isPending ? "Waiting for wallet…" : "Connect wallet"}
    </button>
  );
}
