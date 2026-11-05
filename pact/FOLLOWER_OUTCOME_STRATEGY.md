# PACT Follower Outcome Strategy

Decision date: November 5, 2026.

## Product Decision

PACT does not promise that a leader is profitable or that a copied trade will
make money. It makes the **follower's version** of a trade bounded,
inspectable, and survivable.

> Do not copy a leader's position size. Copy only the part of their plan that
> fits a follower-owned risk envelope and can survive the execution path.

The product is a **verified execution mandate**, not an unattended copy bot:

1. A leader declares a plan: direction, reference entry, stop, target,
   invalidation, window, and optional Flash evidence.
2. A follower pre-commits portfolio and leader limits.
3. PACT either refuses, scales, waits, or presents a bounded order for the
   follower to self-sign.
4. Flash executes the follower's own order. PACT records execution evidence
   separately from the leader declaration and market context.

## Problem Model

The leader can be profitable while the follower loses because copying changes
the trade. The follower receives a different combination of:

| Failure mode | PACT response | Current state |
| --- | --- | --- |
| Follower is too large for their capital | Per-trade, leader, asset, and portfolio caps | Implemented |
| Leader entry becomes a worse follower fill | Max entry drift becomes a Flash price bound | Implemented for TWAP and limit |
| Quote is expensive or moves the market | Flash price-impact/slippage policy gate | Implemented |
| Leader plan has no defined invalidation | Plan protection and quality gates | Implemented; optional by policy |
| Several leaders are the same directional bet | Same-asset/same-side exposure cap | Implemented; correlation analytics not yet built |
| Follower has no exit control | Follower-owned attached TP/SL bracket or manual exit | Implemented for eligible entries |
| Leader claims a trade they did not place | Flash order lookup for leader wallet | Partial: `ORDER_FOUND`, not plan matched |
| Losses accelerate across a sleeve | Reject future proposals after a recorded loss threshold | Partial: not a full live drawdown engine |

## Non-Negotiable Product Truths

- A skip is a successful risk outcome. PACT must never frame a refused or
  expired copy as a missed opportunity.
- The leader's plan, live market chart, policy decision, Flash quote, and
  completed fills are different evidence layers. Never blend them into one
  chart or one “performance” number.
- PACT has no standing follower signing authority. It cannot honestly claim
  automatic execution, automatic cancellation, or automatic unwind today.
- Flash `ORDER_FOUND` proves an order lookup under a leader wallet; it does
  not prove pair, side, size, timing, or price-bound equivalence with the
  published plan.
- Current Base WETH/USDC is a spot-style execution demo. Do not claim a
  leverage cap, liquidation protection, or funding-rate control until PACT
  executes and accounts for a perpetuals product.

## The PACT Risk Envelope

### 1. Admission controls — already implemented

Before requesting a Flash quote, PACT can constrain:

- selected leaders and leader-specific sleeves;
- fixed or proportional notional sizing;
- allowed chain, pair, side, and order type;
- minimum/maximum order size and daily portfolio spend;
- leader daily spend, same-asset exposure, and open-plan count;
- declared stop, target, invalidation, and minimum reward:risk;
- leader order lookup requirement.

### 2. Execution controls — already implemented

After a quote and before signing, PACT can constrain:

- Flash estimated price impact and market-order slippage;
- maximum entry drift from the declared entry;
- a follower-specific `limitNotionalPrice` sent to Flash:
  - buy: maximum acceptable execution price;
  - sell: minimum acceptable execution price;
  - a stricter leader price bound wins;
- EIP-712 and Permit2 payload details in the follower browser;
- follower-owned attached TP/SL bracket where Flash returns its signing data.

### 3. Outcome controls — next to build

PACT needs enough first-party evidence to answer: “did this leader's plan
survive copying for this follower?” The first version needs:

- leader declared entry;
- follower Flash quoted execution price;
- follower actual average fill and fill timestamps;
- execution drift in basis points;
- requested size, policy-approved size, and filled size;
- terminal status and close reason.

This is **execution fidelity**, not a promise of alpha or PnL.

## Core Primitive: Stop-Based Risk Sizing

PACT now supports risk sizing alongside fixed-dollar and proportional sizing.
It is the first sizing mode that answers whether a follower's planned loss at
the leader's declared stop fits their own budget.

### Scope

Follower policy and per-leader mandates provide:

```text
sizing mode: fixed notional | proportional | stop-risk budget
risk budget: $X per plan
```

For a buy with a valid declared entry and stop:

```text
risk per target unit = entry - stop
target units = risk budget / risk per target unit
candidate notional = target units × entry
Flash buy qty (USDC) = min(candidate notional, all existing caps)
```

For a sell, calculate target units using the same risk distance, then cap by
the follower's available target-token balance and all policy limits.

### Required refusal conditions

Stop-risk sizing must return `REVIEW` or `BLOCK`, never fabricate a size, if:

- entry or stop is missing, invalid, or on the wrong side of entry;
- the policy risk budget is zero or invalid;
- the resulting Flash quantity is below the follower minimum;
- the resulting quantity breaches a leader, asset, daily, or portfolio cap;
- a sell quantity exceeds verified follower inventory.

