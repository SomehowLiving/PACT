# Architecture (48-hour MVP)

## One sentence

Leader posts a Flash-shaped strategy; follower policy decides; follower wallet signs; Flash fills on Base.

## Diagram

```
Leader wallet                Follower wallet
     |                            |
     v                            v
[Leader UI]                 [Follower UI]
  post strategy               set policy JSON
     |                            |  signTypedData only if ALLOW/MODIFY
     v                            v
           [PACT API]
           - stores strategies, policies, proposals, decisions, receipts
           - holds FLASH_API_KEY (integrator)
           - runs decide()
           - POST /quote  (after ALLOW/MODIFY)
           - POST /order  only with follower userSignature
           - GET /orders/{id}
                     |
                     v
              Flash API  → Base fill
                     |
                     v
              receipt.transactionId
```

No PACT-held private key that can spend follower funds.

## Packages at hour 0

One Next.js app (App Router) is enough.

| Path | Job |
| --- | --- |
| `lib/policy.ts` | `decide()` + tests |
| `lib/flash.ts` | search, quote, order, getOrder. Server-only |
| `app/leader/page.tsx` | Form: pair, side, type, qty, duration |
| `app/follower/page.tsx` | Policy view, proposal cards, Sign |
| `app/api/strategies/route.ts` | POST/GET |
| `app/api/proposals/route.ts` | Create from strategy + policy |
| `app/api/quote/route.ts` | Flash quote if verdict allows |
| `app/api/order/route.ts` | Flash order if verdict allows + signature present |
| `app/api/orders/[id]/route.ts` | Poll |

In-memory `Map` or sqlite file is fine. No Postgres.

Stack: Next.js, TypeScript, viem, wagmi, Tailwind. Match your usual stack.

## Trust table

| Actor | Trust | May |
| --- | --- | --- |
| Leader | Untrusted | Post strategy JSON |
| LLM | Untrusted | Draft proposal fields |
| Policy engine | Trusted | Return verdict |
| Follower wallet | Signer | EIP-712 + approveTx |
| PACT server | Semi-trusted | Integrator key, refuse BLOCK |
| Flash | Execution after signature | Pull signed amount |

Stolen integrator key ≠ stolen user funds. Stolen follower key is out of scope (wallet compromise).

## Data flow for ALLOW

1. Leader POST strategy `{ twap, buy, 25 USDC, WETH, 600s }`
2. Follower has policy loaded
3. Server builds proposal, `decide()` → ALLOW
4. Server `POST /quote` with follower as `funderAddress`
5. UI shows green + quote notional
6. If `approveTx`, follower sends it
7. Follower signs `orderTypedData`
8. Server `POST /order`
9. UI polls until a `transactionId` exists

## Data flow for BLOCK

1. Leader posts market 500 USDC
2. `decide()` → BLOCK `ORDER_TYPE_NOT_ALLOWED`, `SIZE_EXCEEDS_MAX`
3. UI red, Sign disabled
4. Server never quotes (or quotes only for display **without** a submit path). Safer: **no quote, no order**
5. Receipt: `flashOrderId` absent

## Out of MVP

ENS, Arkiv, World ID, 1inch Aqua, cross-chain, Solana, brackets, DCA, copy of a live public wallet, leaderboards, backtests, session keys.

## Chamber (what you say in Q&A)

Chamber: deposit into a vault; manager or one delegated trader acts inside onchain guards.  
PACT: tokens stay in the follower EOA; each Flash order is a new signature.  
https://docs.chamberfi.com/concepts/vaults-as-guardrails.md
