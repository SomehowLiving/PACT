"use client";

import { useDeskContext, useMine } from "@/components/DeskContext";
import { ActionBadge, Empty, KV, LayerTag, PageHeader, Panel, Planned, Segmented, StatusBadge, LeaderTag } from "@/components/ui";
import { reasonLabel, usd } from "@/lib/format";
import type { CopyAction, Decision, Proposal } from "@/lib/types";
import { actionCounts, actionOf, approvedNotional, isExpired, pairLabel, relativeTime, rewardRisk } from "@/lib/views";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { EvidenceBadge } from "@/components/pages/discover-parts";

type Filter = "ALL" | CopyAction;

type AssistRecommendation = {
  proposalId: string;
  action: "PREPARE_REVIEW" | "HOLD" | "DECLINE";
  headline: string;
  reasons: string[];
};

type AssistResult = {
  mode: "REVIEW" | "ASSIST";
  recommendations: AssistRecommendation[];
  constraints: string[];
};

const SIZING_LABEL: Record<Proposal["copySizingMode"], string> = {
  PROPORTIONAL: "proportional",
  FIXED: "fixed USD",
  STOP_RISK: "stop-risk",
};

function price(value?: string) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—";
}

function gradeTone(grade: Proposal["leaderPlanGrade"]) {
  return grade === "DISCIPLINED" ? "good" : grade === "CAUTION" ? "warn" : "bad";
}

