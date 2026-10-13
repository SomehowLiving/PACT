# Build plan — primary: Narrow PACT

## 1. Pitch

PACT lets you follow a trader’s Flash orders inside limits they cannot break, because your wallet is the only one that can sign.

## 2. Problem

Copy trading today is either a custodial vault or a bot with your key. Flash can already run TWAP, stop-loss, and take-profit from a non-custodial wallet. Nothing turns a leader’s intent into a follower order that a deterministic policy can still refuse.

## 3. Core differentiator

The policy engine can prevent the only signature Flash will honor. The leader never receives allowance on the follower’s tokens. The model cannot override BLOCK.

## 4. Primary prize

**Definitive — Best Use of Flash Advanced Orders in a Social App — $3,500**  
https://ethglobal.com/events/mumbai/prizes/definitive

Eligibility: Flash API or MCP advanced order (DCA/Limit/Stop/SL/TP/TWAP); onchain execution in the demo; short video on Discord and X tagged @DefinitiveFi.

## 5. Secondary prizes (only if pages publish)

Recheck https://ethglobal.com/events/mumbai/prizes on 1 Nov and at kickoff. You may pick **three** partners.

| If this publishes like… | Add this, not more |
| --- | --- |
| World / World ID for Agents (Tokyo analog) | ASK_HUMAN path for oversized copies; show denial |
| Arkiv | Persist strategy version + decision + flashOrderId + tx |
| ENS / ENSv2 (Tokyo analog) | Leader strategy name as source of truth, read at decision time |
| Chainlink CRE (NY analog) | Do not add unless you still have a day |
| 1inch Aqua | Do not add |
| Whitechain / 0G / EF | Ignore unless criteria are a free Solidity deploy you already have |

Continuity Definitive $1,500 is **not** for Classic from-scratch.

Finalist judging is a separate path: 4-minute live demo. Same ALLOW vs BLOCK.

## 6. Integration sequence

1. Definitive account + Flash API key (email login) — **before the event if rules allow keys; otherwise hour 0**. Classic track: no project code before start; API keys and reading docs are preparation, not the repo.
2. `GET /search` + `POST /quote` market on Base USDC→WETH.
3. Sign `orderTypedData`; `POST /order`; poll fill.
4. Repeat with `orderType: twap` or `limit` (the social “advanced” proof).
5. Policy module in TypeScript: pure function, unit tests.
6. Two-wallet UI: Leader feed, Follower policy, Proposal, Decision, Receipt.
7. `forceMinimalAllowance: true` + `expireTime` on resting orders.
8. Discord+X video.
9. Stretch: cancel leftover TWAP slices; Arkiv/World/ENS if published.

## 7. Architecture

```
Leader wallet          Follower wallet
    |                      |
    v                      v
[Leader UI]          [Follower UI]
    |                      |
    | strategy posts       | policy JSON
    v                      v
        [PACT API - no funder keys]
        policyEngine(proposal, policy) -> ALLOW|MODIFY|BLOCK
        flashClient.quote / order / get
    |
    v  (only if ALLOW/MODIFY)
 follower signs EIP-712 in browser
    |
    v
 Flash API  -> onchain fill on Base
    |
    v
 receipt: orderId, status, transactionId, decision log
```

No PACT-held private key that can `POST /order` for the follower.

## 8. Data model

```ts
type Strategy = {
  id: string
  leader: `0x${string}`
  chain: "base"
  targetAsset: string
  contraAsset: string
  side: "buy" | "sell"
  orderType: "market" | "limit" | "twap" | "stop" | "take-profit"
  qty: string
  limitNotionalPrice?: string
  twap?: { durationSeconds: number }
}

type Policy = {
  follower: `0x${string}`
  maxNotionalUsd: number
  maxDailyUsd: number
  allowPairs: string[]
  allowOrderTypes: Strategy["orderType"][]
  maxSlippage: string
}

type Proposal = {
  strategyId: string
  flashQuoteId?: string
  notionalUsd: number
  quote: unknown
}

type Decision = {
  verdict: "ALLOW" | "MODIFY" | "BLOCK"
  reasons: string[]
  modifiedQty?: string
}

type Receipt = {
  decision: Decision
  flashOrderId?: string
  status?: string
  transactionId?: string
  closeReason?: string
}
```

Daily notional is summed from PACT receipts, not from the leader’s claims.

## 9. Security boundaries

| Trust | Boundary |
| --- | --- |
| Leader | Untrusted. Their strategy is data. |
| LLM agent | Untrusted. May draft a Proposal. Cannot sign. Cannot change Policy. |
| Policy engine | Trusted code, deterministic, unit-tested. No network. |
| Follower wallet | Only signer. |
| Flash | Trusted for execution after signature; not trusted to know your policy. |
| PACT server | May hold the **integrator API key**. Must not hold follower keys. |

