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
| World ID | Built (needs WORLD_RP_ID) | Verified-human leaders: World ID 4.0 proof bound to the leader wallet, one human per leader address, badge, Discover filter, follower policy option | Step-up for Autopilot is still planned; never wallet authorization |
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
| Desk writes | Wallet session (SIWE, 12 h httpOnly cookie) | Mandate, plan, mirror, quote and order writes refused unless the session address owns the record |
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

## Phase 2 · step 1: wallet sessions (Nov 6, 2026)

Before this step anyone could POST a mandate, a plan or a mirror for *any* address, and
`POST /api/demo` wiped the whole store, real wallets included.

| Piece | Behaviour |
| --- | --- |
| `lib/session.ts` | Sign-In with Ethereum (EIP-4361) message for Base, single-use nonce (10 min), domain and statement checked; EOA signatures recovered locally, smart wallets checked on chain (ERC-1271 / 6492). Session = HMAC-signed `{address, exp}` in an httpOnly `SameSite=Lax` cookie for 12 h. Secret: `PACT_SESSION_SECRET`, else a random one beside the store file |
| `/api/session/nonce`, `/api/session` | issue message · exchange signature for cookie · `GET` who am I · `DELETE` sign out |
| `requireOwner` | `POST /api/policy` (follower), `/api/strategies` (leader), `/api/proposals` (follower), `/api/quote` and `/api/order` (proposal's follower): 401 `SIGN_IN_REQUIRED` / 403 `SESSION_MISMATCH`. Cancel stays gated by the Flash-verified cancel signature |
| `lib/api.ts` | `apiFetch` retries a write once after one wallet sign-in prompt (shared between concurrent writes); signer registered by `DeskProvider` via wagmi `signMessage` |
| Demo reload | `seedDemo` takes no overrides and clears only demo-owned records (`resetDemoData`); real mandates, plans, mirrors, receipts survive |

The sign-in message says it cannot move funds, approve tokens or place orders. It can't:
it is a plain `personal_sign` text, and every Flash action still needs the wallet's own
EIP-712 signature.

Tests: `lib/session.test.ts` (token tamper/expiry, sign-in, replay, wrong wallet, wrong
site, unknown nonce, owner gate) and a demo-reload test in `lib/store.test.ts` (92 unit
tests pass; the 3 live ones are opt-in). e2e 15/15: Case 0 checks 401 without a session,
403 for another wallet and 200 for the owner. Case 1 shows exactly one sign-in prompt before
the Flash signatures. Case 2 (tampered quote) gets the sign-in and nothing else.

## Phase 2 · step 2: hash-chained evidence log (Nov 6, 2026)

The desk store is mutable: a mandate change deleted the proposals and audit rows it
replaced, and nothing showed that a record had been edited. Now every desk write also
appends to `<store>.evidence.jsonl`, which only grows.

| Piece | Behaviour |
| --- | --- |
| Event | `{v, seq, at, kind, thread, refs, data, prev, threadPrev, hash}`. `hash` = SHA-256 of the canonical JSON without `hash`; `prev` links the whole log, `threadPrev` links one copy (`proposal:<id>`), mandate (`mandate:<follower>`) or plan (`plan:<id>`) |
| Kinds | `mandate.set` (only when the policy hash changes), `plan.published`, `decision.made` (names the proposal, policy and plan hashes), `decision.updated`, `proposal.withdrawn` (mandate change or demo reload — appended, never erased), `quote.stored` (fees, bounds, hashes of the typed data the wallet is asked to sign), `order.submitted`, `order.rejected` (Flash's error), `order.updated` (only when Flash reports a change), `order.cancel_requested` |
| Writer | `lib/store.ts` is the only writer, plus the order and cancel routes for outcomes the store never sees. Reads never append: `policyFor` no longer saves a default mandate for an unknown wallet |
| Verify | `lib/evidence-verify.ts` (browser-safe): `verifyLog` (hashes, sequence, both links), `verifyThread` (one copy). `GET /api/evidence` returns the head hash, length and a server-side check; `?events=1` gives the whole log, `?thread=` one thread |
| Bundle | evidence.json v3 carries the copy's events, the mandate and plan events its decision names, the thread check and the log head |
| UI | Execution → receipt shows an "Evidence trail" card: the events, re-verified in the browser (VERIFIED / BROKEN) |

Limit, stated in the bundle: tamper-evident, not tamper-proof. PACT could rewrite the whole
log; anchoring the head hash on chain is the planned fix.

Tests: `lib/evidence.test.ts` (server hash = browser hash; links; edit, delete and reorder
detected; reload from file continues the chain; demo decisions name their mandate and plan;
withdrawals appended; reads do not write; unchanged polls do not log). 100 unit tests pass.
e2e 17/17: after the real browser flow the log verifies, and the copy's trail reads
`decision.made → quote.stored → order.rejected` (the throwaway wallet has no USDC).

## Phase 2 · step 3: positions, realized P&L and the loss breaker (Nov 6, 2026)

Before: `realizedPnlUsd` was never written, so the per-leader loss breaker could never trip,
and Portfolio showed two "planned" P&L placeholders.

| Piece | Behaviour |
| --- | --- |
| `lib/positions.ts` | `legFacts` sums finalised fills only (reorged and unconfirmed ignored). `positionFrom(entry, exit)`: average cost from entry fills, exit from the protective order's sell fills, realized = proceeds − sold units × average cost, open units and cost; exits clamped to what was bought. Fee convention matches `executionMetrics`: buy amounts already net, sell `feeNotional` subtracted, so realized P&L is never overstated |
| `refreshReceipt` | now keeps the protective order's fills, writes `receipt.position` and `realizedPnlUsd` (buys only); if the protective order cannot be read it keeps the last known position. A new realized loss re-decides the follower's waiting copies when the breaker is on |
| Breaker | `leaderDailyRealizedLoss` counts a loss on the day of the exit fill (`realizedAt`), not the entry day |
| `lib/marks.ts` | open size marked at Flash's own **sell quote** for that size, fees off (what the follower would actually get); Flash's search mid only when Flash will not quote, labelled `flash-search-mid`; 30 s cache per size bucket |
| `GET /api/positions?follower=` | per-copy positions, one exit quote per asset for the total open size, totals (realized, realized today, unrealized, open value/cost, unpriced count). Read-only |
| Evidence | `order.updated` now carries the position facts, so a realized result is in the hash chain |
| UI | Portfolio "P&L" panel replaces the two placeholders; receipt shows a Position row |

Tests: `lib/positions.test.ts` (finalised-only fills; stop-out loss net of fee; partial exit
split into realized and marked; no fill → no position; exit clamp; and end to end with Flash
mocked: a stopped-out protective order records −$0.65, the breaker holds that leader's
waiting copies, the evidence log carries it). Live (`FLASH_LIVE=1`, quotes only): the exit
mark comes from a real Flash sell quote, slightly under the mid. 105 unit tests pass,
4 live pass, e2e 17/17. Visual check on seeded receipts: the panel shows realized −$0.65 and
an open 0.006 WETH marked at a live Flash exit quote.

Not covered: positions closed outside PACT (a manual sell from the wallet) are invisible, and
sells copied from a leader have no cost basis, so they get no P&L.

## Phase 2 · step 4: Flash orders stream (Nov 6, 2026)

Before: every open order was tracked by the browser polling `GET /orders/{id}` every 4 s, and
nothing tracked an order when no page was open.

| Layer | Piece | Behaviour |
| --- | --- | --- |
| L0 | `lib/flash-stream.ts` `OrderStream` | `wss://flash.definitive.fi/v1/ws`; per connection: subscribe `heartbeats` + `orders` (apiKey in-band, one scope: a funder or the org); live on the snapshot; heartbeat watchdog (5 s gap → reconnect); capped exponential backoff with equal jitter; `UNAUTHORIZED` stops; transient errors reconnect; `STREAMING_UNAVAILABLE` → degraded (polling continues) |
| L5 | `lib/tracker.ts` | a frame about a PACT order (entry, its protective order, or a pair whose `sourceEntryOrderId` is the entry) triggers one debounced REST `refreshReceipt`. REST stays the source of truth. Each snapshot (connect and every reconnect) resyncs all live receipts in scope, since a snapshot cannot show what closed during a gap. Streams close when nothing in scope is live |
| Scope | | integrator key → one org-wide connection for every follower; playground key (shared org) → one connection per follower with live orders, capped at 5 of the 50-per-key limit, polling past the cap |
| L7 | `/api/state` → `tracking {mode, status, pollMs}` | started from the desk read and right after a submit; browser order polls drop from 4 s to 30 s while the stream is healthy; Execution shows "live via Flash order stream" or "polling Flash" |

Tests: `lib/flash-stream.test.ts` (fake socket and clock: subscribe shapes, one socket per
scope, snapshot → live, updates delivered, heartbeat gap reconnect + re-subscribe, backoff
grows and caps, UNAUTHORIZED stops, clean close; tracker: no stream without live orders, frames
about the entry and pair coalesce into one refresh, unrelated orders ignored, stream closed
when terminal, pair matched by `sourceEntryOrderId`). Live: a real Flash socket reaches
`live` with a snapshot in about 1 s. In the Next server, a desk read for a follower with a
live order opened the stream and reported `live` within 1.5 s. 113 unit tests, e2e 17/17.

Limit: on serverless hosting the socket only lives while an instance does; polling remains
the fallback, so nothing depends on the stream being up.

## Phase 3 · step 1: leader credibility from the leader's own execution (Nov 6, 2026)

Before: a leader could attach a Flash order id, and `ORDER_FOUND` only proved Flash had *an*
order under that wallet, not that it matched the plan. Orders placed outside PACT's API org
could not be checked at all.

| Layer | Piece | Behaviour |
| --- | --- | --- |
| L0 | `lib/base-rpc.ts` | receipt, block time, finality (block ≤ Base `finalized`), ERC-20 `Transfer` decoding (3 topics; NFTs ignored). One shared Base client (sessions use it too) |
| L3 | `lib/leader-evidence.ts` (pure) | **Onchain**: the leader wallet's net token flows per tx must be the declared trade (buy: contra out, target in), average price ≤ declared entry + 100 bps, first trade no more than 6 h before publish and none after expiry, all final, and no tx already backing another plan. **Flash order**: pair, side, type, limit, the leader's own TP/SL, size, and "leader is in the trade" (cancelled with nothing filled = contradiction); its fill transactions are then checked on chain. Status: `ONCHAIN_VERIFIED` > `PLAN_MATCHED` > `ORDER_FOUND` > `UNVERIFIED`; any contradiction → `MISMATCH` |
| L3 | `lib/leader-record.ts` | counts per leader: plans by evidence status, verified own volume and drift, copies submitted/filled, copiers' drift, realized P&L, wins/losses. No score |
| L4 | `decide` | `MISMATCH` → REVIEW `LEADER_EXECUTION_MISMATCH` for every follower; "require evidence" now means at least a matching order, or `minLeaderEvidence: ONCHAIN_VERIFIED` |
| L5 | `lib/leader-verify.ts`, `setLeaderEvidence` | verification runs at publish *before* copies are proposed; a status change re-decides waiting copies; a `leader.evidence` event is chained only when the facts change |
| API | `POST /api/strategies` `leaderTxHashes`; `GET/POST /api/strategies/[id]/evidence`; `GET /api/leaders/[address]` | attach later (leader session required); open evidence re-checked at most every 30–60 s |
| L7 | badge everywhere (onchain verified / order matches / contradicted / unverified); Publish: tx field + "Back a plan with your execution" panel with each check; Discover: "Backed by own execution" and a Track record panel (replaces the "Verified PnL, win rate" placeholder); Mandate: minimum evidence select | |

The publisher is the signed-in leader wallet (step 1 sessions), so "the leader's wallet" is
proven, and the trades are proven on chain: together they close A6 (no matching order).

Tests: `lib/leader-evidence.test.ts` (verified buy; sell offered for a buy; +300 bps; trade
8 h before publish; tx reused across plans; missing / not-final / reverted; ERC-20 vs NFT
decoding; order field matching; cancelled-unfilled; combine order; the order's own fills
read from chain, reorged fill skipped; policy holds MISMATCH and honours the minimum; store
re-decides the evidence-required demo desk and records once). Live: a real Base tx decoded
with its USDC transfers, not yet final. 125 unit tests; e2e 22/22. Case 4 publishes with a
real Base tx the leader wallet had nothing to do with: `MISMATCH (tx.direction)`, the
follower's copy is held, attaching without a session is 401, and the record counts it.

Not covered: native-ETH legs (WETH/USDC only); leaders whose trades settle to another
recipient wallet; drawdown (needs longer history).

## Phase 3 · step 2: paper copies, probation, copy fidelity, leader page (Nov 6, 2026)

A new leader had no record PACT could stand behind. Now PACT makes its own (handbook F4).

| Layer | Piece | Behaviour |
| --- | --- | --- |
| L3 | `lib/shadow.ts` (pure) | **Paper entry**: a real Flash quote at $100 (or the plan size if smaller) gives the all-in price a follower would pay at publish; the default mandate judges it (entry drift, execution cost, market already below the stop or at the target → `NOT_COPYABLE` with reasons); a limit plan waits until candles trade through the limit. **Settlement**: the plan's stop and target replayed on candles after entry (a candle touching both = stop), exit cost = entry cost, result in R and %; expires at the protection deadline at the last close; open copies are marked, not settled. **Summary**: settled / targets / stops / expired, average R and %, drift, cost; **probation** until 3 paper copies settle with no contradicted plan (R15); **hard to copy** when more than half of ≥ 3 paper copies were not copyable (R14) |
| L5 | `lib/shadow-run.ts` | quotes and candles only, never a signature; entry at publish; settlement re-checked every 5 min from the leader read |
| L1 | `shadow.entry`, `shadow.settled` events on the plan thread; marks are stored but not chained | |
| L4 | `requireGraduatedLeader` → REVIEW `LEADER_ON_PROBATION`; graduation re-decides waiting copies | |
| L3 | `leaderRecord` adds the paper summary and `fidelityGapBps` (copiers' drift − leader's own) | |
| L7 | `/leaders/[address]`: probation / hard-to-copy badges, metric strip, paper copies table (declared vs paper entry, drift, cost, outcome, R), track record, every plan with its evidence checks; Discover → Profile; Mandate toggle | |

Fix found by the live test: Flash market quotes report `estimatedFeeNotional: "0"` while $100
buys $99.83 of WETH. `executionMetrics.costRatio` is now max(reported fee, value lost) ÷
size (`costNotional` added), so the execution-cost budget no longer passes market orders as
free. Preflight shows "cost (reported fees, rest inside the price)".

Tests: `lib/shadow.test.ts` (entry and default-mandate reasons incl. stale levels; limit
waits, enters on touch, or never; target / stop / both-in-one-candle / mark / expiry / candles
before entry ignored; probation and contradiction; hard to copy; policy; through the store:
3 quote-entered, candle-settled copies chain 6 events, the log verifies, the leader
graduates and the follower's held copies are released). Live: a plan at today's levels is
paper-entered on a real Flash quote and marked on real GeckoTerminal candles. 134 unit,
8 live, e2e 25/25 (Case 5: paper entry at +40 bps / 0.18 % cost, probation reported, leader
page renders with paper rows and the contradicted plan).

## Phase 4: signals (Nov 6, 2026)

Facts with a stated source, read by policy; a signal never decides on its own.

| Rule | Signal (L3, `lib/signals.ts`) | Policy (L4) |
| --- | --- | --- |
| R11 reference divergence | three prices for WETH at quote time: **Chainlink ETH/USD on Base** (L0 `lib/oracle.ts`, read on chain, no key), the GeckoTerminal pool, and Flash's quoted market price; stale (> 25 min) or unreadable oracle = `UNAVAILABLE` | Flash or the chart further than `maxReferenceDivergence` (default 1%) from the oracle → WAIT `REFERENCE_PRICE_DIVERGENCE`. Unavailable is shown, not blocking. Stored on the quote and chained in `quote.stored` |
| R8 style drift | this plan's size ÷ the median of ≥ 3 earlier plans on the same side and pair; ≥ 3× alert, ≥ 2× caution | a proportional copy is brought back to the usual size → MODIFY SCALE `LEADER_SIZE_OUT_OF_CHARACTER`; fixed and stop-risk sizes are already the follower's own, so they keep it and show the signal |
| R9 revenge pattern | a re-entry on the same pair and side within 24 h of a stop-out (PACT's paper copy), bigger = alert | alert → REVIEW `LEADER_REVENGE_PATTERN` |

Why Chainlink and not Pyth: Pyth's Hermes has required an API key since 26 Aug 2026 (the
live call returned 401). Chainlink's Base feed updates on a 0.15% move or a 20-minute
heartbeat, which is fine for a 1% check and is not used as an execution price.

UI: `ReferencePrices` (live from `GET /api/reference`, cached 15 s, or the stored quote-time
check) and `SignalList` on the Trade plan panel and the review page; Mandate "Max gap to the
oracle".

Tests: `lib/signals.test.ts` (style drift needs history, ignores other sides and later plans,
levels; revenge within / outside 24 h, bigger vs same; three prices agree, disagree, stale,
unreadable; quote-time WAIT only on disagreement; revenge held; through the store a 4× plan
gives a proportional follower 0.1 × the usual $100, MODIFY SCALE, while a fixed $20 follower
keeps $20). Live: Chainlink, the chart and a Flash quote agree within bps. 140 unit, 9 live,
e2e 29/29 (Case 6: the follower's real quote recorded Flash +5 bps and chart +9 bps vs
Chainlink; a 4× plan raised the alert and the copy was $25 instead of $100).

## Arc validation (Nov 6, 2026)

Live: Flash quotes WETH/USDC on Arc (5042) for market and TWAP; Flash uses the same verifying
contract and Permit2 there, and the wallet guard passes Flash's real Arc entry and protection
payloads with no failures. e2e Case 7: a follower opts into Arc, the leader publishes an Arc
plan, the browser guard passes, the wallet signs both permits and both orders on chain 5042,
and Flash verifies the signatures and refuses only on balance. A funded Arc fill is still to
be recorded.

## Phase 5: Autopilot session key (Nov 6, 2026)

Unblocked by Flash's own docs (FAQ, EVM overview): Flash accepts EIP-1271 smart-wallet
signatures on every EVM chain, validates with `isValidSignature` whenever the funder has code
(including an EIP-7702 delegation), and the settlement contract checks again onchain at
execution. So a session key works if the follower's account accepts it.

ERC-1271 only passes a digest, so a generic session module cannot see what a key is signing.
**`contracts/src/PactSessionAccount.sol`** therefore takes the full payload inside the
signature, rebuilds the exact EIP-712 digest, and only then checks the scope:

| Payload | Onchain rule |
| --- | --- |
| FlashOrder (`DefinitiveFlashAllowance` v1) | swapper = recipient = the wallet; spent token allow-listed and ≤ per-order cap; received token allow-listed; deadline ≤ session expiry |
| Permit2 PermitSingle | spender = Flash settlement; token allow-listed and ≤ permit cap; expiration and sigDeadline ≤ expiry + 24 h (Flash's own buffer) |
| Flash cancel message | accepted (only reduces exposure) |
| any session signature | key matches, session granted and not revoked, `block.timestamp` ≤ expiry |
| 65-byte ECDSA by the owner | accepted: review-mode signing is unchanged |

Two modes: a **PACT wallet** (EIP-1167 clone from `PactAccountFactory`, owned by the
follower's EOA, address predictable; works with any browser wallet) or the EOA itself via
**EIP-7702**. Only the factory can set an owner, and only on a fresh clone, so nobody can
claim a 7702 account. `execute` (approvals, withdrawals) and grant/revoke are owner-only.

PACT side (L6): `lib/session-account.ts` (ABIs, signature encoding identical to the
contract's `abi.decode`, CREATE2 address prediction, a TypeScript mirror of the scope rules
used as a pre-check); `lib/autopilot.ts` (grants in a separate server-only file, session key
generated server-side and stored AES-256-GCM-encrypted, never returned; `runAutopilot` runs
the same `prepareCopyQuote` → policy → guard path as review, funded by the PACT wallet, then
the scope pre-check, then signs order, permit, protection and protection permit with the
session key; daily and per-order caps; every grant, revoke and run is chained as evidence).
Quote and submit were extracted into `lib/copy-quote.ts` and `lib/submit-order.ts`, shared by
both flows; receipts record `funder` and `signedBy`, and status reads and the order stream
follow the funder. Autopilot **submits only when the session is live on chain and
`PACT_AUTOPILOT_SUBMIT=1`**; otherwise it signs, records a dry run and stops.

UI: Wallet → "Autopilot session key" (create with expiry and caps, status from chain, the
one-time setup calls sent from the wallet, turn on/off, revoke with the onchain call);
Mandate → Automation has an Autopilot option; Overview shows the mode.

Tests:
- Foundry (`cd contracts && forge test`): 13 tests — digest equals viem's for a real Flash
  Base payload; owner ECDSA; in-scope order; other recipient, over cap, other tokens, payload
  that does not match the digest, deadline beyond the session, wrong key, revoke, re-grant,
  expiry; permit spender, cap, Flash's 24 h buffer; cancel only; owner-only grant/revoke;
  nobody can claim a 7702 account; smart-wallet mode end to end.
- Base fork (`PACT_FORK=true forge test --match-contract Fork`): the real Permit2 on Base
  accepts a session-signed permit through the account and refuses one over the cap.
- anvil (`PACT_ANVIL=1 npx vitest run lib/session-account.anvil.test.ts`): the compiled
  contracts accept TypeScript-made session signatures in scope and reject theft-shaped and
  over-cap ones; address prediction equals the factory's.
- unit: `lib/autopilot.test.ts` (key encrypted and never exposed; signatures recover to the
  session key; out-of-scope refused; dry run until live; skips with reasons). 144 unit.
- e2e 40/40, Case 8: on real Flash quotes funded by the PACT wallet address, Autopilot passed
  policy and the guard and session-signed all four payloads; a live permit from Flash first
  exposed the sigDeadline rule above, fixed in both the contract and the mirror.

Not done: deploying the factory on Base (needs a funded deployer:
`forge script script/Deploy.s.sol --rpc-url base --broadcast`), a funded PACT wallet, and a
live session-signed fill. Cancelling an Autopilot order from the review page still asks the
EOA to sign; for a PACT wallet the cancel must be the owner's or session's 1271 signature.
Setup: `cd contracts && forge install foundry-rs/forge-std --no-git` (lib is not committed).

## Full test pass and two execution fixes it found (Nov 6, 2026)

Run: typecheck, lint (whole repo), 146 unit, 9 live Flash/Base, 13 Foundry + Base-fork
Permit2, 3 anvil, production build, e2e 40/40, UI e2e 18/18.

1. **TWAP slices vs the cost budget.** Flash charges about $0.07–0.09 per TWAP slice (live:
   $25 at 2 slices = 0.68 %, 10 slices = 3.49 %), so a small copy whose leader left the
   slice count to Flash could exceed the 3 % budget and wait. `prepareCopyQuote` now
   re-quotes once with 2 slices when the leader did not set a count and the quote is over
   budget, keeps the cheaper quote, stores `twapBucketCount` on it, and `submitCopy` sends
   exactly the quoted count. A leader-set count is never changed (the copy waits instead).
   `lib/copy-quote.test.ts`.
2. **An Autopilot session must outlast the protection it signs.** The session validator
   checks expiry on every onchain use, so a stop signed by a 24 h session could not fire
   after the session ends. Autopilot already refused ("protection: order outlives the
   session"); the setup panel now defaults to 72 h and says why.

Lint now ignores `.next-*` build folders and the Foundry project's vendored code.

## UI milestone 1: one global navigation, Discover, leader profile (Nov 6, 2026)

Following `PACT_UI_DESIGN_RULES.md` (now in the repo, referenced from `AGENTS.md`):
- **Shell**: the sidebar and the duplicate top tabs are replaced by one header —
  Trade · Discover · Plans · Portfolio · Orders, search, Publish plan, alerts, network chip,
  account menu (wallet value, desk/DEMO selector, Mandate & risk, Wallet & Autopilot,
  Preferences, Desk overview, and Tools: Demo lab, Classic desk, Classic leader ticket) and
  Connect. Each workspace has local tabs under the header (Discover: All leaders / Following
  / Watchlist·planned; Plans: Proposal inbox / PACT Assist / My published plans; Orders:
  Orders & receipts / Activity log; Account: Mandate / Wallet / Preferences). Phone and
  tablet use the same model in a drawer. Every existing route is unchanged and reachable.
- **Discover**: leader identity links to the canonical profile (row click still opens the
  quick-inspect panel); view, search and sort are in the URL (`?view=&q=&sort=key.dir`);
  new follower-specific **Copyability** column (same engine as the copy drawer:
  `components/pages/use-copyability.ts`), sortable.
- **Leader profile** (`/leaders/[address]`): local tabs Overview / Plans / Execution
  evidence / Paper copies in the URL (`?tab=`); Copy/Edit opens the existing follow drawer
  (saving a mandate never trades); copyability for your desk; a plans table linking to each
  plan page and to your proposal review.
- No backend, API, policy, Flash or signing changes in this milestone.

`e2e/ui.e2e.mjs` checks: no sidebar, exactly five header workspaces, local tabs, filter in
the URL and after refresh, leader link to profile, profile tab in the URL, plan links,
browser back/forward, account menu contents, follow drawer, all 16 routes load, tablet
drawer and no horizontal scroll, no console errors.

Open for review: Discover still leads with four featured cards above the table; Watchlist
is a planned tab; Orders has no per-order route yet (`/orders/:id`) — next milestones.

## UI milestone 2: warm theme from the user's mockups (Nov 6, 2026)

Implements the nine mockups the user supplied (Discover Leaders, Proposal Review,
Portfolio, Orders). Frontend only: no backend, API, policy, Flash or signing changes.

- **Theme**: warm near-black surfaces, cream primary buttons, Cormorant Garamond serif
  for page and panel titles (lining figures), pill chips and badges, underline tabs
  (`.utabs`). Tokens live in `app/globals.css`.
- **Shell**: header with the serif PACT⁺ wordmark and five workspaces (Trade · Discover ·
  Proposals · Portfolio · Orders), a network menu (Base/Arc, Flash status, WETH price, live
  orders) and the wallet/account menu (wallet value, desk, settings, activity log, tools).
  Without a wallet the account menu is a separate button, so nothing becomes unreachable.
  A left rail (Leaders, Following, Watchlist·soon, My Plans, Mandate, Settings) on every
  page except Trade. The old status bar and workspace tabs moved into these menus.
- **Discover**: table-first leader list (strategy, assets, live plans, quality, evidence,
  R:R, copyability) with a leader panel on the right; view, search and sort still in the URL.
- **Proposal Review**: chart and the leader's plan side by side, then Your Execution,
  Policy Check and the unchanged signing card.
- **Portfolio**: tiles (wallet value, open PnL from Flash fills, allocated sleeve, active
  leaders), Positions / Exposure / By Leader tabs with leader and pair filters, an exposure
  donut, allocation by leader, and a position detail panel (Position / Execution / Plan /
  Receipt). Open PnL shows "—" until a copy has filled; DEMO desks show no wallet value.
- **Orders** (`/execution`): tiles by status bucket, status tabs, search, leader, pair and
  date filters, 10-row pages, and an Order Detail panel with Execution (fill trajectory,
  fills with transaction links), Policy & Mandate, Trade Plan and On-chain Evidence (the
  browser-verified evidence trail plus evidence.json). Status view and selected order are
  in the URL (`?view=&order=`).

`e2e/ui.e2e.mjs` (22 checks) now covers the rail, the five workspaces, the account menu
without a wallet, the Portfolio tiles and tabs, and the Orders page.

### Milestone 2, follow-up: one leader identity, Watchlist, order links (Nov 6, 2026)

- **One leader identity everywhere**: `LeaderTag` and `leaderName` in `components/ui.tsx`
  (identicon, "Leader XXXX" from the address, link to the profile). Discover, Following,
  Proposals, the desk overview, Trade, plan pages, Portfolio and Orders all use it, so no
  page shows a bare `0x…` where the others show a name.
- **Watchlist** (`/watchlist`, in the rail): star a leader in the Discover table, the leader
  panel or the profile. The page is the Discover table limited to starred leaders. Saved in
  this browser only (`components/watchlist.tsx`, localStorage with an in-memory fallback);
  starring never follows, sizes or copies anything.
- **Canonical order link**: `/orders/<flash order id or receipt id>` opens that order in
  Orders (`/execution?order=`).
- Proposals queue fits without side-scrolling (pair and side under the plan, sizing under
  the approved amount); the Trade filters use the same pill chips as everywhere else.

`e2e/ui.e2e.mjs` is now 26 checks (adds star, watchlist, reload, unstar and the order
link); `components/watchlist.test.ts` covers parsing of stored values.

## World ID: verified-human leaders (Nov 6, 2026)

Implements the decision in `CRITIQUE_AND_WORLD_DECISION.md`: identity only, never trading
authority and never a skill signal.

- **Flow** (World ID 4.0, IDKit `@worldcoin/idkit-core` 4.6.0): the signed-in leader asks
  PACT for an RP signature (`POST /api/world/sign`; the signing key stays on the server),
  IDKit shows a QR code for World App with the leader's address as the signal, and PACT
  forwards the proof to World's `POST /api/v4/verify/{rp_id}` (`POST /api/world/verify`).
- **PACT's own checks** before and after World's: right environment, the
  `pact-verified-leader` action, every response's `signal_hash` equal to the hash of the
  leader's address, World's success flag. Fails closed on any mismatch.
- **One human, one leader address**: the nullifier is stored as a decimal integer in
  `<store>.humans.json`. A second address for the same human, or a second human for the same
  address, is refused (409). The evidence log records `leader.human_verified` with a SHA-256
  digest of the nullifier, not the nullifier itself.
- **Product consequence**: a "Verified human" badge on Discover, the leader panel and the
  profile; a Discover filter; and a follower mandate option, "Copy only leaders verified as
  unique humans", enforced in `decide()` (`LEADER_NOT_VERIFIED_HUMAN`, BLOCK/REVIEW) and in
  the copyability preview.
- **Where a leader verifies**: Publish (My Plans) and Wallet & Autopilot settings.
- **Config**: `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_PRIVATE_KEY` (the RP signing key) and
  optional `WORLD_ENV=staging` for the simulator. Without all three it is off and says
  which value is missing. `WORLD_RP_ID` is not set yet, so no live proof has been verified.

Tests: `lib/world.test.ts` (7: config and key never exposed, request signing, the World
call, signal/action/environment refusal before calling World, World rejection, one human
one address with the evidence event, the policy rule). UI e2e 29 checks.

### World ID tested end to end on World's staging network (Nov 6, 2026)

`e2e/world.e2e.mjs` (`npm run e2e:world`, server started with `WORLD_ENV=staging`): 16/16.
World's simulator (`complete_test_request`) stands in for World App and generates a real
World ID 4.0 staging proof; everything else is the real path. Checked: the RP signature needs
the leader's session; the Publish page shows the QR code; World verified the proof and PACT
bound it; the panel and the profile show the badge; the evidence event carries only a
nullifier digest; a proof bound to another wallet is refused (`WORLD_SIGNAL_MISMATCH`);
verifying for a wallet you are not signed in as is refused (403); the same human backing a
second leader address is refused (409 `HUMAN_ALREADY_BOUND`, also seen across runs); with
"verified humans only" a follower's copy of the verified leader is not held, the unverified
leader's is held (`LEADER_NOT_VERIFIED_HUMAN`). Before this, World's production verify
endpoint recognised the RP id and the bridge accepted a production request signed with the
RP key. A production proof from a real World App has not been run.

## UI consistency pass: one navigation system across every page (Nov 6, 2026)

A crawl of every route found the shell inconsistent from a user's point of view: the rail
showed Discover's sections on every page (nothing highlighted on Proposals, Portfolio or
Orders), Leaders/Mandate/Settings were listed in two places, PACT Assist and the Activity log
were only in the account menu, `/` and `/plans/[id]` sat outside any workspace, settings
pages had no tabs between them, and older pages kept the glass look and lowercase italic
titles. Fixed (frontend only):

- The rail follows the workspace (top group) and keeps "You" (My Plans · Mandate · Settings)
  below; the account menu is now the wallet and the tools. Plan pages belong to Discover and
  go back to their leader; the desk overview belongs to Portfolio.
- Settings has tabs (Wallet & Autopilot · Preferences) as real links.
- Page titles match the navigation (Proposals, Activity log, Settings, Mandate, Demo lab,
  Classic desk, Classic leader ticket); numbered eyebrows removed; legacy glass surfaces
  render as the standard panel; the last purple/blue chart colours are warm.
- Leaders on My Plans and Mandate use the shared leader identity.
- `lib/copyability.test.ts` pinned its clock: its fixtures expired at 16:00 UTC today and the
  policy then (correctly) answered WAIT.

`e2e/ui.e2e.mjs` is 33 checks and now enforces: every page shows where you are in the header
or rail, no destination is listed twice across header, rail and account menu, the rail shows
the current workspace's sections, Settings tabs are links that back returns from.
