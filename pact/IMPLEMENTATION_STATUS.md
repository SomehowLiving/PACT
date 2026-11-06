# PACT Implementation Status

Status date: November 6, 2026.

This is the operational handoff for PACT. It distinguishes what the repository
implements, what is tested locally, what still needs a real wallet/mainnet
test, and what remains only a design or research direction.

## Executive Snapshot

PACT is a non-custodial, policy-bound social strategy execution MVP.

```text
Leader publishes a structured plan
        ↓
Follower selects leaders and owns the mandate
        ↓
PACT evaluates COPY / SCALE / WAIT / DECLINE / REVIEW
        ↓
Optional PACT Assist queues policy-compatible plans for review
        ↓
Follower requests Flash quote and browser verifies signing payload
        ↓
Follower self-signs from their own wallet
        ↓
Definitive Flash executes and PACT records execution fidelity
```

The core product is **review-and-self-sign execution**, not unattended copying.

## What Is Built

### Leader Plan Publishing

| Capability | Status | Notes |
| --- | --- | --- |
| Structured plan | Built | Thesis, invalidation, entry, stop, target, expiry, capacity, pair, side, order type, quantity |
| Plan structure validation | Built | Long: `stop < entry < target`; short: `target < entry < stop` |
| Reward:risk grading | Built | `DISCIPLINED`, `CAUTION`, or `INCOMPLETE`; strict gate is follower-controlled |
| TWAP fields | Built | Duration, optional bucket count, optional start time, and optional price bound |
| Flash order lookup evidence | Built | `ORDER_FOUND` only proves Flash found an order for the leader wallet; no plan/order field equivalence yet |

Primary endpoint: `POST /api/strategies`.

### Follower Policy and Mandates

| Capability | Status | Notes |
| --- | --- | --- |
| Up to three selected leaders | Built | Follower controls the allowed leader set |
| Per-order and daily caps | Built | Policy cap plus daily copy budget |
| Per-leader daily sleeve | Built | Individual leader allocation limit |
| Same-asset / same-side cap | Built | Prevents duplicate directional exposure from consuming the sleeve |
| Open-plan limits | Built | Global and per-leader limits |
| Pair / chain / side / type allowlists | Built | Fails closed outside the follower mandate |
| Plan-protection / quality / evidence gates | Built | Optional policy preferences |
| Leader pause / resume | Built | Follower holds new plans from one leader (`BLOCK / WAIT · LEADER_PAUSED`) without dropping the leader or mandate; queued plans are re-decided on save. Does not cancel live Flash orders |
| Realized-loss breaker | Partial | Can block future proposals when trusted realized-PnL evidence exists; not a full live drawdown system |

Primary endpoint: `GET` / `POST /api/policy`.

### Sizing

| Mode | Status | Behavior |
| --- | --- | --- |
| Proportional | Built | Follower notional is a percentage of leader notional |
| Fixed USD | Built | Follower chooses a fixed notional per copied plan |
| Stop-risk budget | Built | Derives size from `risk budget ÷ abs(entry - stop)`, then applies all caps |

For stop-risk sizing, buy orders are correctly sent to Flash in USDC notional
units; sell orders are target-asset units. The result is a planned-loss
estimate, not guaranteed maximum loss.

### Quote, Execution, and Exit Safety

| Capability | Status | Notes |
| --- | --- | --- |
| Flash quote shaping | Built | Market, limit, TWAP, and trigger-shaped requests as supported by PACT |
| TWAP rules | Built | `durationSeconds` quote-only; buckets/start time/bound echoed on submit |
| Entry-drift bound | Built | Follower drift is converted into Flash `limitNotionalPrice` for TWAP/limit execution |
| Quote price-impact / slippage gates | Built | Refuses quote that no longer fits follower policy |
| Browser-side EIP-712 guard | Built | Re-checks raw Flash returned signing payload before wallet prompt |
| Permit2 / approval handling | Built | Handles returned direct approval or Permit2 material and validates expected spender/path |
| Attached TP/SL bracket | Built | Eligible buy entries attach a Flash TP/SL pair; its payloads pass the guard, its leg ids and live levels are tracked, and cancel covers entry + pair |
| Single order cancellation | Built | Follower signs a Flash cancel message |
| Batch cancellation | Not built | Needs confirmed Flash endpoint and follower-signed flow |

Primary endpoints: `POST /api/quote`, `POST /api/order`, `GET /api/orders/[id]`, and `POST /api/orders/[id]/cancel`.

### Execution Fidelity

PACT stores and displays:

