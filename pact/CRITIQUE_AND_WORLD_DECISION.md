# PACT Critical Review and World Decision

Review date: November 5, 2026.

## Executive Decision

The critique is directionally right: PACT should not compete as another generic copy-trading product. Its credible wedge is **verified execution mandates**:

> A follower gives a leader bounded authority over *which plans may be proposed*, while the follower’s policy and wallet retain authority over *what may execute*.

That framing is stronger than “safe copy trading,” but only if PACT remains honest about the current interaction model: it is **review-and-self-sign execution**, not unattended mirroring.

World is a good fit only when it is a real trust primitive in this model. The recommended integration is:

1. A public leader must prove they are a **unique human** before appearing in the discoverable leader directory.
2. A public copy-eligible plan must have separate **Flash order evidence** that matches the leader and plan fields.
3. A follower uses a fresh World step-up only for a **mandate escalation**—for example enabling a higher-risk mode, raising a material cap, or allowing an agent to change mandate settings.

World must not be used as a generic login badge, trading-suitability check, performance score, or substitute for wallet authorization.

## 1. What the Critique Gets Right

### Copy trading is not the wedge

Large CEX copy systems and non-custodial onchain systems already offer leader discovery, sizing controls, budgets, and drawdown protection. Dexly’s public materials, for example, advertise non-custodial copying, per-follow budgets, and drawdown-protection auto-pausing. PACT cannot win by claiming that a follower can set a dollar cap.

PACT’s differentiated claim should be the combination of:

- a structured leader declaration;
- independent follower policy evaluation;
- explicit separation of declared plan, market data, policy, and execution truth;
- browser-side inspection of the exact Flash payload before a wallet signs; and
- Flash advanced-order execution with no PACT-held private key.

### Multi-leader sleeves are product-relevant

Users rarely obtain a robust result by allocating all risk to one trader. PACT’s per-leader sleeve, portfolio daily cap, same-asset exposure cap, and open-plan limit are the beginning of a real portfolio construction story. The UI should explain allocation and concentration, not present a social feed.

### A recorded live execution matters more than another feature

The current repository does not contain a recorded end-to-end mainnet follower fill. Until it does, PACT should say “Flash quote/sign/submit path implemented,” not “proven copy execution.” A small Base WETH/USDC TWAP with an attached follower bracket, a recorded order ID, transaction hash, and `GET /orders/{id}` execution report would be the strongest demo artifact.

The team must execute that transaction themselves from a dedicated funded wallet. Do not put a private key in the repository, a chat, or a public recording.

## 2. Verified Flash Facts and Code Gaps

Official Flash sources used for this review:

- https://flash.definitive.fi/docs/twap-order
- https://flash.definitive.fi/docs/evm-overview
- https://flash.definitive.fi/docs/api-reference/flash/quote
- https://flash.definitive.fi/docs/api-reference/flash/order
- https://flash.definitive.fi/docs/post-trade-reporting

### Confirmed TWAP behavior

| Assertion | Status | PACT implication |
| --- | --- | --- |
| Buy `qty` is in contra-asset units; sell `qty` is target units | Confirmed | PACT’s buy sizing in USDC is aligned; do not convert it to WETH |
| `durationSeconds` is required for TWAP, minimum 300 seconds, and quote-only | Confirmed | Current quote shaping is correct to omit it on submit |
| `twapBucketCount` is optional, 2–2560, and must be echoed on submit | Confirmed | Implemented end-to-end with validation and leader UI input |
| `startTime` must be echoed on submit when used | Confirmed | Represented through strategy, proposal, quote, and submit APIs; no leader scheduling input yet |
| `limitNotionalPrice` or `limitCrossPrice` may bound TWAP; only one may be used | Confirmed | Implemented as a follower-specific `limitNotionalPrice`; a stricter leader bound is preserved |
| TWAP does not accept `expireTime` or triggers | Confirmed | PACT quote shaping correctly avoids `expireTime` for TWAP; do not map plan expiry directly into Flash `expireTime` |
| Attached brackets work on market, limit, and TWAP entry orders | Confirmed in Flash docs and PACT request shaping | Current PACT supports eligible buy-entry brackets; validate with a small real fill |
| `funderAddress` is required to produce EVM signing payload | Confirmed | Current quote route correctly passes the follower address |
| Flash returns either direct approval or Permit2 material depending on the quote | Confirmed | Current code handles both paths; the guard must keep inspecting returned payloads rather than assuming one route |

### Corrections to the supplied request example

