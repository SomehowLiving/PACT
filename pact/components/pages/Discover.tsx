"use client";

import { MarketStrip, OnchainPanel } from "@/components/LiveData";
import { useDeskContext } from "@/components/DeskContext";
import { ActionBadge, AddrAvatar, Empty, LayerTag, leaderName, PageHeader, StatusBadge, type SortDir, type Tone } from "@/components/ui";
import { activePlans, formatRR } from "@/components/pages/discover-parts";
import { MAX_LEADERS, useLeaderActions } from "@/components/pages/following-actions";
import { CopyDrawer, type DrawerTab } from "@/components/pages/copy-drawer";
import { COPY_VERDICT, useCopyabilityOf } from "@/components/pages/use-copyability";
import { TrackRecord } from "@/components/pages/track-record";
import { useWatchlist, WatchButton } from "@/components/watchlist";
import { HumanBadge } from "@/components/WorldVerify";
import { ConductBadge } from "@/components/ConductPanel";
import type { Copyability, CopyVerdict } from "@/lib/copyability";
import { reasonLabel, shortAddr } from "@/lib/format";
import type { Strategy } from "@/lib/types";
import { isExpired, leaderRows, pairLabel, relativeTime, rewardRisk, type LeaderRow } from "@/lib/views";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

/*
 * Discover leaders: a table-first directory (Axiom/GMGN) with a quick-inspect panel on the right
 * (Binance Copy). Every number is from the PACT store or Flash receipts; nothing is ranked by
 * unverified PnL. The leader name opens the canonical profile; Follow opens the mandate drawer.
 */

type LeaderActions = ReturnType<typeof useLeaderActions>;
type Category = "all" | "disciplined" | "caution" | "evidence" | "active" | "twap" | "following" | "demo" | "human";
type SortKey = "plans" | "rr" | "evidence" | "copyable" | "followers" | "copied" | "drift" | "last";
const SORT_KEYS: SortKey[] = ["plans", "rr", "evidence", "copyable", "followers", "copied", "drift", "last"];
const SORT_LABEL: Record<SortKey, string> = {
  plans: "Live plans",
  rr: "Reward : risk",
  evidence: "Evidence",
  copyable: "Copyability for you",
  followers: "PACT followers",
  copied: "Copies submitted",
  drift: "Copiers' entry drift",
  last: "Most recent plan",
};
const VERDICT_RANK: Record<CopyVerdict, number> = { COPYABLE: 3, PARTLY: 2, NOT_COPYABLE: 1, NO_LIVE_PLANS: 0 };

const CATEGORY_TEST: Record<Category, (r: LeaderRow, humans: Record<string, string>) => boolean> = {
  all: () => true,
  disciplined: (r) => r.grades.DISCIPLINED > 0 && r.grades.INCOMPLETE === 0 && r.grades.CAUTION === 0,
  caution: (r) => r.grades.CAUTION > 0,
  evidence: (r) => r.evidenceFound > 0,
  active: (r) => r.activePlans > 0,
  twap: (r) => r.orderTypes.includes("twap"),
  following: (r) => r.following,
  demo: (r) => r.isDemo,
  human: (r, humans) => !!humans[r.leader.toLowerCase()],
};
const CHIPS: { value: Category; label: string }[] = [
  { value: "all", label: "All" },
  { value: "disciplined", label: "Disciplined" },
  { value: "caution", label: "Caution" },
  { value: "evidence", label: "Evidence-backed" },
  { value: "active", label: "Active Plans" },
];
const MORE_FILTERS: { value: Category; label: string }[] = [
  { value: "following", label: "Following" },
  { value: "twap", label: "Uses TWAP" },
  { value: "demo", label: "DEMO leaders" },
  { value: "human", label: "Verified human (World ID)" },
];

