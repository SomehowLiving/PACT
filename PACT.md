# PACT

**Copy a trader without giving up your keys or your risk limits.**

PACT is policy-aware copy trading built on [Definitive Flash](https://flash.definitive.fi/docs). A leader publishes an order. Each follower's own rules decide whether to copy it, shrink it, or refuse it. If the order is allowed, the follower signs it from their own wallet. Nobody else can move their money.

Built for ETHGlobal Mumbai 2026 (5–7 Nov). Submitted on the Continuity track: the app was started before kickoff, and new work is committed during the event.

---

## The problem

Copy trading usually forces a bad choice:

- **Hand over custody.** Deposit into a vault or give a bot your key. The manager, or anyone who compromises the bot, can act with your funds.
- **Copy blindly.** Mirror a leader's trade at whatever size and risk they chose, including a $500 market order on an account that was only ever comfortable with $30.

Your personal risk limits are rarely enforced at the moment money moves, and the thing that enforces them is rarely something you can verify.

## What PACT does

1. A **leader** publishes a Flash-shaped order: TWAP, limit, market, take-profit or stop-loss, on Base or Arc.
2. Each **follower** has a personal policy: max per order, daily cap, allowed chains, order types, sides, slippage and price impact.
3. A deterministic policy engine returns one of three verdicts per follower:
   - **ALLOW**: within limits.
   - **MODIFY**: too big, so it is clipped to the follower's cap and daily room instead of refused.
   - **BLOCK**: outside the rules. The sign button is locked and nothing is ever sent to Flash.
4. On ALLOW or MODIFY, a **wallet guard** re-checks everything the follower is about to sign, in the follower's browser, before any wallet prompt.
5. The **follower signs** with their own wallet. Flash executes onchain, non-custodially.

The central design rule: **policy gates the only signature Flash will honor.** Funds stay in the follower's wallet. The server never holds a key that can move them.

### The demo that explains it in five seconds

One leader trade, three followers, three outcomes. The floor page has a panel called "same trade, your rules." A leader posts a $60 TWAP buy:

| Desk | Policy | Verdict | Result |
|---|---|---|---|
| steady | $30 per order, $50 daily | **MODIFY** | clipped to $30 |
| bold | $100 per order, $200 daily | **ALLOW** | signs $60 |
| careful | $15 per order, limit orders only | **BLOCK** | sign locked, nothing sent to Flash |

Two sliders (the leader's trade size and each desk's cap) rerun the real policy engine live in the browser, so anyone can watch a verdict flip. The sliders are a local what-if and never change saved policies.

---

## Features

**Leader (`/leader`)**
- Publish TWAP, limit, market, take-profit or stop-loss on Base or Arc.
- Take-profit and stop-loss are sells of the target token with a price trigger, as Flash defines them.

**Follower (`/follower`)**
- Edit your own limits: per-order cap, daily cap, chains, order types, sides, and which leaders to copy.
- Choose whether oversize orders are clipped (MODIFY) or blocked.
- See the wallet guard checklist before signing.
- A fill timeline: Flash quote, wallet guard, approve allowance, sign Permit2, sign order, submit. Then live order status, TWAP slice progress, and each fill with an explorer link.
- Cancel a resting order. This is a gasless message signature in the wallet.

**Floor (`/`)**
- Remaining daily cap, blocked notional, Flash health and the live WETH price.
- The three-desk what-if panel.
- A tape of every decision with filters.

**History (`/history`)**
- An audit trail: every decision with its verdict, reasons, and a hash of the proposal and of the policy that judged it.
- Fills with explorer links, and an export to JSON.
- The hashes show which rules applied. They are not proof that a trade was safe and do not replace the follower's signature.

---

## How it works

### Policy engine

`decide()` is a pure function in `lib/policy.ts`. It checks, in order: chain, pair, order type, side, slippage and price impact, then size and daily cap.

- **Hard rules** (chain, pair, order type, side, slippage) produce BLOCK, and any size or daily-cap reasons are listed alongside.
- **Soft rules** (size over the per-order cap, or over the remaining daily room) produce MODIFY if the follower allows clipping and the clipped size is above their minimum. Otherwise they produce BLOCK.
- Reason codes: `CHAIN_NOT_ALLOWED`, `PAIR_NOT_ALLOWED`, `ORDER_TYPE_NOT_ALLOWED`, `SIDE_NOT_ALLOWED`, `SLIPPAGE_TOO_HIGH`, `SIZE_EXCEEDS_MAX`, `DAILY_CAP`, `PRICE_UNAVAILABLE`.
- Sells are sized in the target token, so their USD notional uses the live Flash price. **If the price can't be fetched, the order is blocked** rather than guessed.

### Wallet guard (the answer to "what if the server lies?")

Flash never reads PACT's policy, and a server could in theory return a different order than the one the policy approved. So `lib/guard.ts` runs in the follower's browser on the raw payloads Flash returned, before any wallet prompt. It also runs on the server, and a quote that fails is never stored or served.

It refuses to sign unless all of the following hold:

- The signing domain is the right chain and the verifying contract is the Flash contract.
- The swapper (funds source) and the recipient (proceeds) are both the follower.
- The from and to tokens match the proposal, and the direction matches buy or sell.
- `fromAmount` is at most the policy-approved size, and the Permit2 permit amount is at most that size too.
- The Permit2 spender is the Flash contract, the permit is for the spent token, and the permit contract is the canonical Permit2.
- The approve call goes only to the spent token, only for Permit2.
- The deadline is in the future.

The guard has 13 unit tests that simulate a lying server: an inflated amount, redirected proceeds, a swapped token, the wrong spender, the wrong chain and an expired deadline. A browser test also tampers with a live quote by inflating the amount 20 times and confirms the wallet is never asked to sign anything.

### Signing flow

1. The server asks Flash for a quote with `forceMinimalAllowance` and Permit2, using the follower as the funder.
2. The server guard checks the quote. The follower's browser then runs its own guard on the same payloads.
3. If Flash returns an `approveTx`, the follower broadcasts it and waits for the receipt.
4. The follower signs the Permit2 permit and the Flash order (EIP-712).
5. The server submits the order to Flash with the follower's signatures.
6. The page polls the order until it fills or is cancelled.

### Flash integration

- Order types used: market, limit, TWAP, take-profit, stop-loss.
- Chains: Base (8453) and Arc (5042). Arc TWAP quotes were checked against live Flash.
- Live status uses `GET /orders/{id}?funderAddress=…`, which returns `{ order, fills }`.
- Cancel signs the exact message `Definitive Flash v1 — Cancel Order\nOrder: <id>` with EIP-191.
- Flash is mainnet-only, so a real fill uses real funds.

---

## Security model

| Actor | Trust | What they can do |
|---|---|---|
| Leader | Untrusted | Post an intent. Cannot spend a follower's funds. |
| AI agent or bot | Untrusted | Propose a copy. Policy runs before any quote or signature. |
| Policy engine | Trusted | ALLOW, MODIFY or BLOCK. |
| Follower wallet | The signer | Only this key spends. |
| PACT server | Semi-trusted | Holds the Flash API key. Refuses BLOCK. Can submit a signature it already has, but cannot create one. |
| Wallet guard | Independent check | Re-verifies every payload in the browser, without trusting the server. |
| Flash | Executor | Honors the signed order. Does not read policy. |

- PACT never stores a follower private key.
- A BLOCK verdict never reaches Flash's quote or order endpoints, and the server returns 403 on both.
- `/order` also returns 403 if the funder is not the proposal's follower.

### Honest limits

- **The ERC-20 approval to Permit2 is max uint256.** That is what Flash's quote returns. The follower's real spend limit is the signed Permit2 amount, which is sized to the order and expires in about 24 hours. The guard shows this as a warning.
- **The guard pins the Flash contract address** and checks what is signed, not what Flash does afterward.
- **TWAP duration and triggers sit offchain** and are not part of the EIP-712 signature. Flash honors the signature, not PACT's policy.
- **Trigger orders last a very long time by design.** The guard warns, and the order can be cancelled.
- **Cancelling in the Definitive admin is a central kill switch**, not follower safety.
- **PACT does not evaluate whether a strategy is any good.** Copy trading does not make a strategy profitable.
- **Demo state is a local JSON file.** It is not production persistence.

---

## Tech stack

- Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4
- wagmi 3 and viem 2 for wallet, signing and Base/Arc
- Definitive Flash REST API
- Vitest for unit tests, Playwright (driving Chromium) for the browser test

## Verification

- **24 unit tests:** 6 policy cases, 13 wallet-guard cases, 5 Flash contract cases (order status shape, required funder address, exact cancel message bytes, trigger orders).
- **10-check browser test** with a mock wallet: a throwaway key signs for real against the live Flash quote. It covers connecting, the guard panel, the approve, Permit2 and order signing sequence, a tampered quote being refused, and a BLOCK staying locked.
- **Live checks against Flash:** health, quotes on Base and Arc, a priced take-profit, and BLOCK refusals at `/quote` and `/order`.
- Type check and lint are clean.

### Not yet proven

- **A real filled order.** Flash rejected the throwaway test wallet's order with `signature verification failed`. A plain script following Flash's own documented flow, with no PACT code, got the identical error, so the cause looks like the wallet holding no funds. A funded run on Base is the remaining step, and it is the only way to prove live order status, TWAP slice progress, fills and cancel against a real order.
- **Arc settlement.** Quotes work, but no Arc fill has been done.

---

## Run it

```bash
cd pact
cp .env.example .env.local     # add your Flash integrator key
npm install
npm test                       # unit tests
npm run dev                    # http://localhost:3000
npm run e2e                    # browser test, with the dev server running
```

Load the demo without any wallet: click **load demo tape** on the floor page, or `POST /api/demo`. For a real fill the follower needs a Base wallet with a little ETH for gas and some USDC.

## Project layout

```
pact/
  app/               pages: floor, leader, follower, history; API routes
  components/        Floor, Desks, LeadTicket, FollowDesk, History, charts
  lib/
    policy.ts        decide(): ALLOW / MODIFY / BLOCK
    guard.ts         wallet-side signing guard
    flash.ts         Flash REST client
    chains.ts        Base and Arc config, Permit2 and Flash contract addresses
    store.ts         local demo store
  e2e/               mock-wallet browser test
specs/               policy test vectors and data model
guides/ docs/        research and integration notes
```

## Event context

- **Event:** ETHGlobal Mumbai, 5–7 Nov 2026. Submissions close Sat 7 Nov at 09:00 IST.
- **Target sponsor:** Definitive (Flash advanced orders in a social app).
- **Track:** Continuity.

## What is next

- A funded Base fill with an explorer link and a recorded demo.
- A cross-check of the Flash quote against an independent price source, so a bad quote is caught before signing.
- A human approval step for large orders.
- A leader profile and follow flow, and policy presets.

## AI attribution

This project was built with AI coding assistants, including Grok Build and Claude Code. The policy cases, wallet guard, Flash client and UI are in this repo. Flash itself is Definitive's.

## Licence and status

Hackathon prototype. Not audited. Do not use with funds you cannot afford to lose.
