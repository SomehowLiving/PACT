"use client";

import { useDeskContext } from "@/components/DeskContext";
import { TradingChart } from "@/components/TradingChart";
import {
  Addr,
  AddrAvatar,
  Empty,
  KV,
  LayerTag,
  PageHeader,
  Panel,
  Planned,
  Segmented,
  SortTh,
  StatusBadge,
  type SortDir,
} from "@/components/ui";
import {
  activePlans,
  EvidenceBadge,
  FeaturedPlanCard,
  formatRR,
  GradeBadge,
  PlanRange,
  SideType,
} from "@/components/pages/discover-parts";
import { MAX_LEADERS, useLeaderActions } from "@/components/pages/following-actions";
import { CopyDrawer, type DrawerTab } from "@/components/pages/copy-drawer";
import { isExpired, leaderRows, pairLabel, relativeTime, rewardRisk, tokenSymbol, type LeaderRow } from "@/lib/views";
import type { Strategy } from "@/lib/types";
import { TrackRecord } from "@/components/pages/track-record";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Category = "all" | "disciplined" | "evidence" | "twap" | "following" | "demo";
type SortKey = "plans" | "rr" | "evidence" | "followers" | "copied" | "drift" | "last";

const CATEGORY_TEST: Record<Category, (r: LeaderRow) => boolean> = {
  all: () => true,
  disciplined: (r) => r.grades.DISCIPLINED > 0 && r.grades.INCOMPLETE === 0,
  evidence: (r) => r.evidenceFound > 0,
  twap: (r) => r.orderTypes.includes("twap"),
  following: (r) => r.following,
  demo: (r) => r.isDemo,
};

function sortValue(r: LeaderRow, key: SortKey): number {
  switch (key) {
    case "plans":
      return r.activePlans * 1000 + r.plans;
    case "rr":
      return r.avgRewardRisk ?? -1;
    case "evidence":
      return r.evidenceFound;
    case "followers":
      return r.pactFollowers;
    case "copied":
      return r.copiedOrders;
    case "drift":
      // Unmeasured leaders sort after measured ones regardless of direction.
      return r.meanDriftBps ?? Number.POSITIVE_INFINITY;
    case "last":
      return r.lastPlanAt ? Date.parse(r.lastPlanAt) : 0;
  }
}

function isChartable(plan: Strategy) {
  return plan.chain === "base" && tokenSymbol(plan.targetAsset) === "WETH" && tokenSymbol(plan.contraAsset) === "USDC";
}

