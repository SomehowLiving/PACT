# PACT

**Follower-owned social strategy execution.**

PACT is a non-custodial social trading MVP built on Definitive Flash. Leaders
publish structured trade plans; followers decide which leaders they trust and
what risk they are willing to accept. PACT applies the follower’s policy,
checks the exact Flash signing payload in the browser, and the follower signs
only the order that fits their mandate.

PACT does not hold a private key, custody funds, promise returns, or claim that
copying a profitable leader makes a follower profitable.

Built for ETHGlobal Mumbai 2026.

## One-Line Thesis

> Do not copy a leader’s position size. Copy only the part of their plan that
> fits a follower-owned risk envelope and can survive the execution path.

## The Problem

Copy trading fails for followers even when a leader is green. The follower can
receive a worse entry, use unsuitable size, duplicate the same market exposure
through multiple leaders, pay execution costs that erase the edge, or lose
control of the exit.

PACT focuses on these follower-side failure modes:

| Follower risk | PACT response | Status |
| --- | --- | --- |
| Position is too large for follower capital | Portfolio, leader, asset, daily, and open-plan caps | Built |
| Leader entry becomes a worse follower fill | Entry drift becomes the Flash order's limit price (enforced by Flash's engine) | Built |
| Quote has excessive impact or slippage | Quote-time policy gate | Built |
| Plan has no clear invalidation or stop | Structured plan fields and optional quality gate | Built |
| Several leaders create one directional bet | Same-asset/same-side concentration view and cap | Built |
| Follower cannot control exits | Flash TP/SL pair on the follower's position (levels read back and verified) or manual exit | Built for eligible entries |
| Leader claims an order without evidence | Flash `ORDER_FOUND` lookup under leader wallet | Partial |
| Follower cannot see whether copying stayed faithful | Quote, fill, and entry-drift receipt | Built |
| User wants help sorting proposals | Deterministic PACT Assist review queue | Built |

## Market Evidence: Why This Problem Exists

Copy trading is already a large, automated product category rather than a
novel user behavior. The market evidence supports PACT’s narrow claim: the
follower’s outcome can diverge materially from the leader’s outcome, so the
copy mechanism and follower risk envelope deserve independent controls.