1. The Base WETH address must be the 42-character address `0x4200000000000000000000000000000000000006`. Do not copy a malformed expanded address from a slide or note.
2. A 12-bucket TWAP is valid when `twapBucketCount` is carried into the proposal and echoed unchanged to `POST /order`; PACT now validates this range.
3. “Leader said 3,950, therefore only fill at 3,950” is not the same as a follower’s 0.5% drift policy. PACT derives a maximum acceptable buy price or minimum acceptable sell price and preserves any stricter leader bound.
4. For TWAP, label the Flash control **maximum price impact**, not slippage. Market orders use slippage tolerance; price impact is the relevant advanced-order field here.

### Concrete PACT engineering gaps

| Gap | Why it matters | Priority |
| --- | --- | --- |
| No stop-risk sizing mode | Fixed/proportional sizing does not ensure the follower can survive the declared stop | P0 |
| Leader schedule input does not expose `startTime` | An optional Flash scheduling feature is represented in APIs but not configurable by a leader | P2 |
| Activity stores only basic fill fields | Flash can supply average price, fees, venues, and fill timestamps | P1 after live fill |
| Order polling is per-card REST polling | Can create needless rate pressure | P2; confirm and adopt Flash order WebSocket if available to this integration |
| Leader evidence only verifies an order association, not yet full plan equivalence | “Leader skin in the game” cannot be claimed until pair, side, order type, size/window, and ownership are compared | P0 |
| Policy breaker can block new proposals but cannot autonomously cancel live orders | PACT intentionally holds no signing authority | P0 for product honesty |

## 3. Important Constraint: No Standing Authority Means No Cheap Auto-Execute

The suggestion to auto-execute every `ALLOW` result is productually compelling but **not currently implementable as a small toggle**.

Today, Flash requires a follower EIP-712 signature for an order, and PACT deliberately holds neither the follower private key nor a delegated signing authority. A server that automatically submits future signed orders would require one of the following:

- a scoped smart-account/session-key design;
- a delegated-account/EIP-7702 design accepted by Flash and fully guarded by PACT; or
- a pre-authorized order construction model that Flash explicitly supports for this workflow.

Each changes PACT’s threat model, consent model, and demo claim. World proof does not solve this cryptographic authorization problem.

Therefore the hackathon product must say:

- **Current mode:** proposal → policy → review → follower self-signs.
- **Future fast lane:** scoped delegated authority under the same policy, only after a separate security design and explicit follower consent.

The compelling current UX is not “hands-free copy trading.” It is **one-click, evidence-rich self-custody review of a bounded mandate**.

## 4. Evidence Must Be the Load-Bearing Differentiator

Make a plan copy-eligible only when it meets both conditions:

1. **Leader identity evidence:** the Flash order belongs to the leader address.
2. **Plan equivalence evidence:** the Flash order’s chain, assets, side, order type, amount, and applicable timing/price controls match the published plan within clearly declared tolerances.

The UI must show independent statuses, never one vague “verified” badge:

| Status | Meaning |
| --- | --- |
| `leader declared` | A leader wrote a plan; no external evidence exists |
| `Flash order found` | Flash recognizes an order for the leader address |
| `plan matches order` | PACT compared allowed fields and found a match |
| `unique human` | World proves one human account; it does not prove skill or profitability |

For the hackathon, allow a follower policy to require `plan matches order`. This is better than making it universal, because it demonstrates follower choice and allows an honest comparison between strict and flexible mandates.

## 5. Competitor Mapping: Keep, Counter, Defer

### Keep now

- Per-leader dollar sleeves and portfolio-wide caps.
- Fixed-dollar and proportional sizing.
- Active-plan and same-asset exposure limits.
- Entry drift / price-impact refusal.
- Policy refusal with explicit reason.
- Follower-controlled bracket versus manual exit.
- Pause new copying from a leader when the breaker is tripped.

### Counter with an honest PACT claim

| Competitor pattern | PACT counter |
| --- | --- |
| CEX leaderboard / profit share | PACT is not a leaderboard. It proves the source/order relation and separates it from follower policy. |
| Custodial or pooled vault capital | Follower funds remain in the follower wallet; PACT never receives a trading key. |
| Automatic copying | PACT currently prioritizes bounded review and explicit signature. Do not pretend it matches latency-oriented mirroring. |
| Basic copy-risk settings | PACT combines policy controls with inspection of the actual EIP-712 / Permit2 payload the wallet will sign. |

### Defer

- Public performance ranking and PnL claims.
- Profit sharing, leader monetization, or a fee split.
- Autonomous breaker cancellation.
- Trailing stop, DCA, Solana, cross-chain, or all Flash chain support.
- Auto-rebalancing and portfolio optimization.

### Breaker and batch cancel correction

PACT can automatically refuse *new* proposals after a breaker trips because that is a server-side policy decision. It cannot automatically cancel live orders without a follower signature. If Flash batch-cancel is available, use it as a **follower-initiated emergency action**: “cancel eligible open orders for this leader,” one wallet signature, explicit scope. Do not market it as autonomous unwind.

