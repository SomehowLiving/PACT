"use client";

import { MarketStrip } from "@/components/LiveData";
import { useDeskContext, useMine } from "@/components/DeskContext";
import { ActionBadge, AddrAvatar, Empty, LayerTag, Meter, PageHeader, Panel, StatusBadge, type Tone, leaderName } from "@/components/ui";
import { mandateFor } from "@/components/pages/following-actions";
import { usd } from "@/lib/format";
import { CHAINS } from "@/lib/chains";
import { CLOSED_STATUSES, capacity, exposureGroups, isDemoAddress, orderStatusLabel, pairLabel, type ExposureGroup } from "@/lib/views";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Mark } from "@/lib/positions";
import type { Decision, Position, Proposal, Receipt } from "@/lib/types";
import { erc20Abi, formatUnits } from "viem";
import { useBalance, useReadContracts } from "wagmi";

const BASE_ID = 8453;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const WETH = "0x4200000000000000000000000000000000000006" as const;
const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];
const OTHER = "var(--mute)";

type Segment = { key: string; label: string; usd: number; approvedUsd: number; liveUsd: number; leaders: number; color: string };

/** Fixed colour order by entity; more than four groups fold into "Other". */
function segments(groups: ExposureGroup[]): Segment[] {
  const head = groups.slice(0, 4).map((g, i) => ({
    key: g.key,
    label: `${g.asset} ${g.side}`,
    usd: g.approvedUsd + g.liveUsd,
    approvedUsd: g.approvedUsd,
    liveUsd: g.liveUsd,
    leaders: g.leaders.length,
    color: SERIES[i],
  }));
  const rest = groups.slice(4);
  if (!rest.length) return head;
  return [
    ...head,
    {
      key: "other",
      label: `Other (${rest.length})`,
      usd: rest.reduce((s, g) => s + g.approvedUsd + g.liveUsd, 0),
      approvedUsd: rest.reduce((s, g) => s + g.approvedUsd, 0),
      liveUsd: rest.reduce((s, g) => s + g.liveUsd, 0),
      leaders: new Set(rest.flatMap((g) => g.leaders)).size,
      color: OTHER,
    },
  ];
}

type Row = { p: Proposal; d?: Decision; r?: Receipt; pos?: PositionsPayload["positions"][number] };
type Tab = "positions" | "exposure" | "leaders";

