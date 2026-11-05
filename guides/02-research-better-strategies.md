# PACT: research findings and how to make it more advanced

Written 5 Nov 2026, during ETHGlobal Mumbai. Based on web research done today plus a read of Flash's docs and PACT's code.

**How to read this file:** Part 1 is the honest answer to "is it too simple?". Part 2 is what the market and standards look like. Part 3 is what Flash offers that PACT doesn't use yet. Part 4 is two real bugs I found in PACT. Part 5 is the ranked list of upgrades. Part 6 is what I'd do in the time left. Part 7 is what I could not verify.

---

## Part 1: The honest answer

**Yes, PACT is simple in breadth.** Today it covers one token pair (USDC and WETH), five order types, and one kind of rule (limits on size, chain, order type and slippage).

**But "simple" is not the main problem.** The core idea is a real gap: copy trading where the follower keeps their keys and their own rules, with a second check in the browser that the order Flash returned is the order the rules approved. What is thin is everything around that core:
- the rules look at very little of what makes a trade risky (no token risk flags, no liquidity, no loss limits)
- nothing helps a follower decide who to copy
- no one has seen a real order fill
- two parts of the guard disagree with how Flash actually behaves (Part 4)

So the plan is not to make it bigger. It is to make the core deeper and fix what is wrong. Part 5 is ranked for that.

---

## Part 2: What the market and the standards look like

### 2.1 Exchanges already do copy trading well, and compete on these things
From a 2026 comparison of the major platforms (Datawallet):
- **Leader analytics:** Sharpe ratio, drawdown history, risk score, holding time, assets under management. OKX is described as having the best analytics. Leaders on Bybit are filterable by ROI, drawdown, win rate and AUM.
- **Follower risk controls:** Bitget lets followers set a stop-loss per leader, cap the amount per leader, and set daily loss limits, so one leader's bad run doesn't hit the rest.
- **Multi-leader portfolios:** OKX "Smart Portfolio" spreads money across several leaders and rebalances.
- **Fees:** profit sharing of roughly 4 to 10% set by the leader (Bitget).
- **Transparency:** one platform publishes monthly proof of reserves.

**What this means for PACT:** the exchanges are custodial, but they have far more follower controls and leader data than PACT. Our edge is non-custodial plus per-order verification. The gap is the controls and the data.

### 2.2 The "policy engine for agents" idea is now mainstream
A 2026 builder guide (niteagent) describes the same pattern shipping across MetaMask, Coinbase, MoonPay and Turnkey:
- Treat an AI agent as an **untrusted proposer, not a trusted signer**.
- Five controls: max transaction size, rolling 24-hour outflow limit, address and protocol allowlists, session key rotation, and a human approval gate with a kill switch.
- MetaMask's Agent Wallet pauses out-of-policy transactions for approval and auto-declines stale approvals after about five minutes.

**What this means for PACT:** our trust model matches the industry's. That is reassuring, but a plain policy engine is not new. What is specific to PACT is applying it to copy-trade orders and verifying Flash's exact payload in the browser. Pitch that, not "we have a policy engine."

### 2.3 Standards worth knowing
- **ERC-7715 / ERC-7710 (MetaMask "Advanced Permissions", launched 6 Apr 2026):** a user grants an app a scoped, time-limited permission once, and the app acts within it without asking for a signature each time. Their own example: "an AI agent may spend up to 10 USDC per day to buy ETH for 30 days." There is a "periodic" type that resets each period, which is exactly a daily cap.
- **ERC-8004:** onchain registries for agent identity, reputation and validation, tracked across about 29 chains on 8004scan. A leader could be registered as an agent with a reputation. I saw an academic paper titled "Can Trustless Agents Be Trusted?" and did not read it, so don't assume reputation here is hard to game or easy to game.
- **Intents:** UniswapX, CoW Protocol, 1inch Fusion and Across all work by the user signing an order that describes the outcome, with competing executors carrying it out. **Flash works this way too:** you sign an offchain order, and Flash simulates, routes privately and lands it. So PACT is, in effect, a policy layer over intents.

