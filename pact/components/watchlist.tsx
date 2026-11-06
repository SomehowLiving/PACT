"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/*
 * Watchlist: leaders this viewer is eyeing without following them. A per-browser
 * convenience, so it lives in localStorage; following (the mandate) stays on the server.
 * Falls back to memory when storage is blocked, so the page still works.
 */

const KEY = "pact.watchlist";
const EVENT = "pact:watchlist";
let memory = "[]";

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? memory;
  } catch {
    return memory;
  }
}

function write(value: string) {
  memory = value;
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // storage blocked: keep the in-memory copy
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

export function parseWatchlist(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return [...new Set(v.filter((x): x is string => typeof x === "string" && /^0x[0-9a-fA-F]{40}$/.test(x)).map((x) => x.toLowerCase()))];
  } catch {
    return [];
  }
}

export function useWatchlist() {
  const raw = useSyncExternalStore(subscribe, read, () => "[]");
  const list = useMemo(() => parseWatchlist(raw), [raw]);
  const has = useCallback((leader: string) => list.includes(leader.toLowerCase()), [list]);
  const toggle = useCallback(
    (leader: string) => {
      const l = leader.toLowerCase();
      write(JSON.stringify(list.includes(l) ? list.filter((x) => x !== l) : [...list, l]));
    },
    [list],
  );
  return { list, has, toggle };
}

/** Star toggle; does not follow, size or trade. */
export function WatchButton({ leader, compact = false, bare = false }: { leader: string; compact?: boolean; bare?: boolean }) {
  const { has, toggle } = useWatchlist();
  const on = has(leader);
  const label = on ? "Remove from watchlist" : "Add to watchlist";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggle(leader);
      }}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={bare ? `inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-panel-3 ${on ? "text-accent" : "text-mute hover:text-ink"}` : `btn ${compact ? "h-9 w-9" : "h-10 w-10"} p-0 ${on ? "text-accent" : ""}`}
    >
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
        <path d="M8 1.8 9.9 5.7l4.2.6-3 3 .7 4.2L8 11.5l-3.8 2 .7-4.2-3-3 4.2-.6Z" />
      </svg>
    </button>
  );
}