function usePositions(follower?: string) {
  const [data, setData] = useState<PositionsPayload | null>(null);
  useEffect(() => {
    if (!follower) return;
    let live = true;
    const load = () =>
      void fetch(`/api/positions?follower=${follower}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((body: PositionsPayload | null) => {
          if (live && body) setData(body);
        })
        .catch(() => undefined);
    const first = setTimeout(load, 0);
    const id = setInterval(load, 30_000);
    return () => {
      live = false;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [follower]);
  return follower ? data : null;
}

/** Wallet value on Base for the connected wallet (real balances, Flash WETH price). */
function useWalletValue(address?: `0x${string}`, enabled = false) {
  const [price, setPrice] = useState<number | undefined>();
  useEffect(() => {
    void fetch("/api/health")
      .then((r) => r.json())
      .then((h: { price?: number | string }) => setPrice(Number(h.price) > 0 ? Number(h.price) : undefined))
      .catch(() => undefined);
  }, []);
  const eth = useBalance({ address, chainId: BASE_ID, query: { enabled } });
  const tokens = useReadContracts({
    contracts: [
      { address: USDC, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined, chainId: BASE_ID },
      { address: WETH, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined, chainId: BASE_ID },
    ],
    query: { enabled },
  });
  if (!enabled || !price || !eth.data || tokens.data?.[0]?.result === undefined) return undefined;
  const usdc = Number(formatUnits(tokens.data[0].result as bigint, 6));
  const weth = Number(formatUnits((tokens.data[1]?.result as bigint | undefined) ?? BigInt(0), 18));
  return usdc + (Number(formatUnits(eth.data.value, eth.data.decimals)) + weth) * price;
}

function Tile({ label, value, sub, tone, children }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "good" | "bad"; children?: React.ReactNode }) {
  return (
    <div className="panel min-w-0 p-5">
      <div className="text-[13px] text-mute">{label}</div>
      <div className={`mt-2 font-[family-name:var(--font-serif)] text-[30px] font-medium leading-none tnum ${tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : "text-ink"}`}>{value}</div>
      {sub ? <div className="mt-2 text-[12.5px] text-mute">{sub}</div> : null}
      {children}
    </div>
  );
}

function statusOf(row: Row): { label: string; tone: Tone } {
  if (!row.r?.flashOrderId) return { label: "Awaiting signature", tone: "neutral" };
  if (row.pos && !row.pos.position.closed && row.pos.position.entryUnits > 0) return { label: "Open", tone: "good" };
  const s = row.r.status ?? "";
  if (s === "ORDER_STATUS_PARTIALLY_FILLED") return { label: "Partial", tone: "warn" };
  if (s === "ORDER_STATUS_FILLED") return { label: "Filled", tone: "good" };
  return { label: "Working", tone: "neutral" };
}

function Donut({ segs, total }: { segs: Segment[]; total: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const parts = segs.reduce<{ seg: Segment; len: number; offset: number }[]>((acc, seg) => {
    const len = (seg.usd / total) * c;
    const offset = acc.length ? acc[acc.length - 1].offset + acc[acc.length - 1].len : 0;
    return [...acc, { seg, len, offset }];
  }, []);
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative h-[150px] w-[150px] shrink-0">
        <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90" role="img" aria-label="Exposure by asset">
          <circle cx="70" cy="70" r={r} fill="none" stroke="var(--panel-3)" strokeWidth="16" />
          {parts.map(({ seg, len, offset }) => (
            <circle key={seg.key} cx="70" cy="70" r={r} fill="none" stroke={seg.color} strokeWidth="16" strokeDasharray={`${Math.max(0, len - 2)} ${c}`} strokeDashoffset={-offset} />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="tnum text-[17px] font-medium text-ink">{usd(total)}</span>
          <span className="text-[11.5px] text-mute">Total</span>
        </div>
      </div>
      <ul className="min-w-[160px] flex-1 space-y-2.5">
        {segs.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-3 text-[13px]">
            <span className="inline-flex items-center gap-2 text-ink">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="tnum text-ink/85">{((s.usd / total) * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Portfolio() {
  const { state, policy, follower, isDemo, address } = useDeskContext();
  const mine = useMine();
  const data = usePositions(follower);
  const viewingOwnWallet = !isDemo && !!address && follower?.toLowerCase() === address.toLowerCase();
  // A real (non-DEMO) wallet opened read-only: its balances are real, so show them.
  const viewingRealWallet = isDemo && !!follower && !isDemoAddress(follower);
  const walletValue = useWalletValue(
    viewingOwnWallet ? address : viewingRealWallet ? (follower as `0x${string}`) : undefined,
    viewingOwnWallet || viewingRealWallet,
  );
  const [tab, setTab] = useState<Tab>("positions");
  const [leaderFilter, setLeaderFilter] = useState("all");
  const [assetFilter, setAssetFilter] = useState("all");
  const [picked, setPicked] = useState<string | null>(null);

  const groups = useMemo(() => (state ? exposureGroups(state, follower) : []), [state, follower]);
  const cap = useMemo(() => (state ? capacity(state, policy) : undefined), [state, policy]);
  const segs = useMemo(() => segments(groups), [groups]);
  const total = segs.reduce((s, g) => s + g.usd, 0);
  const totalLive = groups.reduce((s, g) => s + g.liveUsd, 0);
  const totalApproved = groups.reduce((s, g) => s + g.approvedUsd, 0);

  const rows = useMemo<Row[]>(() => {
    const receiptOf = new Map((state?.receipts ?? []).map((r) => [r.proposalId, r]));
    const posOf = new Map((data?.positions ?? []).map((x) => [x.proposalId, x]));
    return mine
      .map((p) => ({ p, d: state?.decisions[p.id], r: receiptOf.get(p.id), pos: posOf.get(p.id) }))
      .filter(({ d, r, pos }) => d && d.verdict !== "BLOCK" && (!(r?.status && CLOSED_STATUSES.includes(r.status)) || (pos && !pos.position.closed)));
  }, [mine, state, data]);
  const leaders = [...new Set(rows.map((x) => x.p.leader.toLowerCase()))];
  const assets = [...new Set(rows.map((x) => pairLabel(x.p)))];
  const shown = rows.filter((x) => (leaderFilter === "all" || x.p.leader.toLowerCase() === leaderFilter) && (assetFilter === "all" || pairLabel(x.p) === assetFilter));
  const selected = shown.find((x) => x.p.id === picked) ?? shown[0];

  const byLeader = leaders.map((l) => {
    const mineL = rows.filter((x) => x.p.leader.toLowerCase() === l);
    const alloc = mineL.reduce((s, x) => s + (x.r?.flashOrderId ? x.r.notionalUsd : x.p.notionalUsd), 0);
    const pnl = (data?.positions ?? []).filter((x) => x.leader?.toLowerCase() === l).reduce((s, x) => s + x.position.realizedPnlUsd + x.unrealizedPnlUsd, 0);
    return { leader: l, alloc, pnl, count: mineL.length };
  });
  const allocTotal = byLeader.reduce((s, x) => s + x.alloc, 0);
  const t = data?.totals;
  const sleeveUsed = cap ? cap.dailyUsed : 0;
  const sleeveMax = cap ? cap.dailyMax : 0;

  return (
    <div>
      <PageHeader title="Portfolio" description="Your copied positions, exposure and results across followed leaders." />
      <MarketStrip />

      {!follower ? (
        <div className="panel">
          <Empty title="No desk selected">Connect your wallet, or choose a DEMO desk from the wallet menu.</Empty>
        </div>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
          <div className="min-w-0 space-y-5">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Tile
                label="Total Value"
                value={walletValue === undefined ? "—" : usd(walletValue)}
                sub={viewingOwnWallet || viewingRealWallet ? "Base wallet · ETH, USDC, WETH" : isDemo ? "DEMO desk holds no funds" : "Connect your wallet"}
              />
              <Tile
                label="Open PnL"
                value={t && data?.positions.length ? `${t.unrealizedUsd >= 0 ? "+" : "−"}${usd(Math.abs(t.unrealizedUsd))}` : "—"}
                tone={t && data?.positions.length ? (t.unrealizedUsd >= 0 ? "good" : "bad") : undefined}
                sub={t && data?.positions.length ? `realized ${t.realizedUsd >= 0 ? "+" : "−"}${usd(Math.abs(t.realizedUsd))} · marked at Flash's exit quote` : "No filled copies yet"}
              />
              <Tile label="Allocated Sleeve" value={usd(sleeveMax)} sub={`${sleeveMax > 0 ? ((sleeveUsed / sleeveMax) * 100).toFixed(1) : "0.0"}% used today`}>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel-3">
                  <div className="h-full rounded-full bg-[var(--good)]" style={{ width: `${sleeveMax > 0 ? Math.min(100, (sleeveUsed / sleeveMax) * 100) : 0}%` }} />
                </div>
              </Tile>
              <Tile label="Active Leaders" value={policy.follows?.length ?? 0}>
                <div className="mt-3 flex -space-x-2">
                  {(policy.follows ?? []).map((l) => (
                    <span key={l} className="rounded-full ring-2 ring-[var(--panel)]">
                      <AddrAvatar value={l} size={26} />
                    </span>
                  ))}
                </div>
              </Tile>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="utabs flex-1" role="tablist">
                {(
                  [
                    ["positions", "Positions"],
                    ["exposure", "Exposure"],
                    ["leaders", "By Leader"],
                  ] as [Tab, string][]
                ).map(([k, label]) => (
                  <button key={k} type="button" role="tab" aria-selected={tab === k} data-on={tab === k} onClick={() => setTab(k)}>
                    {label}
                  </button>
                ))}
              </div>
              {tab === "positions" ? (
                <div className="flex gap-2">
                  <select className="field h-9 w-auto rounded-full px-4 text-[13px]" value={leaderFilter} onChange={(e) => setLeaderFilter(e.target.value)} aria-label="Filter by leader">
                    <option value="all">All Leaders</option>
                    {leaders.map((l) => (
                      <option key={l} value={l}>
                        {leaderName(l)}
                      </option>
                    ))}
                  </select>
                  <select className="field h-9 w-auto rounded-full px-4 text-[13px]" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Filter by pair">
                    <option value="all">All Assets</option>
                    {assets.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>

            {tab === "positions" ? (
              shown.length ? (
                <div className="overflow-x-auto">
                  <table className="tbl tbl-tight min-w-[760px]">
                    <thead>
                      <tr>
                        <th>Asset / Pair</th>
                        <th>Leader</th>
                        <th>Side</th>
                        <th className="r">Size</th>
                        <th className="r">Entry</th>
                        <th className="r">Mark</th>
                        <th className="r">PnL</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((row) => {
                        const st = statusOf(row);
                        const pos = row.pos;
                        const pnl = pos ? pos.position.realizedPnlUsd + pos.unrealizedPnlUsd : undefined;
                        const fills = row.r?.finalFillCount ?? row.r?.fills?.length ?? 0;
                        return (
                          <tr key={row.p.id} data-selected={selected?.p.id === row.p.id} onClick={() => setPicked(row.p.id)} className="cursor-pointer">
                            <td>
                              <div className="text-[14px] text-ink">{pairLabel(row.p)}</div>
                              <div className="text-[11.5px] text-mute">
                                {row.p.orderType === "twap" ? "TWAP" : row.p.orderType} · {row.r?.flashOrderId ? `${fills} fill${fills === 1 ? "" : "s"}` : "not signed"}
                              </div>
                            </td>
                            <td>
                              <span className="inline-flex items-center gap-2">
                                <AddrAvatar value={row.p.leader} size={24} />
                                <Link href={`/leaders/${row.p.leader}`} onClick={(e) => e.stopPropagation()} className="text-ink hover:text-accent">
                                  {leaderName(row.p.leader)}
                                </Link>
                              </span>
                            </td>
                            <td>
                              <StatusBadge tone={row.p.side === "buy" ? "good" : "bad"}>{row.p.side === "buy" ? "Long" : "Sell"}</StatusBadge>
                            </td>
                            <td className="r text-ink">{pos && pos.position.openUnits > 0 ? `${pos.position.openUnits.toFixed(4)} WETH` : usd(row.r?.flashOrderId ? row.r.notionalUsd : row.p.notionalUsd)}</td>
                            <td className="r">{pos ? usd(pos.position.averageCost) : row.p.entryReferencePrice ? usd(Number(row.p.entryReferencePrice)) : "—"}</td>
                            <td className="r">{pos?.mark ? usd(pos.mark.price) : "—"}</td>
                            <td className={`r ${pnl === undefined ? "text-mute" : pnl >= 0 ? "text-good" : "text-bad"}`}>
                              {pnl === undefined ? "—" : `${pnl >= 0 ? "+" : "−"}${usd(Math.abs(pnl))}`}
                            </td>
                            <td>
                              <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                            </td>
                            <td className="r">
                              <Link
                                href={row.r?.flashOrderId ? "/execution" : `/review/${row.p.id}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-[12.5px] text-ink/70 hover:text-ink"
                                title={row.r?.flashOrderId ? "Open the order" : "Review and sign"}
                              >
                                {row.r?.flashOrderId ? "Order →" : "Review →"}
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="panel">
                  <Empty title="No open positions" action={<Link href="/proposals" className="btn">Open the proposal inbox</Link>}>
                    COPY and SCALE proposals appear here until their Flash order closes; filled buys stay while the position is open.
                  </Empty>
                </div>
              )
            ) : null}

            {tab === "exposure" ? (
              <div className="grid items-start gap-5 lg:grid-cols-2">
                <Panel title="Asset exposure" subtitle="Approved by policy or live on Flash" layer="policy" bodyClassName="p-5">
                  {total > 0 ? (
                    <>
                      <div className="text-[12.5px] text-mute">
                        <span className="tnum text-ink">{usd(totalLive)}</span> live on Flash · <span className="tnum text-ink">{usd(totalApproved)}</span> approved, not submitted
                      </div>
                      <ExposureBar segs={segs} total={total} />
                    </>
                  ) : (
                    <p className="text-[12.5px] text-mute">Nothing is approved or live.</p>
                  )}
                </Panel>
                <Panel title="Same-asset concentration" subtitle={`Cap ${usd(policy.maxAssetExposureUsd)} per asset and side`} layer="policy" bodyClassName="space-y-4 p-5">
                  {groups.length ? (
                    groups.map((g) => (
                      <Meter
                        key={g.key}
                        label={`${g.asset} ${g.side}`}
                        used={g.liveUsd + g.approvedUsd}
                        max={policy.maxAssetExposureUsd}
                        format={usd}
                        hint={`${total > 0 ? Math.round(((g.liveUsd + g.approvedUsd) / total) * 100) : 0}% of exposure · ${g.leaders.length} leader${g.leaders.length === 1 ? "" : "s"}`}
                      />
                    ))
                  ) : (
                    <p className="text-[12px] text-mute">No concentration yet.</p>
                  )}
                  <p className="text-[11px] leading-relaxed text-mute">Concentration counts plans on the same asset and side. PACT does not estimate correlation from too little history.</p>
                </Panel>
              </div>
            ) : null}

            {tab === "leaders" ? (
              <Panel title="Remaining capacity" subtitle="The same limits PACT enforces on new proposals" layer="policy" bodyClassName="space-y-4 p-5">
                {cap ? (
                  <>
                    <Meter label="Daily copy budget" used={cap.dailyUsed} max={cap.dailyMax} format={usd} />
                    <Meter label="Open plans" used={cap.openPlans} max={cap.openPlansMax} />
                    {cap.sleeves.map((s) => (
                      <Meter
                        key={s.leader}
                        label={
                          <span className="inline-flex items-center gap-2">
                            <AddrAvatar value={s.leader} size={18} />
                            {leaderName(s.leader)}
                            {s.paused ? <StatusBadge tone="warn">paused</StatusBadge> : null}
                          </span>
                        }
                        used={s.used}
                        max={s.max}
                        format={usd}
                        hint={`${s.openPlans} open plan${s.openPlans === 1 ? "" : "s"}`}
                      />
                    ))}
                  </>
                ) : null}
              </Panel>
            ) : null}

            <div className="grid items-start gap-5 lg:grid-cols-2">
              <Panel title="Exposure" bodyClassName="p-5">
                {total > 0 ? <Donut segs={segs} total={total} /> : <p className="text-[12.5px] text-mute">No exposure yet.</p>}
              </Panel>
              <Panel title="By Leader" bodyClassName="px-1 pb-1">
                {byLeader.length ? (
                  <table className="tbl tbl-tight">
                    <thead>
                      <tr>
                        <th>Leader</th>
                        <th className="r">Allocation</th>
                        <th className="r">PnL</th>
                        <th className="r">Positions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byLeader.map((x) => (
                        <tr key={x.leader}>
                          <td>
                            <span className="inline-flex items-center gap-2">
                              <AddrAvatar value={x.leader} size={24} />
                              <Link href={`/leaders/${x.leader}`} className="text-ink hover:text-accent">
                                {leaderName(x.leader)}
                              </Link>
                            </span>
                          </td>
                          <td className="r text-ink">
                            {usd(x.alloc)} <span className="text-mute">({allocTotal > 0 ? ((x.alloc / allocTotal) * 100).toFixed(1) : "0"}%)</span>
                          </td>
                          <td className={`r ${x.pnl > 0 ? "text-good" : x.pnl < 0 ? "text-bad" : "text-mute"}`}>
                            {Math.abs(x.pnl) < 0.005 ? "—" : `${x.pnl > 0 ? "+" : "−"}${usd(Math.abs(x.pnl))}`}
                          </td>
                          <td className="r">{x.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="px-4 py-3 text-[12.5px] text-mute">No positions by leader yet.</p>
                )}
              </Panel>
            </div>

            <div className="grid items-start gap-5 lg:grid-cols-2">
              <Panel title="Wallet balances" subtitle="Base mainnet" layer="wallet" bodyClassName="p-4">
                {viewingOwnWallet && address ? (
                  <WalletBalances address={address} />
                ) : (
                  <p className="text-[12.5px] leading-relaxed text-mute">
                    {isDemo ? "DEMO desks are seeded addresses with no real balances." : "Connect your wallet to read ETH, USDC and WETH balances over Base RPC."}
                  </p>
                )}
              </Panel>
              <PnlPanel data={data} />
            </div>
          </div>

          {selected ? <PositionDetail row={selected} /> : null}
        </div>
      )}
    </div>
  );
}

type DetailTab = "position" | "execution" | "plan" | "receipt";

/** The selected position: its numbers, fills, the plan behind it and its receipt. */
function PositionDetail({ row }: { row: Row }) {
  const { policy } = useDeskContext();
  const [tab, setTab] = useState<DetailTab>("position");
  const { p, r, pos } = row;
  const st = statusOf(row);
  const mandate = mandateFor(policy, p.leader);
  const pnl = pos ? pos.position.realizedPnlUsd + pos.unrealizedPnlUsd : undefined;
  const fills = r?.fills ?? [];
  const finals = r?.finalFillCount ?? fills.length;
  const buckets = r?.twapBucketCount ?? p.twapBucketCount;
  const progress = buckets ? Math.min(1, finals / buckets) : r?.status === "ORDER_STATUS_FILLED" ? 1 : finals > 0 ? 1 : 0;
  const explorer = CHAINS[p.chain].explorerTx;
  const ratio = mandate?.sizingMode === "PROPORTIONAL" ? `${Math.round(mandate.copyRatio * 100)}%` : mandate?.sizingMode === "FIXED" ? `fixed ${usd(mandate.fixedNotionalUsd)}` : `${Math.round(policy.copyRatio * 100)}%`;
  return (
    <aside className="panel overflow-hidden xl:sticky xl:top-[92px]">
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div>
          <div className="font-[family-name:var(--font-serif)] text-[28px] leading-tight text-ink">{pairLabel(p)}</div>
          <div className="mt-2 flex items-center gap-2 text-[13px]">
            <AddrAvatar value={p.leader} size={30} />
            <span className="text-mute">From</span>
            <Link href={`/leaders/${p.leader}`} className="text-ink hover:text-accent">
              {leaderName(p.leader)}
            </Link>
          </div>
        </div>
        <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
      </div>
      <div className="utabs mt-4 px-5" role="tablist">
        {(["position", "execution", "plan", "receipt"] as DetailTab[]).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} data-on={tab === k} onClick={() => setTab(k)} className="capitalize">
            {k}
          </button>
        ))}
      </div>
      <div className="p-5">
        {tab === "position" ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-line bg-panel-2 p-4">
                <div className="text-[12px] text-mute">PnL (Unrealized)</div>
                <div className={`mt-1.5 font-[family-name:var(--font-serif)] text-[26px] tnum ${pnl === undefined ? "text-mute" : pnl >= 0 ? "text-good" : "text-bad"}`}>
                  {pnl === undefined ? "—" : `${pnl >= 0 ? "+" : "−"}${usd(Math.abs(pnl))}`}
                </div>
                <div className="text-[11.5px] text-mute">{pos?.mark ? "at Flash's exit quote" : "no fills yet"}</div>
              </div>
              <div className="rounded-xl border border-line bg-panel-2 p-4">
                <div className="text-[12px] text-mute">Size</div>
                <div className="mt-1.5 font-[family-name:var(--font-serif)] text-[26px] tnum text-ink">
                  {pos && pos.position.openUnits > 0 ? `${pos.position.openUnits.toFixed(4)}` : usd(r?.flashOrderId ? r.notionalUsd : p.notionalUsd)}
                </div>
                <div className="text-[11.5px] text-mute">{pos && pos.position.openUnits > 0 ? `WETH ≈ ${usd(pos.valueUsd)}` : "notional"}</div>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2.5 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-mute">Entry</dt>
                <dd className="tnum text-ink">{pos ? usd(pos.position.averageCost) : p.entryReferencePrice ? usd(Number(p.entryReferencePrice)) : "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-mute">Order Type</dt>
                <dd className="text-ink">{p.orderType === "twap" ? "TWAP" : p.orderType}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-mute">Mark</dt>
                <dd className="tnum text-ink">{pos?.mark ? usd(pos.mark.price) : "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-mute">Filled</dt>
                <dd className="tnum text-ink">{r?.flashOrderId ? `${Math.round(progress * 100)}%` : "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-mute">Target</dt>
                <dd className="tnum text-ink">{p.takeProfitPrice ? usd(Number(p.takeProfitPrice)) : "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-mute">Network</dt>
                <dd className="text-ink">{CHAINS[p.chain].name}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-mute">Stop</dt>
                <dd className="tnum text-ink">{p.stopLossPrice ? usd(Number(p.stopLossPrice)) : "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-mute">Your Ratio</dt>
                <dd className="tnum text-ink">{ratio}</dd>
              </div>
            </dl>
            <div className="mt-5">
              <div className="flex items-baseline justify-between">
                <h3 className="panel-title text-[18px]">Execution Progress</h3>
                <span className="text-[12px] text-mute">
                  {finals}
                  {buckets ? ` / ${buckets}` : ""} fills
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-panel-3">
                <div className="h-full rounded-full bg-[var(--good)]" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            </div>
            <div className="mt-4">
              <h3 className="panel-title text-[18px]">Fills</h3>
              {fills.length ? (
                <ul className="mt-2 space-y-2">
                  {fills.map((f, i) => (
                    <li key={f.transactionId ?? i} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-panel-2 px-3 py-2 text-[12.5px]">
                      <span className="inline-flex items-center gap-2 text-ink/85">
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--good-ink)]" />
                        {f.filledAt ? new Date(f.filledAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </span>
                      <span className="tnum text-ink">{f.notional ? usd(Number(f.notional)) : "—"}</span>
                      {f.transactionId ? (
                        <a href={`${explorer}${f.transactionId}`} target="_blank" rel="noreferrer" className="text-mute hover:text-ink" aria-label="Open the fill transaction" title={f.transactionId}>
                          ↗
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[12.5px] text-mute">{r?.flashOrderId ? "No fills reported by Flash yet." : "Not signed yet."}</p>
              )}
            </div>
          </>
        ) : null}
        {tab === "execution" ? (
          <dl className="space-y-2.5 text-[13px]">
            {[
              ["Flash status", r?.flashOrderId ? orderStatusLabel(r.status) : "not submitted"],
              ["Signed by", r?.signedBy === "SESSION_KEY" ? "Autopilot session key" : r?.flashOrderId ? "Your wallet" : "—"],
              ["Declared entry", p.entryReferencePrice ? usd(Number(p.entryReferencePrice)) : "—"],
              ["Quoted price", r?.quotedExecutionPrice ? usd(Number(r.quotedExecutionPrice)) : "—"],
              ["Average fill", r?.averageFillPrice ? usd(Number(r.averageFillPrice)) : "—"],
              ["Entry drift", r?.entryDriftBps !== undefined ? `${r.entryDriftBps > 0 ? "+" : ""}${r.entryDriftBps.toFixed(1)} bps` : "—"],
              ["Fees", r?.feesUsd !== undefined ? `$${r.feesUsd.toFixed(3)}` : r?.quotedFeeUsd ? `$${Number(r.quotedFeeUsd).toFixed(3)} quoted` : "—"],
              ["Protection", r?.protection ? `${r.protection.status ?? "—"}${r.protection.orderStatus ? ` · ${orderStatusLabel(r.protection.orderStatus)}` : ""}` : "none"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-line-2 pb-2">
                <dt className="text-mute">{k}</dt>
                <dd className="text-right text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {tab === "plan" ? (
          <div className="space-y-3 text-[13px]">
            <p className="text-ink/85">{p.thesis}</p>
            <div className="flex flex-wrap gap-2">
              {row.d ? <ActionBadge action={row.d.action} verdict={row.d.verdict} /> : null}
              <LayerTag layer="policy" />
            </div>
            <Link href={`/plans/${p.strategyId}`} className="btn w-full">
              Open the plan
            </Link>
            <Link href={`/review/${p.id}`} className="btn w-full">
              Open the proposal review
            </Link>
          </div>
        ) : null}
        {tab === "receipt" ? (
          r?.flashOrderId ? (
            <div className="space-y-3 text-[13px]">
              <p className="text-ink/80">The evidence bundle has Flash&apos;s order and fills, PACT&apos;s decision and quote, and the hash-chained trail for this copy.</p>
              <a className="btn w-full" href={`/api/orders/${encodeURIComponent(r.flashOrderId)}/evidence?download`}>
                Download evidence.json
              </a>
            </div>
          ) : (
            <p className="text-[12.5px] text-mute">A receipt exists once the order is submitted to Flash.</p>
          )
        ) : null}
        <Link href={r?.flashOrderId ? "/execution" : `/review/${p.id}`} className="btn btn-primary mt-5 h-11 w-full text-[14px]">
          {r?.flashOrderId ? "View Full Order" : "Review & Sign"}
        </Link>
      </div>
    </aside>
  );
}

type PositionsPayload = {
  positions: {
    proposalId: string;
    flashOrderId?: string;
    title?: string;
    leader?: string;
    position: Position;
    mark?: Mark;
    valueUsd: number;
    unrealizedPnlUsd: number;
  }[];
  totals: { realizedUsd: number; realizedTodayUsd: number; unrealizedUsd: number; openValueUsd: number; openCostUsd: number; unmarked: number };
};

function signedUsd(v: number) {
  if (Math.abs(v) < 0.005) return usd(0);
  return `${v > 0 ? "+" : "−"}${usd(Math.abs(v))}`;
}

function pnlClass(v: number) {
  return Math.abs(v) < 0.005 ? "text-ink" : v > 0 ? "text-good" : "text-bad";
}

const MARK_LABEL: Record<Mark["basis"], string> = {
  "flash-exit-quote": "Flash exit quote",
  "flash-search-mid": "Flash mid (no exit quote)",
};

/** Realized P&L from Flash fills and open positions marked at Flash's own exit quote. */
function PnlPanel({ data }: { data: PositionsPayload | null }) {
  const rows = data?.positions ?? [];
  const t = data?.totals;
  const basis = rows.find((r) => r.mark)?.mark?.basis;
  return (
    <Panel title="P&L" subtitle="From Flash fill rows; open size marked at Flash's exit quote" layer="execution" bodyClassName="p-4">
      {!rows.length || !t ? (
        <p className="text-[12.5px] leading-relaxed text-mute">
          No filled PACT copies yet. Realized P&amp;L appears once a protective order sells; open positions are valued at
          what Flash would pay to sell them now, never from the chart.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <div className="label">Realized</div>
              <div className={`tnum text-[15px] font-semibold ${pnlClass(t.realizedUsd)}`}>{signedUsd(t.realizedUsd)}</div>
              <div className="text-[11px] text-mute">today {signedUsd(t.realizedTodayUsd)}</div>
            </div>
            <div>
              <div className="label">Unrealized</div>
              <div className={`tnum text-[15px] font-semibold ${pnlClass(t.unrealizedUsd)}`}>{signedUsd(t.unrealizedUsd)}</div>
              <div className="text-[11px] text-mute">
                {usd(t.openValueUsd)} value · {usd(t.openCostUsd)} cost
                {t.unmarked ? ` · ${t.unmarked} unpriced` : ""}
              </div>
            </div>
          </div>
          <table className="tbl tbl-tight mt-4">
            <thead>
              <tr>
                <th>Copy</th>
                <th className="r">Open</th>
                <th className="r">Avg cost</th>
                <th className="r">P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pnl = r.position.closed ? r.position.realizedPnlUsd : r.position.realizedPnlUsd + r.unrealizedPnlUsd;
                return (
                  <tr key={r.proposalId}>
                    <td className="max-w-[160px] truncate">
                      {r.flashOrderId ? (
                        <Link className="text-accent hover:underline" href="/execution">
                          {r.title ?? r.flashOrderId.slice(0, 8)}
                        </Link>
                      ) : (
                        (r.title ?? "—")
                      )}
                    </td>
                    <td className="r">{r.position.closed ? <span className="text-mute">closed</span> : `${r.position.openUnits.toFixed(5)} WETH`}</td>
                    <td className="r">{usd(r.position.averageCost)}</td>
                    <td className={`r ${pnlClass(pnl)}`}>{signedUsd(pnl)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] leading-relaxed text-mute">
            Realized = protective-order sell fills minus average entry cost, sell fees taken off.
            {basis ? ` Open size priced by ${MARK_LABEL[basis]}.` : ""} Positions closed outside PACT are not visible here.
          </p>
        </>
      )}
    </Panel>
  );
}

function ExposureBar({ segs, total }: { segs: Segment[]; total: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const parts: (Segment & { share: number; center: number })[] = [];
  for (const s of segs) {
    const share = s.usd / total;
    const start = parts.length ? parts[parts.length - 1].center + parts[parts.length - 1].share / 2 : 0;
    parts.push({ ...s, share, center: start + share / 2 });
  }
  const active = hover !== null ? parts[hover] : null;

  return (
    <div className="mt-4">
      <div className="relative">
        <div className="flex h-7 w-full gap-[2px]" role="img" aria-label="Exposure share by asset and side">
          {parts.map((p, i) => (
            <div
              key={p.key}
              className="h-full min-w-[3px] rounded transition-opacity"
              style={{ flexGrow: p.share, flexBasis: 0, background: p.color, opacity: hover === null || hover === i ? 1 : 0.45 }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </div>
        {active ? (
          <div
            className="pointer-events-none absolute bottom-full z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-panel-3 px-2.5 py-1.5 text-[11.5px] shadow-lg"
            style={{ left: `${Math.min(85, Math.max(15, active.center * 100))}%` }}
          >
            <div className="font-medium text-ink">{active.label}</div>
            <div className="tnum text-mute">
              {usd(active.usd)} · {((active.usd / total) * 100).toFixed(0)}% · live {usd(active.liveUsd)}
            </div>
          </div>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
        {segs.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-mute">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
            <span className="text-ink">{s.label}</span>
            <span className="tnum">{((s.usd / total) * 100).toFixed(0)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function WalletBalances({ address }: { address: `0x${string}` }) {
  const eth = useBalance({ address, chainId: BASE_ID });
  const tokens = useReadContracts({
    contracts: [
      { address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [address], chainId: BASE_ID },
      { address: WETH, abi: erc20Abi, functionName: "balanceOf", args: [address], chainId: BASE_ID },
    ],
  });
  const usdc = tokens.data?.[0]?.result;
  const weth = tokens.data?.[1]?.result;
  const rows: { symbol: string; value?: string; note: string }[] = [
    {
      symbol: "ETH",
      value: eth.data ? Number(formatUnits(eth.data.value, eth.data.decimals)).toFixed(6) : undefined,
      note: "gas for approvals",
    },
    { symbol: "USDC", value: usdc !== undefined ? Number(formatUnits(usdc, 6)).toFixed(2) : undefined, note: "spent on buys" },
    { symbol: "WETH", value: weth !== undefined ? Number(formatUnits(weth, 18)).toFixed(6) : undefined, note: "spent on sells" },
  ];
  const loading = eth.isLoading || tokens.isLoading;
  const failed = eth.isError || tokens.isError;
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th>Asset</th>
            <th className="r">Balance</th>
            <th>Used for</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol}>
              <td className="text-ink">{r.symbol}</td>
              <td className="r text-ink">{r.value ?? (loading ? "…" : failed ? "unavailable" : "—")}</td>
              <td className="text-mute">{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
