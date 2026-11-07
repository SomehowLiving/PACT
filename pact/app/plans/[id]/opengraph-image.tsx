import { ImageResponse } from "next/og";
import type { Strategy } from "@/lib/types";

/*
 * The card X, Telegram and others show for /plans/[id]. It must never fail: the store is
 * per-instance (a plan may not exist on the instance that serves this request), so any miss or
 * error renders the generic PACT card instead. Node runtime (the store reads the filesystem);
 * no font fetches, ImageResponse's bundled font only.
 */

export const alt = "A PACT leader plan: entry, stop, target and reward:risk";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const C = {
  bg: "#0d0b09",
  panel: "#14110e",
  line: "#2a241e",
  ink: "#ece5da",
  mute: "#958b7f",
  cream: "#efe5d4",
  gold: "#c9a46a",
  good: "#7fcf95",
  bad: "#e8857a",
};

type Card = {
  leader: string;
  title: string;
  side: string;
  asset: string;
  pair: string;
  chain: string;
  orderType: string;
  entry?: number;
  stop?: number;
  target?: number;
  rr?: number;
  demo: boolean;
};

const num = (v?: string) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n > 0 ? n : undefined;
};

const money = (n?: number) =>
  n === undefined ? "—" : `$${n.toLocaleString("en-US", Number.isInteger(n) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 4 : 2 })}`;

async function loadCard(id: string): Promise<Card | undefined> {
  // Imported lazily so a store that fails to load still yields the generic card.
  const [{ snapshot }, views] = await Promise.all([import("@/lib/store"), import("@/lib/views")]);
  const plan: Strategy | undefined = snapshot().strategies.find((s) => s.id === id);
  if (!plan) return undefined;
  const entry = num(plan.entryReferencePrice ?? plan.limitNotionalPrice);
  const stop = num(plan.stopLossPrice);
  const target = num(plan.takeProfitPrice);
  const ordered =
    entry !== undefined && stop !== undefined && target !== undefined && (plan.side === "buy" ? stop < entry && entry < target : target < entry && entry < stop);
  const symbol = views.tokenSymbol(plan.targetAsset);
  return {
    // Same label as leaderName() in components/ui.tsx; that module is a client module and its
    // functions cannot be called from a route handler.
    leader: `Leader ${plan.leader.slice(2, 6).toUpperCase()}`,
    title: plan.title.length > 60 ? `${plan.title.slice(0, 59)}…` : plan.title,
    side: plan.side,
    asset: symbol === "WETH" ? "ETH" : symbol,
    pair: views.pairLabel(plan),
    chain: plan.chain,
    orderType: plan.orderType === "twap" ? "TWAP" : plan.orderType,
    entry,
    stop,
    target,
    rr: ordered ? (plan.side === "buy" ? (target! - entry!) / (entry! - stop!) : (entry! - target!) / (stop! - entry!)) : undefined,
    demo: views.isDemoAddress(plan.leader) || !!plan.demoCase,
  };
}

function Wordmark() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ display: "flex", width: 34, height: 34, borderRadius: 999, background: C.cream }} />
      <div style={{ display: "flex", fontSize: 34, fontWeight: 700, letterSpacing: 6, color: C.cream }}>PACT</div>
    </div>
  );
}

function Pill({ children, color = C.ink, border = C.line }: { children: string; color?: string; border?: string }) {
  return (
    <div style={{ display: "flex", padding: "8px 20px", borderRadius: 999, border: `2px solid ${border}`, color, fontSize: 24 }}>{children}</div>
  );
}

function Level({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "22px 28px", background: C.panel, border: `2px solid ${C.line}`, borderRadius: 20 }}>
      <div style={{ display: "flex", fontSize: 24, color: C.mute }}>{label}</div>
      <div style={{ display: "flex", marginTop: 6, fontSize: 46, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function planImage(c: Card) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: "56px 64px", background: C.bg, color: C.ink }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Wordmark />
        <div style={{ display: "flex", gap: 12 }}>
          {c.demo ? <Pill color={C.gold} border={C.gold}>DEMO DATA</Pill> : null}
          <Pill>{`${c.pair} · ${c.chain}`}</Pill>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 52 }}>
        <div style={{ display: "flex", fontSize: 30, color: C.mute }}>{`${c.leader}'s plan`}</div>
        <div style={{ display: "flex", marginTop: 8, fontSize: 64, fontWeight: 700, color: C.cream }}>
          {`${c.side === "buy" ? "Buy" : "Sell"} ${c.asset} · ${c.orderType}`}
        </div>
        <div style={{ display: "flex", marginTop: 8, fontSize: 28, color: C.mute }}>{c.title}</div>
      </div>
      <div style={{ display: "flex", gap: 20, marginTop: "auto" }}>
        <Level label="Entry" value={money(c.entry)} color={C.ink} />
        <Level label="Stop" value={money(c.stop)} color={C.bad} />
        <Level label="Target" value={money(c.target)} color={C.good} />
        <Level label="Reward : risk" value={c.rr === undefined ? "—" : `${c.rr.toFixed(2)}R`} color={C.cream} />
      </div>
      <div style={{ display: "flex", marginTop: 28, fontSize: 24, color: C.mute }}>
        Copy the plan under your own rules: your size, your caps, your stop. Signed by you on Flash.
      </div>
    </div>
  );
}

function genericImage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", width: "100%", height: "100%", padding: "64px 80px", background: C.bg, color: C.ink }}>
      <Wordmark />
      <div style={{ display: "flex", marginTop: 48, fontSize: 76, fontWeight: 700, color: C.cream }}>Copy the plan, not the trader.</div>
      <div style={{ display: "flex", marginTop: 24, fontSize: 32, color: C.mute }}>
        Leaders publish entry, stop and target. You copy under your own mandate and sign every order.
      </div>
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const card = await loadCard(id);
    if (card) {
      // Render fully here so a rendering error still falls through to the generic card.
      const png = await new ImageResponse(planImage(card), size).arrayBuffer();
      return new Response(png, { headers: { "content-type": contentType, "cache-control": "public, max-age=300, s-maxage=3600" } });
    }
  } catch {
    // Fall through: never fail a link preview.
  }
  // Not cached: another instance (or a later request) may have the plan.
  return new ImageResponse(genericImage(), { ...size, headers: { "cache-control": "no-store" } });
}