function bps(v?: number) {
  return v === undefined ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)} bps`;
}

type LeaderActions = ReturnType<typeof useLeaderActions>;

/** GMGN-style row actions: ✦ copyability check and Copy / Edit, both open the copy drawer. */
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
  const size = compact ? "h-7 px-2.5 text-[12px]" : "";
  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => onOpen(leader, "analysis")}
        title="Check copyability against your mandate"
        aria-label="Check copyability"
        className={`btn ${compact ? "h-7 w-7 p-0" : "w-9 p-0"}`}
      >
        <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden>
          <path d="M5.5 2.5 6.6 6 10 7.1 6.6 8.2 5.5 11.7 4.4 8.2 1 7.1 4.4 6Z" fill="currentColor" />
          <path d="M11 1 11.5 2.5 13 3 11.5 3.5 11 5 10.5 3.5 9 3 10.5 2.5Z" fill="currentColor" />
        </svg>
      </button>
      <button type="button" onClick={() => onOpen(leader, "copy")} className={`btn ${following ? "" : "btn-primary"} ${size}`}>
        {following ? "Edit" : "Copy"}
      </button>
    </span>
  );
}

export function Discover() {
  const router = useRouter();
  const { state, policy } = useDeskContext();
  const actions = useLeaderActions();
  const [category, setCategory] = useState<Category>("all");
  const [query, setQuery] = useState("");
  // The top-bar search links here as /discover?q=0x…; read it after hydration.
  useEffect(() => {
    const id = setTimeout(() => {
      const q = new URLSearchParams(window.location.search).get("q");
      if (q) setQuery(q);
    }, 0);
    return () => clearTimeout(id);
  }, []);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "plans", dir: "desc" });
  const [picked, setPicked] = useState<string | null>(null);
  const [pickedPlan, setPickedPlan] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ leader: `0x${string}`; tab: DrawerTab } | null>(null);
  const openDrawer = (leader: `0x${string}`, tab: DrawerTab) => setDrawer({ leader, tab });

  const strategies = useMemo(() => state?.strategies ?? [], [state?.strategies]);
  const rows = useMemo(
    () =>
      state
        ? leaderRows({ strategies: state.strategies, policies: state.policies, proposals: state.proposals, receipts: state.receipts }, policy)
        : [],
    [state, policy],
  );

  const q = query.trim().toLowerCase();
  const shown = rows
    .filter(CATEGORY_TEST[category])
    .filter((r) => !q || r.leader.toLowerCase().includes(q))
    .sort((a, b) => {
      const d = sortValue(a, sort.key) - sortValue(b, sort.key);
      return sort.dir === "asc" ? d : -d;
    });

  const selected = rows.find((r) => r.leader.toLowerCase() === picked) ?? shown[0];
  const selectedPlans = selected
    ? strategies
        .filter((s) => s.leader.toLowerCase() === selected.leader.toLowerCase())
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];
  const chartPlan =
    selectedPlans.find((p) => p.id === pickedPlan && isChartable(p)) ?? selectedPlans.find((p) => isChartable(p) && !isExpired(p)) ?? selectedPlans.find(isChartable);

  const featured = activePlans(strategies)
    .filter((p) => p.leaderPlanGrade !== "INCOMPLETE")
    .sort((a, b) => (rewardRisk(b) ?? 0) - (rewardRisk(a) ?? 0))
    .slice(0, 4);

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "drift" ? "asc" : "desc" }));

  const inspect = (leader: string) => {
    setPicked(leader.toLowerCase());
    setPickedPlan(null);
  };

  const counts = Object.fromEntries(
    (Object.keys(CATEGORY_TEST) as Category[]).map((c) => [c, rows.filter(CATEGORY_TEST[c]).length]),
  ) as Record<Category, number>;

  const drawerRow = drawer ? rows.find((r) => r.leader.toLowerCase() === drawer.leader.toLowerCase()) : undefined;

  return (
    <div>
      {drawer && drawerRow ? (
        <CopyDrawer
          key={`${drawer.leader}:${drawer.tab}`}
          row={drawerRow}
          tab={drawer.tab}
          plans={strategies
            .filter((s) => s.leader.toLowerCase() === drawer.leader.toLowerCase())
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))}
          onClose={() => setDrawer(null)}
        />
      ) : null}
      <PageHeader
        eyebrow="02 · Discover"
        title="Discover leaders"
        description="Leaders ranked by what they have actually published: plan structure, declared reward:risk, whether their own trades back each plan (Flash order or onchain), and how copies executed. PACT does not rank by unverified PnL."
        actions={
          <span className="text-[12px] text-mute">
            Following <span className="tnum text-ink">{policy.follows?.length ?? 0}</span> / {MAX_LEADERS}
          </span>
        }
      />

      {/* Featured plans: discovery cards */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="panel-title">Featured live plans</h2>
        <span className="text-[11.5px] text-mute">Sorted by declared reward:risk · not a performance ranking</span>
      </div>
      {featured.length ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {featured.map((plan) => (
            <FeaturedPlanCard
              key={plan.id}
              plan={plan}
              selected={selected?.leader.toLowerCase() === plan.leader.toLowerCase() && chartPlan?.id === plan.id}
              onInspect={() => router.push(`/plans/${plan.id}`)}
              action={<FollowButton actions={actions} leader={plan.leader} onOpen={openDrawer} />}
            />
          ))}
        </div>
      ) : (
        <div className="panel mb-6">
          <Empty
            title="No live plans yet"
            action={
              <div className="flex gap-2">
                <Link href="/lab" className="btn">
                  Load demo scenario
                </Link>
                <Link href="/leader" className="btn btn-primary">
                  Publish a plan
                </Link>
              </div>
            }
          >
            Featured cards appear when a leader publishes a structured plan that has not expired.
          </Empty>
        </div>
      )}

      {actions.error ? <p className="mb-3 text-[12px] text-bad">{actions.error}</p> : null}

      <div className="grid items-start gap-4 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* Ranking table */}
        <Panel
          title="Leader table"
          layer="policy"
          subtitle="Plan facts from the PACT store; copy outcomes from Flash receipts"
          bodyClassName="flex flex-col"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
            <div className="max-w-full overflow-x-auto scroll-thin">
              <Segmented
                value={category}
                onChange={setCategory}
                options={[
                  { value: "all", label: "All", count: counts.all },
                  { value: "disciplined", label: "Disciplined", count: counts.disciplined },
                  { value: "evidence", label: "Evidence-backed", count: counts.evidence },
                  { value: "twap", label: "TWAP", count: counts.twap },
                  { value: "following", label: "Following", count: counts.following },
                  { value: "demo", label: "Demo", count: counts.demo },
                ]}
              />
            </div>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search leader address 0x…"
              aria-label="Search leader address"
              className="field ml-auto w-full sm:w-[240px]"
            />
          </div>
          {shown.length ? (
            <div className="scroll-thin max-h-[560px] overflow-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Leader</th>
                    <SortTh k="plans" sort={sort} onSort={onSort} right>
                      Plans live/all
                    </SortTh>
                    <SortTh k="rr" sort={sort} onSort={onSort} right>
                      Avg R:R
                    </SortTh>
                    <th title="Disciplined / caution / incomplete">Grade D/C/I</th>
                    <SortTh k="evidence" sort={sort} onSort={onSort} right>
                      Evidence
                    </SortTh>
                    <SortTh k="followers" sort={sort} onSort={onSort} right>
                      PACT followers
                    </SortTh>
                    <th>Pairs · types</th>
                    <SortTh k="copied" sort={sort} onSort={onSort} right>
                      Copied / filled
                    </SortTh>
                    <SortTh k="drift" sort={sort} onSort={onSort} right>
                      Mean drift
                    </SortTh>
                    <SortTh k="last" sort={sort} onSort={onSort} right>
                      Last plan
                    </SortTh>
                    <th className="r" title="Requires verified receipt history">
                      <span className="inline-flex items-center gap-1">
                        PnL <LayerTag layer="planned" compact />
                      </span>
                    </th>
                    <th className="r">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r, i) => (
                    <tr
                      key={r.leader}
                      data-selected={selected?.leader === r.leader}
                      onClick={() => inspect(r.leader)}
                      className="cursor-pointer"
                    >
                      <td className="text-mute tnum">{i + 1}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <AddrAvatar value={r.leader} size={24} />
                          <Addr value={r.leader} className="text-ink" />
                          {r.isDemo ? <LayerTag layer="demo" compact /> : null}
                          {r.paused ? (
                            <StatusBadge tone="warn" icon="⏸">
                              paused
                            </StatusBadge>
                          ) : null}
                        </div>
                      </td>
                      <td className="r tnum">
                        <span className="text-ink">{r.activePlans}</span>
                        <span className="text-mute"> / {r.plans}</span>
                      </td>
                      <td className="r tnum text-ink">{formatRR(r.avgRewardRisk)}</td>
                      <td className="tnum">
                        <span className="text-good">{r.grades.DISCIPLINED}</span>
                        <span className="text-mute"> / </span>
                        <span className="text-warn">{r.grades.CAUTION}</span>
                        <span className="text-mute"> / </span>
                        <span className="text-bad">{r.grades.INCOMPLETE}</span>
                      </td>
                      <td className="r tnum">
                        <span className={r.evidenceFound ? "text-good" : "text-mute"}>{r.evidenceFound}</span>
                        <span className="text-mute"> / {r.plans}</span>
                      </td>
                      <td className="r tnum text-ink">{r.pactFollowers}</td>
                      <td className="text-[12px]">
                        <span className="text-ink">{r.pairs.join(", ")}</span>
                        <span className="text-mute"> · {r.orderTypes.join(", ")}</span>
                      </td>
                      <td className="r tnum">
                        <span className="text-ink">{r.copiedOrders}</span>
                        <span className="text-mute"> / {r.filledOrders}</span>
                      </td>
                      <td className="r tnum text-ink">{bps(r.meanDriftBps)}</td>
                      <td className="r text-mute">{relativeTime(r.lastPlanAt)}</td>
                      <td className="r text-mute" title="Not shown until PACT has verified receipt history">
                        —
                      </td>
                      <td className="r" onClick={(e) => e.stopPropagation()}>
                        <FollowButton actions={actions} leader={r.leader} compact onOpen={openDrawer} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title={rows.length ? "No leaders match" : "No leaders yet"}>
              {rows.length
                ? "Clear the search or pick another category."
                : "Leaders appear here after they publish a plan. Load the demo scenario from the Demo lab, or publish one yourself."}
            </Empty>
          )}
          <div className="border-t border-line px-3 py-2 text-[11px] text-mute">
            Mean drift = average fill vs the leader&apos;s declared entry across all PACT copies; positive means followers paid worse.
          </div>
        </Panel>

        {/* Selected leader detail */}
        <div className="flex min-w-0 flex-col gap-4">
          {selected ? (
            <Panel
              title={
                <span className="flex items-center gap-2">
                  <AddrAvatar value={selected.leader} size={22} />
                  <Addr value={selected.leader} className="text-ink" />
                </span>
              }
              subtitle={`${selected.plans} plan${selected.plans === 1 ? "" : "s"} published · last ${relativeTime(selected.lastPlanAt)}`}
              actions={
                <>
                  {selected.isDemo ? <LayerTag layer="demo" /> : null}
                  <Link className="btn" href={`/leaders/${selected.leader}`} title="Evidence, paper copies and copiers' results">
                    Profile
                  </Link>
                  <FollowButton actions={actions} leader={selected.leader} compact onOpen={openDrawer} />
                </>
              }
            >
              <dl className="px-4 py-2">
                <KV k="Plans live / published" v={`${selected.activePlans} / ${selected.plans}`} />
                <KV k="Average declared R:R" v={formatRR(selected.avgRewardRisk)} />
                <KV
                  k="Backed by own execution"
                  v={
                    <span>
                      {selected.evidenceFound} of {selected.plans} plans
                      {selected.evidenceMismatches ? <span className="text-bad"> · {selected.evidenceMismatches} contradicted</span> : null}
                    </span>
                  }
                />
                <KV k="PACT followers" v={selected.pactFollowers} />
                <KV k="Copies submitted / filled" v={`${selected.copiedOrders} / ${selected.filledOrders}`} />
                <KV k="Mean entry drift" v={bps(selected.meanDriftBps)} />
              </dl>
              {selected.following ? (
                <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
                  {selected.paused ? (
                    <StatusBadge tone="warn" icon="⏸">
                      paused
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="good" icon="●">
                      active
                    </StatusBadge>
                  )}
                  <button
                    type="button"
                    className="btn px-2.5 py-1 text-[11.5px]"
                    disabled={!!actions.blockedReason(selected.leader) || actions.busy !== null}
                    title={actions.blockedReason(selected.leader)}
                    onClick={() => void actions.setPaused(selected.leader, !selected.paused)}
                  >
                    {selected.paused ? "Resume" : "Pause"}
                  </button>
                  <Link href="/following" className="ml-auto text-[12px] text-accent hover:underline">
                    Mandate & sleeve →
                  </Link>
                </div>
              ) : null}
            </Panel>
          ) : null}

          {selected && chartPlan ? (
            <Panel title="Plan levels" subtitle={chartPlan.title} bodyClassName="overflow-hidden">
              <TradingChart
                entry={chartPlan.entryReferencePrice}
                stop={chartPlan.stopLossPrice}
                target={chartPlan.takeProfitPrice}
                height={240}
              />
            </Panel>
          ) : null}

          {selected ? (
            <Panel title="Published plans" layer="policy" subtitle="Leader declarations, not executions">
              <ul className="scroll-thin max-h-[420px] divide-y divide-line-2 overflow-y-auto">
                {selectedPlans.map((plan) => {
                  const expired = isExpired(plan);
                  const on = chartPlan?.id === plan.id;
                  return (
                    <li key={plan.id}>
                      <button
                        type="button"
                        onClick={() => router.push(`/plans/${plan.id}`)}
                        onMouseEnter={() => isChartable(plan) && setPickedPlan(plan.id)}
                        title="Open the plan"
                        className={`block w-full px-4 py-3 text-left transition ${on ? "bg-panel-3" : "hover:bg-panel-2"}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[12.5px] font-medium text-ink">{plan.title}</span>
                          {expired ? (
                            <StatusBadge tone="neutral">expired</StatusBadge>
                          ) : (
                            <span className="shrink-0 text-[11px] text-mute">ends {relativeTime(plan.expiresAt)}</span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                          <SideType plan={plan} />
                          <span className="text-mute">{pairLabel(plan)}</span>
                          <span className="tnum text-ink">{formatRR(rewardRisk(plan))}</span>
                          <GradeBadge grade={plan.leaderPlanGrade} />
                          <EvidenceBadge status={plan.leaderEvidenceStatus} />
                        </div>
                        <div className="mt-2.5">
                          <PlanRange plan={plan} />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ) : null}

          {selected ? <TrackRecord leader={selected.leader} /> : null}
          <Planned title="Drawdown">
            Needs a longer history of closed copies per leader. Shown only once enough receipts exist, never estimated.
          </Planned>
          <Planned title="Leader watch alerts">
            Notify when a followed or watched leader publishes a new plan.
          </Planned>
        </div>
      </div>
    </div>
  );
}
