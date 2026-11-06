import type { Decision, Policy, Proposal } from "./types";

export type AgentRecommendationAction = "PREPARE_REVIEW" | "HOLD" | "DECLINE";

export type AgentRecommendation = {
  proposalId: string;
  action: AgentRecommendationAction;
  headline: string;
  reasons: string[];
};

/**
 * The Assist agent is intentionally deterministic: it turns the existing
 * follower policy result into a review queue and never signs, quotes, or
 * submits an order.
 */
export function assessProposalForAssist(
  proposal: Proposal,
  decision: Decision | undefined,
): AgentRecommendation {
  if (!decision) {
    return {
      proposalId: proposal.id,
      action: "HOLD",
      headline: "Policy decision unavailable",
      reasons: ["POLICY_DECISION_MISSING"],
    };
  }
  if (decision.verdict === "ALLOW" || decision.verdict === "MODIFY") {
    return {
      proposalId: proposal.id,
      action: "PREPARE_REVIEW",
      headline:
        decision.verdict === "MODIFY"
          ? "Policy scaled this plan; ready for follower review"
          : "Policy allows this plan; ready for follower review",
      reasons: decision.reasons,
    };
  }
  if (decision.reasons.includes("LEADER_PAUSED")) {
    return {
      proposalId: proposal.id,
      action: "HOLD",
      headline: "Held; you paused this leader",
      reasons: decision.reasons,
    };
  }
  if (decision.action === "WAIT" || decision.action === "REVIEW") {
    return {
      proposalId: proposal.id,
      action: "HOLD",
      headline: "Hold; the mandate does not currently permit execution",
      reasons: decision.reasons,
    };
  }
  return {
    proposalId: proposal.id,
    action: "DECLINE",
    headline: "Declined by the follower mandate",
    reasons: decision.reasons,
  };
}

export function assessFollowerForAssist(
  policy: Policy,
  proposals: Proposal[],
  decisions: Record<string, Decision>,
) {
  return {
    mode: policy.automationMode ?? "REVIEW",
    recommendations: proposals.map((proposal) => assessProposalForAssist(proposal, decisions[proposal.id])),
    constraints: [
      "No private key or session key is available to PACT Assist.",
      "Assist never signs, quotes, submits, cancels, or changes a follower mandate.",
      "Every prepared order still opens the follower review and self-sign flow.",
    ],
  };
}
