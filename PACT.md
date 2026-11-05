# PACT

**Social strategy execution with a follower-owned risk budget.**

PACT is a non-custodial copy-execution MVP built on [Definitive Flash](https://flash.definitive.fi/docs). A leader publishes a structured plan. Each follower explicitly chooses leaders, applies their own policy, and signs only the Flash orders that fit it. PACT never receives a private key or custody of the follower's funds.

Built for ETHGlobal Mumbai 2026.

## The Product Thesis

People follow traders because they want access to a repeatable strategy, not merely a social feed. But a leader's account size, risk tolerance, timing, and open exposure are not the follower's.

PACT treats copying as a **portfolio allocation decision**:

1. Leaders publish a plan with a thesis, reference entry, invalidation, stop, target, entry expiry, and follower capacity.
2. Followers choose up to three leaders and configure a mandate for each: proportional or fixed sizing, daily sleeve, allowed order types, and follower-managed exit behavior.
3. For every proposed trade, PACT returns `COPY`, `SCALE`, `WAIT`, `DECLINE`, or `REVIEW`.
4. The follower re-checks the Flash typed data in their browser and signs with their own wallet.
5. Definitive Flash executes the order. Eligible buy entries can attach a Flash TP/SL bracket.

PACT does **not** predict returns, rank traders by an invented alpha score, or guarantee that a leader's trade is profitable.

## Why It Matters

Centralized copy-trading products commonly offer allocation, per-trader limits, and copy-level stop-loss controls. PACT's distinction is that the follower's constraints sit before the signature that enables execution:

- no exported private key;
- no server-side trading key;
- no custodian path;
- no blind replication beyond the follower's configured sleeves.

The product is designed for a follower who values participation in a strategy **and** wants a hard, inspectable limit on what any leader can consume.

## What Is Built

### Leader plans

Leader plans require:

- thesis and invalidation;
- reference entry, stop-loss, and take-profit;
- a reward:risk assessment, with `1.5R` available as an opt-in follower gate;
- entry window and separate protection expiry;
- per-follower capacity;
- optional Flash order ID evidence.

Long plans must follow `stop < entry < target`; short plans must follow `target < entry < stop`. Structurally incomplete plans are rejected before publication. A low reward:risk plan is marked as a caution and can be refused if the follower enables that preference.

### Follower policy

The default demo policy on Base is intentionally conservative:

| Control | Default |
| --- | ---: |
| Selected leaders | Up to 3 |
| Default copy mandate | 25% proportional, Flash TP/SL exit |
| Per-order maximum | $30 |
| Daily copy budget | $50 |
| Per-leader daily sleeve | $25 |
| Per-leader realized-loss breaker | $10 / day, off until enabled |
| Same-asset / same-side exposure | $35 |
| Open plans | 3 total, 1 per leader |
| Allowed entries | TWAP and limit buys |
| Max entry drift | 1% |
| Max quote price impact | 0.5% |
| Max slippage | 1% |

Without a leader-specific mandate, sizing follows:

```text
requested = leader notional × copy multiplier
approved = min(
  requested,
  per-order cap,
  remaining daily budget,
  remaining per-leader sleeve,
  remaining same-asset exposure,
  plan capacity
)
```

Hard rule failures—unsupported chain, pair, type, side, expired plan, missing required invalidation, structurally invalid plan, or optional evidence requirement—refuse the trade before a wallet prompt. A reward:risk below the follower's preference is a caution unless that follower enables the stricter gate. A size-only overage can be scaled when the follower enables it.

Each selected leader can override the default with a fixed-dollar or proportional copy size, a leader-specific daily sleeve, a narrower set of permitted order types, and one of two current follower exit modes: **Flash TP/SL bracket** or **manual exit**. PACT does not yet mirror a leader's exit as an executable action, so it does not claim that mode is available.

PACT also has an opt-in per-leader realized-loss circuit breaker. When enabled and recorded
realized losses on closed PACT receipts reach the follower's daily threshold, new proposals
from that leader return `WAIT`. Flash currently provides order and fill information rather
than account-level P&L, so this breaker only activates when a trusted P&L evidence source
records the receipt; PACT does not fabricate P&L from an open position.

### Multi-leader simulation

The Floor's **simulated portfolio run** uses persisted demo data and the same policy function as the real copy path:

- Leader one proposes an $80 TWAP: follower requests $20 and can copy it.
- Leader two proposes a $120 limit: follower requests $30 but is scaled to the $25 leader sleeve.
- Leader three proposes a $40 market order: follower requests $10 but is declined because market entries are not enabled.

This is a policy simulation only. It is not a claim that orders were sent or that a strategy made money.

### Definitive Flash execution

PACT integrates:

- Flash quote and order APIs;
- Flash order-status polling and cancellation;
- EIP-712 entry order signing;
- Permit2 signing and minimal approval transactions;
- browser-side typed-data guard before signing;
- quote-time entry-drift and estimated-price-impact checks;
- attached Flash TP/SL bracket signing for eligible buy entries.

Base is the primary integration. Arc is represented in the app configuration but has not been live-tested.

## Trust and Security Model

- A follower signs every approval, Permit2 message, entry order, and bracket order from their own wallet.
- PACT does not export, store, or request a private key.
- The policy is evaluated server-side for the product decision and the raw signing payload is re-checked client-side before the wallet prompt.
- Pasting a leader Flash order ID can verify that Flash recognizes an order for the leader wallet. It does **not** yet prove that the order exactly matches the published PACT plan.

## Current Limits and Honest Claims

PACT is hackathon MVP software, not a production investment product.

- No audit has been completed.
- The current store is local demo storage, not durable production infrastructure.
- There is no successful real follower order/fill and attached bracket recorded yet; the live quote and full signature flow have been exercised with Flash, but mock-wallet order submission is expected to fail signature verification.
- There is no public performance leaderboard, fake AI signal score, social chat, or verified leader track record.
- World ID, Arkiv/Swarm, 1inch, Uniswap, and Chainlink are research candidates, not current integrations.

## Demo Flow

1. Open the Floor and select **load demo tape**.
2. Show **same trade, your rules**: one leader trade produces different follower outcomes.
3. Show **one follower, three leaders, one risk budget**: one copy, one scaled copy, one type-gated refusal.
4. Publish a disciplined leader plan from **Lead**.
5. In **Follow**, select leaders and set the multiplier, portfolio budget, leader sleeve, exposure, and execution thresholds.
6. Request a Flash quote, inspect the guard steps, and sign only from the follower wallet.

## Local Development

```bash
cd pact
npm install
cp .env.example .env.local
npm run dev
```

Required for live Flash requests:

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

Use only a dedicated plain EOA, Base mainnet, a small USDC balance (roughly $5–$10), and enough Base ETH for approvals. Confirm each prompt, retain the Flash order ID, and inspect entry plus bracket status before describing PACT as having completed a mainnet order.
