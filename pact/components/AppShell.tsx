"use client";

import { Connect } from "@/components/Connect";
import { DeskProvider, useDeskContext } from "@/components/DeskContext";
import { Mark } from "@/components/Mark";
import { LayerTag } from "@/components/ui";
import { shortAddr } from "@/lib/format";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { erc20Abi, formatUnits } from "viem";
import { useBalance, useReadContracts } from "wagmi";

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

type NavItem = { href: string; label: string; icon: IconName; count?: "following" | "awaiting"; match?: string[] };

const PRIMARY: NavItem[] = [
  { href: "/", label: "Overview", icon: "overview" },
  { href: "/discover", label: "Discover", icon: "discover" },
  { href: "/following", label: "Following", icon: "following", count: "following" },
  { href: "/proposals", label: "Proposals", icon: "proposals", count: "awaiting", match: ["/review"] },
  { href: "/portfolio", label: "Portfolio", icon: "portfolio" },
  { href: "/execution", label: "Execution", icon: "execution" },
];

const SECONDARY: NavItem[] = [
  { href: "/settings/mandate", label: "Mandate", icon: "mandate" },
  { href: "/assist", label: "PACT Assist", icon: "assist" },
];

const MORE: { href: string; label: string }[] = [
  { href: "/leader", label: "Publish a plan" },
  { href: "/settings/wallet", label: "Wallet & connections" },
  { href: "/settings/preferences", label: "Preferences" },
  { href: "/lab", label: "Demo lab" },
  { href: "/history", label: "Activity log" },
  { href: "/follower", label: "Classic desk" },
  { href: "/leader/classic", label: "Classic leader ticket" },
];

const TOP_TABS: { href: string; label: string; match?: string[] }[] = [
  { href: "/trade", label: "Trade", match: ["/review"] },
  { href: "/discover", label: "Leaders", match: ["/following"] },
  { href: "/proposals", label: "Plans", match: ["/leader"] },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/execution", label: "Receipts", match: ["/history"] },
];

function active(path: string, href: string, match?: string[]) {
  if (href === "/") return path === "/";
  return path === href || path.startsWith(`${href}/`) || !!match?.some((m) => path.startsWith(m));
}

