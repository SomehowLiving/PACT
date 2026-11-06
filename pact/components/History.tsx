"use client";

import { VerdictPill } from "@/components/VerdictPill";
import { useDesk } from "@/components/useDesk";
import { CHAINS } from "@/lib/chains";
import { reasonLabel, shortAddr, usd } from "@/lib/format";

export function History() {
  const { state } = useDesk();
  const logs = state?.logs ?? [];
  const proposals = new Map((state?.proposals ?? []).map((p) => [p.id, p]));
  const receipts = new Map((state?.receipts ?? []).map((r) => [r.proposalId, r]));

  const fills = (state?.receipts ?? []).flatMap((r) => r.fills ?? []);
  const filled = fills.reduce((sum, f) => sum + Number(f.notional ?? 0), 0);
  const blocked = state?.blockedNotionalUsd ?? 0;

  function exportJson() {
    const blob = new Blob([JSON.stringify({ logs, receipts: state?.receipts ?? [] }, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pact-audit.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-5">
      <section className="glass rounded-[32px] p-6 md:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-mute">Orders · audit trail</div>
            <h1 className="mt-2 font-[family-name:var(--font-serif)] text-[36px] font-medium leading-[1.1] text-ink md:text-[44px]">
              Activity log
            </h1>
            <p className="mt-2 max-w-xl text-sm text-mute">
              Each proposal is hashed with the policy that judged it. The hashes show which rules
              applied. They are not proof a trade was safe, and they do not replace the follower’s
              signature.
            </p>
          </div>
          <button
            type="button"
            onClick={exportJson}
            className="rounded-full bg-white/10 px-4 py-2 text-[13px]"
          >
            export json
          </button>
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat k="decisions" v={String(logs.length)} />
          <Stat k="blocked notional" v={usd(blocked)} />
          <Stat k="fills" v={String(fills.length)} />
          <Stat k="filled notional" v={usd(filled)} />
        </dl>
      </section>

      <section className="glass rounded-[32px] p-6">
        {logs.length === 0 ? (
          <p className="text-sm text-mute">
            No decisions yet. Load the demo tape on the floor.
          </p>
        ) : (
          <ul className="divide-y divide-white/6">
            {logs.map((l) => {
              const p = proposals.get(l.proposalId);
              const r = receipts.get(l.proposalId);
              const tx = r?.fills?.find((f) => f.transactionId)?.transactionId ?? r?.transactionId;
              return (
                <li key={l.proposalId} className="py-4 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <VerdictPill verdict={l.verdict} />
                    <span className="text-[14px]">
                      {p ? `${p.orderType} ${p.side} · ${usd(p.notionalUsd)}` : "proposal"}
                    </span>
                    {p ? (
                      <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-widest text-mute">
                        {p.chain}
                      </span>
                    ) : null}
                    <span className="ml-auto text-[11px] text-mute">
                      {new Date(l.at).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="mt-1 text-[12px] text-mute">
                    desk {p ? shortAddr(p.follower) : "—"}
                    {l.reasons.length ? ` · ${l.reasons.map(reasonLabel).join(", ")}` : ""}
                  </div>
                  <div className="mt-2 grid gap-1 font-mono text-[10px] text-mute md:grid-cols-2">
                    <span>proposal {l.proposalHash.slice(0, 18)}…</span>
                    <span>policy {l.policyHash.slice(0, 18)}…</span>
                    {l.flashOrderId ? <span>flash order {l.flashOrderId}</span> : null}
                    {tx && p ? (
                      <a
                        className="text-gold"
                        href={`${CHAINS[p.chain].explorerTx}${tx}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        tx {tx.slice(0, 18)}…
                      </a>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-2xl bg-black/25 p-4 hairline">
      <dt className="text-[11px] text-mute">{k}</dt>
      <dd className="num mt-1 text-[22px]">{v}</dd>
    </div>
  );
}
