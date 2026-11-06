import { tokenOutflows } from "./base-rpc";
import { buyWindow, frontRun, sellIntoFlow, summarize, type ConductPlan, type Fill, type Outflow } from "./conduct";
import { setLeaderConduct, snapshot } from "./store";

/*
 * Gathers the facts for lib/conduct: followers' real Flash fills of a leader's plans (from
 * PACT's receipts), the leader's own evidenced trade (from their attached evidence, read on
 * Base), and the plan's asset leaving the leader's wallet on Base while followers bought.
 */

export type ConductDeps = {
  outflows: (owner: string, token: string, fromMs: number, toMs: number) => Promise<Outflow[]>;
  nowMs?: number;
};

const defaults: ConductDeps = { outflows: (o, t, f, to) => tokenOutflows(o, t, f, to) };

export async function scanLeaderConduct(leader: string, deps: Partial<ConductDeps> = {}) {
  const d = { ...defaults, ...deps };
  const st = snapshot();
  const key = leader.toLowerCase();
  // Seeded DEMO records stay as seeded; a real scan of a DEMO address would only erase them.
  const seeded = st.conduct?.[key];
  if (seeded?.source === "demo") return { conduct: seeded, changed: false };
  const plans: ConductPlan[] = [];
  for (const plan of st.strategies.filter((s) => s.leader.toLowerCase() === key)) {
    const copies = new Set(st.proposals.filter((p) => p.strategyId === plan.id).map((p) => p.id));
    const fills: Fill[] = st.receipts
      .filter((r) => copies.has(r.proposalId))
      .flatMap((r) => r.fills ?? [])
      .map((f) => ({ at: Date.parse(f.filledAt ?? ""), price: Number(f.fillPrice), usd: Number(f.notional) }))
      .filter((f) => Number.isFinite(f.at) && f.price > 0 && f.usd > 0)
      .map((f) => ({ at: f.at, price: f.price, units: f.usd / f.price }));
    if (!fills.length) continue;
    let sold: ConductPlan["sellIntoFlow"];
    if (plan.side === "buy" && plan.chain === "base") {
      const w = buyWindow(fills)!;
      try {
        sold = sellIntoFlow(fills, await d.outflows(plan.leader, plan.targetAsset, w.from, w.to), plan.leaderEvidence?.onchain?.targetUnits);
      } catch {
        // Base RPC failed: unknown for this plan, which is not the same as clear.
      }
    }
    plans.push({ strategyId: plan.id, title: plan.title, frontRun: frontRun(plan, plan.leaderEvidence?.onchain ?? {}, fills), sellIntoFlow: sold });
  }
  return setLeaderConduct(summarize(leader, plans, "base", d.nowMs));
}

const lastScan = new Map<string, number>();

/** Fire-and-forget re-check, at most once a minute per leader. */
export function scheduleConductScan(leader: string, minGapMs = 60_000) {
  const key = leader.toLowerCase();
  const now = Date.now();
  if (now - (lastScan.get(key) ?? 0) < minGapMs) return;
  lastScan.set(key, now);
  void scanLeaderConduct(key).catch(() => undefined);
}
