# Company gap, MVS, SLIP — applied to PACT

Source for the framework: Underscore VC talk (Chris, underscore.vc) on the **product–company gap**. This note maps it onto narrow PACT and the open-source that already exists. Access date for OSS fetches: 2026-10-13.

The talk’s claim: a working product is not a company. Product–market fit is one step. You still need a **minimum viable segment**, a product that is **easy to sell** (go-to-market fit), and a **business model** that scales selling.

You started with a **product idea** (PACT). That is the usual path. The work now is to design GTM and pricing into the MVP so the hackathon demo is also the first wedge of a company — or to know, honestly, that this is a prize shot and not venture-scale.

## 1. Value proposition (check before more features)

**Job:** Mirror a leader’s *Flash order intent* (pair, side, TWAP/limit/stop) inside limits the leader and the model cannot break, while funds stay in **my** wallet.

**Four U’s (as used in the talk)**

| U | PACT |
| --- | --- |
| Unworkable | Copy bots want a hot key. Vaults want a deposit. Flash has no copy/policy API. |
| Unavoidable | People already follow wallets and KOLs. Agents will keep placing orders. |
| Urgent | After a bot or agent drain, “I’ll be careful” is not a control. |
| Underserved | Non-custodial **advanced orders** (TWAP/SL/TP), not another market-swap chatbot. |

**Three D’s**

| D | Honest read |
| --- | --- |
| Discontinuous | Yes vs Chamber: no vault share token; follower EOA signs Flash. |
| Defensible | Weak as a protocol. Flash can ship copy. Chamber can add Flash. Defense is distribution + policy UX + integrator relationship. |
| Disruptive | Only if SLIP is real (try in minutes, no IT, no deposit). |

**Black-and-white matrix**

Today: **latent + critical for a small group** (people who already ran a copy bot or will not deposit into a vault). Not yet blatant-critical like a phone. Chamber’s AI-vault marketing is the industry moving the same problem **up and to the right** — inside a vault. PACT is the EOA version of that move.

Willingness to pay is **unproven**. Do not pitch “alpha.” Pitch “the follower cannot be overrun.”

## 2. Product–company gap (Padient vs YouTube)

**Padient analog (failure to scale):** QR payments sold into Walmart/Best Buy IT. 10-year terminal cycle. Acquired, never a huge company.

PACT Padient risk: waiting for Definitive BD, or rebuilding Chamber, or needing an L1 IT department (Arc prize as a second product).

**YouTube analog:** insane product, no model, Google added ads.

PACT YouTube risk: social copy needs a network. You will not have 20M users this weekend. You **do** have a monetization primitive on day one: `flashIntegratorFeeBps`.

**iPhone analog:** touchscreen was the object; App Store + IAP was the company.

PACT iPhone analog: Flash TWAP is the object; **policy-gated follower signature + fee on copy** is the company. The App Store partner is **Definitive**, not ENS.

## 3. Minimum viable segment (do this, ignore the rest)

Grand vision (tell investors later): every agent and every KOL copy, every chain Flash supports.

**MVS for the next 90 days (and the weekend):**

> A Base USDC holder who wants to copy **one** leader’s **TWAP or limit** on Flash, with a hard USD cap, without depositing into a Chamber vault and without giving a bot their key.

Dominate that. The talk’s test: the segment is small enough that if you are right, you own it. Five followers of one leader, repeating, is the post-hackathon proof. Two wallets is the prize demo.

**Ignore until MVS is won**

- Solana sniper copy, Hyperliquid/GMX copy, Polymarket copy
- Enzyme / Yearn / Chamber vault UX
- ENSv2, World ID, Arkiv (unless a Mumbai prize page publishes and you add **one**)
- 1inch Aqua
- Multi-leader marketplaces, backtests, leaderboards, fake PnL

**How you would pick this MVS in the talk’s “200 customers” method** (after the event, cheap):

