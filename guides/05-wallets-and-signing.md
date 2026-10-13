# Wallets and signing

## Two wallets, always

| Role | Signs | Holds USDC |
| --- | --- | --- |
| Leader | Nothing Flash-related in MVP | Optional |
| Follower | `approveTx` (if any), Permit2 (if any), `orderTypedData`, cancel (stretch) | Yes |

Connect **one** wallet per browser profile, or two browsers. Mixing them mid-demo is the usual failure.

## Browser stack

wagmi + viem + RainbowKit or ConnectKit. `signTypedData` on the connected account.

Server uses `FLASH_API_KEY` only. Server **never** calls `privateKeyToAccount` for the follower.

Flash’s own examples use `privateKeyToAccount` in a script. That pattern is for **docs**. Copying it into an API route makes PACT custodial.

## EIP-712

```ts
const typed = JSON.parse(quote.evm.orderTypedData) as {
  domain: Record<string, unknown>
  types: Record<string, unknown>
  primaryType: string
  message: Record<string, unknown>
}
const userSignature = await signTypedDataAsync(typed)
```

Submit:

- `userSignature`
- `evmOrderTypedData: quote.evm.orderTypedData` (original string)

Do not reconstruct typed data.

## Approvals

If `quote.evm.approveTx`:

```ts
await sendTransaction({
  to: approveTx.to,
  data: approveTx.data,
  value: 0n,
})
await waitForTransactionReceipt({ hash })
```

Then sign the order.

`forceMinimalAllowance: true` + `evmUsePermit2: true` on the quote (see [02-flash-api.md](02-flash-api.md)).

## What Flash actually binds

From https://flash.definitive.fi/docs/non-custodial.md:

- Token, total input amount, recipient, deadline — **in the signature**
- Limit price, TWAP schedule, trigger price — **offchain**, Flash engine
- Min-out — **not** in the signature; Flash applies slippage / price-impact at execution

PACT therefore:

1. Policy on pair, type, size **before** quote
2. After quote, optionally re-check quoted notional vs policy
3. Follower signs
4. Show `closeReason` if Flash later rejects

## 7702 / smart wallets

Flash supports EIP-1271. 7702-delegated EOAs need the delegate’s signature format. Use a **plain EOA** on stage.

## Integrator cancel vs user cancel

Definitive Admin email can cancel from their UI. That is a **central** kill switch. Mention it in Q&A as integrator ops, not as follower safety. Follower safety is: don’t sign, or sign cancel, or revoke allowance.
