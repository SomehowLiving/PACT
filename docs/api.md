# API reference

PACT's HTTP API is served by the app under `/api`. JSON in, JSON out. Writes need a wallet
session cookie (`pact_session`, see [Security](security.md#wallet-sessions)): **401** without
one, **403** for another wallet. Addresses are `0x`-prefixed, 40 hex characters.

## Session

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| POST | `/api/session/nonce` | `{ address }` | `{ message }`: an EIP-4361 message to sign |
| POST | `/api/session` | `{ message, signature }` | Sets the session cookie |
| GET | `/api/session` | — | `{ address, expiresAt }` for the signed-in wallet, or `{ address: null }` |
| DELETE | `/api/session` | — | Signs out |

## Desk state and mandate

| Method | Path | Body / query | Auth | Returns |
| --- | --- | --- | --- | --- |
| GET | `/api/state` | `?follower=` | — | Plans, policies, proposals, decisions, quotes, receipts, verified humans, conduct, spend, tracking |
| GET | `/api/policy` | `?follower=` | — | The follower's mandate (created with defaults if new) |
| POST | `/api/policy` | the full policy | session | The saved mandate; waiting copies are re-decided |
| GET | `/api/positions` | `?follower=` | — | Positions from Flash fills, marked at Flash's exit quote, with totals |
| GET | `/api/agent` | `?follower=` | — | PACT Assist's review queue |

## Plans and proposals

| Method | Path | Body / query | Auth | Returns |
| --- | --- | --- | --- | --- |
| GET | `/api/strategies` | — | — | Published plans |
| POST | `/api/strategies` | `{ leader, side, orderType, qty, entryReferencePrice, stopLossPrice, takeProfitPrice, invalidation, … , leaderFlashOrderId?, leaderTxHashes? }` | leader session | The plan, its evidence, follower copies, Autopilot runs |
| GET / POST | `/api/strategies/[id]/evidence` | `{ flashOrderId?, txHashes? }` | leader session (POST) | The plan's leader evidence |
| GET | `/api/proposals` | — | — | All proposals and decisions |
| POST | `/api/proposals` | `{ strategyId, follower }` | session | Copies an open plan for the follower (Mirror) |

## Quote, order and tracking

| Method | Path | Body / query | Auth | Returns |
| --- | --- | --- | --- | --- |
| POST | `/api/quote` | `{ proposalId }` | session | Flash quote, metrics, reference prices, server guard result; 403 on a BLOCK |
| POST | `/api/order` | `{ proposalId, userSignature, evmPermitSignature?, attachedBracketSignature?, attachedBracketPermitSignature? }` | session | `{ orderId, receipt }` |
| GET | `/api/orders/[id]` | — | — | Refreshes the order (by Flash order ID) from Flash; the receipt |
| POST | `/api/orders/[id]/cancel` | `{ userSignature, orderIds? }` | follower's signature | Cancels the entry and its protection |
| GET | `/api/orders/[id]/evidence` | `?download` | — | The order's evidence bundle (Flash order and fills, decision, quote, trail) |

## Leaders and wallets

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/leaders/[address]` | The leader's record, plans with evidence and paper copies, and conduct (re-checked when stale) |
| GET | `/api/wallets/[address]` | The wallet on Base: ETH/USDC/WETH balances, transactions sent, contract or EOA, USDC/WETH flows over 6 h, last move. DEMO addresses return `{ demo: true }` |

## Market and references

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/market/weth` | `?tf=` WETH/USDC pool: price, 5m and 24h change, 24h volume, liquidity, candles |
| GET | `/api/reference` | Chainlink ETH/USD on Base, the pool price and a Flash quote, with divergence in bps and a status |
| GET | `/api/health` | Flash reachability and the WETH price |
| GET | `/api/preflight` | `?funder=&qty=&buckets=&duration=` Live-run readiness for one wallet: balances, gas and a real Flash quote for a protected TWAP. Never places an order or asks for a signature |

## Evidence

| Method | Path | Query | Returns |
| --- | --- | --- | --- |
| GET | `/api/evidence` | `?thread=proposal:<id>` (or `plan:`, `mandate:`, `leader:`) | That thread's events and their verification |
| GET | `/api/evidence` | `?events` | Every event |

## Autopilot

| Method | Path | Body / query | Auth | Returns |
| --- | --- | --- | --- | --- |
| GET | `/api/autopilot` | `?follower=` | — | Grants (never the key), setup calls, revoke call |
| POST | `/api/autopilot` | `{ follower, chain, hours, maxPerOrderUsd, maxDailyUsd, worldProof? }` | session | A new grant and its setup calls; `worldProof` is required when the mandate asks for World ID approval |
| DELETE | `/api/autopilot` | `{ follower, grantId }` | session | Revoked grant and the on-chain revoke call |
| POST | `/api/autopilot/run` | `{ proposalId }` | session | Runs Autopilot for one proposal (dry run until live) |

## World ID

| Method | Path | Body | Auth | Returns |
| --- | --- | --- | --- | --- |
| GET | `/api/world` | — | — | `{ enabled, app_id, rp_id, environment, actions, missing, verified }` (never the key) |
| POST | `/api/world/sign` | `{ address, purpose: "leader" \| "autopilot" }` | session | An RP signature for one World ID request |
| POST | `/api/world/verify` | `{ address, proof }` | session | `{ verified, verifiedAt }`; 409 if the human already backs another leader |

## Demo

| Method | Path | Returns |
| --- | --- | --- |
| POST | `/api/demo` | Re-seeds the DEMO desks, priced off Chainlink, and returns each case's decision |
