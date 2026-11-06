import { describe, expect, it } from "vitest";
import { leaderFidelity } from "./fidelity";

const FOLLOWER = "0x2222222222222222222222222222222222222222";
const OTHER = "0x7777777777777777777777777777777777777777";
const A = "0x1111111111111111111111111111111111111111" as const;
const B = "0x5555555555555555555555555555555555555555" as const;

const proposals = [
  { id: "a1", leader: A },
  { id: "a2", leader: A },
  { id: "a3", leader: A },
  { id: "b1", leader: B },
];
const fill = [{ fillPrice: "2510", notional: "10" }];

describe("leader execution fidelity", () => {
  it("summarises only this follower's submitted Flash orders per leader", () => {
    const [a, b] = leaderFidelity(
      FOLLOWER,
      [A, B],
      proposals,
      [
        { proposalId: "a1", follower: FOLLOWER, flashOrderId: "o1", fills: fill, entryDriftBps: 40, closeReason: "FILLED" },
        { proposalId: "a2", follower: FOLLOWER, flashOrderId: "o2", fills: fill, entryDriftBps: 120, closeReason: "FILLED" },
        // Submitted but not yet filled: counts as submitted, not as a drift sample.
        { proposalId: "a3", follower: FOLLOWER, flashOrderId: "o3", fills: [] },
        // Another follower's receipt and a receipt with no Flash order are ignored.
        { proposalId: "a1", follower: OTHER, flashOrderId: "o4", fills: fill, entryDriftBps: 999 },
        { proposalId: "b1", follower: FOLLOWER, fills: fill, entryDriftBps: 5 },
      ],
      "0.01",
    );
    expect(a).toMatchObject({
      submitted: 3,
      filled: 2,
      driftSamples: 2,
      meanDriftBps: 80,
      worstDriftBps: 120,
      withinBound: 1,
      closeReasons: { FILLED: 2 },
    });
    expect(b).toMatchObject({ submitted: 0, filled: 0, driftSamples: 0 });
    expect(b.meanDriftBps).toBeUndefined();
    expect(b.withinBound).toBeUndefined();
  });

  it("does not invent drift for fills without a declared entry", () => {
    const [a] = leaderFidelity(FOLLOWER, [A], proposals, [
      { proposalId: "a1", follower: FOLLOWER, flashOrderId: "o1", fills: fill },
    ]);
    expect(a).toMatchObject({ submitted: 1, filled: 1, driftSamples: 0 });
    expect(a.worstDriftBps).toBeUndefined();
  });
});