export function Proposals() {
  const { state, refresh, follower, policy, canAct, isDemo } = useDeskContext();
  const mine = useMine();
  const [filter, setFilter] = useState<Filter>("ALL");
  // Deep links such as /proposals?action=COPY preselect a filter (read after hydration).
  useEffect(() => {
    const id = setTimeout(() => {
      const wanted = new URLSearchParams(window.location.search).get("action")?.toUpperCase();
      if (wanted && (["COPY", "SCALE", "WAIT", "REVIEW", "DECLINE"] as string[]).includes(wanted)) {
        setFilter(wanted as CopyAction);
      }
    }, 0);
    return () => clearTimeout(id);
  }, []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mirroring, setMirroring] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [assist, setAssist] = useState<AssistResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decisions = useMemo(() => state?.decisions ?? {}, [state?.decisions]);
  const counts = useMemo(() => actionCounts(mine, decisions), [mine, decisions]);
  const rows = useMemo(
    () => (filter === "ALL" ? mine : mine.filter((p) => actionOf(decisions[p.id]) === filter)),
    [filter, mine, decisions],
  );
  const selected = rows.find((p) => p.id === selectedId) ?? rows[0];
  const assistById = useMemo(
    () => new Map((assist?.recommendations ?? []).map((r) => [r.proposalId, r])),
    [assist],
  );

  async function mirror() {
    if (!canAct || !follower) return;
    setMirroring(true);
    setError(null);
    try {
      const follows = policy.follows ?? [];
      for (const s of state?.strategies ?? []) {
        if (!follows.some((l) => l.toLowerCase() === s.leader.toLowerCase())) continue;
        await apiFetch("/api/proposals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ strategyId: s.id, follower }),
        });
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "mirror failed");
    } finally {
      setMirroring(false);
    }
  }

  async function scan() {
    if (!follower) return;
    setScanning(true);
    setError(null);
    try {
      const res = await fetch(`/api/agent?follower=${follower}`, { cache: "no-store" });
      const json = (await res.json()) as AssistResult & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "assist scan failed");
      setAssist(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "assist scan failed");
    } finally {
      setScanning(false);
    }
  }

  const filterOptions: { value: Filter; label: string; count: number }[] = [
    { value: "ALL", label: "All", count: mine.length },
    ...(["COPY", "SCALE", "WAIT", "REVIEW", "DECLINE"] as CopyAction[]).map((a) => ({
      value: a,
      label: a,
      count: counts[a],
    })),
  ];

  return (
    <div>
      <PageHeader
        title="Proposals"
        description="Every leader plan you follow, decided against your mandate. PACT only quotes and asks for a signature on COPY and SCALE."
        actions={
          <>
            <button
              type="button"
              className="btn"
              disabled={!follower || scanning}
              onClick={() => void scan()}
              title="Deterministic scan of stored policy decisions. Never quotes or signs."
            >
              {scanning ? "Scanning…" : "Assist scan"}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canAct || mirroring}
              onClick={() => void mirror()}
              title={canAct ? "Create proposals from open plans of your selected leaders" : "Connect your own wallet to mirror plans"}
            >
              {mirroring ? "Mirroring…" : "Mirror open intents"}
            </button>
          </>
        }
      />

      {error ? <p className="mb-3 text-[12px] text-bad">{error}</p> : null}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="max-w-full overflow-x-auto">
          <Segmented value={filter} options={filterOptions} onChange={setFilter} />
        </div>
        {isDemo ? <LayerTag layer="demo" /> : null}
      </div>

      <div className="grid items-start gap-4 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel
          title="Queue"
          subtitle={`${rows.length} proposal${rows.length === 1 ? "" : "s"} · newest first`}
          layer="policy"
        >
          {!follower ? (
            <Empty title="No follower selected">
              Connect your wallet, or choose a demo desk in the top bar to inspect a seeded queue.
            </Empty>
          ) : rows.length === 0 ? (
            <Empty
              title={mine.length ? "Nothing matches this filter" : "No proposals yet"}
              action={
                mine.length ? null : (
                  <Link href="/discover" className="btn">
                    Find leaders to follow
                  </Link>
                )
              }
            >
              {mine.length
                ? "Try another decision filter."
                : "Select leaders in Discover, then mirror their open plans into this queue."}
            </Empty>
          ) : (
            <div className="scroll-thin max-h-[640px] overflow-auto">
              <table className="tbl tbl-tight">
                <thead>
                  <tr>
                    <th>Decision</th>
                    <th>Plan</th>
                    <th>Leader</th>
                    <th className="r">Requested</th>
                    <th className="r">Approved</th>
                    <th>Grade</th>
                    <th>Expiry</th>
                    <th>Evidence</th>
                    {assist ? <th>Assist</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <QueueRow
                      key={p.id}
                      proposal={p}
                      decision={decisions[p.id]}
                      selected={selected?.id === p.id}
                      onSelect={() => setSelectedId(p.id)}
                      assist={assist ? assistById.get(p.id) : undefined}
                      showAssist={!!assist}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="space-y-4">
          {selected ? (
            <VerdictPanel proposal={selected} decision={decisions[selected.id]} />
          ) : (
            <Panel title="Policy verdict" layer="policy">
              <Empty title="Select a proposal">The verdict, its reasons and the sizing math appear here.</Empty>
            </Panel>
          )}

          {assist ? (
            <Panel
              title="Assist scan"
              subtitle={assist.mode === "ASSIST" ? "Assist mode on" : "Review mode: scan only"}
              layer="policy"
              actions={
                <button type="button" className="btn btn-ghost px-2 py-1 text-[11px]" onClick={() => setAssist(null)}>
                  Clear
                </button>
              }
              bodyClassName="p-4"
            >
              <div className="grid grid-cols-3 gap-2 text-center">
                {(["PREPARE_REVIEW", "HOLD", "DECLINE"] as const).map((a) => (
                  <div key={a} className="rounded-lg border border-line-2 py-2">
                    <div className="tnum text-[18px] font-semibold text-ink">
                      {assist.recommendations.filter((r) => r.action === a).length}
                    </div>
                    <div className="label mt-0.5 text-[9px]">{a.replace("_", " ")}</div>
                  </div>
                ))}
              </div>
              <ul className="mt-3 space-y-1 text-[11px] leading-relaxed text-mute">
                {assist.constraints.map((c) => (
                  <li key={c}>· {c}</li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Planned title="Autopilot">
            Automatic execution of COPY decisions under a capped size. Requires a revocable, expiry-bound
            smart-account session key scoped to Flash; PACT will never ask for a private key.
          </Planned>
        </div>
      </div>
    </div>
  );
}

function QueueRow({
  proposal: p,
  decision,
  selected,
  onSelect,
  assist,
  showAssist,
}: {
  proposal: Proposal;
  decision?: Decision;
  selected: boolean;
  onSelect: () => void;
  assist?: AssistRecommendation;
  showAssist: boolean;
}) {
  const expired = isExpired(p);
  const approved = approvedNotional(p, decision);
  return (
    <tr
      data-selected={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      tabIndex={0}
      className="cursor-pointer"
    >
      <td>{decision ? <ActionBadge action={decision.action} verdict={decision.verdict} /> : <span className="text-mute">—</span>}</td>
      <td className="max-w-[240px]">
        <div className="truncate text-ink" title={p.title}>
          {p.title}
        </div>
        <div className="text-[11.5px] text-mute">
          {pairLabel(p)} · <span className="capitalize">{p.side}</span> · {p.orderType === "twap" ? "TWAP" : p.orderType}
        </div>
      </td>
      <td>
        <LeaderTag value={p.leader} size={20} />
      </td>
      <td className="r">{decision?.verdict === "MODIFY" ? <span className="text-mute">—</span> : usd(p.notionalUsd)}</td>
      <td className="r">
        <div className="text-ink">{approved > 0 ? usd(approved) : <span className="text-mute">$0</span>}</div>
        <div className="text-[11.5px] text-mute">{SIZING_LABEL[p.copySizingMode]}</div>
      </td>
      <td>
        <StatusBadge tone={gradeTone(p.leaderPlanGrade)}>{p.leaderPlanGrade.toLowerCase()}</StatusBadge>
      </td>
      <td className={expired ? "text-mute line-through" : "text-mute"}>{relativeTime(p.expiresAt)}</td>
      <td><EvidenceBadge status={p.leaderEvidenceStatus} /></td>
      {showAssist ? (
        <td className="text-mute">{assist ? assist.action.replace("_", " ").toLowerCase() : "—"}</td>
      ) : null}
    </tr>
  );
}

function VerdictPanel({ proposal: p, decision }: { proposal: Proposal; decision?: Decision }) {
  const blocked = !decision || decision.verdict === "BLOCK";
  const rr = rewardRisk(p);
  const action = actionOf(decision);
  return (
    <Panel
      title="Policy verdict"
      subtitle={p.title}
      layer="policy"
      actions={decision ? <ActionBadge action={decision.action} verdict={decision.verdict} /> : null}
      bodyClassName="p-4"
    >
      <div>
        <div className="label">Reasons</div>
        {decision?.reasons.length ? (
          <ul className="mt-2 space-y-1.5">
            {decision.reasons.map((r) => (
              <li key={r} className="flex items-start gap-2 text-[12.5px] text-ink">
                <span aria-hidden className={blocked ? "text-bad" : "text-warn"}>
                  {blocked ? "✕" : "!"}
                </span>
                <span>
                  {reasonLabel(r)}
                  <span className="ml-1.5 font-mono text-[10px] text-mute">{r}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[12.5px] text-mute">
            {decision ? "No policy limits hit. The plan fits your mandate as declared." : "No decision recorded."}
          </p>
        )}
      </div>

      <div className="mt-4">
        <div className="label">Sizing</div>
        <dl className="mt-1">
          <KV k="Mode" v={SIZING_LABEL[p.copySizingMode]} />
          <KV k={action === "SCALE" ? "Approved (scaled)" : "Notional"} v={usd(approvedNotional(p, decision) || p.notionalUsd)} />
          <KV k="Flash qty" v={`${decision?.modifiedQty ?? p.qty} ${p.side === "buy" ? "USDC" : "target"}`} />
          {p.copySizingMode === "STOP_RISK" ? (
            <>
              <KV k="Risk budget" v={p.riskBudgetUsd !== undefined ? usd(p.riskBudgetUsd) : "—"} />
              <KV k="Risk / unit" v={p.stopRiskPerUnitUsd !== undefined ? usd(p.stopRiskPerUnitUsd) : "—"} />
              <KV
                k="Planned loss at stop"
                v={p.estimatedLossAtStopUsd !== undefined ? usd(p.estimatedLossAtStopUsd) : "—"}
              />
            </>
          ) : null}
        </dl>
        {p.copySizingMode === "STOP_RISK" ? (
          <p className="mt-1.5 text-[11px] leading-relaxed text-mute">
            Planned loss is an estimate at the declared stop, not a guaranteed maximum.
          </p>
        ) : null}
      </div>

      <div className="mt-4">
        <div className="flex items-center gap-2">
          <span className="label">Leader plan</span>
          <span className="text-[10px] text-mute">declared, not executed</span>
        </div>
        <dl className="mt-1">
          <KV k="Entry" v={price(p.entryReferencePrice)} />
          <KV k="Stop" v={price(p.stopLossPrice)} />
          <KV k="Target" v={price(p.takeProfitPrice)} />
          <KV k="Reward : risk" v={rr !== undefined ? `${rr.toFixed(2)} : 1` : "—"} />
          <KV k="Exit" v={p.followerExitMode === "FOLLOWER_BRACKET" ? "Flash TP/SL bracket" : "manual"} />
          <KV k="Expires" v={relativeTime(p.expiresAt)} />
          <KV k="Invalidation" v={p.invalidation?.trim() || "not declared"} wrap />
        </dl>
      </div>

      {blocked ? (
        <button type="button" className="btn mt-4 w-full" disabled>
          Review unavailable · blocked by policy
        </button>
      ) : (
        <Link href={`/review/${p.id}`} className="btn btn-primary mt-4 w-full">
          Open review
        </Link>
      )}
    </Panel>
  );
}