- leader declared entry;
- follower Flash quoted execution price;
- order ID, status, close reason, transaction IDs, and TWAP progress;
- Flash fill rows and weighted average fill price when available;
- entry drift in basis points;
- requested/approved notional and policy decision.

This is a receipt layer, not a PnL predictor. It answers whether the follower’s
actual execution stayed within the mandate they approved.

Two things build on the receipts:

- **Per-leader fidelity history** (`lib/fidelity.ts`, “your leaders” panel on
  `/follower`): submitted and filled orders, mean and worst entry drift, how many
  fills stayed inside the follower’s drift bound, and Flash close reasons. It uses
  only this follower’s own PACT orders and is not a skill or profitability score.
- **Evidence export** (`GET /api/orders/[id]/evidence`, `npm run evidence -- <orderId>`,
  and an `evidence.json` link on each order card): re-reads the order from Flash and
  saves PACT’s decision, proposal and policy hashes, quote, fills, tx explorer links and
  the **raw** Flash order response to `pact/evidence/<orderId>.json`. If Flash is
  unreachable it still exports the stored record with `flash.live: false`.

### Portfolio and Market Context

| Capability | Status | Notes |
| --- | --- | --- |
| Multi-leader concentration view | Built | Shows approved capacity by same asset + side, percentage, and contributing leader count |
| Real WETH/USDC chart | Built | Base OHLCV from GeckoTerminal for the review workspace |
| Entry/stop/target overlays | Built | Declared levels only; never presented as route or fill truth |
| Broader token chart coverage | Not built | Current live chart is intentionally only Base WETH/USDC |
| Statistical correlation / Sharpe | Not built | PACT does not fabricate analytics from insufficient history |

Market data endpoint: `GET /api/market/weth`.

### PACT Assist

| Capability | Status | Notes |
| --- | --- | --- |
| Review mode | Built | Follower self-signs every order |
| Assist mode | Built | Scans stored policy decisions and returns `PREPARE_REVIEW`, `HOLD`, or `DECLINE` |
| Direct enable/disable UI | Built | Saves mode through follower policy API |
| Quote / sign / submit / cancel | Forbidden in Assist | Assist has no private key or session authority |
| Autopilot | Not built | Requires smart-account session-key design and live integration testing |

Agent endpoint: `GET /api/agent?follower=...`.

## Runtime Paths

### A. Leader-to-Follower Path

1. Leader submits a plan through `/leader` or `POST /api/strategies`.
2. PACT validates plan structure and optional leader order lookup.
3. The follower selects that leader in their policy.
4. Follower mirrors selected leader plans with `POST /api/proposals`.
5. PACT calculates requested size, applies policy and mandate limits, persists
   the proposal and decision.
6. The user sees `COPY`, `SCALE`, `WAIT`, `DECLINE`, or `REVIEW`.

### B. Follower Signing Path

1. Follower opens `/review/[proposalId]`.
2. PACT renders declared plan, external market context, policy result, and
   follower execution bound separately.
3. Follower requests `POST /api/quote`.
4. PACT sends Flash a follower-derived order request, validates quote metrics,
   then stores the raw quote/typed data only if server guard passes.
5. Browser independently runs the guard against raw returned data.
6. Follower may approve token/Permit2, sign entry typed data, sign bracket if
   applicable, and submit through `POST /api/order`.
7. PACT polls `GET /api/orders/[id]`, then updates receipt/fill/fidelity data.

### C. Assist Path

1. Follower enables `ASSIST` in policy or directly in the Assist panel.
2. User selects **scan plans**.
3. `/api/agent` reads the same stored policy decisions used by PACT.
4. Eligible/scaled plans link to review; held and declined plans are explained.
5. No quote, signature, submission, cancellation, or mandate edit occurs.

## Test and Validation Status

Last local validation for the currently committed product features:

| Check | Result |
| --- | --- |
| `npm test` | 66 tests passed |
| `npm run lint` | Passed |
| `npx tsc --noEmit` | Passed |
| `git diff --check` | Passed before each related commit |
| `npm run build` | Passes (Nov 6). The first run after a change can stop with Next’s `SecurityFatalError` notice because `next.config.ts` sets `experimental.agentUpgrade: "security"`; rerunning continues. Next 16.4.5 has a known advisory, so an upgrade is recommended |

Test coverage is organized as follows:

| Test file | Coverage |
| --- | --- |
| `lib/policy.test.ts` | Policy verdicts, caps, expiry, drift, quality/evidence gates, breaker, price bounds, stop-risk sizing |
| `lib/guard.test.ts` | EIP-712 / Permit2 recipient, amount, token, spender, domain, deadline, and approval tampering checks |
| `lib/flash.test.ts` | Flash request shaping, TWAP asymmetric echo rules, brackets, cancellation message, execution/fill metrics |
| `lib/store.test.ts` | Multi-leader sleeves, deterministic demo cases, fixed sizing, stop-risk sizing |
| `lib/agent.test.ts` | Assist queues review, holds waits/reviews (including follower pauses), and declines blocked plans |
| `lib/fidelity.test.ts` | Per-leader drift history counts only this follower’s Flash orders and never invents drift without fills and a declared entry |

### Not Yet Validated With Real Funds

- A successful follower-signed Base mainnet order and fill.
- Attached bracket activation on a real filled entry.
- Arc quote/sign/fill path.
- Full leader plan-to-order equivalence against a real Flash response.
- Any smart-account session-key / Autopilot authorization path.

## Integration Matrix

| Integration | Status | What PACT Uses | Important Boundary |
| --- | --- | --- | --- |
| Definitive Flash | Built, mainnet integration pending live follower fill | Quote, submit, status, cancel, advanced orders, typed data | Mainnet only; real fill requires a funded follower wallet and explicit signatures |
| Base | Built primary chain | Chain config, WETH/USDC, wallet flow, explorer links | Current practical demo chain |
| Arc | Configured only | Chain ID and token config | No recorded live PACT validation yet |
| Permit2 | Built through Flash response path | Approval/permit payload handling and browser checks | PACT validates returned material; it does not replace Flash authorization semantics |
| wagmi + viem | Built | Wallet connection, chain switch, typed-data/message signing, approval transaction | EVM-only client architecture |
| GeckoTerminal | Built for one review pair | Base WETH/USDC OHLCV context | Chart is context, not execution price or Flash route truth |
| World ID | Researched only | No runtime integration | Possible future public-leader uniqueness or high-risk mandate step-up; never wallet authorization |
| Smart-account session keys | Designed only | No runtime integration | Required before Autopilot can exist |
| Rhinestone / ERC-7579 | Candidate direction only | No SDK or deployed validator | Must be tested with Flash EIP-1271 + Permit2 behavior before selection |
| 1inch / Uniswap | Not integrated | None | Flash is the execution integration; do not add a second execution router without a product reason |
| Chainlink / Pyth | Not integrated | None | No oracle is used to claim execution truth |
| Hyperliquid / CEX copy APIs | Research only | None | Competitive context, not a PACT dependency |

## Data and Trust Boundaries

| Layer | Source | PACT treatment |
| --- | --- | --- |
| Leader declaration | PACT leader input | A plan claim, not execution truth |
| Follower policy | Follower-owned PACT settings | Authority boundary for whether a plan may proceed |
| Market context | GeckoTerminal for Base WETH/USDC | Informational chart only |
| Execution quote/fill | Definitive Flash | Source of execution facts |
| Wallet authorization | Follower wallet | Only current authority able to sign execution |
| Assist | Deterministic local policy orchestration | No key, no session, no execution authority |

## What Is Explicitly Not Claimed

PACT must not claim:

- that it makes followers profitable;
- that a leader is skilled or safe because they are followed or green;
- that `ORDER_FOUND` proves the published plan matches a leader’s Flash order;
- that a declared stop guarantees maximum realized loss;
- that the GeckoTerminal chart is Flash’s route, quote, or final fill;
- that Assist is Autopilot;
- that a World proof authorizes trading;
- that automatic cancellation, automatic unwind, leverage control, liquidation
  protection, or funding-rate protection exists.

## Planned Work

### P0 — Proof and Receipt Quality

1. Execute a small follower-signed Base WETH/USDC TWAP with attached bracket.
2. Preserve order ID, transaction hashes, fill rows, average fill, and terminal
   report as a real demo artifact: run `npm run evidence -- <orderId>` once the
   order is terminal and commit `pact/evidence/<orderId>.json`.
3. Expand receipts with any confirmed Flash-provided fee, venue, and completed
   fill-count fields after observing the real response schema.

### P1 — Better Mandate Safety

1. Compare leader plan fields with Flash order fields when the actual response
   provides sufficient data; introduce `PLAN_MATCHED` only then.
2. ~~Follower-initiated leader pause/resume~~ (built Nov 6). Batch cancel still
   waits on Definitive confirming the endpoint and signature shape.
3. ~~Leader execution-fidelity history from receipts~~ (built Nov 6); it becomes
   meaningful once real fills exist.
4. Expand market context to additional explicitly supported pairs only after
   validating token mapping and data quality.

### P2 — Optional Delegated Autopilot

1. Select one EIP-1271-compatible smart-account/session-key provider.
2. Build a revocable, expiry-bound, token/contract/amount-scoped session
   validator that binds to PACT policy snapshots.
