import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultPolicy } from "./constants";
import { sha256Json } from "./hash";

const storeFile = join(tmpdir(), `pact-evidence-test-${process.pid}.json`);
const g = globalThis as unknown as { __pact?: unknown; __pactEvidence?: unknown };

async function fresh() {
  vi.resetModules();
  process.env.PACT_STORE_FILE = storeFile;
  const store = await import("./store");
  const evidence = await import("./evidence");
  store.resetStore();
  return { store, evidence };
}

beforeEach(() => {
  delete g.__pact;
  delete g.__pactEvidence;
});

describe("hash-chained log", () => {
  it("hashes the same bytes on the server and in the browser", async () => {
    const { evidence } = await fresh();
    const value = { b: [1, { z: "x", a: null }], a: "é" };
    expect(evidence.hashSync(value)).toBe(await sha256Json(value));
  });

  it("links every event to the previous one and to its thread", async () => {
    const { evidence } = await fresh();
    const a = evidence.appendEvidence("decision.made", "proposal:1", { proposalId: "1" }, { verdict: "ALLOW" });
    const b = evidence.appendEvidence("mandate.set", "mandate:0xabc", {}, { policyHash: "0x1" });
    const c = evidence.appendEvidence("quote.stored", "proposal:1", { proposalId: "1" }, { qty: "25", missing: undefined });
    expect([a.seq, b.seq, c.seq]).toEqual([0, 1, 2]);
    expect(a.prev).toBe(evidence.GENESIS);
    expect(b.prev).toBe(a.hash);
    expect(c.threadPrev).toBe(a.hash);
    expect(b.threadPrev).toBeNull();
    expect(c.data).toEqual({ qty: "25" });
    expect(await evidence.verifyLog(evidence.evidenceLog())).toEqual({ ok: true, length: 3, head: c.hash });
    expect((await evidence.verifyThread(evidence.threadEvents("proposal:1"))).ok).toBe(true);
  });

  it("detects an edited, deleted or reordered event", async () => {
    const { evidence } = await fresh();
    for (let i = 0; i < 4; i++) evidence.appendEvidence("order.updated", "proposal:x", {}, { status: `S${i}` });
    const log = structuredClone(evidence.evidenceLog());

    const edited = structuredClone(log);
    edited[1].data.status = "ORDER_STATUS_FILLED";
    expect(await evidence.verifyLog(edited)).toMatchObject({ ok: false, brokenAt: 1 });

    const deleted = log.filter((_, i) => i !== 2);
    expect(await evidence.verifyLog(deleted)).toMatchObject({ ok: false, brokenAt: 2 });
    expect(await evidence.verifyThread(deleted)).toMatchObject({ ok: false, brokenAt: 2 });

    const reordered = [log[0], log[2], log[1], log[3]];
    expect(await evidence.verifyLog(reordered)).toMatchObject({ ok: false, brokenAt: 1 });
  });

  it("survives a restart: the file reloads into the same verifiable chain", async () => {
    const { evidence } = await fresh();
    evidence.appendEvidence("plan.published", "plan:p", {}, { n: 1 });
    evidence.appendEvidence("plan.published", "plan:q", {}, { n: 2 });
    const head = evidence.evidenceHead();
    const lines = readFileSync(storeFile.replace(/\.json$/, ".evidence.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);

    delete g.__pactEvidence;
    vi.resetModules();
    const reloaded = await import("./evidence");
    expect(reloaded.evidenceHead()).toEqual(head);
    const next = reloaded.appendEvidence("plan.published", "plan:p", {}, { n: 3 });
    expect(next.prev).toBe(head.head);
    expect(next.threadPrev).toBe(reloaded.evidenceLog()[0].hash);
    expect((await reloaded.verifyLog(reloaded.evidenceLog())).ok).toBe(true);
  });
});

describe("store writes evidence", () => {
  it("records the demo with decisions naming the mandate and plan they applied", async () => {
    const { store, evidence } = await fresh();
    await store.seedDemo();
    const log = evidence.evidenceLog();
    expect((await evidence.verifyLog(log)).ok).toBe(true);

    const decisions = log.filter((e) => e.kind === "decision.made");
    expect(decisions.length).toBe(store.snapshot().proposals.length);
    for (const d of decisions) {
      const mandates = evidence.threadEvents(evidence.threads.mandate(String(d.refs.follower)));
      expect(mandates.some((m) => m.data.policyHash === d.data.policyHash)).toBe(true);
      const plan = evidence.threadEvents(evidence.threads.plan(String(d.refs.strategyId)));
      expect(plan[0]?.data.planHash).toBe(d.data.planHash);
    }
  });

  it("appends withdrawals instead of erasing proposals a mandate change replaces", async () => {
    const { store, evidence } = await fresh();
    await store.seedDemo();
    const follower = store.DEMO_PORTFOLIO_FOLLOWER;
    const before = store.snapshot().proposals.filter((p) => p.follower === follower).map((p) => p.id);
    store.upsertPolicy({ ...store.policyFor(follower), maxNotionalUsd: 40 });
    await store.rebuildFor(follower);

    for (const id of before) {
      const trail = evidence.threadEvents(evidence.threads.proposal(id));
      expect(trail.map((e) => e.kind)).toEqual(["decision.made", "proposal.withdrawn"]);
      expect(trail[1].data.reason).toBe("MANDATE_CHANGED");
    }
    const mandates = evidence.threadEvents(evidence.threads.mandate(follower));
    expect(mandates.at(-1)?.data.policy).toMatchObject({ maxNotionalUsd: 40 });
    expect((await evidence.verifyLog(evidence.evidenceLog())).ok).toBe(true);
  });

  it("does not write when a wallet with no mandate is read, nor when a mandate is re-saved unchanged", async () => {
    const { store, evidence } = await fresh();
    const wallet = "0x1234567890abcdef1234567890abcdef12345678" as const;
    store.policyFor(wallet);
    expect(evidence.evidenceLog()).toHaveLength(0);
    expect(store.snapshot().policies).toHaveLength(0);
    store.upsertPolicy(defaultPolicy(wallet));
    store.upsertPolicy(defaultPolicy(wallet));
    expect(evidence.evidenceLog().map((e) => e.kind)).toEqual(["mandate.set"]);
  });

  it("logs an order's status only when Flash reports a change", async () => {
    const { store, evidence } = await fresh();
    await store.seedDemo();
    const proposal = store.snapshot().proposals[0];
    store.addReceipt({
      proposalId: proposal.id,
      follower: proposal.follower,
      decision: store.decisionFor(proposal.id)!,
      flashOrderId: "flash-1",
      status: "ORDER_STATUS_PENDING",
      notionalUsd: 25,
    });
    store.patchReceipt(proposal.id, { status: "ORDER_STATUS_PENDING" });
    store.patchReceipt(proposal.id, { status: "ORDER_STATUS_PARTIALLY_FILLED", finalFillCount: 1 });
    store.patchReceipt(proposal.id, { status: "ORDER_STATUS_PARTIALLY_FILLED", finalFillCount: 1 });
    const kinds = evidence.threadEvents(evidence.threads.proposal(proposal.id)).map((e) => e.kind);
    expect(kinds).toEqual(["decision.made", "order.submitted", "order.updated"]);
  });
});
