# PACT Product and Terminal Direction

Audit date: November 5, 2026.

## 1. What PACT Is

PACT is a **follower-owned, policy-aware social execution layer** for Definitive Flash. It is not a vault, bot wallet, signal provider, or performance leaderboard.

The core job is simple:

1. A leader publishes a structured trade plan.
2. A follower decides whether that leader is eligible for a slice of the follower's portfolio.
3. PACT evaluates the follower's policy before quoting.
4. The follower reviews a live Flash quote and signs with their own wallet.
5. Flash executes and reports the order; PACT records the decision and receipt.

The product value is not “copy every trade faster.” It is **turning an untrusted social trade idea into a bounded, reviewable execution decision**.

## 2. The Four Data Layers

Every screen must show which layer a number belongs to. Never blend them.

| Layer | Examples | Authority | UI rule |
| --- | --- | --- | --- |
| Leader plan | thesis, entry, stop, target, expiry | leader-declared | Label as declared; not verified performance |
| Market context | OHLCV, liquidity, volume, recent price | data provider | Label source and freshness; never call it an execution quote |
| Follower policy | caps, sleeves, pair/type rules, evidence gate | follower-owned | Show the exact rule that allows, changes, or refuses a copy |
| Execution truth | Flash quote, price impact, typed data, fills, venue, order status | Flash + wallet | Show only after a real quote/order response |

This prevents the product from looking “vibe coded”: the interface becomes an execution workstation with explicit evidence, rather than a collection of decorative cards.

## 3. Capability Matrix

### Definitive Flash upstream capability

Flash currently documents 13 EVM chains plus Solana, advanced orders, EVM quote/approve/sign/submit flow, cross-chain orders when a route is available, and post-trade execution reports. Its documented advanced surface includes market, limit, stop, stop-loss, take-profit, trailing stop, bracket, TWAP, DCA, and cross-chain market orders.

Sources:

- https://flash.definitive.fi/docs/supported-chains
- https://flash.definitive.fi/docs/evm-overview
- https://flash.definitive.fi/docs/post-trade-reporting

### What PACT implements today

| Capability | PACT state | Evidence / limit |
| --- | --- | --- |
| Leader plan publication | Implemented | Strategy store and `/leader` ticket |
| Follower policy decision | Implemented and tested | `ALLOW`, `MODIFY`, `BLOCK`; caps, sleeves, exposure, active-plan, expiry, protection, quality, evidence, and loss-breaker rules |
| Multi-leader allocation | Implemented and tested | Up to 3 open plans total; 1 open plan per leader by default; per-leader mandate support |
| EVM Flash quote flow | Implemented | Quote route requests Flash quote, evaluates price impact and entry drift, then re-runs the wallet guard |
| EIP-712 / Permit2 browser guard | Implemented and tested | Guard tests reject recipient, amount, token, spender, allowance, domain, and deadline tampering |
| EVM order signing and submit | Implemented | Requires follower wallet and a real Flash quote |
| Flash TP/SL attached bracket | Implemented for eligible buy entries | Follower can select Flash bracket or manual exit; leader-exit mirroring is not implemented |
| Order polling and cancellation | Implemented | Flash order status and follower-signed cancel path |
| Live market chart | Implemented for Base WETH/USDC review | GeckoTerminal Base pool OHLCV; market context only, not Flash route/quote truth |
| Base network configuration | Implemented | Chain 8453; WETH/USDC fixture and live market-data resolver |
| Arc network configuration | Configured, not live-validated | Chain 5042 and token addresses are configured; no recorded live PACT quote/fill evidence |
| Other Flash EVM networks | Not implemented in PACT | Flash supports them, but PACT's `Chain` type and wallet configuration only expose Base and Arc |
| Solana | Not implemented in PACT | Current app is EVM-specific: wagmi, EIP-712, ERC-20 approvals, Permit2 |
| Cross-chain Flash orders | Not implemented in PACT | Current quote request uses one chain for source and destination and has no bridge recipient flow |
| Trailing stop / DCA | Not implemented in PACT UI/policy | Flash may support them upstream; PACT does not expose or test them |
| Verified leader track record | Not implemented | No wallet performance index, realized PnL feed, or public leaderboard |
| Live mainnet follower fill recorded by PACT | Not yet evidenced in the repository | Do not claim a completed real follower order/fill until a dedicated small-value run is recorded and inspected |

### Test evidence in this repository

Current automated suite: 47 tests.

| Area | Tests | What is covered |
| --- | ---: | --- |
| Policy engine | 17 | hard refusals, scaling, expiry, exposure, plan quality, evidence gate, loss breaker, quote drift |
| Wallet guard | 19 | typed-data and Permit2 tampering / wrong-recipient defense |
| Flash request shaping | 8 | quote body, order types, resting expiry, bracket payload, execution metrics |
| Store/demo simulation | 3 | multi-leader policy decisions, deterministic scenarios, mandates |

