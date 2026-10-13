# Definitive Flash API — integration guide

**Docs index (fetch this first):** https://flash.definitive.fi/docs/llms.txt  
**Base URL:** `https://flash.definitive.fi/v1`  
**OpenAPI:** https://flash.definitive.fi/v1/openapi.json  
**Access date for this write-up:** 2026-10-13

Flash is the product. Policy is *your* code in front of it. Flash does not read follower policies.

## Auth

Every request:

```
x-definitive-api-key: <key>
Content-Type: application/json
```

- **Your** integrator key: https://app.definitive.fi → More → Flash → Create Flash Key  
  https://flash.definitive.fi/docs/getting-started.md
- **Playground key** (docs, development): `dpka_513a2bd7_57a2_46d2_927b_2a3857fe271b`  
  Use your own key on the submitted demo so the org shows as integrator.

The API key identifies the **integrator**. It is not a user wallet. Users still sign EIP-712.

## Chain for Mumbai MVP

Use **Base only**.

| | |
| --- | --- |
| `chain` string | `base` |
| chain id | `8453` |
| public RPC | `https://mainnet.base.org` |
| WETH | `0x4200000000000000000000000000000000000006` |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

Full list: https://flash.definitive.fi/docs/supported-chains.md — mainnets, including `arc` `5042`. **No testnet row.**

## Mental model

```
GET /search  → addresses
POST /quote  → quoteId + evm.orderTypedData (+ maybe approveTx / permitTypedData)
wallet: approve if needed, then signTypedData
POST /order  → orderId
GET /orders/{id} → status, fills[].transactionId
```

Official EVM walkthrough: https://flash.definitive.fi/docs/evm-overview.md  
Runnable market TS: https://flash.definitive.fi/docs/market-order.md  
Runnable TWAP TS: https://flash.definitive.fi/docs/twap-order.md

## 1. Search

```
GET /v1/search?query=weth&chain=base&limit=1
```

Use `address` + `chain` as `targetAsset` / `targetChain`. Never send a symbol on `/quote`. Watch `riskFlagged`.

## 2. Target / contra / qty

https://flash.definitive.fi/docs/placing-orders.md

| Field | Meaning |
| --- | --- |
| `targetAsset` | Asset being traded (WETH in the demo) |
| `contraAsset` | Payment / pricing asset (USDC) |
| `side: buy` | Buy the target; `qty` is **contra** spent (USDC) |
| `side: sell` | Sell the target; `qty` is **target** sold (WETH) |

Demo ALLOW: buy WETH, spend `"25"` USDC.

## 3. Quote

`POST /v1/quote`

**Always send `funderAddress`** (follower wallet). If omitted, `evm.orderTypedData` is empty.

MVP TWAP buy (quote body):

```json
{
  "targetChain": "base",
  "contraChain": "base",
  "targetAsset": "0x4200000000000000000000000000000000000006",
  "contraAsset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "side": "buy",
  "qty": "25",
  "orderType": "twap",
  "durationSeconds": 600,
  "funderAddress": "0xFOLLOWER",
  "forceMinimalAllowance": true,
  "evmUsePermit2": true,
  "maxPriceImpact": "0.05"
}
```

Notes from docs:

- `durationSeconds` is **quote-time only**. Minimum **300**. Do not echo it on `/order`.
- Optional `twapBucketCount` (2–2560): echo the same value on submit if you set it.
- Optional `startTime` ISO-8601: echo on submit if set.
- TWAP does **not** accept `expireTime`.
- `forceMinimalAllowance` is quote-only; do not send it on `/order`.
- Pair the flag with `evmUsePermit2: true` on EVM (USDT-style approve issues; USDC is still cleaner on Permit2).
- Do not combine `forceMinimalAllowance` with `attachedBracket` (rejected).
- If you set `flashIntegratorFeeBps`, send the **same string** on quote and order.

Market (for the BLOCK demo you still quote only if you want a live quote card; you **must not** submit):

```json
{
  "orderType": "market",
  "qty": "500",
  "maxSlippage": "0.05",
  "side": "buy"
}
```

plus the same pair, chains, `funderAddress`. Markets reject `expireTime` / `durationSeconds`. Deadline is ~5 minutes.

Limit: exactly one of `limitNotionalPrice` (USD per target) or `limitCrossPrice` (contra per target). Optional `expireTime` ISO-8601 for GTT.

## 4. Approval / Permit2

The quote picks the path. Handle what it returns.

| Quote fields | Action |
| --- | --- |
| `evm.approveTx` present | Follower **sends** that tx (gas). Wait for receipt. Do not edit `to` / `data`. |
| `evm.permitTypedData` present | Follower **signs** it; submit as `evmPermitTypedData` + `evmPermitSignature` |
| both empty, `orderTypedData` present | Already authorized. Sign the order. |

Approval tx and order signature **cannot** be one click (docs).

Default unlimited approve is the drain story judges ask about. `forceMinimalAllowance: true` sizes ERC-20/Permit2 pull to this quote **plus unfilled open orders**. After a fill, the next quote may return a new approve/permit — always handle it.

Held Permit2 permits can be invisible onchain until first use. Do not “fix” a missing allowance by sending a second approve if the quote said none is needed.