- Telegram/Discord copy-bot users: “would you keep USDC in your wallet if the bot could not exceed $X?”
- Chamber depositors: “why did you deposit instead of signing each order?”
- Definitive (the actual buyer this weekend): they already wrote the social/copy prize text.

You do not need 200 people before Nov 5. You need the MVS written on the README so you do not add features.

## 4. SLIP — design the MVP so it sells

Mnemonic from the talk: **S**imple to install/use, **L**ow/no initial cost, **I**nstant and ongoing value, **P**lays well in the ecosystem.

| Letter | PACT weekend | After event |
| --- | --- | --- |
| **S** | Web app, two labeled wallets, connect, numbers on one screen. No vault, no app install (Foodie QR lesson). | Same. Complexity is Chamber’s job. |
| **L** | Follower pays gas + Flash trading fees only. No AUM fee. Free to try one leader. Talk’s warning: forever-free reads as worthless — a trial that becomes bps is better. | `flashIntegratorFeeBps` on copied fills. Ladder: 1 leader free → extra leaders / higher daily cap paid. |
| **I** | BLOCK is instant (gain with no Flash). ALLOW fill in minutes. Self-proving: policy JSON vs Basescan `transactionId` (Pagos lesson). Time-to-value << 3 months; it is minutes. | Dashboard of “blocked notional” is the ongoing proof, not ROI. |
| **P** | **Flash is the Shopify.** Do not rebuild routing, TWAP, or MEV. MCP exists; use REST + browser sign in the product. | Definitive preferred-app / integrator listing is the Klaviyo move. Do not become the cloud that replaces Flash. |

**Pain/gain:** switching cost is “I already have a bot with my key” or “I already deposited in Chamber.” Gain must beat that in one session: Sign vs BLOCK, one hash.

## 5. Pricing (the question in the talk)

Do **not** price like a vault (management + performance). That is Chamber, and they already take a protocol cut.

Day-1 ladder (architect now, even if the demo fee is `0`):

1. **Free:** follow one leader, policy, BLOCK, one small TWAP (hackathon).
2. **Take rate:** `flashIntegratorFeeBps` on successful copy fills (Flash already pays this to the integrator).
3. **Cap upgrades:** higher `maxDailyUsd` / more leaders — subscription or extra bps.
4. **Never:** sell “alpha,” backtests, or custody.

If nobody repeats a copy after the weekend, you have a prize, not a company. That is an acceptable outcome; say it out loud.

## 6. R&D vs sales spend

The 40/20 SaaS benchmarks are for mature companies. For you this month: 100% product. The talk’s point still applies: **founder-led sales** is you showing two wallets to Definitive judges and then to five followers. Hire no “growth” until one leader has strangers copying twice.

Vision for VCs (if you ever want that path): non-custodial copy of professional order types as agents become the default trader. Seed investors bet on **you + that vision**, and they still want the small wedge first. If the TAM story is “social trading” vs eToro, they will say it is crowded. If the story is “Flash copy with fail-closed policy,” it is a feature unless you own distribution.

A lifestyle DeFi tool that earns integrator bps can be a good company without being a venture-scale one. Decide later. This weekend is the wedge.

## 7. Open source — reuse vs avoid

Fetched 2026-10-13. Quality bar: maintained, real docs, matches the **job** (follower-signed Flash copy). Most “copy trading” repos fail that bar on purpose: they **are** the hot-wallet bot.

### Reuse (reference, not a fork of the product)