### 2.4 What won at a recent ETHGlobal (Lisbon 2026, via The Graph's winners post)
- **EQLTY** won a $2,000 Continuity prize. Its "Risk" agent blocks a trade unless the data is fresh and traceable.
- **atlas** won for apps that act only inside a policy the user sets.
- The post's own summary: "a guard five minutes late is a preference for an app that displays and a bug for one that spends."
- Several winners built MCP servers or tooling for other developers, and the sponsor rewarded that explicitly.

This is one sponsor's post about one event, so treat it as a hint about taste, not a rule. It suggests that gates on stale or untrusted data, and MCP tooling, are well-regarded themes.

### 2.5 The real weaknesses of copy trading (what a better product could fix)
- Past results don't predict future results, and track records can be cherry-picked.
- You don't know the leader's position size, time horizon or risk when you copy.
- Every copied trade pays costs again (fees, spread, gas), so a follower often does worse than the leader.
- Sybil leaders: one person running many leader accounts and promoting whichever got lucky.

---

## Part 3: What Flash offers that PACT doesn't use yet

Read from Flash's own docs today. "Used" means PACT already uses it.

| Flash feature | What it does | PACT |
|---|---|---|
| Market, Limit, TWAP, Stop-loss, Take-profit | The five core order types | Used |
| **Bracket** | Attach a take-profit and stop-loss pair to an entry order in one flow (`attachedBracket`), or place a pair on a token you hold | Not used |
| **Trailing stop** | A stop that follows the price at a set percentage | Not used |
| **Stop (stop buy)** | Buy when price crosses a level, for when getting in matters more than the price | Not used |
| **DCA** | Recurring buys or sells at regular intervals | Not used |
| **Cross-chain market** | Swap across EVM chains or EVM and Solana | Not used |
| **`/search`** | Returns price, liquidity, 24h volume, market cap, holders and a **`riskFlagged`** field for any token | Price only. `riskFlagged` is read in the health check but never used in a rule |
| **Orders WebSocket** | Live status updates instead of polling | We poll every 4 seconds |
| **Post-trade report** | `filled.averageNotionalPrice`, per-fill price, venues, gas and fee breakdown | We store fills but don't compute anything from them |
| **Integrator fee** | `flashIntegratorFeeBps` lets you charge a fee on every trade, on top of Definitive's own 10 bps (promotional through December 2026) | Supported by the code, off unless configured |
| **Base builder code** | `erc8021AttributionCode` on `/order` lets Base credit your app for the activity (register on base.dev) | Not used |
| **MCP server** | `npx @definitive-fi/flash-mcp` exposes quote, submit, status and cancel tools to any MCP client | Not used |
| **Chains** | arbitrum, avalanche, base, bsc, ethereum, optimism, polygon, solana, hyperevm, plasma, monad, robinhood, ink, arc | Base and Arc |

Fees land in PACT's own Flash portfolio. They are **not** paid to a leader automatically, so a leader revenue share would need a separate payout step.

---

## Part 4: Two real problems in PACT, found by checking Flash's docs

I confirmed both in the code. **Both are now fixed** (see "Status" under each problem). The sections below describe what was wrong.

