import { describe, expect, it } from "vitest";
import { assessProposalForAssist } from "./agent";
import type { Proposal } from "./types";

const proposal = { id: "p1" } as Proposal;

describe("PACT Assist", () => {
  it("queues allow and modify decisions for review rather than execution", () => {
    expect(
      assessProposalForAssist(proposal, { verdict: "ALLOW", action: "COPY", reasons: [] }),
    ).toMatchObject({ action: "PREPARE_REVIEW" });
    expect(
      assessProposalForAssist(proposal, {
        verdict: "MODIFY",
        action: "SCALE",
        reasons: ["DAILY_CAP"],
      }),
    ).toMatchObject({ action: "PREPARE_REVIEW" });
  });

  it("holds waits and refuses blocked plans", () => {
    expect(
      assessProposalForAssist(proposal, { verdict: "BLOCK", action: "WAIT", reasons: ["PLAN_EXPIRED"] }),
    ).toMatchObject({ action: "HOLD" });
    expect(
      assessProposalForAssist(proposal, {
        verdict: "BLOCK",
        action: "DECLINE",
        reasons: ["PAIR_NOT_ALLOWED"],
      }),
    ).toMatchObject({ action: "DECLINE" });
  });

  it("labels a follower pause as the follower's own hold", () => {
    expect(
      assessProposalForAssist(proposal, { verdict: "BLOCK", action: "WAIT", reasons: ["LEADER_PAUSED"] }),
    ).toMatchObject({ action: "HOLD", headline: "Held; you paused this leader" });
  });
});