3. Validate its Permit2 and Flash behavior with a dedicated small-value
   mainnet test.
4. Add Autopilot only after the follower can revoke it and every action has an
   attributable receipt.

### P3 — Public Discovery and Ecosystem Integrations

1. Consider World unique-human eligibility for a public leader directory.
2. Consider World step-up for material Autopilot mandate increases.
3. Do not use World as KYC, suitability, leader-quality proof, or wallet
   authorization.

## Repository Guide

| Path | Purpose |
| --- | --- |
| `PACT.md` | Canonical product thesis, market evidence, learning model, and demo narrative |
| `pact/README.md` | Developer quick-start and Flash-specific safety notes |
| `pact/PRODUCT_DIRECTION.md` | Information architecture and UI direction |
| `pact/CRITIQUE_AND_WORLD_DECISION.md` | Critique response, Flash facts, and World decision |
| `pact/FOLLOWER_OUTCOME_STRATEGY.md` | Follower-risk product strategy |
| `pact/AGENT_AUTOMATION_ARCHITECTURE.md` | Assist versus future Autopilot authorization design |
| `pact/lib/policy.ts` | Policy, entry-bound, plan-quality, and stop-risk calculations |
| `pact/lib/guard.ts` | Browser/server signing payload guard |
| `pact/lib/flash.ts` | Flash request, response, and execution-fidelity helpers |
| `pact/lib/store.ts` | Local state, proposals, receipts, and demo seed |
| `pact/components/FollowDesk.tsx` | Follower workspace, review/signing UI, mandates, concentration, Assist |

## Recent Product Commits

| Commit | Scope |
| --- | --- |
| `f895714` | Rewrote `PACT.md` with market evidence and learning model |
| `08abfc4` | Made Assist mode directly actionable in the UI |
| `e611eed` | Added policy-bound Assist agent and Autopilot architecture doc |
| `eb83dc5` | Added stop-risk sizing, execution fidelity, and concentration controls |
| `d6cf25a` | Added policy-driven copy mandates |

## Phase 0 hardening (Nov 6, 2026)

Fixes from the Flash docs/OpenAPI audit and a source study of other Flash apps
(see `../pact-architecture.md`). Each is covered by a unit test; the request
shapes are also checked against the live API by `FLASH_LIVE=1 npx vitest run lib/flash.live.test.ts`
(quotes only, no orders).

| Fix | Before | After |
| --- | --- | --- |
| Signing domain | `chainId` passed to viem as a string, so viem dropped it from the EIP-712 domain hash and Flash rejected every signature (`403 signature verification failed`) | `parseOrderTypedData` coerces it to a number; the browser e2e now reaches Flash's balance check (`insufficient source asset balance`) — the signatures verify |
| Limit + protection | rejected by Flash (`limit_cross_price required`, pair expiry before entry) | `limitCrossPrice` on limit + bracket; pair expiry ≥ entry expiry |
| Copy lifetime | resting copies lived 7 days regardless of the plan | expire with the plan's copy window; TWAP copies finish inside it |
| Protection guard | bracket approval, permit and order signed unchecked | `verifyBracketSigning` in server and browser; size bounded by 2.2 × entry ÷ stop |
| Direct approvals | guard failed a bounded approval to Flash's allowance contract | accepted when bounded; vault pinned via `NEXT_PUBLIC_FLASH_VAULT` |
| Fees | ignored; drift used the market mark only | all-in price, fee and cost ratio stored; separate `maxExecutionCost` budget (default 3%) |
| Fill parsing | `fillPrice` averaged (inverted on sells) | Flash `averageNotionalPrice`, else finalised contra ÷ target; reorged fills ignored; fees summed |
| Submit | protections omitted on submit; a 4xx assumed nothing happened; bracket expiry sent on submit | impact/slippage echoed; failed submits reconciled against the order list; submit shape per OpenAPI |
| Protection tracking | bracket id never stored; cancel left the pair live | pair status, `bracketOrderId`, live levels read back (`levelsMatch`); cancel = one signed batch for entry + pair; `422 already filled` reported, not failed |
| Polling | stopped when the entry ended; 404 right after submit = error | continues while the pair is live; 404 within 15 s = pending; reads retry on 429 |
| Receipts | — | `receiptVerdict`: MATCH / MISMATCH for price bound, fees, recipient, integrator fee, protection levels (in the evidence bundle) |

**Known configuration gap:** `.env.local` uses Flash's public playground key, so fees go
to Definitive's vault and orders share its portfolio. Get a PACT integrator key before
the live run and set `NEXT_PUBLIC_FLASH_VAULT` to its vault.