Native ETH: quote spent asset `0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee`, send `wrap.evmTx`, submit with wrapped asset from the quote. **MVP: USDC in, WETH out — skip wrap.**

## 5. Sign (browser)

```ts
const { domain, types, primaryType, message } = JSON.parse(quote.evm.orderTypedData)
const userSignature = await walletClient.signTypedData({ domain, types, primaryType, message })
```

Echo `evmOrderTypedData` **unchanged** on submit. Deadline lives inside that payload.

EIP-1271 smart wallets work. EIP-7702 delegated EOAs must sign through the delegate’s `isValidSignature` path. Demo with a **plain EOA**.

The signature authorizes an **input debit** (token, amount, recipient, deadline). It does **not** encode min-out. Limit / TWAP / trigger params are **offchain** in Flash’s engine. https://flash.definitive.fi/docs/non-custodial.md

That is why PACT policy must run **before** this signature.

## 6. Submit

`POST /v1/order`

```json
{
  "targetChain": "base",
  "contraChain": "base",
  "targetAsset": "0x4200000000000000000000000000000000000006",
  "contraAsset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "side": "buy",
  "qty": "25",
  "orderType": "twap",
  "funderAddress": "0xFOLLOWER",
  "quoteId": "<from quote>",
  "userSignature": "0x…",
  "evmOrderTypedData": "<string from quote, unchanged>"
}
```

Add permit fields if you signed a permit. Response: `orderId`.

**PACT server rule:** refuse `/order` unless the stored decision for this quote is ALLOW or MODIFY. BLOCK → no `userSignature` collection, no POST.

## 7. Receipt (prize proof)

`GET /v1/orders/{orderId}`

https://flash.definitive.fi/docs/post-trade-reporting.md

- Status: `ORDER_STATUS_ACCEPTED` → `ORDER_STATUS_PARTIALLY_FILLED` (TWAP resting) → `ORDER_STATUS_FILLED`
- Each fill: `transactionId` (tx hash), `venues`, `fillPrice`, `notional`
- TWAP: one fill per slice; `twapBucketCount` / `completedFillCount`
- Terminal: `FILLED` | `CANCELLED` | `REJECTED`
- Cancellable: `PENDING` | `ACCEPTED` | `PARTIALLY_FILLED`

Show Basescan for `fills[0].transactionId`. PARTIALLY_FILLED is enough for the demo if a slice landed.

Useful `closeReason` values:

| Code | Demo use |
| --- | --- |
| `REASON_ORDER_TRIGGERED_ON_ENTRY` | Honest SL/TP already crossed |
| `REASON_INSUFFICIENT_ASSET_BALANCE` | Follower spent the USDC elsewhere |
| `REASON_MAXIMUM_SLIPPAGE_EXCEEDED` | Retry / explain |

## 8. Cancel (stretch)

Follower signs a cancel message; `POST /orders/{orderId}/cancel`. https://flash.definitive.fi/docs/cancelling-orders.md  
Admin on the **integrator** account can also cancel from the Definitive UI. Do not make that the demo path.

## 9. MCP — learning vs product

Package: `@definitive-fi/flash-mcp`  
https://flash.definitive.fi/docs/flash-mcp.md  
Source (reference implementation): https://github.com/DefinitiveCo/flash-mcp

`flash_submit_order` **moves funds** using the wallet configured in the MCP server. That is fine for **your** laptop experiments. It is **custody** if it signs for the follower. Product path: REST + browser `signTypedData`.

## 10. Prize mapping

https://ethglobal.com/events/mumbai/prizes/definitive

| Requirement | How PACT shows it |
| --- | --- |
| Working Flash API or MCP flow | REST quote → sign → order |
| Advanced order (DCA / limit / stop / SL / TP / TWAP) | TWAP 10 min on Base |
| Onchain execution in final demo | `transactionId` on Basescan |
| Social app (copy trading named) | Leader posts, follower copies under policy |
| Discord + X video, tag `@DefinitiveFi` | See [06-demo-and-submission.md](06-demo-and-submission.md) |

## 11. Pitfalls

- Empty `orderTypedData` → you omitted `funderAddress`
- Submitting native `0xeee…` as spent asset → rejected; wrap first
- Editing the signed payload deadline by hand → docs say let Flash derive it
- Policy in the UI while server still POSTs `/order` → you are the custodian
- Fake PnL / backtests → out of scope
- Assuming Flash testnet → none in supported-chains.md
- `qty` on sell as USDC → wrong; sell qty is WETH
- Combining `forceMinimalAllowance` with brackets
- Single Friday commit

## 12. Official pages to keep open

- https://flash.definitive.fi/docs/evm-overview.md
- https://flash.definitive.fi/docs/placing-orders.md
- https://flash.definitive.fi/docs/twap-order.md
- https://flash.definitive.fi/docs/minimal-authorization.md
- https://flash.definitive.fi/docs/non-custodial.md
- https://flash.definitive.fi/docs/order-statuses.md
- https://flash.definitive.fi/docs/api-reference/flash/quote.md
- https://flash.definitive.fi/docs/api-reference/flash/order.md
- https://flash.definitive.fi/docs/api-reference/flash/get-order.md
