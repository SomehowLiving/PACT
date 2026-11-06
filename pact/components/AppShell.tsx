"use client";

import { Connect } from "@/components/Connect";
import { DeskProvider, useDeskContext } from "@/components/DeskContext";
import { LayerTag } from "@/components/ui";
import { shortAddr } from "@/lib/format";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { erc20Abi, formatUnits } from "viem";
import { useAccount, useBalance, useDisconnect, useReadContracts, useSwitchChain } from "wagmi";

/* ── Desk counts shared by nav, bell and status bar ───────────────────── */

const CLOSED = ["ORDER_STATUS_FILLED", "ORDER_STATUS_CANCELLED", "ORDER_STATUS_REJECTED", "ORDER_STATUS_TERMINATED"];

function useDeskCounts() {
  const { state, follower, policy } = useDeskContext();
  const f = follower?.toLowerCase();
  const mine = f ? (state?.proposals ?? []).filter((p) => p.follower.toLowerCase() === f) : [];
  const receiptOf = new Map((state?.receipts ?? []).map((r) => [r.proposalId, r]));
  const awaiting = mine.filter((p) => {
    const d = state?.decisions[p.id];
    return d && d.verdict !== "BLOCK" && !receiptOf.get(p.id)?.flashOrderId;
  }).length;
  const live = (state?.receipts ?? []).filter(
    (r) => r.flashOrderId && f && r.follower.toLowerCase() === f && !CLOSED.includes(r.status ?? ""),
  ).length;
  return { awaiting, live, following: policy.follows?.length ?? 0 };
}


/* ── Navigation model ─────────────────────────────────────────────────── */
/*
 * One navigation system (PACT_UI_DESIGN_RULES §3), no destination listed twice:
 *  - header: the five workspaces;
 *  - rail, top: the sections of the workspace you are in (its local navigation);
 *  - rail, bottom: what is yours (My Plans, Mandate, Settings), the same on every page;
 *  - account menu: the wallet itself (value, desk, disconnect) and the tools.
 * Every route belongs to exactly one of these, so the header or the rail always shows where
 * you are.
 */

type Count = "following" | "awaiting" | "live";
type RailIcon = "leaders" | "star" | "eye" | "plus" | "shield" | "gear" | "inbox" | "spark" | "pie" | "home" | "list" | "clock";
type Section = { href: string; label: string; icon: RailIcon; match?: string[]; count?: Count };
type Workspace = { href: string; label: string; match: string[]; count?: Count; sections: Section[] };

const WORKSPACES: Workspace[] = [
  { href: "/trade", label: "Trade", match: ["/trade"], sections: [] },
  {
    href: "/discover",
    label: "Discover",
    match: ["/discover", "/following", "/watchlist", "/leaders", "/plans"],
    sections: [
      { href: "/discover", label: "Leaders", icon: "leaders", match: ["/leaders", "/plans"] },
      { href: "/following", label: "Following", icon: "star", count: "following" },
      { href: "/watchlist", label: "Watchlist", icon: "eye" },
    ],
  },
  {
    href: "/proposals",
    label: "Proposals",
    match: ["/proposals", "/review", "/assist"],
    count: "awaiting",
    sections: [
      { href: "/proposals", label: "Proposal inbox", icon: "inbox", count: "awaiting", match: ["/review"] },
      { href: "/assist", label: "PACT Assist", icon: "spark" },
    ],
  },
  {
    href: "/portfolio",
    label: "Portfolio",
    match: ["/portfolio", "/"],
    sections: [
      { href: "/portfolio", label: "Positions & exposure", icon: "pie" },
      { href: "/", label: "Desk overview", icon: "home" },
    ],
  },
  {
    href: "/execution",
    label: "Orders",
    match: ["/execution", "/orders", "/history"],
    count: "live",
    sections: [
      { href: "/execution", label: "Orders & receipts", icon: "list", match: ["/orders"] },
      { href: "/history", label: "Activity log", icon: "clock" },
    ],
  },
];

/** Yours, on every page: the plans you publish, your mandate, your wallet settings. */
const YOU: Section[] = [
  { href: "/leader", label: "My Plans", icon: "plus", match: ["/leader/classic"] },
  { href: "/settings/mandate", label: "Mandate", icon: "shield" },
  { href: "/settings/wallet", label: "Settings", icon: "gear", match: ["/settings/preferences"] },
];

