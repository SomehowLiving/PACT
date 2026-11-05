# PACT Agent Automation Architecture

Decision date: November 5, 2026.

## Decision

PACT ships **Assist Mode**, not unattended Autopilot.

Assist is a deterministic policy agent. It reads the follower’s existing PACT
decisions and creates a review queue. It has no private key, session key, or
wallet authority, so it cannot quote, sign, submit, cancel, or amend a trade.

This is intentional. The product claim remains:

> An agent may automate the analysis of a mandate; only a follower-controlled
> authorization can automate execution.

## Current Implementation

The follower policy has two modes:

| Mode | Behavior |
| --- | --- |
| `REVIEW` | Existing PACT flow: follower opens a proposal, requests a quote, and self-signs every required message. |
| `ASSIST` | `GET /api/agent?follower=...` maps existing policy decisions into `PREPARE_REVIEW`, `HOLD`, or `DECLINE`. Allowed/scaled proposals link to the normal review workspace. |

The Assist agent is deliberately not an LLM decision-maker. It uses the same
stored PACT decision that governs the normal UI. This means it cannot invent a
trade, relax a cap, reinterpret a stop, or claim an unverified market signal.

## Real-World Autopilot Pattern

Unattended execution must use a follower-owned smart account with a revocable,
scoped session key—not a follower EOA private key and not a PACT server key.

The target design is:

```text
Follower owner wallet
  └─ signs a short-lived session permission on a smart account
       └─ agent session key may sign only permitted Flash orders
            ├─ Base only
            ├─ allowlisted Flash settlement / Permit2 path
            ├─ allowlisted target + contra assets
            ├─ selected leaders only
            ├─ TWAP and limit only
            ├─ exact PACT policy caps and stop-risk budget
            ├─ exact maximum entry bound
            ├─ no transfers / withdrawals
            ├─ small per-period spend limit
            └─ explicit expiry and owner revocation
```

The smart-account validator must enforce these rules onchain or in the account
validation path. A database flag, prompt text, or server-side agent policy is
not sufficient authority for an unattended trading feature.

## Required Autopilot Gates

Do not enable an Autopilot UI switch until every gate is true:

1. **Smart-account compatibility:** the follower account can validate Flash’s
   typed-data signature through EIP-1271.
2. **Session-key validator:** each permitted call is constrained by chain,
   Flash contracts, assets, side, order type, recipient, quantity, time window,
   and no-withdrawal behavior.
3. **Policy binding:** PACT derives each execution limit from the exact policy
   snapshot that the follower accepted. The agent cannot pick a looser limit.
4. **Token/Permit scope:** approval and Permit2 behavior has been tested with
   the smart account; no broad approval is silently widened.
5. **Revocation:** the follower can revoke the session immediately from the
   owner wallet. Expiry is short by default.
6. **Receipts:** every agent action records the session permission ID, policy
   hash, quote, signature path, order ID, fills, and terminal close reason.
7. **Failure mode:** absent/expired/revoked session means `HOLD`, never a
   fallback to a server-held key or EOA key export.
8. **Live validation:** a dedicated small-value mainnet test succeeds before
   describing Autopilot as available.

## Candidate Integration Direction

ERC-7579 / modular smart-account session systems are the relevant integration
class. A provider such as Rhinestone Smart Sessions can supply session-key
permissions and policy modules; Flash must first be exercised with the chosen
account’s EIP-1271 signature behavior and Permit2/approval response.

PACT should select exactly one provider after testing. It should not ship two
half-integrations or abstract a session-key standard that has not been tested
against Flash.

## What Assist Is Allowed To Do

- Scan follower proposals.
- Explain the existing `ALLOW`, `MODIFY`, `WAIT`, `REVIEW`, or `BLOCK` result.
- Route an allowed/scaled plan to the existing review page.
- Notify the follower that a plan needs review or is held.

## What Assist Is Forbidden To Do

- Generate a new trade from natural-language instruction.
- Alter a policy, leader list, token allowlist, or risk budget.
- Request or store an EOA private key.
- Request a quote, sign typed data, submit an order, cancel an order, or
  execute an exit.
- Claim it is an Autopilot or that it improves returns.

## World ID Boundary

World may become a step-up confirmation before a follower enables a material
Autopilot mandate, but it is not wallet authorization and cannot replace a
session permission. It should not block Assist Mode.