| Repo | What it is | Use how |
| --- | --- | --- |
| [DefinitiveCo/flash-mcp](https://github.com/DefinitiveCo/flash-mcp) | Official quote → wrap/approve → sign → submit → poll. MIT. Tools include `flash_submit_signed_order` (external wallet). | **Read this.** Copy REST shapes. Do **not** run `flash_submit_order` against a follower key (custody). |
| Flash docs runnable TS | [market-order.md](https://flash.definitive.fi/docs/market-order.md), [twap-order.md](https://flash.definitive.fi/docs/twap-order.md) | Hour 0–12 scripts, then replace `privateKeyToAccount` with wagmi. |
| viem + wagmi | Industry default | Browser EIP-712. |

There is **no** good OSS for “policy-gated Flash copy.” That is the hole. Do not invent a protocol token to fill it this weekend.

### Study as competitors / foils (do not clone)

| Repo | Job | Why it is not PACT |
| --- | --- | --- |
| [dhedge/V2-Public](https://github.com/dhedge/V2-Public) | Chamber contracts: vault + Guard System | Deposit + manager/trader. They call it non-custodial because the manager cannot withdraw. Follower still leaves the EOA. |
| [dhedge/dhedge-v2-sdk](https://github.com/dhedge/dhedge-v2-sdk) | Create vaults, deposit, bot-trade as manager | SDK for **Chamber**. Using it makes you Chamber, not Flash copy. |
| [prathamesh-mutkure/agent-latch](https://github.com/prathamesh-mutkure/agent-latch) (DSAP, Tokyo 2026) | Agent spend limits, ENS policy, World ID ASK_HUMAN, Uniswap/x402 | High quality hackathon code. **Agent payments, not social copy, not Flash.** Cloning it loses originality. Steal the ALLOW/BLOCK/ASK_HUMAN *shape* only. |
| [gnosisguild/zodiac-modifier-roles](https://github.com/gnosisguild/zodiac-modifier-roles) | Onchain RBAC for Safes | Different account model (Safe). Weekend-expensive. |
| Copin Protocol org | GMX-style copy | Venue-specific perps, not Flash. |

### Do not use as a base (they are the problem)

These are copy-trade **bots** that run with the follower’s key or a funded bot wallet. Stars do not mean product-market fit for *your* user.

| Repo | Notes |
| --- | --- |
| [0xhamssog/pons-copy-trading-bot](https://github.com/0xhamssog/pons-copy-trading-bot) | Copies wallets on Robinhood Chain (Python). Hot-bot pattern. |
| [justFiveDev/Solana-Copy-Trading-Bot](https://github.com/justFiveDev/Solana-Copy-Trading-Bot) | Raydium/Pump.fun copy. |
| Hyperliquid / Polymarket copy bots on GitHub | Same pattern: classify wallets, replay fills, your key signs. |

If a judge asks “how is this different from GitHub copy bots?”: **those bots are the signer.** PACT’s follower is the signer; the bot cannot exceed policy.

### Not found (CONFIRMED absence in this pass)

- No GitHub org results for a Definitive Flash **copy-trading** app.
- `DefinitiveCo` public repos: `flash-mcp`, `definitive-public`, `railtail` — no social layer.
- No `copytrade solidity` hits in the search that returned. Onchain copy protocols that exist are vaults (Chamber/Enzyme) or venue-native.

## 8. What to build (DeFi track, company-shaped)

**Weekend (Classic, Definitive $3,500):** SLIP MVP. Two wallets, TWAP ALLOW, market BLOCK, real `transactionId`, integrator key, `forceMinimalAllowance`. Specs already in this repo.

**Company-shaped details that cost almost nothing this weekend (the talk’s “forethought”):**

- README states MVS in one sentence.
- Fee field exists (`flashIntegratorFeeBps`) even if `"0"`.
- Self-proving UI: policy numbers + BLOCK reason + Basescan.
- One sentence on Chamber: they guard vaults; you guard the Flash signature.
- Partner story: Definitive is the ecosystem, not a logo.

**Do not spend the weekend on:** token, vault, leaderboard, backtest, multi-chain, Aqua, ENSv2.

## 9. Pass/fail after Mumbai

| Signal | Means |
| --- | --- |
| Definitive prize or serious judge questions | Product–market fit for the **sponsor** (enough to keep going 2 weeks). |
| A stranger copies a leader a second time | Start of MVS. |
| Only teammates used it | Prize artifact. Park it. |
| Flash ships native copy | Feature risk. Stay on policy+UX or stop. |
| Users ask to deposit instead of sign | They wanted Chamber. Do not pivot into a worse vault. |