## 6. World: Does It Make Sense?

### Verdict: yes, but only as identity-bound eligibility and step-up approval

ETHGlobal Mumbai’s World criteria emphasize a meaningful action that needs human identity or a fresh human approval layer—not login added for decoration. The prize page specifically highlights World ID Agent Pass and IDKit trust moments, and notes that hackathon proofs use fake identities and are not production proof.

Source: https://ethglobal.com/events/mumbai/prizes/world

### Recommended World flow: Verified Public Leader

**Trust moment:** a leader changes a private plan into a discoverable, copy-eligible public mandate.

1. Leader publishes a structured plan.
2. PACT asks for a World Proof of Human / Agent Pass check.
3. PACT requires Flash evidence for the leader’s own matching order.
4. Only then is the leader eligible for the public directory and for follower policies that require strict evidence.

This protects against a farm of throwaway signal accounts and makes leader distribution fairer without collecting a name, email, passport number, or custodying funds.

### Optional second World flow: Mandate Escalation

Require a fresh World step-up when a follower attempts to:

- materially raise a daily or per-leader sleeve;
- enable a future delegated fast lane;
- allow a newly discovered public leader; or
- use a batch-cancel emergency action through an agent interface.

This is a good Agent Pass demonstration because an agent can prepare the change, but the application asks the unique human for fresh approval at the exact authority-escalation moment.

### What World must not be used for

- A generic “sign in with World” button.
- Calling a leader “verified trader,” “safe,” or “profitable.”
- KYC, accredited-investor, jurisdiction, or suitability claims.
- Allowing an agent to bypass wallet signature requirements.
- Production anti-sybil guarantees with hackathon sandbox/mock proofs.

### World fit score

| Proposed use | Fit | Why |
| --- | ---: | --- |
| Login-only | 1/10 | Cosmetic; fails the trust-moment requirement |
| Unique-human leader directory | 8/10 | Directly reduces leader-sybil spam and pairs naturally with Flash evidence |
| Fresh mandate-escalation step-up | 8/10 | Real consent moment, especially with Agent Pass |
| Trading authorization substitute | 0/10 | World identity is not a wallet signature or delegated trade authority |

## 7. Ranked Hackathon Scope

### P0: must ship and demo

1. Record one small-value Base WETH/USDC follower TWAP with attached bracket. Save the Flash order report and transaction hash outside secrets.
2. Make strict leader evidence meaningful: compare the submitted plan to the leader’s Flash order before labeling it matched.
3. Add stop-risk sizing based on follower risk budget and declared stop, then apply every existing cap.
4. Show a live TWAP order state: order ID, `completedFillCount / twapBucketCount`, fill rows, average execution price when returned, and close reason when terminal.
5. Add execution-fidelity receipts: leader declared entry, follower quote, average fill, and drift in basis points.

### P1: only after P0 works

6. Add leader-level pause/resume for future proposals and a follower-signed batch-cancel workflow if Flash confirms availability for this account.
7. Add transparent integrator-fee display. Keep it at 0 for the demo unless the exact fee lifecycle has been tested; if nonzero, use the exact same string in quote and submit.
8. Use Flash search during publishing to resolve token metadata and surface any documented risk flag, after validating the actual response schema with the project API key.

### P2: explicitly future work

10. Scoped delegated fast lane / auto-execution.
11. Trailing-stop follower exit mode.
12. WebSocket order updates, multi-chain expansion, Solana, cross-chain, and public leader performance analytics.
13. World’s Verified Public Leader flow with visibly separate `unique human` and `Flash plan matches order` states.

## 8. Demo Narrative

“Social trading normally asks you to trust a leaderboard. PACT asks a different question: *what authority are you willing to give this leader over your wallet?* The leader publishes a plan and may provide a Flash order that PACT can find under the leader wallet. The follower gives each leader a separate sleeve. PACT checks the follower’s rules, bounds the execution price, and lets the follower sign only the Flash order that fits. The follower’s wallet remains the final authority.”

## 9. Questions for Definitive

Ask before implementing beyond P0:

1. Which order-status WebSocket endpoint, authentication method, and subscription key should this integration use?
2. Is batch cancel supported for this integrator account, what exact request/signature shape does it require, and is there a 25-order limit?
3. Does `GET /orders/{id}` expose all fields needed to compare a leader plan (assets, side, order type, amount, limit, start time, duration, bucket count) to a published PACT plan?
4. For a TWAP attached bracket, what exact activation and cancellation lifecycle should PACT display?
5. Is a Flash-supported scoped/session authorization design available for an integrator that wants a future follower-authorized fast lane, without holding a private key?
