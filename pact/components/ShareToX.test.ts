import { describe, expect, it } from "vitest";
import { SHARE_TEXT_MAX, planRewardRisk, planShareText, xIntentUrl, type SharePlan } from "@/components/ShareToX";
import { CHAINS } from "@/lib/chains";

const REAL = "0x80E5E2947549fd4d451b77f82f884871EEb543c9" as const;
const DEMO = "0x1111111111111111111111111111111111111111" as const;

const plan = (over: Partial<SharePlan> = {}): SharePlan => ({
  leader: REAL,
  side: "buy",
  orderType: "twap",
  targetAsset: CHAINS.base.weth,
  entryReferencePrice: "2240",
  stopLossPrice: "2195",
  takeProfitPrice: "2330",
  ...over,
});

describe("xIntentUrl", () => {
  it("builds X's post intent with text and url encoded", () => {
    const u = xIntentUrl({ text: "R:R 2.0 · stop $2,195 & target #1?", url: "https://pact.example/plans/a b?x=1&y=2" });
    expect(u.startsWith("https://x.com/intent/post?")).toBe(true);
    const q = new URL(u).searchParams;
    expect(q.get("text")).toBe("R:R 2.0 · stop $2,195 & target #1?");
    expect(q.get("url")).toBe("https://pact.example/plans/a b?x=1&y=2");
    expect(u).not.toContain(" ");
    expect(u).not.toContain("+");
    expect(u).toContain("%26");
  });

  it("omits url when none is given", () => {
    expect(new URL(xIntentUrl({ text: "hi" })).searchParams.has("url")).toBe(false);
  });
});

describe("planShareText", () => {
  it("shows the plan's own numbers and R:R when entry, stop and target are ordered", () => {
    const t = planShareText(plan());
    expect(t).toBe(
      "Leader 80E5's ETH plan on PACT: buy via TWAP, entry $2,240 · stop $2,195 · target $2,330 (R:R 2.0). Copy it under your own rules — sizing, caps and your own stop/target on @DefinitiveFi Flash.",
    );
    expect(planRewardRisk(plan())).toBeCloseTo(2);
  });

  it("computes R:R for a sell with target below entry below stop", () => {
    const t = planShareText(plan({ side: "sell", entryReferencePrice: "2500", stopLossPrice: "2550", takeProfitPrice: "2350" }));
    expect(t).toContain("sell via TWAP");
    expect(t).toContain("(R:R 3.0)");
  });

  it("omits R:R when the levels are out of order or missing", () => {
    expect(planShareText(plan({ stopLossPrice: "2300" }))).not.toContain("R:R");
    expect(planShareText(plan({ side: "sell" }))).not.toContain("R:R");
    const noTarget = planShareText(plan({ takeProfitPrice: undefined }));
    expect(noTarget).not.toContain("R:R");
    expect(noTarget).not.toContain("target $");
    expect(planRewardRisk(plan({ entryReferencePrice: undefined }))).toBeUndefined();
  });

  it("falls back to the limit price when there is no reference entry", () => {
    expect(planShareText(plan({ orderType: "limit", entryReferencePrice: undefined, limitNotionalPrice: "2240" }))).toContain("buy via limit, entry $2,240");
  });

  it("labels demo plans", () => {
    expect(planShareText(plan({ leader: DEMO })).startsWith("[Demo] Leader 1111's ETH plan")).toBe(true);
    expect(planShareText(plan({ demoCase: "CORE_TWAP_COPY" })).startsWith("[Demo] ")).toBe(true);
    expect(planShareText(plan()).startsWith("[Demo]")).toBe(false);
  });

  it("stays within the length limit even with huge prices", () => {
    const cases = [
      plan(),
      plan({ leader: DEMO, orderType: "take-profit" }),
      plan({ leader: DEMO, entryReferencePrice: "123456789012.25", stopLossPrice: "123456789000.75", takeProfitPrice: "923456789012.5" }),
    ];
    for (const c of cases) {
      const t = planShareText(c);
      expect(t.length).toBeLessThanOrEqual(260);
      expect(t.length).toBeLessThanOrEqual(SHARE_TEXT_MAX);
    }
  });
});