/* ── Sidebar ──────────────────────────────────────────────────────────── */

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
    <div className="mx-3 rounded-lg border border-line bg-bg/60 px-3.5 py-3">
      <div className="flex items-center justify-between text-[11.5px] text-mute">
        <span>{isDemo ? "Demo desk" : "Wallet value"}</span>
        <LayerTag layer={isDemo ? "demo" : "wallet"} compact />
      </div>
      {isDemo ? (
        <>
          <div className="mt-1 truncate text-[15px] font-semibold text-ink">{policy.label}</div>
          <div className="mt-0.5 text-[11px] text-mute">Seeded addresses hold no funds</div>
        </>
      ) : !address ? (
        <>
          <div className="mt-1 text-[20px] font-semibold tnum text-mute">—</div>
          <div className="mt-0.5 text-[11px] text-mute">Connect to read Base balances</div>
        </>
      ) : (
        <>
          <div className="mt-1 text-[20px] font-semibold tracking-[-0.01em] tnum text-ink">
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

function NavRow({
  item,
  path,
  count,
  onNavigate,
  collapsed,
}: {
  item: NavItem;
  path: string;
  count: number;
  onNavigate: () => void;
  collapsed: boolean;
}) {
  const on = active(path, item.href, item.match);
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={on ? "page" : undefined}
        aria-label={collapsed ? item.label : undefined}
        title={collapsed ? (count ? `${item.label} · ${count}` : item.label) : undefined}
        className={`relative flex items-center rounded-md text-[13.5px] transition-colors ${
          collapsed ? "h-10 justify-center" : "gap-3 px-3 py-2"
        } ${on ? "bg-panel-3 font-medium text-ink" : "text-ink/75 hover:bg-panel-2 hover:text-ink"}`}
      >
        <Icon name={item.icon} className={on ? "text-ink" : "text-mute"} />
        {collapsed ? (
          count ? (
            <span className="absolute right-1.5 top-1 min-w-[15px] rounded-full bg-panel-3 px-1 text-center text-[9.5px] font-semibold leading-[15px] tnum text-ink ring-2 ring-[var(--panel)]">
              {count}
            </span>
          ) : null
        ) : (
          <>
            <span className="flex-1">{item.label}</span>
            {count ? <span className="min-w-[22px] rounded-md bg-panel-3 px-1.5 py-0.5 text-center text-[11px] font-medium tnum text-ink">{count}</span> : null}
          </>
        )}
      </Link>
    </li>
  );
}

function Sidebar({
  path,
  onNavigate,
  wethPrice,
  collapsed = false,
  onExpand,
}: {
  path: string;
  onNavigate: () => void;
  wethPrice?: number;
  collapsed?: boolean;
  onExpand?: () => void;
}) {
  const counts = useDeskCounts();
  const [moreOpen, setMoreOpen] = useState(() => MORE.some((m) => active(path, m.href)));
  const countOf = (item: NavItem) => (item.count ? counts[item.count] : 0);

  return (
    <div className="flex h-full flex-col">
      <Link
        href="/trade"
        onClick={onNavigate}
        title={collapsed ? "PACT" : undefined}
        className={`flex h-14 shrink-0 items-center border-b border-line ${collapsed ? "justify-center" : "gap-2.5 px-5"}`}
      >
        <Mark size={24} />
        {collapsed ? null : <span className="text-[17px] font-semibold tracking-[0.14em] text-ink">PACT</span>}
      </Link>
      {collapsed ? null : (
        <div className="pt-3">
          <WalletValue wethPrice={wethPrice} />
        </div>
      )}
      <nav className={`scroll-thin mt-3 flex-1 overflow-y-auto ${collapsed ? "px-2.5" : "px-2"}`} aria-label="Application navigation">
        <ul className="space-y-0.5">
          {PRIMARY.map((item) => (
            <NavRow key={item.href} item={item} path={path} count={countOf(item)} onNavigate={onNavigate} collapsed={collapsed} />
          ))}
        </ul>
        <div className={`my-3 border-t border-line ${collapsed ? "mx-1" : "mx-3"}`} />
        <ul className="space-y-0.5">
          {SECONDARY.map((item) => (
            <NavRow key={item.href} item={item} path={path} count={0} onNavigate={onNavigate} collapsed={collapsed} />
          ))}
        </ul>
        <div className="mt-1">
          <button
            type="button"
            onClick={() => {
              if (collapsed) {
                setMoreOpen(true);
                onExpand?.();
              } else setMoreOpen(!moreOpen);
            }}
            aria-expanded={collapsed ? false : moreOpen}
            aria-label={collapsed ? "More pages" : undefined}
            title={collapsed ? "More pages" : undefined}
            className={`flex w-full items-center rounded-md text-[13.5px] text-ink/75 hover:bg-panel-2 hover:text-ink ${
              collapsed ? "h-10 justify-center" : "gap-3 px-3 py-2"
            }`}
          >
            <Icon name="more" className="text-mute" />
            {collapsed ? null : (
              <>
                <span className="flex-1 text-left">More</span>
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={`text-mute transition-transform ${moreOpen ? "rotate-180" : ""}`}>
                  <path d="m2.5 3.8 2.5 2.5 2.5-2.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
                </svg>
              </>
            )}
          </button>
          {moreOpen && !collapsed ? (
            <ul className="mb-2 ml-[38px] space-y-0.5 border-l border-line pl-2">
              {MORE.map((m) => (
                <li key={m.href}>
                  <Link
                    href={m.href}
                    onClick={onNavigate}
                    className={`block rounded px-2 py-1.5 text-[12.5px] ${active(path, m.href) ? "bg-panel-3 text-ink" : "text-mute hover:text-ink"}`}
                  >
                    {m.label}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </nav>
      {collapsed ? (
        <div className="flex justify-center py-4" title="Non-custodial · you sign every order">
          <span className="h-2 w-2 rounded-full bg-[var(--good)]" aria-label="Non-custodial: you sign every order" />
        </div>
      ) : (
        <div className="m-3 rounded-lg border border-line bg-bg/60 px-3.5 py-3">
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-good">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--good)]" aria-hidden />
            Non-custodial
          </div>
          <p className="mt-1 text-[12px] text-ink/80">You sign every order.</p>
          <Link href="/lab" onClick={onNavigate} className="mt-1.5 inline-block text-[12px] font-medium text-accent hover:underline">
            How PACT works →
          </Link>
        </div>
      )}
    </div>
  );
}

/* ── Top bar ──────────────────────────────────────────────────────────── */

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

/** Desktop: collapse/expand the sidebar. Phone: open the navigation drawer. */
function SidebarToggle({ collapsed, onToggle, onOpenDrawer }: { collapsed: boolean; onToggle: () => void; onOpenDrawer: () => void }) {
  const icon = (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <rect x="2" y="2.75" width="12" height="10.5" rx="2" />
      <path d="M6 2.75v10.5" />
      {collapsed ? <path d="m8.75 6.5 1.5 1.5-1.5 1.5" strokeLinecap="round" strokeLinejoin="round" /> : <path d="M10.25 6.5 8.75 8l1.5 1.5" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className="btn btn-ghost hidden h-9 w-9 border-transparent p-0 text-mute hover:text-ink lg:inline-flex"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-keyshortcuts="Meta+B Control+B"
        title={`${collapsed ? "Expand" : "Collapse"} sidebar  ⌘B`}
      >
        {icon}
      </button>
      <button
        type="button"
        onClick={onOpenDrawer}
        className="btn btn-ghost h-9 w-9 border-transparent p-0 text-mute hover:text-ink lg:hidden"
        aria-label="Open navigation"
      >
        {icon}
      </button>
    </>
  );
}

function TopBar({
  path,
  collapsed,
  onToggle,
  onOpenDrawer,
}: {
  path: string;
  collapsed: boolean;
  onToggle: () => void;
  onOpenDrawer: () => void;
}) {
  const { viewAs, setViewAs, demoDesks, isDemo, address } = useDeskContext();
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
      <SidebarToggle collapsed={collapsed} onToggle={onToggle} onOpenDrawer={onOpenDrawer} />
      <span className="mx-1 hidden h-5 w-px bg-line md:block" aria-hidden />
      <nav className="hidden items-center gap-1 md:flex" aria-label="Workspace">
        {TOP_TABS.map((t) => {
          const on = active(path, t.href, t.match);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={on ? "page" : undefined}
              className={`rounded-md px-3.5 py-1.5 text-[14px] transition-colors ${on ? "bg-panel-3 font-medium text-ink" : "text-ink/75 hover:text-ink"}`}
            >
              {t.label}
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
          <label className="flex w-[min(320px,24vw)] min-w-[180px] items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 focus-within:border-accent">
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
        <Link
          href="/proposals"
          className="btn btn-ghost relative h-9 w-9 p-0"
          title="Plans awaiting your signature"
          aria-label={`${counts.awaiting} plans awaiting your signature`}
        >
          <Icon name="bell" />
          {counts.awaiting ? (
            <span className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-[var(--accent-strong)] px-1 text-[10px] font-semibold leading-4 tnum text-white">
              {counts.awaiting}
            </span>
          ) : null}
        </Link>
        <select
          value={viewAs}
          onChange={(e) => setViewAs(e.target.value as "wallet" | `0x${string}`)}
          aria-label="Desk to view"
          className={`field hidden w-auto py-1.5 pr-7 sm:block ${isDemo ? "border-dashed text-mute" : ""}`}
        >
          <option value="wallet">{address ? `My desk · ${shortAddr(address)}` : "My desk"}</option>
          {demoDesks.map((p) => (
            <option key={p.follower} value={p.follower}>
              Demo · {p.label}
            </option>
          ))}
        </select>
        <Connect />
      </div>
    </header>
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

function StatusBar({ health, collapsed }: { health: Health | null; collapsed: boolean }) {
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
    <footer
      className={`scroll-thin fixed inset-x-0 bottom-0 z-30 flex h-8 items-center gap-1 overflow-x-auto border-t border-line bg-panel px-2 text-[11.5px] text-mute transition-[left] duration-200 ${
        collapsed ? "lg:left-[64px]" : "lg:left-[240px]"
      }`}
    >
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
      <Item title="Base mainnet, chain 8453">
        <span className="h-1.5 w-1.5 rounded-full bg-[#0052ff]" aria-hidden /> Base
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

const SIDEBAR_KEY = "pact.sidebarCollapsed";

/** Collapsed state is a per-browser preference, restored after hydration. */
function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        if (localStorage.getItem(SIDEBAR_KEY) === "1") setCollapsed(true);
      } catch {
        /* storage unavailable */
      }
    }, 0);
    return () => clearTimeout(id);
  }, []);
  const toggle = () =>
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  return { collapsed, toggle };
}

function Frame({ children }: { children: ReactNode }) {
  const path = usePathname();
  const health = useHealth();
  const [open, setOpen] = useState(false);
  const { collapsed, toggle } = useSidebarCollapsed();
  const wethPrice = Number(health?.price) > 0 ? Number(health?.price) : undefined;
  const wide = path === "/trade";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="min-h-screen bg-bg">
      <aside
        className={`fixed inset-y-0 left-0 z-40 hidden overflow-hidden border-r border-line bg-panel transition-[width] duration-200 lg:block ${
          collapsed ? "w-[64px]" : "w-[240px]"
        }`}
      >
        <Sidebar path={path} onNavigate={() => undefined} wethPrice={wethPrice} collapsed={collapsed} onExpand={toggle} />
      </aside>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close navigation" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[260px] max-w-[85vw] border-r border-line bg-panel">
            <Sidebar path={path} onNavigate={() => setOpen(false)} wethPrice={wethPrice} />
          </aside>
        </div>
      ) : null}
      <div className={`transition-[padding] duration-200 ${collapsed ? "lg:pl-[64px]" : "lg:pl-[240px]"}`}>
        <TopBar path={path} collapsed={collapsed} onToggle={toggle} onOpenDrawer={() => setOpen(true)} />
        <DemoBanner />
        <main className={`mx-auto w-full px-4 pb-14 lg:px-5 ${wide ? "max-w-none pt-4" : "max-w-[1480px] pt-6"}`}>{children}</main>
        <StatusBar health={health} collapsed={collapsed} />
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
