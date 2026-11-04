"use client";

import { useCallback, useEffect, useState } from "react";
import type { DeskState } from "@/lib/types";

export type DeskPayload = DeskState & {
  dailySpentUsd: number;
  blockedNotionalUsd: number;
};

export function useDesk(follower?: string) {
  const [state, setState] = useState<DeskPayload | null>(null);

  const refresh = useCallback(async () => {
    const q = follower ? `?follower=${follower}` : "";
    const res = await fetch(`/api/state${q}`, { cache: "no-store" });
    const json = (await res.json()) as DeskPayload;
    setState(json);
  }, [follower]);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const id = setInterval(() => void refresh(), 2000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh]);

  return { state, refresh };
}