Threats: prompt injection → malicious proposal (engine BLOCKs pair/size); stolen integrator key (fees/attribution, not user funds); unlimited ERC-20 approve (use `forceMinimalAllowance`); UI bug enabling Sign on BLOCK (disable + server refuse to attach quote for BLOCK).

## 10. Day-by-day (48–72h)

**Prep (legal for Classic):** read Flash docs, create email account, fund a tiny Base USDC balance, write policy unit tests **off-repo** or wait for start. Do not commit project code.

**Hour 0–6:** repo, Next.js + viem, env for API key, quote+sign+submit script for market on Base.

**Hour 6–12:** TWAP or limit live. Screenshot order id.

**Hour 12–20:** policy engine + tests (size, pair, order type, daily cap, MODIFY clips qty).

**Hour 20–32:** Leader/Follower UI. Seed one strategy. Proposal card with verdict colors.

**Hour 32–40:** End-to-end ALLOW fill + BLOCK attempt (button disabled, reason). Record backup video of the fill.

**Hour 40–48:** Discord+X video 2–4 min; README with tx hashes; submission form; pick 3 partners.

**Hour 48–60 stretch:** cancel path; Arkiv log; World ASK_HUMAN if published.

**Hour 60–72:** judging script rehearsal; sleep; do not add sponsors.

## 11. Roles

**Solo:** you. Order: Flash script → policy tests → UI → video. Steal UI from a wallet connect template.

**Team of 3**

| Person | Owns |
| --- | --- |
| A (you) | Policy engine, threat model, Flash receipt verification |
| B | Flash quote/sign/submit, chain ops, API key |
| C | UI, demo video, submission copy, X/Discord |

## 12. Demo script (~4 minutes live / 2–4 min video)

**0:00** “This is PACT. You can follow a strategy without giving that trader your wallet.”  
**0:15** Show Leader wallet posting “TWAP buy 25 USDC of WETH on Base, 10 minutes.”  
**0:30** Show Follower policy: max 30 USDC, Base USDC-WETH, TWAP+limit only.  
**0:45** Agent proposal ALLOW. Follower signs. Flash status ACCEPTED → PARTIALLY_FILLED/FILLED. Open Basescan `transactionId`.  
**1:30** Leader posts “market buy 500 USDC.” Policy BLOCK: exceeds maxNotional. Sign control disabled. No Flash order id created.  
**2:00** Optional: MODIFY clips 80 USDC request to 30.  
**2:20** Architecture one-slide: leader untrusted, model untrusted, policy deterministic, follower signs, Flash executes.  
**2:40** “We did not backtest the leader. We proved the follower could not be overrun.”  
**3:00–4:00** Q&A: keys, what Flash does not sign, Chamber comparison.

## 13. First 30 seconds (judges)

- Two labeled wallets, not a chatbot.
- A policy with numbers.
- A green ALLOW or a red BLOCK already on screen, not a roadmap.

## 14. MVP acceptance

- [ ] Follower private key never sent to server
- [ ] Unit tests: BLOCK on pair, size, order type; ALLOW on in-policy TWAP/limit
- [ ] One Flash advanced order FILLED or PARTIALLY_FILLED with `transactionId`
- [ ] One BLOCK with no Flash order
- [ ] README: tx hash, API usage, AI-tool attribution
- [ ] Video 2–4 min, ≥720p, posted Discord + X, tag @DefinitiveFi
- [ ] Git history with more than one commit

## 15. Fallback if live Flash fails

Play the **pre-recorded** fill from hour 40. Live demo the BLOCK path (it needs no Flash). Show `flash_quote` still working. Do not fake a transaction hash.

If the API is down entirely: you are ineligible for Definitive (onchain execution required). Pivot partner selection to whatever published prizes you actually integrated. Do not invent a 1inch Aqua app in the last six hours.

## 16. Submission checklist and failure modes

**Checklist**

- Classic vs Continuity selected correctly
- ≤3 partner prizes
- Public GitHub
- Demo video constraints (no AI voice, no phone, no <720p)
- Definitive X + Discord
- Explain Flash in the partner text box
- FEEDBACK.md if Uniswap publishes Tokyo-like rules

**Likely judging failures**

| Failure | Avoid |
| --- | --- |
| Market swap chatbot | Lead with TWAP/limit/SL |
| Policy in UI only | Disable sign + no server order on BLOCK |
| Fake PnL | Don’t show |
| ENS name, no Flash fill | Inverse priority |
| Single Friday commit | Commit as you go |
| Video >4 min or AI voice | ETHGlobal auto-reject |
| Unlimited approve, judge asks about drain | `forceMinimalAllowance` |
| Calling it “non-custodial” while a server key signs | Don’t |

## Essential vs stretch

**Essential:** policy engine, follower signature, one advanced Flash fill, one BLOCK, video.  
**Stretch:** MODIFY, cancel, daily cap across two fills, Arkiv, World, ENS.  
The product is still a prize contender on essentials alone.
