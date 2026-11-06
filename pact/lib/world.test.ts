import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultPolicy } from "./constants";
import { decide } from "./policy";

const g = globalThis as unknown as { __pact?: unknown; __pactEvidence?: unknown };
const LEADER = "0xAbCdEf0123456789aBcDeF0123456789abCDef01";
const OTHER = "0x2222222222222222222222222222222222222222";

async function setup() {
  delete g.__pact;
  delete g.__pactEvidence;
  process.env.PACT_STORE_FILE = join(tmpdir(), `pact-world-test-${process.pid}.json`);
  process.env.WORLD_APP_ID = "app_test0000000000000000000000000000";
  process.env.WORLD_RP_ID = "rp_0123456789abcdef";
  process.env.WORLD_PRIVATE_KEY = `0x${randomBytes(32).toString("hex")}`;
  delete process.env.WORLD_ENV;
  const world = await import("./world");
  const ev = await import("./evidence");
  world.resetHumans();
  return { world, ev };
}

/** An IDKit v4 result bound to `signalOf`. */
function proof(signalOf: string, overrides: Record<string, unknown> = {}) {
  return {
    protocol_version: "4.0",
    nonce: "0x01",
    action: "pact-verified-leader",
    environment: "production",
    responses: [{ identifier: "proof_of_human", signal_hash: hashSignal(signalOf.toLowerCase()), proof: ["0x1"], nullifier: "0x00ff", issuer_schema_id: 1 }],
    ...overrides,
  };
}

const ok = (nullifier = "0x00FF") =>
  vi.fn(async () => new Response(JSON.stringify({ success: true, environment: "production", results: [{ identifier: "proof_of_human", success: true, nullifier }] }), { status: 200 }));

describe("World ID config", () => {
  beforeEach(setup);

  it("is off until app id, rp id and signing key are all set, and never exposes the key", async () => {
    const { world } = await setup();
    expect(world.publicWorldConfig().enabled).toBe(true);
    expect(JSON.stringify(world.publicWorldConfig())).not.toContain(process.env.WORLD_PRIVATE_KEY!.slice(2));
    delete process.env.WORLD_RP_ID;
    expect(world.publicWorldConfig()).toMatchObject({ enabled: false, missing: ["WORLD_RP_ID"] });
    expect(() => world.signLeaderRequest()).toThrow(/WORLD_RP_ID/);
  });

  it("signs a request for the leader action", async () => {
    const { world } = await setup();
    const s = world.signLeaderRequest();
    expect(s.sig).toMatch(/^0x[0-9a-f]+$/i);
    expect(s.expires_at - s.created_at).toBe(300);
  });
});

describe("verifyLeaderProof", () => {
  it("forwards the proof to World and returns a normalized nullifier", async () => {
    const { world } = await setup();
    const fetchImpl = ok();
    const r = await world.verifyLeaderProof(LEADER, proof(LEADER), fetchImpl as never);
    expect(r.nullifier).toBe("255");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://developer.world.org/api/v4/verify/rp_0123456789abcdef");
    expect(JSON.parse(String(init.body)).action).toBe("pact-verified-leader");
  });

  it("refuses a proof bound to another wallet, action or environment, before calling World", async () => {
    const { world } = await setup();
    const fetchImpl = ok();
    await expect(world.verifyLeaderProof(LEADER, proof(OTHER), fetchImpl as never)).rejects.toMatchObject({ code: "WORLD_SIGNAL_MISMATCH" });
    await expect(world.verifyLeaderProof(LEADER, proof(LEADER, { action: "other" }), fetchImpl as never)).rejects.toMatchObject({ code: "WORLD_WRONG_ACTION" });
    await expect(world.verifyLeaderProof(LEADER, proof(LEADER, { environment: "staging" }), fetchImpl as never)).rejects.toMatchObject({ code: "WORLD_WRONG_ENVIRONMENT" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when World rejects the proof", async () => {
    const { world } = await setup();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: false, code: "invalid_proof", detail: "proof invalid" }), { status: 400 }));
    await expect(world.verifyLeaderProof(LEADER, proof(LEADER), fetchImpl as never)).rejects.toMatchObject({ code: "WORLD_VERIFY_FAILED" });
  });
});

