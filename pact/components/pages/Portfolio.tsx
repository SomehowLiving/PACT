"use client";

import { useDeskContext, useMine } from "@/components/DeskContext";
import {
  ActionBadge,
  Addr,
  Empty,
  LayerTag,
  Meter,
  PageHeader,
  Panel,
  StatusBadge,
} from "@/components/ui";
import { usd } from "@/lib/format";
import { CLOSED_STATUSES, capacity, exposureGroups, orderStatusLabel, pairLabel, type ExposureGroup } from "@/lib/views";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Mark } from "@/lib/positions";
import type { Position } from "@/lib/types";
import { erc20Abi, formatUnits } from "viem";
import { useBalance, useReadContracts } from "wagmi";

const BASE_ID = 8453;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const WETH = "0x4200000000000000000000000000000000000006" as const;
const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];
const OTHER = "var(--mute)";

type Segment = { key: string; label: string; usd: number; approvedUsd: number; liveUsd: number; leaders: number; color: string };

/** Fixed colour order by entity; more than three groups fold into "Other". */
function segments(groups: ExposureGroup[]): Segment[] {
  const head = groups.slice(0, 3).map((g, i) => ({
    key: g.key,
    label: `${g.asset} ${g.side}`,
    usd: g.approvedUsd + g.liveUsd,
    approvedUsd: g.approvedUsd,
    liveUsd: g.liveUsd,
    leaders: g.leaders.length,
    color: SERIES[i],
  }));
  const rest = groups.slice(3);
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

export function Portfolio() {
  const { state, policy, follower, isDemo, address } = useDeskContext();
  const mine = useMine();

  const groups = useMemo(() => (state ? exposureGroups(state, follower) : []), [state, follower]);
  const cap = useMemo(() => (state ? capacity(state, policy) : undefined), [state, policy]);
  const segs = useMemo(() => segments(groups), [groups]);
  const total = segs.reduce((s, g) => s + g.usd, 0);
  const totalLive = groups.reduce((s, g) => s + g.liveUsd, 0);
  const totalApproved = groups.reduce((s, g) => s + g.approvedUsd, 0);

  const positions = useMemo(() => {
    const receiptOf = new Map((state?.receipts ?? []).map((r) => [r.proposalId, r]));
    return mine
      .map((p) => ({ p, d: state?.decisions[p.id], r: receiptOf.get(p.id) }))
      .filter(({ d, r }) => d && d.verdict !== "BLOCK" && !(r?.status && CLOSED_STATUSES.includes(r.status)));
  }, [mine, state]);

  const viewingOwnWallet = !isDemo && !!address && follower?.toLowerCase() === address.toLowerCase();

  return (
    <div>
      <PageHeader
        eyebrow="05 · Portfolio"
        title="Portfolio"
        description="What your mandate has approved, what is live on Flash, how concentrated it is, and how much capacity is left today."
      />

      {!follower ? (
        <div className="panel">
          <Empty title="No follower selected">Connect your wallet, or choose a demo desk in the top bar.</Empty>
        </div>
      ) : (
        <div className="space-y-4">
          <Panel
            title="Asset exposure"
            subtitle="Same asset and side, approved by policy or live on Flash"
            actions={
              <>
                <LayerTag layer="policy" />
                <LayerTag layer="execution" />
              </>
            }
            bodyClassName="p-4"
          >
            {total > 0 ? (
              <>
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                  <div>
                    <span className="label">Total</span>
                    <div className="tnum text-[22px] font-semibold text-ink">{usd(total)}</div>
                  </div>
                  <div className="text-[12px] text-mute">
                    <span className="tnum text-ink">{usd(totalLive)}</span> live on Flash ·{" "}
                    <span className="tnum text-ink">{usd(totalApproved)}</span> approved, not submitted
                  </div>
                </div>
                <ExposureBar segs={segs} total={total} />
                <div className="mt-4 overflow-x-auto">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Asset · side</th>
                        <th className="r">Approved, not submitted</th>
                        <th className="r">Live on Flash</th>
                        <th className="r">Total</th>
                        <th className="r">Share</th>
                        <th className="r">Leaders</th>
                      </tr>
                    </thead>
                    <tbody>
                      {segs.map((s) => (
                        <tr key={s.key}>
                          <td>
                            <span className="inline-flex items-center gap-2 text-ink">
                              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
                              {s.label}
                            </span>
                          </td>
                          <td className="r">{usd(s.approvedUsd)}</td>
                          <td className="r">{usd(s.liveUsd)}</td>
                          <td className="r text-ink">{usd(s.usd)}</td>
                          <td className="r">{((s.usd / total) * 100).toFixed(0)}%</td>
                          <td className="r">{s.leaders}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <Empty title="No exposure">
                Nothing is approved or live. Approved proposals and submitted Flash orders appear here.
              </Empty>
            )}
          </Panel>

          <div className="grid items-start gap-4 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Panel title="Open positions" subtitle="Approved plans and non-terminal Flash orders" layer="policy">
              {positions.length ? (
                <div className="overflow-x-auto">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Decision</th>
                        <th>Plan</th>
                        <th>Leader</th>
                        <th>Pair</th>
                        <th>Side · type</th>
                        <th className="r">Notional</th>
                        <th>State</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map(({ p, d, r }) => (
                        <tr key={p.id}>
                          <td>{d ? <ActionBadge action={d.action} verdict={d.verdict} /> : null}</td>
                          <td className="max-w-[220px] truncate text-ink" title={p.title}>
                            {p.title}
                          </td>
                          <td>
                            <Addr value={p.leader} />
                          </td>
                          <td>{pairLabel(p)}</td>
                          <td className="text-mute">
                            <span className="text-ink">{p.side}</span> · {p.orderType}
                          </td>
                          <td className="r text-ink">{usd(r?.flashOrderId ? r.notionalUsd : p.notionalUsd)}</td>
                          <td>
                            {r?.flashOrderId ? (
                              <span className="inline-flex items-center gap-1.5">
                                <LayerTag layer="execution" compact />
                                <span className="text-ink">{orderStatusLabel(r.status)}</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5">
                                <LayerTag layer="policy" compact />
                                <span className="text-mute">awaiting signature</span>
                              </span>
                            )}
                          </td>
                          <td className="r">
                            <Link
                              href={r?.flashOrderId ? "/execution" : `/review/${p.id}`}
                              className="text-[12px] text-accent hover:underline"
                            >
                              {r?.flashOrderId ? "order" : "review"}
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="No open positions">
                  COPY and SCALE proposals stay here until their Flash order closes.
                </Empty>
              )}
            </Panel>

            <div className="space-y-4">
              <Panel title="Remaining capacity" subtitle="The same limits PACT enforces on new proposals" layer="policy" bodyClassName="space-y-4 p-4">
                {cap ? (
                  <>
                    <Meter label="Daily copy budget" used={cap.dailyUsed} max={cap.dailyMax} format={usd} />
                    <Meter label="Open plans" used={cap.openPlans} max={cap.openPlansMax} />
                    {cap.sleeves.length ? (
                      <div className="space-y-3 border-t border-line-2 pt-3">
                        <div className="label">Leader sleeves today</div>
                        {cap.sleeves.map((s) => (
                          <Meter
                            key={s.leader}
                            label={
                              <span className="inline-flex items-center gap-2">
                                <Addr value={s.leader} />
                                {s.paused ? <StatusBadge tone="warn" icon="⏸">paused</StatusBadge> : null}
                              </span>
                            }
                            used={s.used}
                            max={s.max}
                            format={usd}
                            hint={`${s.openPlans} open plan${s.openPlans === 1 ? "" : "s"}`}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="text-[12px] text-mute">No leaders selected.</p>
                    )}
                  </>
                ) : null}
              </Panel>

              <Panel title="Same-asset concentration" subtitle={`Cap ${usd(policy.maxAssetExposureUsd)} per asset and side`} layer="policy" bodyClassName="space-y-4 p-4">
                {groups.length ? (
                  groups.map((g) => (
                    <Meter
                      key={g.key}
                      label={`${g.asset} ${g.side}`}
                      used={g.liveUsd + g.approvedUsd}
                      max={policy.maxAssetExposureUsd}
                      format={usd}
                      hint={`${total > 0 ? Math.round(((g.liveUsd + g.approvedUsd) / total) * 100) : 0}% of exposure · ${g.leaders.length} leader${g.leaders.length === 1 ? "" : "s"} contributing`}
                    />
                  ))
                ) : (
                  <p className="text-[12px] text-mute">No concentration yet.</p>
                )}
                <p className="text-[11px] leading-relaxed text-mute">
                  Concentration counts plans on the same asset and side. PACT does not estimate statistical correlation from
                  insufficient history.
                </p>
              </Panel>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Wallet balances" subtitle="Base mainnet" layer="wallet" bodyClassName="p-4">
              {viewingOwnWallet && address ? (
                <WalletBalances address={address} />
              ) : (
                <p className="text-[12.5px] leading-relaxed text-mute">
                  {isDemo
                    ? "Demo desks are seeded addresses with no real balances. Switch to your wallet to read balances over Base RPC."
                    : "Connect your wallet to read ETH, USDC and WETH balances over Base RPC."}
                </p>
              )}
            </Panel>
            <PnlPanel follower={follower} />
          </div>
        </div>
      )}
    </div>
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
function PnlPanel({ follower }: { follower?: `0x${string}` }) {
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

  const rows = follower ? (data?.positions ?? []) : [];
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
