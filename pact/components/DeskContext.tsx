"use client";

import { useDesk, type DeskPayload } from "@/components/useDesk";
import { defaultPolicy } from "@/lib/constants";
import type { Policy } from "@/lib/types";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { registerSignIn, signInWith } from "@/lib/api";

const VIEW_KEY = "pact.viewAs";

type DeskContextValue = {
  state: DeskPayload | null;
  refresh: () => Promise<void>;
  /** Follower whose desk is shown: the connected wallet, or a seeded demo desk. */
  follower?: `0x${string}`;
  /** True when viewing a seeded demo desk. Demo desks are read-only. */
  isDemo: boolean;
  /** Seeded demo desks available to view (policies carrying a demo label). */
  demoDesks: Policy[];
  viewAs: "wallet" | `0x${string}`;
  setViewAs: (value: "wallet" | `0x${string}`) => void;
  policy: Policy;
  address?: `0x${string}`;
  isConnected: boolean;
  /** Only the connected wallet viewing its own desk can change a mandate or sign. */
  canAct: boolean;
};

const Ctx = createContext<DeskContextValue | null>(null);

const PREVIEW = defaultPolicy("0x0000000000000000000000000000000000000000");

function readViewAs(): "wallet" | `0x${string}` {
  try {
    const value = localStorage.getItem(VIEW_KEY);
    if (value && /^0x[0-9a-fA-F]{40}$/.test(value)) return value as `0x${string}`;
  } catch {
    /* storage unavailable */
  }
  return "wallet";
}

export function DeskProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount();
  const [viewAs, setViewAsState] = useState<"wallet" | `0x${string}`>("wallet");

  useEffect(() => {
    // Restore after hydration so server and client render the same first frame.
    const id = setTimeout(() => {
      const stored = readViewAs();
      if (stored !== "wallet") setViewAsState(stored);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  const setViewAs = useCallback((value: "wallet" | `0x${string}`) => {
    setViewAsState(value);
    try {
      localStorage.setItem(VIEW_KEY, value);
    } catch {
      /* storage unavailable */
    }
  }, []);

  // Writes need a wallet session; the first write that hits a 401 asks the wallet to sign in.
  const { signMessageAsync } = useSignMessage();
  useEffect(() => {
    if (!address) {
      registerSignIn(null);
      return;
    }
    registerSignIn(() => signInWith(address, (message) => signMessageAsync({ message })));
    return () => registerSignIn(null);
  }, [address, signMessageAsync]);

  const follower = viewAs === "wallet" ? address : viewAs;
  const { state, refresh } = useDesk(follower);

  useEffect(() => {
    if (!address || viewAs !== "wallet") return;
    // Reads the saved mandate; a wallet with none gets the defaults (unsaved until it edits).
    void fetch(`/api/policy?follower=${address}`).then(() => refresh());
  }, [address, viewAs, refresh]);

  const value = useMemo<DeskContextValue>(() => {
    const demoDesks = (state?.policies ?? []).filter((p) => p.label);
    const policy =
      state?.policies.find((p) => follower && p.follower.toLowerCase() === follower.toLowerCase()) ??
      (follower ? defaultPolicy(follower) : PREVIEW);
    const isDemo = viewAs !== "wallet";
    return {
      state,
      refresh,
      follower,
      isDemo,
      demoDesks,
      viewAs,
      setViewAs,
      policy,
      address,
      isConnected,
      canAct: !isDemo && isConnected && !!address,
    };
  }, [state, refresh, follower, viewAs, setViewAs, address, isConnected]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDeskContext() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useDeskContext must be used inside DeskProvider");
  return value;
}

/** Proposals belonging to the viewed follower, newest first. */
export function useMine() {
  const { state, follower } = useDeskContext();
  return useMemo(
    () =>
      follower
        ? (state?.proposals ?? []).filter((p) => p.follower.toLowerCase() === follower.toLowerCase())
        : [],
    [state?.proposals, follower],
  );
}
