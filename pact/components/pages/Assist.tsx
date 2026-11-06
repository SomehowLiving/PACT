"use client";

import { useDeskContext } from "@/components/DeskContext";
import { ActionBadge, Empty, LayerTag, PageHeader, Panel, Planned, StatusBadge, type Tone } from "@/components/ui";
import { reasonLabel } from "@/lib/format";
import type { AutomationMode } from "@/lib/types";
import Link from "next/link";
import { useState } from "react";

type Recommendation = { proposalId: string; action: "PREPARE_REVIEW" | "HOLD" | "DECLINE"; headline: string; reasons: string[] };
type Scan = { mode: AutomationMode; recommendations: Recommendation[]; constraints: string[] };

const REC_TONE: Record<Recommendation["action"], { tone: Tone; label: string }> = {
  PREPARE_REVIEW: { tone: "good", label: "Prepare review" },
  HOLD: { tone: "warn", label: "Hold" },
  DECLINE: { tone: "bad", label: "Decline" },
};

const LEVELS = [
  { level: "0", name: "Review only", status: "Built", can: "Nothing on its own. You review and sign every plan.", cannot: "—" },
  { level: "1", name: "PACT Assist", status: "Built", can: "Read your proposals and stored decisions, sort them into a review queue, explain each one.", cannot: "Quote, sign, submit, cancel, change a mandate, or hold any key." },
  { level: "2", name: "Autopilot", status: "Planned", can: "Execute COPY / SCALE plans inside your mandate with a revocable, scoped session key.", cannot: "Leave the session's on-chain scope, widen a limit, override a refusal, or withdraw." },
  { level: "3", name: "Bring your own agent", status: "Idea", can: "An external agent operates a bounded sub-account under a PACT mandate.", cannot: "Same limits as Autopilot." },
];