### Important boundary

This is a **declared-stop risk budget**, not guaranteed loss control. A gap,
partial fill, price impact, or bracket failure can produce a larger realized
loss. The UI must say this next to the result.

## Portfolio View: Diversification Without Fake Correlation

Do not claim statistical correlation until PACT has a clean, comparable return
history for each leader. For the hackathon, build an honest concentration view:

```text
approved capacity: $45
long WETH exposure: $35 (78%)
leaders contributing: 2
open plans: 2 / 3
```

Then add simple warnings:

- “two leaders create the same long-WETH exposure”;
- “this proposal would exceed your same-direction asset cap”;
- “three selected leaders are not necessarily diversified.”

The existing same-asset/same-side exposure policy is the calculation source.
Do not invent a beta, Sharpe, or correlation coefficient for the demo.

## Leader Selection: What PACT Can and Cannot Judge

PACT should not ship a recent-ROI leaderboard. It must first build a
first-party record from leader declarations and follower execution receipts.

### Show now

- declared plan completeness and reward:risk;
- whether a Flash order was found for the leader wallet;
- style facts supplied by a leader: order type, planned duration, pair, and
  declared price bound;
- follower-specific policy compatibility.

### Build after a real execution record exists

- plan-to-order equivalence checks;
- quote/fill drift history by leader and pair;
- median planned holding duration and order frequency;
- cancellation and terminal-order history;
- execution-cost ratio: follower price impact and fees relative to order size.

Do not present any of these as a profitability or safety score until data is
complete enough to support the claim.

## Breaker and Exit Decision

Current breaker behavior is intentionally limited: it can block **future**
proposals when the system has recorded enough follower loss. It does not have
the authority to cancel or unwind an already-signed order.

### Hackathon-safe next step

When a breaker trips, show a frozen sleeve with a follower action:

```text
New copies blocked.
Review N open Flash orders.
Sign cancellation for this leader's orders.
```

Implement batch cancellation only after Flash confirms the exact endpoint and
signature flow. It remains follower-initiated.

### Explicitly defer

- automatic batch cancel;
- automatic market unwind;
- delegated session keys and autonomous copy execution until the requirements in
  `AGENT_AUTOMATION_ARCHITECTURE.md` are met.

Those features require a different authorization design and would weaken the
current no-standing-authority claim.

## Hackathon Build Order

### Slice 1 — prove the existing path

1. Execute one small Base WETH/USDC follower TWAP with an attached bracket.
2. Save the order ID, filled slices, transaction hashes, and terminal report.
3. Add those receipt fields to Activity and the review workspace.

Success criterion: PACT can show a real proposed plan, follower quote, signed
order, and eventual Flash fills without inventing PnL.

### Slice 2 — make survival sizing real — implemented

1. Add `STOP_RISK` as a follower sizing mode.
2. Compute size from the follower risk budget and declared stop.
3. Apply every existing cap after that calculation.
4. Add deterministic tests for buy, sell, cap, invalid-stop, and min-size
   refusals.

Success criterion: the same leader plan produces different, explainable sizes
for two followers with different risk budgets. Deterministic buy, sell, and
invalid-stop tests cover the calculation; live execution still requires a
follower-signed Flash order.

### Slice 3 — prove the copy mechanism, not the leader's marketing

1. Persist and display quoted price, average fill, and entry drift in bps.
2. Display approved versus filled notional and all terminal close reasons.
3. Add an honest concentration panel for multi-leader sleeves.

Success criterion: PACT can demonstrate why a follower waited, scaled, or
skipped a trade and whether the actual execution stayed within its mandate.

### Slice 4 — only if time remains

1. Compare leader plan fields to the Flash order response when Flash supplies
   sufficient fields.
2. Add a unique-human gate for a public leader directory with World ID.
3. Add follower-signed batch cancellation once confirmed by Definitive.

## World Decision

World improves a **public discovery** surface, not execution quality:

- use it for unique-human eligibility before a leader appears in a public
  directory;
- keep World status visibly separate from Flash order evidence;
- optionally require a World step-up when a follower materially raises their
  own mandate limits;
- do not use it for generic login, wallet authorization, KYC/suitability, or
  “good trader” claims.

World is a Slice 4 integration. It should not delay risk sizing, real Flash
evidence, or execution-fidelity receipts.

## Claims for the Demo

### Safe to claim after Slice 1

> PACT makes a follower self-sign a bounded Flash order after independently
> checking policy, execution price impact, entry drift, and the returned
> signing payload.

### Safe to claim after Slice 2

> PACT sizes a follower’s trade from their declared stop-risk budget, then
> applies sleeve and portfolio caps.

### Safe to claim after Slice 3

> PACT records whether a follower’s actual execution stayed within the
> follower-owned mandate.

### Never claim without more evidence

- “PACT makes followers profitable.”
- “PACT automatically cancels/unwinds risk.”
- “PACT verifies a leader’s full strategy or performance.”
- “World verification means a leader is trustworthy or suitable.”
- “A declared stop guarantees maximum loss.”
