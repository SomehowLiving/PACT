"use client";

import { Connect } from "@/components/Connect";
import { DeskProvider, useDeskContext } from "@/components/DeskContext";
import { Mark } from "@/components/Mark";
import { LayerTag } from "@/components/ui";
import { shortAddr } from "@/lib/format";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { erc20Abi, formatUnits } from "viem";
import { useAccount, useBalance, useReadContracts } from "wagmi";

/* ── Icons (16px, 1.4 stroke) ─────────────────────────────────────────── */

type IconName = "overview" | "discover" | "following" | "proposals" | "portfolio" | "execution" | "mandate" | "assist" | "more" | "bell" | "search";

function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  const p = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, className, "aria-hidden": true };
  switch (name) {
    case "overview":
      return <svg {...p}><path d="M2.5 7 8 2.5 13.5 7v6a.5.5 0 0 1-.5.5h-3v-4h-4v4H3a.5.5 0 0 1-.5-.5Z" /></svg>;
    case "discover":
      return <svg {...p}><circle cx="8" cy="8" r="5.5" /><path d="m10.2 5.8-1.4 3-3 1.4 1.4-3Z" /></svg>;
    case "following":
      return <svg {...p}><circle cx="6" cy="5.5" r="2.3" /><path d="M2 13c.4-2.2 2-3.5 4-3.5s3.6 1.3 4 3.5" /><path d="M10.5 3.5a2.2 2.2 0 0 1 0 4.2M12 9.8c1.2.5 1.9 1.6 2.1 3.2" /></svg>;
    case "proposals":
      return <svg {...p}><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2" /></svg>;
    case "portfolio":
      return <svg {...p}><path d="M8 2.5v5.5h5.5A5.5 5.5 0 1 1 8 2.5Z" /><path d="M10 2.8A5.5 5.5 0 0 1 13.2 6H10Z" /></svg>;
    case "execution":
      return <svg {...p}><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /><path d="M5 6h6M5 8.5h6M5 11h3.5" /></svg>;
    case "mandate":
      return <svg {...p}><path d="M3 4.5h10M3 8h10M3 11.5h10" /><circle cx="6" cy="4.5" r="1.2" fill="currentColor" /><circle cx="10.5" cy="8" r="1.2" fill="currentColor" /><circle cx="5" cy="11.5" r="1.2" fill="currentColor" /></svg>;
    case "assist":
      return <svg {...p}><path d="M6.5 2.5 7.6 6l3.4 1.1-3.4 1.1-1.1 3.5-1.1-3.5L2 7.1 5.4 6Z" /><path d="m12 9.5.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5Z" /></svg>;
    case "more":
      return <svg {...p}><circle cx="4" cy="8" r=".9" fill="currentColor" /><circle cx="8" cy="8" r=".9" fill="currentColor" /><circle cx="12" cy="8" r=".9" fill="currentColor" /></svg>;
    case "bell":
      return <svg {...p}><path d="M4 11V7.5a4 4 0 0 1 8 0V11l1 1.5H3Z" /><path d="M6.5 13.5a1.6 1.6 0 0 0 3 0" /></svg>;
    case "search":
      return <svg {...p}><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>;
  }
}

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
 * One global navigation (PACT_UI_DESIGN_RULES §3): five workspaces in the header, local tabs
 * inside each workspace, everything else in the account menu. Every existing route stays
 * reachable; no destination appears twice.
 */

type Count = "following" | "awaiting" | "live";

type Workspace = {
  href: string;
  label: string;
  /** Routes that belong to this workspace (segment-exact prefixes). */
  match: string[];
  count?: Count;
  tabs?: { href?: string; label: string; count?: Count; match?: string[]; planned?: string }[];
};

const WORKSPACES: Workspace[] = [
  { href: "/trade", label: "Trade", match: ["/trade"] },
  {
    href: "/discover",
    label: "Discover",
    match: ["/discover", "/following", "/leaders"],
    tabs: [
      { href: "/discover", label: "All leaders", match: ["/leaders"] },
      { href: "/following", label: "Following", count: "following" },
      { label: "Watchlist", planned: "Planned: save a leader to watch without following them" },
    ],
  },
  {
    href: "/proposals",
    label: "Plans",
    match: ["/proposals", "/review", "/plans", "/assist", "/leader"],
    count: "awaiting",
    tabs: [
      { href: "/proposals", label: "Proposal inbox", count: "awaiting", match: ["/review"] },
      { href: "/assist", label: "PACT Assist" },
      { href: "/leader", label: "My published plans" },
    ],
  },
  { href: "/portfolio", label: "Portfolio", match: ["/portfolio"] },
  {
    href: "/execution",
    label: "Orders",
    match: ["/execution", "/history"],
    count: "live",
    tabs: [
      { href: "/execution", label: "Orders & receipts" },
      { href: "/history", label: "Activity log" },
    ],
  },
  {
    href: "/settings/mandate",
    label: "Account",
    match: ["/settings"],
    tabs: [
      { href: "/settings/mandate", label: "Mandate & risk", match: ["/settings"] },
      { href: "/settings/wallet", label: "Wallet & Autopilot" },
      { href: "/settings/preferences", label: "Preferences" },
    ],
  },
];