export function Assist() {
  const { state, policy, follower, canAct, isDemo, refresh } = useDeskContext();
  const [scan, setScan] = useState<Scan | null>(null);
  const [busy, setBusy] = useState<"mode" | "scan" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mode = policy.automationMode ?? "REVIEW";
  const byId = new Map((state?.proposals ?? []).map((p) => [p.id, p]));

  async function setMode(next: AutomationMode) {
    setBusy("mode");
    setError(null);
    try {
      const res = await fetch("/api/policy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...policy, automationMode: next }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "could not change mode");
      if (next === "REVIEW") setScan(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not change mode");
    } finally {
      setBusy(null);
    }
  }

  async function runScan() {
    if (!follower) return;
    setBusy("scan");
    setError(null);
    try {
      const res = await fetch(`/api/agent?follower=${follower}`, { cache: "no-store" });
      const json = (await res.json()) as Scan & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "scan failed");
      setScan(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "scan failed");
    } finally {
      setBusy(null);
    }
  }

  const counts = { PREPARE_REVIEW: 0, HOLD: 0, DECLINE: 0 };
  for (const r of scan?.recommendations ?? []) counts[r.action] += 1;

  return (
    <div>
      <PageHeader
        title="PACT Assist"
        description="A deterministic helper that sorts your proposals into a review queue. It never quotes, signs or changes your mandate."
        actions={
          <>
            <button
              type="button"
              className="btn"
              disabled={!canAct || busy !== null}
              title={canAct ? undefined : isDemo ? "Demo desks are read-only" : "Connect your wallet"}
              onClick={() => void setMode(mode === "ASSIST" ? "REVIEW" : "ASSIST")}
            >
              {busy === "mode" ? "Saving…" : mode === "ASSIST" ? "Turn Assist off" : "Turn Assist on"}
            </button>
            <button type="button" className="btn btn-primary" disabled={mode !== "ASSIST" || !follower || busy !== null} onClick={() => void runScan()}>
              {busy === "scan" ? "Scanning…" : "Scan proposals"}
            </button>
          </>
        }
      />
      {error ? <p className="mb-4 text-[12.5px] text-bad">{error}</p> : null}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel
          title="Review queue"
          layer="policy"
          subtitle={mode === "ASSIST" ? "Built from the same stored decisions you see in Proposals" : "Assist is off; you triage proposals yourself"}
          actions={
            scan ? (
              <span className="flex items-center gap-2 text-[12px] text-mute">
                <StatusBadge tone="good">{counts.PREPARE_REVIEW} prepare</StatusBadge>
                <StatusBadge tone="warn">{counts.HOLD} hold</StatusBadge>
                <StatusBadge tone="bad">{counts.DECLINE} decline</StatusBadge>
              </span>
            ) : null
          }
        >
          {scan?.recommendations.length ? (
            <div className="scroll-thin overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Assist</th>
                    <th>Plan</th>
                    <th>PACT decision</th>
                    <th>Why</th>
                    <th className="r" />
                  </tr>
                </thead>
                <tbody>
                  {scan.recommendations.map((r) => {
                    const p = byId.get(r.proposalId);
                    const d = state?.decisions[r.proposalId];
                    return (
                      <tr key={r.proposalId}>
                        <td>
                          <StatusBadge tone={REC_TONE[r.action].tone}>{REC_TONE[r.action].label}</StatusBadge>
                        </td>
                        <td className="max-w-[240px]">
                          <div className="truncate text-ink">{p?.title ?? r.proposalId}</div>
                          <div className="text-[11.5px] text-mute">{r.headline}</div>
                        </td>
                        <td>{d ? <ActionBadge action={d.action} verdict={d.verdict} /> : "—"}</td>
                        <td className="max-w-[260px] truncate text-[12px] text-mute">{r.reasons.length ? r.reasons.map(reasonLabel).join(", ") : "no limits hit"}</td>
                        <td className="r">
                          {r.action === "PREPARE_REVIEW" ? (
                            <Link href={`/review/${r.proposalId}`} className="btn h-7 px-3 text-[12px]">
                              Review
                            </Link>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title={mode === "ASSIST" ? (scan ? "Nothing to sort" : "Run a scan") : "Assist is off"}>
              {mode === "ASSIST"
                ? "Assist maps COPY and SCALE to prepare-review, WAIT and REVIEW to hold, and refusals to decline. Every prepared item still opens your normal review and signature."
                : "Turn Assist on to have your proposals sorted into a review queue. You can turn it off at any time."}
            </Empty>
          )}
        </Panel>

        <div className="space-y-5">
          <Panel title="What Assist may do" bodyClassName="px-4 py-3">
            <ul className="space-y-2 text-[12.5px]">
              {(scan?.constraints ?? [
                "No private key or session key is available to PACT Assist.",
                "Assist never signs, quotes, submits, cancels, or changes a follower mandate.",
                "Every prepared order still opens the follower review and self-sign flow.",
              ]).map((c) => (
                <li key={c} className="flex gap-2 text-ink/85">
                  <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-mute" />
                  {c}
                </li>
              ))}
            </ul>
          </Panel>
          <Planned title="Autopilot">
            Needs a follower-owned smart account with a revocable, short-lived session key scoped on-chain to Flash, your assets,
            sides, limits and expiry, and a small live mainnet test. A missing or revoked session always means hold.
          </Planned>
        </div>
      </div>

      <Panel title="Agent authority levels" className="mt-5" subtitle="Each level is gated by what you can verify and revoke">
        <div className="scroll-thin overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Level</th>
                <th>Name</th>
                <th>Status</th>
                <th>Can do</th>
                <th>Cannot do</th>
              </tr>
            </thead>
            <tbody>
              {LEVELS.map((l) => (
                <tr key={l.level}>
                  <td className="tnum text-mute">{l.level}</td>
                  <td className="font-medium text-ink">{l.name}</td>
                  <td>
                    {l.status === "Built" ? (
                      <StatusBadge tone="good">Built</StatusBadge>
                    ) : (
                      <LayerTag layer="planned" />
                    )}
                  </td>
                  <td className="whitespace-normal text-[12.5px] text-ink/85">{l.can}</td>
                  <td className="whitespace-normal text-[12.5px] text-mute">{l.cannot}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