### Problem 1: the guard can wrongly refuse a legitimate order
- **What the code does:** [lib/guard.ts](../pact/lib/guard.ts) requires the Permit2 permit amount to be at most the order's approved size (the `permit.amount` check).
- **What Flash does:** with `forceMinimalAllowance`, Flash sizes the permit to *this order plus every unfilled open order for the same wallet and token*. Their example: a new 25 USDC order with 40 USDC already open needs a 65 USDC permit.
- **Result:** the first order works. A follower with a resting TWAP or limit order who gets a second copied order would see a perfectly honest quote fail the guard. In a demo, the second trade would be refused for no real reason.
- **Fix idea:** compare the permit with (this order + the follower's other unfilled orders for that token), using the open orders PACT already knows about, or fetch them from Flash. Keep it strict: the permit may not exceed that sum.
- **Status: fixed.** The guard takes `otherOpenUnits` and allows a permit up to this order plus those. The server works that number out from the follower's submitted, unclosed orders (`openSpendUnits` in `lib/store.ts`) and returns it with the quote. The order's own signed amount is still capped to this order alone. Orders placed outside PACT are invisible to this sum, so a wallet with such orders could still see an honest permit refused. The browser receives the number from the server, so a lying server could widen the permit limit, but not the order amount, which is what actually moves funds. Six new tests cover it.

### Problem 2: limit and trigger orders get an unlimited permit expiry
- **What the code does:** [lib/flash.ts](../pact/lib/flash.ts) never sends `expireTime` for limit, stop-loss, take-profit or stop orders.
- **What Flash says:** for those types you should *always* set a future `expireTime`, otherwise the shared Permit2 duration becomes unlimited. TWAP uses `durationSeconds` (we do send it). Market orders must not send either.
- **Result:** the guard shows a warning about expiry, and the follower's permission lasts far longer than needed. This undermines the "bounded spending" story.
- **Fix idea:** add an expiry (for example 7 days) to those order types and let the follower choose it.
- **Status: fixed.** Limit, stop-loss, take-profit and stop quotes now send `expireTime` 7 days ahead (`RESTING_ORDER_SECONDS` in `lib/constants.ts`). TWAP and market orders still send none, since Flash rejects it. Flash's spec confirms `expireTime` belongs on the quote only, not on `/order`. A live take-profit quote showed the order ending in 168 h and the permit in 192 h, which is exactly the 24 h buffer in Flash's docs, and the guard's expiry check now judges the permit against the order deadline instead of "now". The follower can't choose the length yet. A live limit quote could not be run because this machine lost DNS, but it uses the same code path as the take-profit.

### Smaller points from Flash's order-status docs
- **Gas can cancel small orders.** Flash cancels an order if gas and fees would exceed **30% of its value** (`REASON_EXECUTION_COST_EXCEEDS_LIMIT`). Our "careful" desk caps orders at $15, and a $15 TWAP split into slices could be cancelled for this reason. A minimum order size rule would prevent surprises.
- **Triggers already crossed get cancelled** (`REASON_ORDER_TRIGGERED_ON_ENTRY`). We should compare the trigger with the live price before asking for a quote.
- **Resting orders are cancelled automatically if the wallet's balance runs out** (`REASON_INSUFFICIENT_FUNDER_BALANCE`). The fill timeline should show Flash's `closeReason` clearly.
- **Statuses:** Flash has eight, including `PARTIALLY_FILLED` (a TWAP with some slices done) and `TERMINATED`. Make sure the timeline handles all of them.

---

## Part 5: Ideas ranked by value against effort

Effort is a rough guess: **S** about 1 to 3 hours, **M** about half a day, **L** a day or more. "Helps" says which prize the idea supports.

### Do these (high value, realistic)

**A. Policy backtest, "shadow mode" (M).**
Run a follower's rules over a leader's past trades and show what would have been allowed, shrunk or blocked, and what the result would have been. The decision function is a pure function PACT already has, so this needs no funds and no wallet. It answers the biggest copy-trading worry ("what would this leader have done to me?") before money moves.
*Helps:* Definitive (Social App), judging on Originality and Practicality. I did not find a product doing exactly this in my searches, but I can't promise nobody does.

**B. Rules that look at the token, not just the pair (S to M).**
Use Flash's `/search` data: block tokens with `riskFlagged: true`, block when the order is a large share of the pool's liquidity or a thin 24-hour volume, and add a minimum order size so gas can't eat the trade (Part 4). Today PACT only trades USDC and WETH, where these rules hardly matter. Widening to a short allowlist of other tokens makes the rules visibly useful, because token risk is the real danger in copy trading.
*Helps:* Definitive, Technicality.

**C. Fix Part 4's two problems (S).**
Not optional. A guard that refuses honest orders will embarrass the demo.

**D. Copy the exit too: attached brackets (M).**
Add a follower rule such as "every copied buy must carry a stop-loss at minus 8%." Flash's `attachedBracket` puts the stop-loss in the same flow, so the risk rule is enforced by the order itself, not by hope. The guard must verify the second payload as well. I have **not read** Flash's Bracket Orders page yet, so read it before committing.
*Helps:* Definitive "Most Creative" (advanced orders used in a new way).

**E. Human approval step with World ID (M).**
Add a fourth verdict, "needs human approval", for large orders, using World's Agent Pass step-up. See the earlier message. Add a stale-approval timeout of about five minutes, as MetaMask does.
*Helps:* World Continuity prize (up to $2,500).

**F. A PACT MCP server (M).**
Expose `propose`, `decide`, `quote`, `status` and `cancel` as MCP tools so an AI agent talks to PACT instead of Flash directly. "A firewall in front of the Flash MCP" is easy to explain and matches both Definitive's "built for agents" message and the tooling taste seen at Lisbon.
*Helps:* Definitive, WOW and Technicality.

### Consider if time allows

**G. Follower loss limits and a leader circuit breaker (M).** Daily loss limit, a cap per leader, and automatic pause after a set drawdown, as Bitget offers. Needs profit and loss from fills, which needs live prices.

**H. Leader scorecard and a "copy gap" metric (M).** Compute realized results from Flash fills. "Copy gap" is how much worse (or better) the follower's fill was than the leader's for the same trade. I did not see this on the platforms I read.

**I. Leaderboard and share link (S).** A cheap way to satisfy the "social" part of Definitive's prize wording.

**J. Base builder code (S).** About 10 lines plus a registration on base.dev. Low effort, small upside.

**K. Websocket for status (S to M).** Replaces polling. Nice, but invisible to judges.

### Roadmap only, don't build now

**L. A standing permission for hands-free copying (L).** The follower grants "up to $50 a day" once through ERC-7715, and copies run without a click. It is the most "advanced" idea here and the riskiest. Flash's order signature is checked against the wallet, and I don't know whether Flash accepts a smart-account or session-key signature. Ask the Flash team before spending any time on it.

**M. Multi-leader portfolios (L), Solana (L), cross-chain (L).** Too big for two days.

---

## Part 6: What I'd do with the time left

Order matters. Each step makes the next more believable.

1. **Fix Part 4 (C).** About 2 hours.
2. **Funded real fill on Base**, with an explorer link and a recorded demo. The most important proof you can show.
3. **Token-aware rules (B)**, including the minimum order size.
4. **Policy backtest (A).** This is the best "advanced" feature per hour spent.
5. **World ID approval step (E)**, if the docs match what I read.
6. **Then one of D or F**, whichever the first fill went smoothest for. Don't start both.
7. Leaderboard and share link (I), then the public repo and README.

Cut: L, M, G, H, K unless something finishes early.

### How to describe it without overselling
- "A firewall for trading intents: your rules decide what gets signed."
- "Before you copy anyone, replay your rules over their history."
- Avoid "secure" and "tested end to end" until a real fill exists.

---

## Part 7: What I could not verify

- **No competitor count or judging data.** Mumbai results do not exist yet, and I could not find how Definitive judged at past events.
- **Brackets and WebSocket details.** I read the overview of each, not the full pages.
- **Sources are mostly vendor blogs and comparison articles.** The platform comparison (Datawallet) and the agent-wallet guide (niteagent) are marketing-adjacent. The monthly hack-loss figure in the niteagent post (about $39.1M in August 2026) is second-hand, so I left it out of the analysis above.
- **Smart-account signatures with Flash** are untested and unknown to me.
- **World ID Agent Pass flow** is based on the docs overview. I have not read the step-up guide in detail.

---

## Sources

- Flash docs: https://flash.definitive.fi/docs (overview), `/for-agents`, `/minimal-authorization`, `/monetizing-your-integration`, `/post-trade-reporting`, `/order-statuses`, `/security`
- ETHGlobal Mumbai prizes: https://ethglobal.com/events/mumbai/prizes
- The Graph, ETHGlobal Lisbon 2026 winners: https://thegraph.com/blog/ethglobal-lisbon-2026-winners/
- Best crypto copy trading platforms, Datawallet: https://www.datawallet.com/crypto/best-crypto-copy-trading-platforms
- Agentic wallet security (policy-engine pattern), niteagent: https://niteagent.com/blog/agentic-wallet-security-2026/
- MetaMask Advanced Permissions (ERC-7715): https://metamask.io/en-GB/news/introducing-advanced-permissions
- ERC-7715: https://eips.ethereum.org/EIPS/eip-7715
- ERC-8004: https://eips.ethereum.org/EIPS/eip-8004
- Intents and solvers overview: https://crypto.news/what-are-intents-and-solvers-the-invisible-layer-executing-your-defi-trades/
- World ID Agent Pass docs: https://auth.world.org/docs