/** Header destinations: the five workspaces. Account lives in the account menu. */
const GLOBAL = WORKSPACES.filter((w) => w.label !== "Account");

const ACCOUNT_LINKS: { href: string; label: string; hint?: string }[] = [
  { href: "/", label: "Desk overview" },
  { href: "/settings/mandate", label: "Mandate & risk" },
  { href: "/settings/wallet", label: "Wallet & Autopilot" },
  { href: "/settings/preferences", label: "Preferences" },
];

const TOOL_LINKS: { href: string; label: string }[] = [
  { href: "/lab", label: "Demo lab · how PACT works" },
  { href: "/follower", label: "Classic desk" },
  { href: "/leader/classic", label: "Classic leader ticket" },
];

function active(path: string, href: string, match?: string[]) {
  if (href === "/") return path === "/";
  return path === href || path.startsWith(`${href}/`) || !!match?.some((m) => path === m || path.startsWith(`${m}/`));
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
    <span className={`ml-1.5 min-w-[18px] rounded px-1 text-center text-[10.5px] font-semibold leading-[16px] tnum ${strong ? "bg-[var(--accent-strong)] text-white" : "bg-panel-3 text-ink"}`}>
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

function NetworkChip() {
  const { chainId, isConnected } = useAccount();
  const name = chainId === 8453 ? "Base" : chainId === 5042 ? "Arc" : isConnected ? `Chain ${chainId}` : "Base";
  const supported = !isConnected || chainId === 8453 || chainId === 5042;
  return (
    <Link
      href="/settings/wallet"
      title={supported ? `${name} · network for quotes and signing` : "Unsupported network: switch to Base or Arc in your wallet"}
      className={`hidden h-9 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] sm:inline-flex ${supported ? "border-line text-ink/85 hover:text-ink" : "border-[var(--bad)] text-bad"}`}
    >
      <span aria-hidden className={`h-2 w-2 rounded-full ${name === "Arc" ? "bg-[#8b5cf6]" : supported ? "bg-[#0052ff]" : "bg-[var(--bad)]"}`} />
      {name}
    </Link>
  );
}

function AccountMenu({ wethPrice }: { wethPrice?: number }) {
  const { viewAs, setViewAs, demoDesks, isDemo, address } = useDeskContext();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`btn h-9 gap-1.5 px-2.5 text-[12.5px] ${isDemo ? "border-dashed text-mute" : ""}`}
        title="Account, desk and settings"
      >
        <span className="max-w-[140px] truncate">{isDemo ? "Demo desk" : address ? shortAddr(address) : "Account"}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={`text-mute transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="m2.5 3.8 2.5 2.5 2.5-2.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 top-11 z-50 w-[300px] rounded-lg border border-line bg-panel p-2 shadow-xl">
          <WalletValue wethPrice={wethPrice} />
          <label className="mt-2 block px-1 text-[11px] text-mute">
            Desk to view
            <select
              value={viewAs}
              onChange={(e) => setViewAs(e.target.value as "wallet" | `0x${string}`)}
              aria-label="Desk to view"
              className="field mt-1 w-full py-1.5"
            >
              <option value="wallet">{address ? `My desk · ${shortAddr(address)}` : "My desk"}</option>
              {demoDesks.map((p) => (
                <option key={p.follower} value={p.follower}>
                  DEMO · {p.label}
                </option>
              ))}
            </select>
          </label>
          <ul className="mt-2 border-t border-line pt-1.5">
            {ACCOUNT_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={close} role="menuitem" className="block rounded px-2 py-1.5 text-[13px] text-ink/85 hover:bg-panel-2 hover:text-ink">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-1.5 border-t border-line pt-1.5">
            <div className="px-2 pb-0.5 text-[10.5px] uppercase tracking-wide text-mute">Tools</div>
            <ul>
              {TOOL_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} onClick={close} role="menuitem" className="block rounded px-2 py-1.5 text-[12.5px] text-mute hover:bg-panel-2 hover:text-ink">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-1.5 border-t border-line px-2 pt-2 text-[11px] text-mute">
            <span className="text-good">● Non-custodial.</span> You sign every order; Autopilot signs only inside an onchain-scoped session.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Header({ path, onOpenDrawer, wethPrice }: { path: string; onOpenDrawer: () => void; wethPrice?: number }) {
  const counts = useDeskCounts();
  const router = useRouter();
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-bg/95 px-3 backdrop-blur-md lg:px-4">
      <button type="button" onClick={onOpenDrawer} className="btn btn-ghost h-9 w-9 border-transparent p-0 text-mute hover:text-ink lg:hidden" aria-label="Open navigation">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
          <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
        </svg>
      </button>
      <Link href="/" className="mr-2 flex shrink-0 items-center gap-2" title="PACT · desk overview">
        <Mark size={22} />
        <span className="text-[16px] font-semibold tracking-[0.14em] text-ink">PACT</span>
      </Link>
      <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Workspaces">
        {GLOBAL.map((w) => {
          const on = active(path, w.href, w.match);
          return (
            <Link
              key={w.href}
              href={w.href}
              aria-current={on ? "page" : undefined}
              className={`flex items-center rounded-md px-3 py-1.5 text-[14px] transition-colors ${on ? "bg-panel-3 font-medium text-ink" : "text-ink/70 hover:text-ink"}`}
            >
              {w.label}
              {w.count ? <CountPill value={counts[w.count]} strong={w.count === "awaiting"} /> : null}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <form
          role="search"
          className="hidden min-w-0 shrink xl:block"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/discover${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
          }}
        >
          <label className="flex w-[min(300px,22vw)] min-w-[180px] items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 focus-within:border-accent">
            <Icon name="search" className="shrink-0 text-mute" />
            <input
              ref={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search leaders by address…"
              aria-label="Search leaders by address"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-mute"
            />
            <kbd className="rounded border border-line px-1.5 text-[10.5px] text-mute">⌘K</kbd>
          </label>
        </form>
        <Link href="/leader" className="btn hidden h-9 px-3 text-[12.5px] md:inline-flex" title="Publish a structured plan as a leader">
          Publish plan
        </Link>
        <Link href="/proposals" className="btn btn-ghost relative h-9 w-9 p-0" title="Plans awaiting your signature" aria-label={`${counts.awaiting} plans awaiting your signature`}>
          <Icon name="bell" />
          {counts.awaiting ? (
            <span className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-[var(--accent-strong)] px-1 text-[10px] font-semibold leading-4 tnum text-white">{counts.awaiting}</span>
          ) : null}
        </Link>
        <NetworkChip />
        <AccountMenu wethPrice={wethPrice} />
        <Connect />
      </div>
    </header>
  );
}

/** Local tabs of the current workspace, directly under the header. */
function WorkspaceTabs({ path }: { path: string }) {
  const counts = useDeskCounts();
  const ws = workspaceOf(path);
  if (!ws?.tabs) return null;
  return (
    <nav className="scroll-thin flex h-10 items-center gap-1 overflow-x-auto border-b border-line bg-panel/40 px-3 lg:px-4" aria-label={`${ws.label} views`}>
      <span className="mr-2 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-mute">{ws.label}</span>
      {ws.tabs.map((t) => {
        if (!t.href) {
          return (
            <span key={t.label} title={t.planned} className="shrink-0 cursor-not-allowed rounded-md px-2.5 py-1 text-[12.5px] text-mute/60">
              {t.label} <span className="text-[10px] uppercase">planned</span>
            </span>
          );
        }
        const on = active(path, t.href, t.match);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={`flex shrink-0 items-center rounded-md px-2.5 py-1 text-[12.5px] transition-colors ${on ? "bg-panel-3 font-medium text-ink" : "text-ink/70 hover:text-ink"}`}
          >
            {t.label}
            {t.count ? <CountPill value={counts[t.count]} strong={t.count === "awaiting"} /> : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** Phone and tablet: the same workspaces and tabs in a drawer (one navigation, not two). */
function NavDrawer({ path, onClose }: { path: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
      <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close navigation" onClick={onClose} />
      <aside className="scroll-thin absolute inset-y-0 left-0 w-[280px] max-w-[85vw] overflow-y-auto border-r border-line bg-panel p-3">
        <ul className="space-y-1">
          {WORKSPACES.map((w) => (
            <li key={w.href}>
              <Link
                href={w.href}
                onClick={onClose}
                className={`block rounded-md px-3 py-2 text-[14px] ${active(path, w.href, w.match) ? "bg-panel-3 font-medium text-ink" : "text-ink/80"}`}
              >
                {w.label}
              </Link>
              {w.tabs ? (
                <ul className="ml-3 border-l border-line pl-2">
                  {w.tabs
                    .filter((t) => t.href)
                    .map((t) => (
                      <li key={t.href}>
                        <Link href={t.href!} onClick={onClose} className={`block rounded px-2 py-1.5 text-[12.5px] ${active(path, t.href!, t.match) ? "text-ink" : "text-mute"}`}>
                          {t.label}
                        </Link>
                      </li>
                    ))}
                </ul>
              ) : null}
            </li>
          ))}
          <li className="border-t border-line pt-1">
            <Link href="/leader" onClick={onClose} className="block rounded-md px-3 py-2 text-[13px] text-accent">
              Publish plan
            </Link>
          </li>
          {TOOL_LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} onClick={onClose} className="block rounded-md px-3 py-1.5 text-[12.5px] text-mute">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function DemoBanner() {
  const { isDemo, policy, setViewAs } = useDeskContext();
  if (!isDemo) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-panel/60 px-4 py-1.5 text-[12px] text-mute lg:px-5">
      <LayerTag layer="demo" />
      <span>
        Read-only demo desk <span className="text-ink">{policy.label}</span> · seeded data, not a real account
      </span>
      <button type="button" onClick={() => setViewAs("wallet")} className="ml-auto font-medium text-accent hover:underline">
        Back to my desk
      </button>
    </div>
  );
}

/* ── Status bar ───────────────────────────────────────────────────────── */

function Item({ href, children, title }: { href?: string; children: ReactNode; title?: string }) {
  return href ? (
    <Link href={href} title={title} className="flex shrink-0 items-center gap-1.5 rounded px-2 py-1 hover:bg-panel-2 hover:text-ink">
      {children}
    </Link>
  ) : (
    <span title={title} className="flex shrink-0 items-center gap-1.5 px-2 py-1">
      {children}
    </span>
  );
}

function StatusBar({ health }: { health: Health | null }) {
  const counts = useDeskCounts();
  const [now, setNow] = useState("");
  useEffect(() => {
    const tick = () => setNow(new Date().toISOString().slice(11, 19));
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  const price = Number(health?.price);

  return (
    <footer className="scroll-thin fixed inset-x-0 bottom-0 z-30 flex h-8 items-center gap-1 overflow-x-auto border-t border-line bg-panel px-2 text-[11.5px] text-mute">
      <Item href="/proposals" title="Policy-approved plans awaiting your signature">
        Awaiting signature
        <span className={`rounded px-1 tnum ${counts.awaiting ? "bg-[var(--accent-strong)] text-white" : "bg-panel-3 text-mute"}`}>{counts.awaiting}</span>
      </Item>
      <Item href="/execution" title="Orders working on Flash">
        Live orders
        <span className={`rounded px-1 tnum ${counts.live ? "bg-[color-mix(in_oklab,var(--layer-exec)_30%,transparent)] text-ink" : "bg-panel-3 text-mute"}`}>{counts.live}</span>
      </Item>
      <Item href="/following" title="Selected leaders">
        Leaders <span className="tnum text-ink">{counts.following}/3</span>
      </Item>
      <span className="mx-1 h-3.5 w-px shrink-0 bg-line" aria-hidden />
      <Item title="WETH price reported by Definitive Flash">
        WETH <span className="tnum font-medium text-ink">{Number.isFinite(price) && price > 0 ? `$${price.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—"}</span>
      </Item>
      <div className="ml-auto flex shrink-0 items-center">
        <Item href="/settings/wallet" title={health?.error ?? "Definitive Flash API"}>
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${health === null ? "bg-mute" : health.ok ? "bg-[var(--good)]" : "bg-[var(--bad)]"}`} />
          {health === null ? "Flash checking" : health.ok ? "Flash online" : "Flash unreachable"}
          {health?.ok && health.latencyMs !== undefined ? <span className="tnum text-ink">{health.latencyMs} ms</span> : null}
        </Item>
        <Item title="Current time, UTC">
          <span className="tnum">{now}</span> UTC
        </Item>
      </div>
    </footer>
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
    <div className="min-h-screen bg-bg">
      {open ? <NavDrawer path={path} onClose={() => setOpen(false)} /> : null}
      <Header path={path} onOpenDrawer={() => setOpen(true)} wethPrice={wethPrice} />
      <WorkspaceTabs path={path} />
      <DemoBanner />
      <main className={`mx-auto w-full px-4 pb-14 lg:px-5 ${wide ? "max-w-none pt-4" : "max-w-[1480px] pt-5"}`}>{children}</main>
      <StatusBar health={health} />
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