function sortValue(r: LeaderRow, key: SortKey, copyRank: Map<string, number>): number {
  switch (key) {
    case "plans":
      return r.activePlans * 1000 + r.plans;
    case "rr":
      return r.avgRewardRisk ?? -1;
    case "evidence":
      return r.evidenceFound;
    case "copyable":
      return copyRank.get(r.leader.toLowerCase()) ?? -1;
    case "followers":
      return r.pactFollowers;
    case "copied":
      return r.copiedOrders;
    case "drift":
      // Unmeasured leaders sort after measured ones regardless of direction.
      return r.meanDriftBps ?? Number.POSITIVE_INFINITY;
    case "last":
      return Date.parse(r.lastPlanAt ?? "") || 0;
  }
}

function bps(v?: number) {
  return v === undefined ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)} bps`;
}

/** Wallet-derived display name: PACT has no leader profiles beyond the wallet. */
export { leaderName };

/** The leader's dominant plan quality. */
function quality(r: Pick<LeaderRow, "grades">): { label: string; tone: Tone } {
  if (r.grades.INCOMPLETE > 0) return { label: "Incomplete", tone: "bad" };
  if (r.grades.CAUTION > 0) return { label: "Caution", tone: "warn" };
  if (r.grades.DISCIPLINED > 0) return { label: "Disciplined", tone: "good" };
  return { label: "—", tone: "neutral" };
}

function Evidence({ r }: { r: Pick<LeaderRow, "evidenceFound" | "evidenceMismatches"> }) {
  const [label, dot, title] =
    r.evidenceMismatches > 0
      ? ["Contradicted", "bg-[var(--bad-ink)]", "The leader's own execution contradicts at least one plan"]
      : r.evidenceFound > 0
        ? ["Order Found", "bg-[var(--good-ink)]", "At least one plan is backed by the leader's own Flash order or onchain trades"]
        : ["Unverified", "bg-mute", "No plan is backed by the leader's own execution yet"];
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-ink" title={title}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function CopyPill({ c }: { c?: Copyability }) {
  if (!c) return <span className="text-mute">—</span>;
  const live = c.previews.length;
  const ok = c.counts.COPY + c.counts.SCALE;
  const tone = COPY_VERDICT[c.verdict].tone;
  const cls =
    tone === "good"
      ? "text-good bg-[color-mix(in_oklab,var(--good)_16%,transparent)]"
      : tone === "warn"
        ? "text-warn bg-[color-mix(in_oklab,var(--warn)_14%,transparent)]"
        : tone === "bad"
          ? "text-bad bg-[color-mix(in_oklab,var(--bad)_16%,transparent)]"
          : "text-mute bg-panel-3";
  return (
    <span
      className={`inline-flex h-7 min-w-[56px] items-center justify-center rounded-full px-3 text-[13px] font-medium tnum ${cls}`}
      title={`${COPY_VERDICT[c.verdict].label}${c.topReasons.length ? ` · most common hold: ${c.topReasons.map((x) => reasonLabel(x.reason)).join(", ")}` : ""}`}
    >
      {live ? `${ok} / ${live}` : "—"}
    </span>
  );
}

function Assets({ pairs }: { pairs: string[] }) {
  const tokens = [...new Set(pairs.flatMap((p) => p.split("/").map((t) => t.trim())))].slice(0, 2);
  return (
    <span className="flex gap-1.5">
      {tokens.map((t) => (
        <span key={t} className="rounded-md border border-line bg-panel-2 px-2 py-1 text-[11.5px] text-ink/90">
          {t.length > 8 ? `${t.slice(0, 6)}…` : t}
        </span>
      ))}
    </span>
  );
}

export function CopyAddress({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      title={copied ? "Copied" : "Copy address"}
      aria-label="Copy address"
      className="inline-flex items-center gap-1 font-mono text-[12px] text-mute hover:text-ink"
    >
      {shortAddr(value)}
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden>
        <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2" />
        <path d="M2 8V2.8A.8.8 0 0 1 2.8 2H8" />
      </svg>
      {copied ? <span className="text-good">copied</span> : null}
    </button>
  );
}

/** Follow opens the mandate drawer (never a trade); the sparkle runs the copyability check. */
export function FollowButton({
  actions,
  leader,
  compact = false,
  onOpen,
}: {
  actions: LeaderActions;
  leader: `0x${string}`;
  compact?: boolean;
  onOpen: (leader: `0x${string}`, tab: DrawerTab) => void;
}) {
  const following = actions.isFollowing(leader);
  return (
    <span className="inline-flex items-center gap-1.5">
      <WatchButton leader={leader} compact={compact} />
      <button
        type="button"
        onClick={() => onOpen(leader, "analysis")}
        title="Check copyability against your mandate"
        aria-label="Check copyability"
        className={`btn ${compact ? "h-9 w-9 p-0" : "h-10 w-10 p-0"}`}
      >
        <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden>
          <path d="M5.5 2.5 6.6 6 10 7.1 6.6 8.2 5.5 11.7 4.4 8.2 1 7.1 4.4 6Z" fill="currentColor" />
          <path d="M11 1 11.5 2.5 13 3 11.5 3.5 11 5 10.5 3.5 9 3 10.5 2.5Z" fill="currentColor" />
        </svg>
      </button>
      <button type="button" onClick={() => onOpen(leader, "copy")} className={`btn ${following ? "" : "btn-primary"} ${compact ? "h-9 px-4" : "h-10 px-5 text-[14px]"}`}>
        {following ? "Edit mandate" : "Follow"}
      </button>
    </span>
  );
}

/** Discover lists every leader; scope "watchlist" is the same table limited to starred leaders. */
export function Discover({ scope = "all" }: { scope?: "all" | "watchlist" } = {}) {
  const { state, policy, follower } = useDeskContext();
  const watch = useWatchlist();
  const actions = useLeaderActions();
  const [category, setCategory] = useState<Category>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "plans", dir: "desc" });
  const [urlReady, setUrlReady] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  // View, search and sort live in the URL (?view=&q=&sort=key.dir), so refresh and shared links
  // keep them. Read after hydration.
  useEffect(() => {
    const id = setTimeout(() => {
      const p = new URLSearchParams(window.location.search);
      const view = p.get("view");
      if (view && view in CATEGORY_TEST) setCategory(view as Category);
      if (p.get("q")) setQuery(p.get("q")!);
      const [k, d] = (p.get("sort") ?? "").split(".");
      if (SORT_KEYS.includes(k as SortKey)) setSort({ key: k as SortKey, dir: d === "asc" ? "asc" : "desc" });
      setUrlReady(true);
    }, 0);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    if (!urlReady) return;
    const p = new URLSearchParams();
    if (category !== "all") p.set("view", category);
    if (query.trim()) p.set("q", query.trim());
    if (sort.key !== "plans" || sort.dir !== "desc") p.set("sort", `${sort.key}.${sort.dir}`);
    const next = `${window.location.pathname}${p.size ? `?${p}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", next);
  }, [urlReady, category, query, sort]);
  useEffect(() => {
    if (!filtersOpen) return;
    const onDown = (e: MouseEvent) => {
      if (filtersRef.current && !filtersRef.current.contains(e.target as Node)) setFiltersOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [filtersOpen]);

  const copyabilityOf = useCopyabilityOf();
  const [picked, setPicked] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ leader: `0x${string}`; tab: DrawerTab } | null>(null);
  const openDrawer = (leader: `0x${string}`, tab: DrawerTab) => setDrawer({ leader, tab });

  const strategies = useMemo(() => state?.strategies ?? [], [state?.strategies]);
  const rows = useMemo(
    () => (state ? leaderRows({ strategies: state.strategies, policies: state.policies, proposals: state.proposals, receipts: state.receipts }, policy) : []),
    [state, policy],
  );
  const copyRank = useMemo(
    () =>
      new Map(
        rows.map((r) => {
          const c = copyabilityOf(r.leader);
          return [r.leader.toLowerCase(), c ? VERDICT_RANK[c.verdict] * 1000 + c.counts.COPY + c.counts.SCALE : -1] as const;
        }),
      ),
    [rows, copyabilityOf],
  );
  const plansOf = (leader: string) =>
    strategies.filter((s) => s.leader.toLowerCase() === leader.toLowerCase()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const q = query.trim().toLowerCase();
  const scoped = scope === "watchlist" ? rows.filter((r) => watch.has(r.leader)) : rows;
  const shown = scoped
    .filter((r) => CATEGORY_TEST[category](r, state?.humans ?? {}))
    .filter((r) => {
      if (!q) return true;
      const latest = plansOf(r.leader)[0];
      return r.leader.toLowerCase().includes(q) || r.pairs.some((p) => p.toLowerCase().includes(q)) || !!latest?.title.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const d = sortValue(a, sort.key, copyRank) - sortValue(b, sort.key, copyRank);
      return sort.dir === "asc" ? d : -d;
    });
  const selected = scoped.find((r) => r.leader.toLowerCase() === picked) ?? shown[0];
  const drawerRow = drawer ? rows.find((r) => r.leader.toLowerCase() === drawer.leader.toLowerCase()) : undefined;
  const onSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "drift" ? "asc" : "desc" }));
  const sortMark = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? " ↑" : " ↓") : " ⇅");

  return (
    <div>
      {drawer && drawerRow ? (
        <CopyDrawer key={`${drawer.leader}:${drawer.tab}`} row={drawerRow} tab={drawer.tab} plans={plansOf(drawer.leader)} onClose={() => setDrawer(null)} />
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px] 2xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="min-w-0">
          {scope === "watchlist" ? (
            <PageHeader title="Watchlist" description="Leaders you are watching without following. Saved in this browser only; starring never sizes or copies anything." />
          ) : (
            <PageHeader title="Discover Leaders" description="Explore traders publishing structured, verifiable trade plans on PACT." />
          )}
          <MarketStrip />

          <div className="flex gap-3">
            <label className="flex h-12 min-w-0 flex-1 items-center gap-3 rounded-full border border-line bg-panel-2 px-5 focus-within:border-accent">
              <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden className="shrink-0 text-mute">
                <circle cx="7" cy="7" r="4.5" />
                <path d="m10.5 10.5 3 3" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search wallet, pair or plan"
                aria-label="Search wallet, pair or plan"
                className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-mute"
              />
            </label>
            <div className="relative" ref={filtersRef}>
              <button type="button" className="btn h-12 gap-2 px-5 text-[14px]" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
                  <path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3" />
                </svg>
                Filters
              </button>
              {filtersOpen ? (
                <div className="absolute right-0 top-14 z-40 w-[280px] rounded-xl border border-line bg-panel p-3 shadow-2xl">
                  <div className="text-[11px] uppercase tracking-wide text-mute">More filters</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {MORE_FILTERS.map((f) => (
                      <button
                        key={f.value}
                        type="button"
                        onClick={() => setCategory(category === f.value ? "all" : f.value)}
                        className={`btn h-8 px-3 text-[12.5px] ${category === f.value ? "btn-primary" : ""}`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <label className="mt-3 block text-[11px] uppercase tracking-wide text-mute">
                    Sort by
                    <select
                      className="field mt-1.5 text-[13px] normal-case"
                      value={sort.key}
                      onChange={(e) => setSort({ key: e.target.value as SortKey, dir: e.target.value === "drift" ? "asc" : "desc" })}
                    >
                      {SORT_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {SORT_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="mt-3 text-[11px] leading-relaxed text-mute">PACT does not rank leaders by PnL it has not verified.</p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="seg mt-5" role="tablist" aria-label="Leader filters">
            {CHIPS.map((c) => (
              <button key={c.value} type="button" role="tab" aria-selected={category === c.value} data-on={category === c.value} onClick={() => setCategory(c.value)}>
                {c.label}
              </button>
            ))}
            {MORE_FILTERS.some((f) => f.value === category) ? (
              <button type="button" role="tab" aria-selected data-on onClick={() => setCategory("all")} title="Clear this filter">
                {MORE_FILTERS.find((f) => f.value === category)!.label} ✕
              </button>
            ) : null}
          </div>

          {actions.error ? <p className="mt-3 text-[12px] text-bad">{actions.error}</p> : null}

          <div className="mt-5 overflow-x-auto">
            {shown.length ? (
              <table className="tbl tbl-tight min-w-[780px]">
                <thead>
                  <tr>
                    <th>Leader</th>
                    <th>Strategy</th>
                    <th>Assets</th>
                    <th>
                      <button type="button" onClick={() => onSort("plans")} className="hover:text-ink">
                        Live Plans{sortMark("plans")}
                      </button>
                    </th>
                    <th>Quality</th>
                    <th>
                      <button type="button" onClick={() => onSort("evidence")} className="hover:text-ink">
                        Evidence{sortMark("evidence")}
                      </button>
                    </th>
                    <th>
                      <button type="button" onClick={() => onSort("rr")} className="hover:text-ink">
                        R:R{sortMark("rr")}
                      </button>
                    </th>
                    <th>
                      <button type="button" onClick={() => onSort("copyable")} className="hover:text-ink" title="Live plans your mandate would copy or scale">
                        Copyability{sortMark("copyable")}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const mine = plansOf(r.leader);
                    const latest = mine.find((p) => !isExpired(p)) ?? mine[0];
                    const qual = quality(r);
                    return (
                      <tr key={r.leader} data-selected={selected?.leader === r.leader} onClick={() => setPicked(r.leader.toLowerCase())} className="cursor-pointer">
                        <td>
                          <div className="flex items-center gap-2.5">
                            <AddrAvatar value={r.leader} size={34} />
                            <div className="min-w-0">
                              <Link
                                href={`/leaders/${r.leader}`}
                                onClick={(e) => e.stopPropagation()}
                                className="block text-[14.5px] font-medium text-ink hover:text-accent"
                                title="Open the leader profile"
                              >
                                {leaderName(r.leader)}
                              </Link>
                              <span className="flex items-center gap-1.5">
                                <CopyAddress value={r.leader} />
                                <WatchButton leader={r.leader} bare />
                                {r.isDemo ? <LayerTag layer="demo" compact /> : null}
                                <HumanBadge verifiedAt={state?.humans?.[r.leader.toLowerCase()]} compact />
                                <ConductBadge conduct={state?.conduct?.[r.leader.toLowerCase()]} compact />
                                {r.paused ? <StatusBadge tone="warn">paused</StatusBadge> : null}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="max-w-[130px]">
                          <span className="block truncate text-[13px] text-ink/85" title={latest?.title}>
                            {latest?.title ?? "—"}
                          </span>
                          <span className="text-[11.5px] capitalize text-mute">{r.orderTypes.join(" · ")}</span>
                        </td>
                        <td>
                          <Assets pairs={r.pairs} />
                        </td>
                        <td className="tnum text-[14px] text-ink">{r.activePlans}</td>
                        <td>
                          <StatusBadge tone={qual.tone}>{qual.label}</StatusBadge>
                        </td>
                        <td>
                          <Evidence r={r} />
                        </td>
                        <td className="tnum text-[14px] text-ink">{r.avgRewardRisk === undefined ? "—" : r.avgRewardRisk.toFixed(1)}</td>
                        <td>
                          <CopyPill c={copyabilityOf(r.leader)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              scope === "watchlist" && !scoped.length ? (
                <Empty
                  title="Your watchlist is empty"
                  action={
                    <Link href="/discover" className="btn btn-primary">
                      Discover leaders
                    </Link>
                  }
                >
                  Star a leader in Discover or on their profile to keep an eye on their plans without following them.
                </Empty>
              ) : (
              <Empty
                title={rows.length ? "No leaders match" : "No leaders yet"}
                action={
                  rows.length ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setCategory("all");
                        setQuery("");
                      }}
                    >
                      Clear filters
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <Link href="/lab" className="btn">
                        Load demo scenario
                      </Link>
                      <Link href="/leader" className="btn btn-primary">
                        Publish a plan
                      </Link>
                    </div>
                  )
                }
              >
                {rows.length ? "Clear the search or pick another filter." : "Leaders appear here after they publish a plan."}
              </Empty>
              )
            )}
          </div>
          <p className="mt-3 text-[11.5px] text-mute">
            Following {policy.follows?.length ?? 0} / {MAX_LEADERS} leaders · Copyability is for the desk you are viewing · Leader names are derived from the
            wallet; PACT has no leader profiles beyond it.
          </p>
        </div>

        {selected ? (
          <LeaderPanel
            row={selected}
            plans={plansOf(selected.leader)}
            copy={copyabilityOf(selected.leader)}
            follower={follower}
            onFollow={(tab) => openDrawer(selected.leader, tab)}
            actions={actions}
          />
        ) : null}
      </div>
    </div>
  );
}

type PanelTab = "overview" | "plans" | "execution";

/** Quick inspection of the selected leader; the full story is on the profile. */
function LeaderPanel({
  row,
  plans,
  copy,
  follower,
  onFollow,
  actions,
}: {
  row: LeaderRow;
  plans: Strategy[];
  copy?: Copyability;
  follower?: string;
  onFollow: (tab: DrawerTab) => void;
  actions: LeaderActions;
}) {
  const { state } = useDeskContext();
  const [tab, setTab] = useState<PanelTab>("overview");
  const live = activePlans(plans);
  const latest = live[0] ?? plans[0];
  const qual = quality(row);
  const decisionFor = (plan: Strategy) => {
    const mine = follower ? state?.proposals.find((p) => p.strategyId === plan.id && p.follower.toLowerCase() === follower.toLowerCase()) : undefined;
    if (mine) return { decision: state?.decisions[mine.id], href: `/review/${mine.id}` };
    const preview = copy?.previews.find((p) => p.plan.id === plan.id);
    return { decision: preview?.decision, href: `/plans/${plan.id}` };
  };
  const list = tab === "overview" ? live.slice(0, 3) : plans.slice(0, 12);
  return (
    <aside className="panel overflow-hidden xl:sticky xl:top-[92px]">
      <div className="relative h-24 overflow-hidden border-b border-line">
        <svg aria-hidden viewBox="0 0 440 96" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <defs>
            <linearGradient id="pact-sky" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#1c1712" />
              <stop offset="1" stopColor="#0f0c0a" />
            </linearGradient>
            <linearGradient id="pact-peak" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#c9b08a" stopOpacity="0.55" />
              <stop offset="1" stopColor="#3b2f24" stopOpacity="0.1" />
            </linearGradient>
          </defs>
          <rect width="440" height="96" fill="url(#pact-sky)" />
          <path d="M150 96 L250 30 L285 46 L330 8 L380 40 L440 22 L440 96 Z" fill="url(#pact-peak)" />
          <path d="M150 96 L250 30 L285 46 L330 8 L380 40 L440 22" fill="none" stroke="#e8d6b8" strokeOpacity="0.35" />
        </svg>
      </div>
      <div className="relative z-10 -mt-9 flex flex-wrap items-end justify-between gap-3 px-5">
        <div className="flex min-w-[210px] flex-1 items-end gap-3">
          <span className="shrink-0 rounded-full ring-4 ring-[var(--panel)]">
            <AddrAvatar value={row.leader} size={68} />
          </span>
          <div className="min-w-0 pb-1">
            <Link href={`/leaders/${row.leader}`} className="block truncate font-[family-name:var(--font-serif)] text-[26px] leading-tight text-ink hover:text-accent">
              {leaderName(row.leader)}
            </Link>
            <span className="flex items-center gap-2">
              <CopyAddress value={row.leader} />
              <HumanBadge verifiedAt={state?.humans?.[row.leader.toLowerCase()]} />
            </span>
          </div>
        </div>
        <div className="ml-auto shrink-0 pb-1">
          <FollowButton actions={actions} leader={row.leader} onOpen={(_l, t) => onFollow(t)} compact />
        </div>
      </div>

      <div className="utabs mt-4 px-5" role="tablist">
        {(["overview", "plans", "execution"] as PanelTab[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} data-on={tab === t} onClick={() => setTab(t)} className="capitalize">
            {t}
          </button>
        ))}
      </div>

      <div className="p-5">
        {tab === "overview" ? (
          <>
            <p className="text-[14px] leading-relaxed text-ink/80">{latest?.thesis ?? "No plan published yet."}</p>
            <div className="mt-4 grid grid-cols-3 gap-3 rounded-xl border border-line bg-panel-2 p-4">
              <div>
                <div className="text-[12px] text-mute">Live Plans</div>
                <div className="mt-1 text-[16px] tnum text-ink">{row.activePlans}</div>
              </div>
              <div>
                <div className="text-[12px] text-mute">Quality</div>
                <div className="mt-1">
                  <StatusBadge tone={qual.tone}>{qual.label}</StatusBadge>
                </div>
              </div>
              <div>
                <div className="text-[12px] text-mute">Evidence</div>
                <div className="mt-1">
                  <Evidence r={row} />
                </div>
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
              <dt className="text-mute">PACT followers</dt>
              <dd className="text-right tnum text-ink">{row.pactFollowers}</dd>
              <dt className="text-mute">Copies submitted / filled</dt>
              <dd className="text-right tnum text-ink">
                {row.copiedOrders} / {row.filledOrders}
              </dd>
              <dt className="text-mute">Copiers&apos; entry drift</dt>
              <dd className="text-right tnum text-ink">{bps(row.meanDriftBps)}</dd>
              <dt className="text-mute">Last plan</dt>
              <dd className="text-right text-ink">{relativeTime(row.lastPlanAt)}</dd>
            </dl>
            <div className="mt-4">
              <OnchainPanel address={row.leader} compactView />
            </div>
          </>
        ) : null}

        {tab === "overview" || tab === "plans" ? (
          <div className={tab === "overview" ? "mt-6" : ""}>
            <div className="flex items-baseline justify-between">
              <h3 className="panel-title">{tab === "overview" ? "Current Plans" : "All plans"}</h3>
              <Link href={`/leaders/${row.leader}?tab=plans`} className="text-[12.5px] text-ink/70 hover:text-ink">
                View all →
              </Link>
            </div>
            <ul className="mt-2 divide-y divide-line-2">
              {list.map((p) => {
                const { decision, href } = decisionFor(p);
                const rr = rewardRisk(p);
                return (
                  <li key={p.id} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <Link href={`/plans/${p.id}`} className="min-w-0 hover:text-accent">
                        <div className="flex flex-wrap items-center gap-x-2 text-[14px] text-ink">
                          <span className="font-medium">{pairLabel(p)}</span>
                          <span className={p.side === "buy" ? "text-good" : "text-bad"}>{p.side === "buy" ? "Long" : "Sell"}</span>
                          <span className="text-mute">· {p.orderType === "twap" ? "TWAP" : p.orderType[0].toUpperCase() + p.orderType.slice(1)}</span>
                        </div>
                        <div className="mt-1 text-[12.5px] text-mute">
                          Entry <span className="tnum text-ink/85">{p.entryReferencePrice ?? "—"}</span>
                          <span className="mx-2">
                            Target <span className="tnum text-ink/85">{p.takeProfitPrice ?? "—"}</span>
                          </span>
                          Stop <span className="tnum text-ink/85">{p.stopLossPrice ?? "—"}</span>
                          {rr ? <span className="ml-2">· {formatRR(rr)}</span> : null}
                        </div>
                      </Link>
                      {decision ? (
                        <Link href={href} title={decision.reasons.length ? decision.reasons.map(reasonLabel).join(", ") : "Fits your mandate"} className="shrink-0">
                          <ActionBadge action={decision.action} verdict={decision.verdict} />
                        </Link>
                      ) : null}
                    </div>
                  </li>
                );
              })}
              {list.length === 0 ? <li className="py-3 text-[12.5px] text-mute">No live plans.</li> : null}
            </ul>
          </div>
        ) : null}

        {tab === "execution" ? <TrackRecord leader={row.leader} /> : null}
      </div>
    </aside>
  );
}