const GLOBAL = WORKSPACES;

const TOOL_LINKS: { href: string; label: string }[] = [
  { href: "/lab", label: "Demo lab · how PACT works" },
  { href: "/follower", label: "Classic desk" },
  { href: "/leader/classic", label: "Classic leader ticket" },
];

/** "/" matches only itself; anything else matches the route and everything below it. */
function active(path: string, href: string, match?: string[]) {
  const hit = (h: string) => (h === "/" ? path === "/" : path === h || path.startsWith(`${h}/`));
  return hit(href) || !!match?.some(hit);
}

function workspaceOf(path: string) {
  return WORKSPACES.find((w) => active(path, w.href, w.match));
}

/* ── Wallet value (account menu) ──────────────────────────────────────── */

const BASE_ID = 8453;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const WETH = "0x4200000000000000000000000000000000000006" as const;

/** Real wallet value on Base (ETH + USDC + WETH at the Flash WETH price). No history, so no % change. */
function WalletValue({ wethPrice }: { wethPrice?: number }) {
  const { address, isDemo, policy } = useDeskContext();
  const enabled = !!address && !isDemo;
  const eth = useBalance({ address, chainId: BASE_ID, query: { enabled } });
  const tokens = useReadContracts({
    contracts: [
      { address: USDC, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined, chainId: BASE_ID },
      { address: WETH, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined, chainId: BASE_ID },
    ],
    query: { enabled },
  });
  const ethAmt = eth.data ? Number(formatUnits(eth.data.value, eth.data.decimals)) : undefined;
  const usdc = tokens.data?.[0]?.result as bigint | undefined;
  const weth = tokens.data?.[1]?.result as bigint | undefined;
  const usdcAmt = usdc !== undefined ? Number(formatUnits(usdc, 6)) : undefined;
  const wethAmt = weth !== undefined ? Number(formatUnits(weth, 18)) : undefined;
  const total =
    wethPrice && ethAmt !== undefined && usdcAmt !== undefined && wethAmt !== undefined
      ? usdcAmt + (ethAmt + wethAmt) * wethPrice
      : undefined;

  return (
    <div className="rounded-md border border-line bg-bg/60 px-3 py-2.5">
      <div className="flex items-center justify-between text-[11.5px] text-mute">
        <span>{isDemo ? "Demo desk" : "Wallet value · Base"}</span>
        <LayerTag layer={isDemo ? "demo" : "wallet"} compact />
      </div>
      {isDemo ? (
        <>
          <div className="mt-1 truncate text-[15px] font-semibold text-ink">{policy.label}</div>
          <div className="mt-0.5 text-[11px] text-mute">Seeded addresses hold no funds</div>
        </>
      ) : !address ? (
        <div className="mt-1 text-[12px] text-mute">Connect to read Base balances</div>
      ) : (
        <>
          <div className="mt-1 text-[18px] font-semibold tnum text-ink">
            {total === undefined ? "…" : `$${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </div>
          <div className="mt-0.5 truncate text-[11px] tnum text-mute">
            {usdcAmt === undefined ? "reading Base RPC…" : `${usdcAmt.toFixed(2)} USDC · ${(wethAmt ?? 0).toFixed(4)} WETH · ${(ethAmt ?? 0).toFixed(4)} ETH`}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Health ───────────────────────────────────────────────────────────── */

type Health = { ok?: boolean; price?: number | string; latencyMs?: number; error?: string };

/** One health poll for the whole shell (the API caches Flash for 30s). */
function useHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    const load = () =>
      void fetch("/api/health", { cache: "no-store" })
        .then((r) => r.json())
        .then((j: Health) => setHealth(j))
        .catch(() => setHealth({ ok: false, error: "unreachable" }));
    const first = setTimeout(load, 0);
    const id = setInterval(load, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  return health;
}

/* ── Header ───────────────────────────────────────────────────────────── */

function CountPill({ value, strong = false }: { value: number; strong?: boolean }) {
  if (!value) return null;
  return (
    <span
      className={`ml-1.5 min-w-[18px] rounded-full px-1.5 text-center font-sans text-[10.5px] font-semibold leading-[17px] tnum ${strong ? "bg-[var(--accent-strong)] text-[var(--accent-ink)]" : "bg-panel-3 text-ink"}`}
    >
      {value}
    </span>
  );
}

/** Close a popover on outside click or Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 10 10" aria-hidden className={`text-mute transition-transform ${open ? "rotate-180" : ""}`}>
      <path d="m2.5 3.8 2.5 2.5 2.5-2.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** Network pill: the wallet's chain, plus Flash's status and the WETH price (the old status bar). */
function NetworkMenu({ health }: { health: Health | null }) {
  const { chainId, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  const counts = useDeskCounts();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const name = chainId === 5042 ? "Arc" : chainId === 8453 || !isConnected ? "Base" : `Chain ${chainId}`;
  const supported = !isConnected || chainId === 8453 || chainId === 5042;
  const price = Number(health?.price);
  return (
    <div className="relative hidden sm:block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={supported ? `${name}: network for quotes and signing` : "Unsupported network"}
        className={`btn h-10 gap-2 px-4 text-[14px] ${supported ? "" : "border-[var(--bad)] text-bad"}`}
      >
        <span aria-hidden className={`h-3 w-3 rounded-full ${name === "Arc" ? "bg-[#8b5cf6]" : supported ? "bg-[#2f6bff]" : "bg-[var(--bad)]"}`} />
        {name}
        <Chevron open={open} />
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 top-12 z-50 w-[260px] rounded-xl border border-line bg-panel p-2 shadow-2xl">
          {[
            { id: 8453, label: "Base", dot: "bg-[#2f6bff]" },
            { id: 5042, label: "Arc", dot: "bg-[#8b5cf6]" },
          ].map((c) => (
            <button
              key={c.id}
              type="button"
              role="menuitem"
              disabled={!isConnected}
              onClick={() => {
                switchChain({ chainId: c.id as 8453 | 5042 });
                close();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-ink/90 hover:bg-panel-2 disabled:cursor-default disabled:hover:bg-transparent"
              title={isConnected ? `Switch the wallet to ${c.label}` : "Connect a wallet to switch networks"}
            >
              <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${c.dot}`} />
              {c.label}
              {name === c.label ? <span className="ml-auto text-[11px] text-mute">current</span> : null}
            </button>
          ))}
          <dl className="mt-1.5 space-y-1.5 border-t border-line px-2.5 pt-2 text-[12px]">
            <div className="flex justify-between">
              <dt className="text-mute">Definitive Flash</dt>
              <dd className={health === null ? "text-mute" : health.ok ? "text-good" : "text-bad"}>
                {health === null ? "checking" : health.ok ? `online · ${health.latencyMs ?? "—"} ms` : "unreachable"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-mute">WETH (Flash)</dt>
              <dd className="tnum text-ink">{Number.isFinite(price) && price > 0 ? `$${price.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-mute">Live orders</dt>
              <dd className="tnum text-ink">{counts.live}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  );
}

function WalletGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden className="text-mute">
      <rect x="2" y="3.5" width="12" height="9.5" rx="1.8" />
      <path d="M10 8.2h4" />
      <circle cx="10.8" cy="8.2" r=".6" fill="currentColor" />
    </svg>
  );
}

/** The wallet pill is the account menu: value, desk, settings, tools, disconnect. */
function WalletMenu({ wethPrice }: { wethPrice?: number }) {
  const { viewAs, setViewAs, demoDesks, isDemo } = useDeskContext();
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  if (!isConnected || !address) {
    // Without a wallet the menu still holds settings, the activity log and the tools.
    return (
      <div className="relative flex items-center gap-2" ref={ref}>
        {demoDesks.length ? <DeskSelect compact /> : null}
        <Connect />
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="Account menu"
          title="Desk and tools"
          className="btn h-10 w-10 p-0"
        >
          <WalletGlyph />
        </button>
        {open ? (
          <div role="menu" className="absolute right-0 top-12 z-50 w-[300px] rounded-xl border border-line bg-panel p-2 shadow-2xl">
            <p className="px-2 py-1.5 text-[12px] leading-relaxed text-mute">
              {isDemo ? "Viewing a read-only DEMO desk. Connect a wallet to act." : "Connect a wallet to see its value and act."}
            </p>
            <MenuLinks onClose={close} />
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`btn h-10 gap-2.5 px-4 font-mono text-[13.5px] ${isDemo ? "border-dashed" : ""}`}
        title="Account, desk and settings"
      >
        {isDemo ? <span className="font-sans text-[11px] text-mute">DEMO</span> : null}
        {shortAddr(address)}
        <WalletGlyph />
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 top-12 z-50 w-[300px] rounded-xl border border-line bg-panel p-2 shadow-2xl">
          <WalletValue wethPrice={wethPrice} />
          <label className="mt-2 block px-1 text-[11px] text-mute">
            Desk to view
            <select value={viewAs} onChange={(e) => setViewAs(e.target.value as "wallet" | `0x${string}`)} aria-label="Desk to view" className="field mt-1 w-full py-1.5">
              <option value="wallet">My desk · {shortAddr(address)}</option>
              {demoDesks.map((p) => (
                <option key={p.follower} value={p.follower}>
                  DEMO · {p.label}
                </option>
              ))}
            </select>
          </label>
          <MenuLinks onClose={close} />
          <button
            type="button"
            onClick={() => {
              disconnect();
              close();
            }}
            className="mt-1 w-full rounded px-2 py-1.5 text-left text-[12.5px] text-mute hover:bg-panel-2 hover:text-ink"
          >
            Disconnect wallet
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Desk picker for visitors without a wallet: the seeded DEMO desks. */
function DeskSelect({ compact = false }: { compact?: boolean }) {
  const { viewAs, setViewAs, demoDesks, address } = useDeskContext();
  return (
    <select
      value={viewAs}
      onChange={(e) => setViewAs(e.target.value as "wallet" | `0x${string}`)}
      aria-label="Desk to view"
      className={`field hidden h-10 w-auto rounded-full py-1.5 pl-4 pr-8 text-[13px] md:block ${compact ? "" : ""} ${viewAs !== "wallet" ? "border-dashed" : ""}`}
    >
      <option value="wallet">{address ? `My desk · ${shortAddr(address)}` : "My desk"}</option>
      {demoDesks.map((p) => (
        <option key={p.follower} value={p.follower}>
          DEMO · {p.label}
        </option>
      ))}
    </select>
  );
}

/** Tools live only here; settings and logs are in the rail. */
function MenuLinks({ onClose }: { onClose: () => void }) {
  return (
    <div className="mt-2 border-t border-line pt-1.5">
      <div className="px-2 pb-0.5 text-[10.5px] uppercase tracking-wide text-mute">Tools</div>
      <ul>
        {TOOL_LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} onClick={onClose} role="menuitem" className="block rounded px-2 py-1.5 text-[12.5px] text-mute hover:bg-panel-2 hover:text-ink">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Header({ path, onOpenDrawer, wethPrice, health }: { path: string; onOpenDrawer: () => void; wethPrice?: number; health: Health | null }) {
  const counts = useDeskCounts();
  return (
    <header className="sticky top-0 z-30 flex h-[76px] items-center gap-3 bg-bg/80 px-4 backdrop-blur-md lg:px-8">
      <button type="button" onClick={onOpenDrawer} className="btn btn-ghost h-10 w-10 border-transparent p-0 text-mute hover:text-ink lg:hidden" aria-label="Open navigation">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
          <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
        </svg>
      </button>
      <Link href="/" className="mr-6 flex shrink-0 items-start font-[family-name:var(--font-serif)] text-[32px] leading-none tracking-[0.02em] text-ink lg:mr-0 lg:w-[218px]" title="PACT · desk overview">
        PACT
        <span className="ml-0.5 -mt-1 text-[18px] text-ink/80" aria-hidden>
          +
        </span>
      </Link>
      {/* The logo spans the rail (250px less the header's 32px padding; the 12px item gap plus
          4px here plus the link padding puts the first label on the content edge). */}
      <nav className="hidden items-stretch self-stretch lg:flex lg:pl-1" aria-label="Workspaces">
        {GLOBAL.map((w) => {
          const on = active(path, w.href, w.match);
          return (
            <Link
              key={w.href}
              href={w.href}
              aria-current={on ? "page" : undefined}
              className={`relative flex items-center px-4 font-[family-name:var(--font-serif)] text-[19px] transition-colors ${on ? "text-ink" : "text-ink/60 hover:text-ink"}`}
            >
              {w.label}
              {w.count ? <CountPill value={counts[w.count]} strong={w.count === "awaiting"} /> : null}
              {on ? <span aria-hidden className="absolute inset-x-4 bottom-[18px] h-[2px] rounded-full bg-[var(--accent-strong)]" /> : null}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto flex min-w-0 items-center gap-3">
        <NetworkMenu health={health} />
        <WalletMenu wethPrice={wethPrice} />
      </div>
    </header>
  );
}

/* ── Left rail ────────────────────────────────────────────────────────── */


function RailGlyph({ name }: { name: RailIcon }) {
  const p = { width: 18, height: 18, viewBox: "0 0 18 18", fill: "none", stroke: "currentColor", strokeWidth: 1.35, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "leaders":
      return <svg {...p}><circle cx="7" cy="6.2" r="2.6" /><path d="M2.5 14.5c.5-2.4 2.3-3.8 4.5-3.8s4 1.4 4.5 3.8" /><path d="M12 4a2.4 2.4 0 0 1 0 4.6M13.6 10.9c1.2.6 1.9 1.8 2.1 3.5" /></svg>;
    case "star":
      return <svg {...p}><path d="m9 2.6 1.9 4 4.3.5-3.2 2.9.9 4.3L9 12.1l-3.9 2.2.9-4.3-3.2-2.9 4.3-.5Z" /></svg>;
    case "eye":
      return <svg {...p}><path d="M1.8 9S4.5 4 9 4s7.2 5 7.2 5-2.7 5-7.2 5-7.2-5-7.2-5Z" /><circle cx="9" cy="9" r="2.2" /></svg>;
    case "plus":
      return <svg {...p}><path d="M9 3.5v11M3.5 9h11" /></svg>;
    case "shield":
      return <svg {...p}><path d="M9 2.5 14 4.4v4.3c0 3.1-2.1 5.6-5 6.8-2.9-1.2-5-3.7-5-6.8V4.4Z" /><path d="m6.8 9 1.6 1.6L11.4 7.6" /></svg>;
    case "inbox":
      return <svg {...p}><path d="M2.5 10.5 4.6 4h8.8l2.1 6.5V14H2.5Z" /><path d="M2.5 10.5h3.8l.9 1.6h3.6l.9-1.6h3.8" /></svg>;
    case "spark":
      return <svg {...p}><path d="M7.5 3 8.8 7.2 13 8.5 8.8 9.8 7.5 14 6.2 9.8 2 8.5 6.2 7.2Z" /><path d="M13.5 2.5 14 4l1.5.5L14 5l-.5 1.5L13 5l-1.5-.5L13 4Z" /></svg>;
    case "pie":
      return <svg {...p}><path d="M9 2.5A6.5 6.5 0 1 0 15.5 9H9Z" /><path d="M11.2 2.8a6.5 6.5 0 0 1 4 4H11.2Z" /></svg>;
    case "home":
      return <svg {...p}><path d="m2.8 8.2 6.2-5 6.2 5" /><path d="M4.5 7v7.5h9V7" /></svg>;
    case "list":
      return <svg {...p}><path d="M6.5 4.5h9M6.5 9h9M6.5 13.5h9" /><circle cx="3" cy="4.5" r=".8" fill="currentColor" /><circle cx="3" cy="9" r=".8" fill="currentColor" /><circle cx="3" cy="13.5" r=".8" fill="currentColor" /></svg>;
    case "clock":
      return <svg {...p}><circle cx="9" cy="9" r="6.5" /><path d="M9 5.2V9l2.6 1.6" /></svg>;
    case "gear":
      return <svg {...p}><circle cx="9" cy="9" r="2.3" /><path d="M9 2.5v1.6M9 13.9v1.6M15.5 9h-1.6M4.1 9H2.5M13.6 4.4l-1.1 1.1M5.5 12.5l-1.1 1.1M13.6 13.6l-1.1-1.1M5.5 5.5 4.4 4.4" /></svg>;
  }
}

function RailLink({ item, path, onNavigate }: { item: Section; path: string; onNavigate?: () => void }) {
  const counts = useDeskCounts();
  // A section owns its route and the routes in its match list; "Settings" must not light up on Mandate.
  const on = active(path, item.href, item.match);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={on ? "page" : undefined}
      className={`flex items-center gap-3.5 rounded-xl px-4 py-3 text-[15px] transition-colors ${on ? "bg-panel-3 text-ink" : "text-ink/75 hover:bg-panel-2 hover:text-ink"}`}
    >
      <RailGlyph name={item.icon} />
      <span className="flex-1">{item.label}</span>
      {item.count ? <CountPill value={counts[item.count]} /> : null}
    </Link>
  );
}

/** The rail: this workspace's sections on top, what is yours below. */
function Rail({ path, onNavigate }: { path: string; onNavigate?: () => void }) {
  const ws = workspaceOf(path);
  const sections = ws?.sections ?? [];
  return (
    <nav aria-label="Workspace" className="flex h-full flex-col px-4 pt-6">
      {sections.length ? (
        <>
          <div className="px-4 pb-2 text-[11px] uppercase tracking-[0.12em] text-mute">{ws!.label}</div>
          <ul className="space-y-1.5">
            {sections.map((item) => (
              <li key={item.href}>
                <RailLink item={item} path={path} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <div className={sections.length ? "mt-5 border-t border-line pt-5" : ""}>
        <div className="px-4 pb-2 text-[11px] uppercase tracking-[0.12em] text-mute">You</div>
        <ul className="space-y-1.5">
          {YOU.map((item) => (
            <li key={item.href}>
              <RailLink item={item} path={path} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </div>
      {/* A faint ridge line at the foot of the rail. */}
      <svg aria-hidden viewBox="0 0 240 120" className="pointer-events-none mt-auto w-full opacity-60" preserveAspectRatio="none">
        <defs>
          <linearGradient id="ridge" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#8a6a45" stopOpacity="0.45" />
            <stop offset="1" stopColor="#0d0b09" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M0 70 L40 52 L70 64 L110 30 L140 50 L175 38 L210 58 L240 46 L240 120 L0 120 Z" fill="url(#ridge)" />
        <path d="M0 70 L40 52 L70 64 L110 30 L140 50 L175 38 L210 58 L240 46" fill="none" stroke="#b08d5b" strokeOpacity="0.35" strokeWidth="1" />
      </svg>
    </nav>
  );
}

/** Phone and tablet: workspaces and the rail in one drawer. */
function NavDrawer({ path, onClose }: { path: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
      <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close navigation" onClick={onClose} />
      <aside className="scroll-thin absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col overflow-y-auto border-r border-line bg-panel">
        <ul className="space-y-1 p-3">
          {GLOBAL.map((w) => (
            <li key={w.href}>
              <Link
                href={w.href}
                onClick={onClose}
                className={`block rounded-lg px-3 py-2 font-[family-name:var(--font-serif)] text-[18px] ${active(path, w.href, w.match) ? "bg-panel-3 text-ink" : "text-ink/75"}`}
              >
                {w.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="border-t border-line">
          <Rail path={path} onNavigate={onClose} />
        </div>
        <div className="border-t border-line p-3">
          <MenuLinks onClose={onClose} />
        </div>
      </aside>
    </div>
  );
}

function DemoBanner() {
  const { isDemo, policy, setViewAs } = useDeskContext();
  if (!isDemo) return null;
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-dashed border-line px-4 py-2 text-[12.5px] text-mute">
      <LayerTag layer="demo" />
      <span>
        Read-only DEMO desk <span className="text-ink">{policy.label}</span> · seeded data, not a real account
      </span>
      <button type="button" onClick={() => setViewAs("wallet")} className="ml-auto font-medium text-accent hover:underline">
        Back to my desk
      </button>
    </div>
  );
}

/* ── Frame ────────────────────────────────────────────────────────────── */

function Frame({ children }: { children: ReactNode }) {
  const path = usePathname();
  const health = useHealth();
  const [open, setOpen] = useState(false);
  const wethPrice = Number(health?.price) > 0 ? Number(health?.price) : undefined;
  const wide = path === "/trade";

  return (
    <div className="min-h-screen">
      {open ? <NavDrawer path={path} onClose={() => setOpen(false)} /> : null}
      <Header path={path} onOpenDrawer={() => setOpen(true)} wethPrice={wethPrice} health={health} />
      <div className="flex">
        {wide ? null : (
          <aside className="sticky top-[76px] hidden h-[calc(100vh-76px)] w-[250px] shrink-0 border-r border-line lg:block">
            <Rail path={path} />
          </aside>
        )}
        <main className={`min-w-0 flex-1 px-4 pb-14 lg:px-8 ${wide ? "pt-2" : "pt-6"}`}>
          <div className={wide ? "" : "mx-auto max-w-[1520px]"}>
            <DemoBanner />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <DeskProvider>
      <Frame>{children}</Frame>
    </DeskProvider>
  );
}