| Evidence | What it says | PACT implication |
| --- | --- | --- |
| [90-day multi-exchange outcome report](https://www.yieldfund.com/news/is-copy-trading-profitable-a-90-day-multi-exchange-study) | The publisher reports **100,236** Binance, Bybit, and MEXC copier outcomes: **48.48%** ended profitable; **97.04%** of leaders were green on their own PnL, while only **43.61%** produced positive follower PnL. | A leader’s displayed PnL is not enough. PACT independently controls size, entry bound, impact, and follower exit. |
| [IOSCO Final Report, May 2025](https://www.iosco.org/library/pubdocs/pdf/IOSCOPD793.pdf) | The international securities-regulator body identifies that imitative trading is often associated with short-term, higher-risk strategies and warns that frequent trading fees can erode retail returns. | PACT exposes a specific follower mandate before execution instead of presenting automatic imitation as passive investing. |
| [Binance Copy Trading developer documentation](https://developers.binance.com/en/docs/products/copy-trading/Introduction) | Binance describes copy trading as automated: after the user selects an investment amount, the system automatically copies followed leaders’ trades. | PACT deliberately starts with review-and-self-sign; its future Autopilot must be constrained by a follower-owned session permission, not a generic bot key. |
| [Hyperliquid vault leader documentation](https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/vaults/for-vault-leaders) | Legacy vault leaders receive a **10%** profit share and must retain at least **5%** of vault capital. | Incentives and skin-in-the-game matter, but PACT does not pool follower funds or treat a leader incentive as a substitute for follower-specific risk controls. |
| [Social-learning trading-network study](https://arxiv.org/pdf/2507.01817) | The authors report that users can select traders based on popularity even when popularity is poorly correlated with performance, with static mirroring associated with underperformance. | PACT’s discovery story should emphasize plan evidence, policy compatibility, and execution fidelity—not follower count or a social leaderboard. |

### How To Read These Numbers

The `100,236`-outcome report is a useful directional market signal, but it is
publisher-produced rather than an independently audited industry dataset. PACT
uses it to motivate a **testable product hypothesis**, not as a promise or a
universal statistic:

> Even if a leader’s idea is valid, a follower can lose because their entry,
> size, execution cost, portfolio context, and exit are different.

The IOSCO report is the stronger source for the general retail-risk framing.
The platform documents establish how current products automate copying and
incentivize leaders; they do not validate PACT’s performance.

## Product Model

```text
Leader publishes a declared plan
        ↓
Follower chooses leaders and configures a mandate
        ↓
PACT policy returns COPY / SCALE / WAIT / DECLINE / REVIEW
        ↓
PACT Assist may queue eligible items for review
        ↓
Follower requests a Flash quote
        ↓
PACT checks the returned quote and browser verifies typed data
        ↓
Follower self-signs approvals, permits, entry, and eligible bracket
        ↓
Flash executes; PACT records fills and execution fidelity
```

PACT is currently a **review-and-self-sign** system. It is not an unattended
copy bot.

## What Is Built

### 1. Leader Plans

Leaders publish:

- thesis and invalidation;
- reference entry, stop-loss, and take-profit;
- entry expiry and separate protection expiry;
- follower capacity;
- side, chain, pair, order type, quantity, TWAP duration, optional buckets,
  optional start time, and optional price bound;
- optional Flash order ID evidence.

Plan structure is validated before publication:

```text
long:  stop < entry < target
short: target < entry < stop
```

PACT grades plans as `DISCIPLINED`, `CAUTION`, or `INCOMPLETE`. Followers can
choose whether a low reward:risk plan is merely a warning or an explicit block.

`ORDER_FOUND` means Flash returned an order when queried using the publishing
leader as funder. It does **not** mean PACT has verified that every plan field
matches that Flash order.

### 2. Follower Mandates

Followers select up to three leaders and can configure global controls plus a
leader-specific mandate.

| Control | Default demo value |
| --- | ---: |
| Selected leaders | Up to 3 |
| Default sizing | 25% proportional |
| Default stop-risk budget | $2 planned loss at declared stop |
| Per-order cap | $30 |
| Daily cap | $50 |
| Per-leader daily sleeve | $25 |
| Same-asset / same-side exposure | $35 |
| Open plans | 3 total, 1 per leader |
| Allowed entries | TWAP and limit buys |
| Maximum entry drift | 1% |
| Maximum quote price impact | 0.5% |
| Maximum market slippage | 1% |

Each leader can use one of three sizing modes:

1. **Proportional** — a fraction of the leader’s notional.
2. **Fixed USD** — a fixed follower notional.
3. **Stop-risk budget** — a maximum planned loss at the leader’s declared stop.

All paths still pass through portfolio, daily, leader, asset-exposure, plan
capacity, and minimum-size controls.

### 3. Stop-Risk Sizing

Stop-risk sizing is PACT’s strongest follower-specific sizing mechanism.

```text
risk per target unit = abs(entry - stop)
target units = follower risk budget / risk per target unit

buy Flash qty  = target units × entry, denominated in USDC
sell Flash qty = target units, denominated in the target asset
```

PACT then applies all caps. If entry or stop is missing or invalid, PACT returns
`REVIEW` rather than inventing a size.

This is a **planned-loss estimate**, not a guaranteed maximum loss. Gaps,
partial fills, execution costs, and an unfilled stop can produce a larger
realized loss.

### 4. Flash Execution Controls

PACT integrates Flash quote, order, order-status, and cancellation paths.

For a follower quote, PACT applies:

- market slippage limits where relevant;
- advanced-order price-impact limits, sent on the quote **and** echoed on submit;
- follower `maxEntryDrift` converted into the order's Flash limit price
  (`limitNotionalPrice`, or `limitCrossPrice` on a limit entry with protection,
  which Flash requires):
  - buy: maximum acceptable execution price;
  - sell: minimum acceptable execution price;
  - a stricter leader price bound wins;
- an **execution-cost budget**: Flash's estimated fees (platform + network +
  integrator) as a share of size, checked separately from drift (default 3%);
- copies that never outlive the plan: a resting copy expires with the leader's
  copy window, and a TWAP copy finishes inside it;
- TWAP duration, optional bucket count, and optional start-time shaping;
- an attached Flash TP/SL pair for eligible buy entries when the follower
  chooses bracket exit; its expiry is never earlier than the entry's.

For TWAP, `durationSeconds` is quote-only. `twapBucketCount`, `startTime`, and
the applicable price bound are echoed on order submission. PACT does not send
TWAP `expireTime` or trigger fields.

**Who enforces what.** The limit price and the TP/SL triggers are enforced by
**Flash's execution engine**. They are not part of the follower's signature: a
Flash order signature binds the tokens, the maximum spend, the recipient (the
follower), the fee vault and the deadline. So PACT reads the live TP/SL levels
back from Flash after submit and flags any difference from what the follower
chose, and every receipt carries a MATCH / MISMATCH verdict for the price bound,
fees, recipient, integrator fee and protection levels.

### 5. Browser-Side Signature Guard

PACT checks the raw Flash payloads both server-side and in the follower browser
before any wallet prompt: the entry order **and** the protection pair's approval,
permit and order. The guard verifies, among other things:

- follower recipient and swapper on every order;
- expected tokens and chain (the protection sells what the entry buys);
- policy-approved amount, and a bound on what the protection may sell;
- Permit2 or direct-approval target and amount;
- the integrator fee vault, when pinned (`NEXT_PUBLIC_FLASH_VAULT`);
- signing domain and future deadline.

What the guard proves is **where funds can go**, not at what price: even a
tampered price or trigger can only mis-time a trade back into the follower's
own wallet.

PACT never stores, exports, or requests a follower private key. A blocked plan
never calls Flash quote or order endpoints. Cancelling a copy cancels the entry
**and** its live protective order with one signature (Flash batch cancel).

### 6. Execution Fidelity Receipts

PACT treats leader intent, market context, Flash quote, and filled execution as
separate evidence layers.

For a submitted order it records:

- leader declared entry;
- follower Flash quoted execution price;
- Flash order ID, status, close reason, transaction IDs, and TWAP progress;
- fill rows and weighted average fill price when fills are available;
- follower entry drift in basis points;
- requested / approved notional and policy decision.

This is not a PnL claim. It answers a narrower, useful question:

> Did the follower’s actual execution remain faithful to the mandate they approved?

### 7. Multi-Leader Portfolio Context

PACT shows the follower’s approved capacity by same asset and same direction,
including the percentage of approved capacity and the number of contributing
leaders.

Example:

```text
Approved capacity: $45
WETH buy exposure: $35 · 78% · 2 leaders
```

PACT deliberately does not manufacture a correlation coefficient, Sharpe
ratio, trader score, or performance forecast from insufficient history.

### 8. PACT Assist

PACT Assist is optional. When enabled, it scans the existing follower proposal
set and maps stored policy results into:

- `PREPARE_REVIEW` for `ALLOW` and `MODIFY`;
- `HOLD` for `WAIT` and `REVIEW`;
- `DECLINE` for refused plans.

Assist is deterministic policy orchestration, not an autonomous trading model.
It can open the normal review flow, but it cannot:

- alter a policy, leader set, token allowlist, or risk budget;
- request a quote;
- sign typed data;
- submit or cancel an order;
- access a private key or session key.

## Learning Loop

PACT’s current learning is **evidence learning**, not self-training or a claim
of predictive AI.

### What PACT Learns and Stores

Over completed Flash orders, PACT can accumulate first-party execution facts:

- declared entry versus quoted entry;
- quoted entry versus average fill;
- entry drift in basis points by leader, pair, order type, and direction;
- quote impact and terminal close reasons;
- requested size versus policy-approved size versus filled size;
- plan completeness and repeatability of declared stop/target/invalidation.

### What This Enables Later

Once there is enough real receipt history, PACT can surface factual execution
quality such as:

- “This leader’s TWAP plans have historically stayed within X bps of declared
  entry for this follower.”
- “This style frequently exceeds the follower’s quote-impact threshold.”
- “Two selected leaders repeatedly create the same long-asset concentration.”

These must remain descriptive, with source receipts available. PACT must not
turn a few fills into a “safe leader” or “will make money” score.

### Future Adaptive Policy Principle

Any future learning system may **recommend** a tighter cap, lower risk budget,
or manual review. It must never silently widen risk, change a follower mandate,
or activate execution authority. The follower remains the policy owner.

## Assist Versus Autopilot

| Capability | PACT Assist | Future Autopilot |
| --- | --- | --- |
| Scan and explain policy decisions | Yes | Yes |
| Queue review items | Yes | Yes |
| Sign / submit an order | No | Only with delegated authority |
| Cancel or unwind | No | Only with scoped delegated authority |
| Holds follower EOA key | Never | Never |

Autopilot is **not available** today. It requires a follower-owned smart
account with a revocable, short-lived, onchain-scoped session key. The session
must restrict Flash contracts, chain, assets, sides, order types, limits,
expiry, no-withdrawal behavior, and revoke path. See
`pact/AGENT_AUTOMATION_ARCHITECTURE.md` for the required gates.

World ID may later be a step-up confirmation before a user enables a material
Autopilot mandate. It is not wallet authorization and cannot replace a session
permission.

## Honest Constraints

PACT is hackathon MVP software, not production investment infrastructure.

- No security audit has been completed.
- State is local JSON demo storage, not durable multi-user persistence.
- Base is the primary configured path; Arc is configured but not live-tested.
- The repository does not contain a recorded successful real follower mainnet
  fill and attached bracket report yet.
- The loss breaker can refuse future copies when trusted realized-PnL evidence
  exists; it is not a full live portfolio drawdown engine.
- PACT has no leader-performance leaderboard, verified historical wallet PnL,
  full plan-to-order equivalence check, or statistical correlation engine.
- Current Base WETH/USDC flow is spot-style execution. PACT does not claim
  leverage limits, liquidation protection, or funding-rate controls.
- No automatic copy execution, automatic cancellation, or automatic unwind is
  available.

## App Surfaces

| Surface | Purpose |
| --- | --- |
| `/` | Portfolio floor, policy simulation matrix, market/Flash health, demo loading |
| `/leader` | Publish a structured Flash-shaped leader plan |
| `/follower` | Choose leaders, set mandates, use Assist, and inspect concentration |
| `/review/[proposalId]` | Compare declaration, real Base WETH/USDC market context, policy, Flash quote, guard, and signing flow |

## Demo Runbook

1. Start at `/` and select **load demo scenario**.
2. Show the deterministic policy outcomes: approved, scaled, blocked, expired,
   low reward:risk, evidence-required, and unsupported-pair cases.
3. In `/follower`, select multiple leaders and show sleeves, stop-risk budget,
   concentration, and the optional Assist scan.
4. Open an approved proposal in `/review/[proposalId]`.
5. Show declared plan levels, real market context, follower execution bound,
   and the browser-side signature guard.
6. Use a dedicated funded follower wallet to request a Flash quote and,
   only after manually verifying the prompts, sign the entry and eligible
   bracket.
7. Show order status, TWAP slice progress, fills, and execution-fidelity
   receipt.

## Running Locally

```bash
cd pact
npm install
cp .env.example .env.local
npm run dev
```

Flash requests require:

```text
FLASH_API_KEY=...
```

Validation:

```bash
npm test
npm run lint
npx tsc --noEmit
```

## Before Using Real Funds

Use a dedicated plain EOA, Base mainnet, a small USDC balance, and enough Base
ETH for approval transactions. Start with a small WETH/USDC TWAP and an
attached follower bracket. Confirm every wallet prompt, retain the Flash order
ID and transaction hashes, and inspect order/fill status before claiming that
PACT has completed a live mainnet execution.

## Related Design Documents

- `pact/PRODUCT_DIRECTION.md` — terminal information architecture.
- `pact/CRITIQUE_AND_WORLD_DECISION.md` — critique response, Flash facts, and
  World decision.
- `pact/FOLLOWER_OUTCOME_STRATEGY.md` — follower-risk product strategy.
- `pact/AGENT_AUTOMATION_ARCHITECTURE.md` — Assist and future Autopilot
  authority model.

## External Sources

- YieldFund, *Is Copy Trading Profitable? A 90-Day, Multi-Exchange Study*:
  https://www.yieldfund.com/news/is-copy-trading-profitable-a-90-day-multi-exchange-study
- IOSCO, *Online Imitative Trading Practices: Copy Trading, Mirror Trading,
  Social Trading* (May 2025):
  https://www.iosco.org/library/pubdocs/pdf/IOSCOPD793.pdf
- Binance Developer Docs, *Copy Trading Introduction*:
  https://developers.binance.com/en/docs/products/copy-trading/Introduction
- Hyperliquid Docs, *For Vault Leaders (Legacy)*:
  https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/vaults/for-vault-leaders
- Joseph et al., *When Influence Misleads: Informational and Strategic Limits
  of Social Learning in Trading Networks* (arXiv preprint):
  https://arxiv.org/pdf/2507.01817