Tests prove local behavior. They do not prove that a production wallet has completed a mainnet fill.

## 4. Supported Scope for the Hackathon Demo

The credible, demoable scope is:

- **Network:** Base first.
- **Pair:** WETH/USDC first.
- **Order types:** TWAP and limit buys first; market refusal shown as a policy choice.
- **Follower action:** review, quote, guard, self-sign, submit.
- **Risk proof:** one policy decision can copy, scale, wait, decline, or request review.
- **Social proof:** follower allocates separate sleeves to multiple leaders rather than blindly following one account.

Arc should be presented as **configured expansion**, not a completed execution story, until a real Arc quote and signing flow are tested. Other Flash chains, Solana, cross-chain, DCA, and trailing stop should be described as upstream possibilities, not PACT features.

## 5. Terminal Information Architecture

PACT should use five product surfaces, not a dashboard full of disconnected cards.

### A. Portfolio (`/`)

Purpose: answer “What can my selected leaders do with my money today?”

- Portfolio budget and allocated sleeves.
- Leader allocation table: leader, sleeve remaining, active plans, current policy state.
- Pending review queue, ordered by expiry and policy urgency.
- Open Flash orders and post-trade status.
- No marketing hero, fake PnL, sparkline, or generic demo tiles.

### B. Review (`/review/[proposalId]`)

Purpose: answer “Should I authorize this specific copy now?”

Three-column desktop workspace:

1. **Left: leader plan** — thesis, declared entry/stop/target, expiry, evidence status, plan quality.
2. **Center: real market context** — actual OHLCV chart, liquidity, volume, data source, freshness, and declared levels overlaid when in range.
3. **Right: follower execution ticket** — requested vs approved size, exact policy result, Flash quote, price impact, entry drift, approvals/signatures, and submit button.

Below the workspace: quote payload/guard checks and, after submit, fill-by-fill Flash execution report.

### C. Mandates (`/follower`)

Purpose: define authority before a trade appears.

- Leader selection.
- Per-leader sizing method, daily sleeve, order types, exit mode.
- Portfolio-wide caps, asset exposure, active-plan limit, entry drift, quality/evidence gates.
- Use progressive sections and a plain “effective policy” summary. Do not mix signing controls here.

### D. Publish (`/leader`)

Purpose: create a legible plan, not a social post.

- Pair, side, order type, amount, entry conditions, stop, target, expiry, invalidation.
- Inline plan-quality validation before publication.
- Optional Flash order evidence lookup with honest status: verified only when PACT can verify it.

### E. Activity (`/history`)

Purpose: audit what happened.

- Proposal, policy result, requested/approved size, quote, order ID, status.
- When Flash returns it: fill price, fill time, venue, fees, and average execution price.
- Do not calculate or display PnL until a reliable accounting source is integrated.

## 6. Visual System

Use a restrained terminal, not a landing page.

- Fixed left navigation on desktop; compact bottom navigation on mobile.
- One dark surface, one border color, one blue interaction color, green/red only for execution state.
- Tables and compact order rows by default. Cards only for an actual workspace or order ticket.
- Monospace for prices, times, sizes, order IDs, and policy codes.
- Every chart must carry source, pair/pool, timeframe, last updated, and an empty/error state.
- Every action must state its effect: `review market`, `request Flash quote`, `sign order`, `cancel order`.
- Remove or quarantine legacy decorative components: orb, generic gauge, synthetic sparklines, and slider demos.

## 7. Build Sequence

1. **Completed, first pass:** `/review/[proposalId]` is now the only place that renders market context, execution levels, Flash quote, guard, and signing.
2. **Completed, first pass:** `/follower` now routes proposal cards into review and no longer exposes an inline signing action.
3. Rebuild `/` as allocation and pending-review table; move simulations behind a dedicated demo/debug route.
4. Expand `Chain` support only after adding the required token maps, wallet chain support, data-source coverage, quote test, and a documented small-value end-to-end test for that network.
5. Add Flash post-trade report fields to receipts and Activity before considering leader scoring or strategy analytics.
6. Add a trustworthy leader-performance source only after the execution record has reliable persistence and accounting.

## 8. Non-Negotiable Claims

PACT may claim:

- Non-custodial, follower-signed EVM copy execution.
- Policy can allow, scale, wait, decline, or review a leader plan before quote/sign.
- Base WETH/USDC market context is shown from a labeled external DEX-data source.
- Flash handles the quoted advanced-order execution flow after the follower signs.

PACT must not claim:

- That copy trading is automatically profitable.
- That leader performance, wallet PnL, or market signals are verified when they are not.
- That every Flash-supported chain/order type is supported by PACT.
- That an external chart price is the Flash route or final execution price.
- That leader exits are automatically mirrored.
