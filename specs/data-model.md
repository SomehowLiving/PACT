# Data model

Implement at kickoff. Types are the contract between UI, policy, and Flash.

```ts
export type Chain = "base"
export type Side = "buy" | "sell"
export type OrderType = "market" | "limit" | "twap" | "stop" | "stop-loss" | "take-profit"

export type Strategy = {
  id: string
  leader: `0x${string}`
  chain: Chain
  targetAsset: `0x${string}`
  contraAsset: `0x${string}`
  side: Side
  orderType: OrderType
  qty: string
  durationSeconds?: number
  limitNotionalPrice?: string
  createdAt: string
}

export type Policy = {
  follower: `0x${string}`
  chain: Chain
  maxNotionalUsd: number
  maxDailyUsd: number
  minNotionalUsd: number
  allowModify: boolean
  allowPairs: string[] // `${target}:${contra}` lowercase
  allowOrderTypes: OrderType[]
  allowSides: Side[]
  maxSlippage: string
  maxPriceImpact: string
  askHumanUsd?: number
}

export type Proposal = {
  id: string
  strategyId: string
  chain: Chain
  targetAsset: `0x${string}`
  contraAsset: `0x${string}`
  side: Side
  orderType: OrderType
  qty: string
  notionalUsd: number
  maxSlippage?: string
  maxPriceImpact?: string
  durationSeconds?: number
}

export type Decision = {
  verdict: "ALLOW" | "MODIFY" | "BLOCK"
  reasons: string[]
  modifiedQty?: string
}

export type Receipt = {
  proposalId: string
  decision: Decision
  quoteId?: string
  flashOrderId?: string
  status?: string
  transactionId?: string
  closeReason?: string
  notionalUsd: number
}
```

Pair key: both addresses lowercased, `target:contra`.

Notional for a **buy** of USDC contra can start as `Number(qty)` when contra is USDC. After quote, replace with `Number(quote.from.notional)` or `to.notional` as returned.
