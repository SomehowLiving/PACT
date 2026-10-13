# Policy engine

The engine is a **pure function**. No network, no Flash, no LLM. Unit-test it before the UI.

Flash will not enforce this. Triggers, limits, and TWAP schedules are offchain in Flash and **not** in the EIP-712 payload ([non-custodial.md](https://flash.definitive.fi/docs/non-custodial.md)). The only enforcement that exists is: **BLOCK never produces a signature or a `POST /order`.**

## Function

```ts
decide(proposal, policy, dailySpentUsd): Decision
```

`dailySpentUsd` is the sum of PACT receipts for this follower since UTC midnight, **not** the leader’s claimed volume.

## Types

See [`../specs/data-model.md`](../specs/data-model.md). Verdicts: `ALLOW` | `MODIFY` | `BLOCK`.

## Rule order (deterministic)

Run in this order. First BLOCK wins. Reasons are an array of codes (show them in the UI).

1. `proposal.chain === policy.chain` else `CHAIN_NOT_ALLOWED`
2. Pair key `${target}:${contra}` in `policy.allowPairs` else `PAIR_NOT_ALLOWED`
3. `proposal.orderType` in `policy.allowOrderTypes` else `ORDER_TYPE_NOT_ALLOWED`
4. `proposal.side` in `policy.allowSides` else `SIDE_NOT_ALLOWED`
5. If `proposal.maxSlippage` (or `maxPriceImpact`) > policy max → `SLIPPAGE_TOO_HIGH`
6. If `proposal.notionalUsd > policy.maxNotionalUsd` → if `policy.allowModify` and remaining budget ≥ `policy.minNotionalUsd`, **MODIFY** clip `qty`; else `SIZE_EXCEEDS_MAX` BLOCK
7. If `dailySpentUsd + notionalUsd > policy.maxDailyUsd` → same MODIFY-or-BLOCK with `DAILY_CAP`
8. Optional: `riskFlagged` from search → BLOCK `ASSET_RISK_FLAGGED`

MODIFY clips `qty` so notional equals `min(maxNotionalUsd, maxDailyUsd - dailySpentUsd)`. Re-quote after MODIFY with the clipped qty. Do not reuse the oversized `quoteId`.

## MVP policy (hardcode in the demo)

```json
{
  "chain": "base",
  "maxNotionalUsd": 30,
  "maxDailyUsd": 50,
  "minNotionalUsd": 5,
  "allowModify": true,
  "allowPairs": [
    "0x4200000000000000000000000000000000000006:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
  ],
  "allowOrderTypes": ["twap", "limit"],
  "allowSides": ["buy"],
  "maxSlippage": "0.05",
  "maxPriceImpact": "0.05"
}
```

Demo ALLOW: TWAP buy 25 USDC WETH.  
Demo BLOCK: market buy 500 USDC (`ORDER_TYPE_NOT_ALLOWED` and `SIZE_EXCEEDS_MAX`).

Market is **not** in `allowOrderTypes` so the 500 USDC market is a clean red card even if someone later raises the size cap.

## What the LLM may do

Draft a `Proposal` from a leader strategy (map “buy eth with 25 bucks over 10 minutes” → Flash fields). It must **not**:

- Change `Policy`
- Call `/order`
- Hold `userSignature`
- Override `decide()`

Treat the model as untrusted input, same as the leader.

## Test vectors

[`../specs/policy-cases.json`](../specs/policy-cases.json) — implement these as unit tests at hour 12. If a case fails, the product is lying.

## UI contract

| Verdict | Sign button | Server `/order` |
| --- | --- | --- |
| ALLOW | enabled | allowed with matching quoteId |
| MODIFY | enabled only after follower accepts clipped qty and a **new** quote | allowed for new quoteId |
| BLOCK | disabled | 403, no Flash call |

Log `{ proposalHash, policyHash, verdict, reasons, quoteId?, flashOrderId? }` in memory/sqlite for the README.