describe("one human, one leader", () => {
  it("binds once, is idempotent, and refuses a second address for the same human", async () => {
    const { world, ev } = await setup();
    expect(world.isVerifiedHuman(LEADER)).toBe(false);
    expect(world.bindLeader(LEADER, "255", "4.0").created).toBe(true);
    expect(world.bindLeader(LEADER, "255", "4.0").created).toBe(false);
    expect(world.isVerifiedHuman(LEADER.toUpperCase().replace("0X", "0x"))).toBe(true);
    expect(() => world.bindLeader(OTHER, "255", "4.0")).toThrow(/already verified leader/);
    expect(() => world.bindLeader(LEADER, "256", "4.0")).toThrow(/different human/);
    const events = ev.evidenceLog().filter((e) => e.kind === "leader.human_verified");
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0].data)).not.toContain('"255"');
  });
});

describe("policy: verified-human leaders only", () => {
  it("holds plans from unverified leaders when the follower asks for it", () => {
    const p = { ...defaultPolicy(OTHER), requireVerifiedHuman: true, requirePlanProtection: false };
    const prop = { side: "buy", orderType: "twap", chain: "base", qty: "25", notionalUsd: 25, targetAsset: "0x4200000000000000000000000000000000000006", contraAsset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" } as never;
    expect(decide(prop, p, { dailySpentUsd: 0 }).reasons).toEqual(["LEADER_NOT_VERIFIED_HUMAN"]);
    expect(decide(prop, p, { dailySpentUsd: 0, leaderVerifiedHuman: true }).reasons).not.toContain("LEADER_NOT_VERIFIED_HUMAN");
    expect(decide(prop, { ...p, requireVerifiedHuman: false }, { dailySpentUsd: 0 }).reasons).not.toContain("LEADER_NOT_VERIFIED_HUMAN");
  });
});

describe("Autopilot approval (mandate step-up)", () => {
  const limits = { chain: "base", hours: 72, maxPerOrderUsd: 25, maxDailyUsd: 100 };
  const approval = (signal: string) => ({ ...proof(LEADER), action: "pact-autopilot-stepup", responses: [{ identifier: "proof_of_human", signal_hash: hashSignal(signal), proof: ["0x1"], nullifier: "0x0a" }] });

  it("accepts an approval bound to exactly these limits, and refuses it for higher ones", async () => {
    const { world } = await setup();
    const signal = world.autopilotSignal(OTHER, limits);
    const fetchImpl = ok("0x0a");
    await expect(world.verifyWorldProof("pact-autopilot-stepup", signal, approval(signal), fetchImpl as never)).resolves.toMatchObject({ nullifier: "10" });
    const higher = world.autopilotSignal(OTHER, { ...limits, maxPerOrderUsd: 2500 });
    await expect(world.verifyWorldProof("pact-autopilot-stepup", higher, approval(signal), fetchImpl as never)).rejects.toMatchObject({ code: "WORLD_SIGNAL_MISMATCH" });
    // A leader-verification proof cannot stand in for an Autopilot approval.
    await expect(world.verifyWorldProof("pact-autopilot-stepup", signal, { ...approval(signal), action: "pact-verified-leader" }, fetchImpl as never)).rejects.toMatchObject({ code: "WORLD_WRONG_ACTION" });
  });

  it("keeps the first approver for a desk and refuses a different human", async () => {
    const { world } = await setup();
    expect(world.recordApproval(OTHER, "10").first).toBe(true);
    expect(world.recordApproval(OTHER, "10").first).toBe(false);
    expect(() => world.recordApproval(OTHER, "11")).toThrow(/different human/);
  });
});
