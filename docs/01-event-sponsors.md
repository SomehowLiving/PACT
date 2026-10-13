# ETHGlobal Mumbai 2026 — event, rules, sponsors

**Access date:** 2026-10-13. Status labels: CONFIRMED | ANALOG | UNPUBLISHED | SECONDARY | INFERENCE.

## Event facts (CONFIRMED unless noted)

| Field | Value | Source |
| --- | --- | --- |
| Name | ETHGlobal Mumbai | https://ethglobal.com/events |
| Dates | Thu 5 Nov – Sat 7 Nov 2026 | Same listing: “November 5 7 Thu — Sat” |
| Format | IRL hackathon, Mumbai, India | Same |
| Application | “Apply to Attend” still shown on events index | Same |
| Submission deadline | Saturday 7 Nov 2026, 09:00 IST. Late submissions not accepted | https://ethglobal.com/events/mumbai/info/details |
| How to submit | Hacker Dashboard: title, description, repository | Same |
| Demo video | Optional, strongly encouraged, 2–4 minutes, ≥720p, no AI voiceover, no phone recording, no music-over-text | Same |
| Partner prizes on form | Select **up to 3** partner prizes. Multiple tracks from one partner count as one selection | Same |
| Team size | Up to 5 people; solo allowed. Each member must be accepted and stake individually | https://ethglobal.com/events/mumbai/info/start |
| Attendance stake | Stake ETH; returned ~3 weeks after event if you submit | Same |
| Finalist judging | 7 minutes: 4 demo + 3 Q&A | details page |
| Partner judging | From submission materials. Booth visit optional, not required | details page |
| AI tools | Permitted with attribution. Spec-driven workflows allowed if specs/prompts are in the repo. Entirely AI-generated work may be ineligible for partner prizes / finalists | details page |

**Venue:** UNPUBLISHED on the official pages that loaded. SECONDARY sources (soliditydeveloper.com reviewed 2026-10-07; Coinpedia) name **Jio World Convention Centre, Bandra Kurla Complex, Mumbai 400098**.

**Main event landing page:** `https://ethglobal.com/events/mumbai` returned **HTTP 500** on 2026-10-13. Do not treat missing venue/total-pool copy on that URL as “no venue.” Use `/prizes` and `/info/*`.

**Date conflict:** India Crypto Research lists 6–8 Nov 2026. Official events index and details page use 5–7 Nov 2026. Trust official.

**Prize-pool conflict:** DevGrants Daily (2026-09-19) wrote “$175,000” and “World $20,000.” The live prizes page on 2026-10-13 lists 12 partner pools summing to **$144,500**, with World at **$12,500**. A separate Finalist pool is **UNPUBLISHED** for Mumbai (Lisbon 2026 had a $17,000 Finalist pack — ANALOG only).

## Tracks (CONFIRMED)

From details + start pages, and Tokyo 2026’s public “New for 2026” copy (ANALOG for the 2026 rule change, consistent with Mumbai details):

1. **Classic / Start Fresh / From Scratch.** Work begins after the hackathon starts. Prior project-specific code disqualifies partner prizes and the Finalist category.
2. **Continuity — Extend Open Source / Ship a Feature.** Existing codebase allowed if pre-existing work is documented and new work happened during the event. Partner eligibility “may vary by event and partner.”

Mumbai 1inch and Definitive both publish a **Continuity-only** sub-prize. Classic submissions should not count on those Continuity dollars.

Version control: large single commits / missing history may be disqualified.

## Official judging criteria (CONFIRMED)

1. Technicality  
2. Originality  
3. Practicality  
4. Usability (UI/UX/DX)  
5. WOW Factor  

No numeric rubric weights published.

## Mumbai sponsors (CONFIRMED 2026-10-13)

Source: https://ethglobal.com/events/mumbai/prizes and each `/prizes/{slug}` page.

| Sponsor | Product (from prize “About”) | Published prize | Exact eligibility | Desired project types | Required technical proof | Integration difficulty | Compatible sponsors | Missing information | Official sources |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| World | World ID / human vs AI identity and inclusive finance (world.org) | $12,500 | UNPUBLISHED | UNPUBLISHED | UNPUBLISHED | Medium if Tokyo-like IDKit / World ID for Agents | ENS, Definitive, Hedera, Chainlink | Entire prize text | https://ethglobal.com/events/mumbai/prizes/world |
| 1inch | Aqua + SwapVM self-custodial DeFi positions; SDKs across 17 EVM chains and Solana | $7,000 = Aqua $5,000 (1st 2500 / 2nd 1500 / 3rd 1000) + Continuity Aqua $2,000 (1500 / 500) | Official Aqua/SwapVM contracts (modified SwapVM redeploy allowed). Onchain token transfers in demo (local forks ok). Proper git history | Custom Aqua app = sophisticated DeFi position. SwapVM scores higher | Tests or UI showing the position; onchain (or fork) transfers | High (custom opcodes, contract size) | Uniswap v4, Arkiv (logs), Chainlink oracles | Scoring rubric beyond “SwapVM higher” | https://ethglobal.com/events/mumbai/prizes/1inch |
| 0G | L1 / “decentralized AI OS” (0g_labs) | $15,000 | UNPUBLISHED | UNPUBLISHED | UNPUBLISHED | High (own chain + compute/storage) | Arkiv, ENS, Hedera | Entire prize text | https://ethglobal.com/events/mumbai/prizes/0g |
| Uniswap Foundation | Uniswap protocol, Unichain, v4, grantees | $15,000 | UNPUBLISHED | UNPUBLISHED | UNPUBLISHED | Medium (API or v4 hook) | 1inch, Definitive, ENS | Entire prize text | https://ethglobal.com/events/mumbai/prizes/uniswap-foundation |
| Arc | Circle L1, EVM, “Economic OS”; lending, FX, payments. Product: testnet **and** mainnet (docs.arc.io); USDC gas; Circle Agent Stack on circle.com | $15,000 | UNPUBLISHED | UNPUBLISHED | UNPUBLISHED | Medium–High (new L1, USDC-native). Flash still has **no Arc testnet** in supported-chains.md | Chainlink, Hedera, World, Definitive (Flash lists `arc` chain id 5042) | Entire prize text | https://ethglobal.com/events/mumbai/prizes/arc ; https://www.circle.com/blog/introducing-arc-an-open-layer-1-blockchain-purpose-built-for-stablecoin-finance ; https://docs.arc.io/arc-chain.md |
| Hedera | EVM + JS/Java/Python/Rust/Go/Swift SDKs | $15,000 | UNPUBLISHED | UNPUBLISHED | UNPUBLISHED | Medium (Agent Kit exists) | World, ENS, 0G | Entire prize text | https://ethglobal.com/events/mumbai/prizes/hedera |
| Arkiv | Web3 database: wallet-owned, queryable, expiring entities. Ethereum, $GLM | $15,000 | UNPUBLISHED | UNPUBLISHED | UNPUBLISHED | Low–Medium (TS SDK, Tiramisu testnet) | Definitive (logs), ENS, 1inch | Entire prize text | https://ethglobal.com/events/mumbai/prizes/arkiv |
| Whitechain | ETHGlobal about text empty. Product site: WhiteBIT-backed OP Stack L2, WBT gas, Sepolia testnet chain id 1874, “Available on Testnet today” | $15,000 | UNPUBLISHED | UNPUBLISHED | UNPUBLISHED | Low for a Solidity deploy; product-fit unclear | Uniswap, 1inch | Prize criteria and even the ETHGlobal about blurb | https://ethglobal.com/events/mumbai/prizes/whitechain ; https://docs.whitechain.io/learn/introduction |
| Ethereum Foundation | Protocol / ecosystem steward | $15,000 | UNPUBLISHED | UNPUBLISHED | UNPUBLISHED | Varies | All | Entire prize text | https://ethglobal.com/events/mumbai/prizes/ethereum-foundation |
| ENS | “The universal pointer for anything on the internet.” | $10,000 | UNPUBLISHED | UNPUBLISHED | UNPUBLISHED | Medium if ENSv2 Sepolia (Tokyo analog) | World, Definitive, Arkiv | Entire prize text | https://ethglobal.com/events/mumbai/prizes/ens |
| Definitive | Flash API: advanced orders, 900+ sources, EVM+Solana, MCP for agents. Marketing claim $3B+ notional (MARKETING) | $5,000 = Social app $3,500 + Continuity creative $1,500 | Working Flash API or Flash MCP flow using DCA/Limit/Stop/Stop Loss/Take Profit/TWAP. Onchain execution in final demo. Short demo video on Discord **and** X, tag @DefinitiveFi | Social trading agent/app: copy trading, signals/leaderboards to X/TikTok, agent-run products others follow, any shared-experience trading | Live Flash order + onchain fill; social demo video | Low–Medium (REST + MCP; **mainnet only** in published chain list) | ENS (identity), Arkiv (log), World (unique follower), Arc (Flash supports `arc`) | Rubric weights; testnet; whether “social” can be a two-wallet local demo | https://ethglobal.com/events/mumbai/prizes/definitive |
| Chainlink | Oracle network | $5,000 | UNPUBLISHED | UNPUBLISHED | UNPUBLISHED | Medium (CRE analog from NY 2026) | Arc, Hedera, 1inch, Definitive | Entire prize text | https://ethglobal.com/events/mumbai/prizes/chainlink |

**Published vs unpublished:** Only **1inch** and **Definitive** have prize criteria on Mumbai pages as of 2026-10-13. Ten of twelve say “Prize details coming soon.”

## Analog prize text (NOT Mumbai rules)

Use these only to guess what might appear, and to pre-read SDKs.

### World — ETHGlobal Tokyo 2026 ($15,000) ANALOG

- Best Use of IDKit $5,000 (2×$2,500): real trust moment, proportionate credential, success **and** failure path, integration debrief.
- Best Use of World ID for Agents $7,500 (3×$2,500): complete request → completion → validated result → protected action; **denied/expired path must not execute**; validate on backend.
- Continuity IDKit $2,500.

Source: https://ethglobal.com/events/tokyo2026/prizes/world

### ENS — Tokyo 2026 ($10,000) ANALOG

- Best Use of ENSv2 $7,000: **must be ENSv2 on Sepolia**, features central not cosmetic, live demo, open source. Bonus for AI agents as namespaces / EAC / Permissioned Resolver.
- Continuity ENSv2 into existing project $3,000.

Source: https://ethglobal.com/events/tokyo2026/prizes/ens

### Uniswap Foundation — Tokyo 2026 / NY 2026 ANALOG

Tokyo: Best Uniswap Stack Contribution; public GitHub, **FEEDBACK.md**, Uniswap Developer Feedback Form.  
NY 2026: Best Uniswap API Integration required **transaction IDs**, README, ≤3 min video, feedback form.

### 0G — Lisbon 2026 ($15,000) ANALOG

Best AI Product on 0G required **0G Compute / Private Computer for inference**, live demo, contract addresses. Infrastructure track separate. Continuity track for prior 0G work.

### Hedera — Lisbon 2026 / NY 2026 ANALOG

“AI & Agentic Payments on Hedera”: at least one payment/token/financial op on **Hedera Testnet**; Agent Kit / x402 / ACP; ≤5 min video. Optional ERC-8004 / HCS.

### Arc — NY 2026 ANALOG

Circle Arc: USDC/EURC, agentic payments, prediction markets, continuity. Collaborative bounty with Dynamic + Unlink for private nanopayments. Functional frontend+backend, architecture diagram, video, repo.

### Chainlink — NY 2026 ANALOG

CRE workflows (simulate via CLI is enough); CCIP/Feeds/Data Streams/PoR/VRF with **onchain state change**; Confidential AI Attester; Continuity upgrade. Functions/Automation called deprecated in that prize text.

## Definitive Flash — technical facts (CONFIRMED from docs, 2026-10-13)

Docs: https://flash.definitive.fi/docs and `.md` equivalents.

| Topic | What docs say |
| --- | --- |
| Order types | Market, Limit, Stop Loss, Take Profit, TWAP, DCA, Cross-Chain, Bracket, Stop / Stop Buy (prize page lists these) |
| Auth | API key `x-definitive-api-key`. Per-order `userSignature` (EIP-712 on EVM). Optional Permit2. ERC-20 approve once |
| Custody | Funds stay in user wallet until atomic execution. No intermediate holding contract |
| Policy in Flash | **NOT FOUND IN DOCS.** Flash does not evaluate follower risk policies. Conditional params (limit, TWAP, trigger) are held **offchain** by Flash’s engine and are **not embedded in the signature** (non-custodial.md) |
| Bounded spend | `forceMinimalAllowance: true` bounds ERC-20/Permit2/Solana delegation to required amount; Permit2 duration = latest order deadline + 24h if every order has `expireTime` |
| Chains | Mainnets only in supported-chains.md: arbitrum, **arc (5042)**, avalanche, base, bsc, ethereum, hyperevm, ink, monad, optimism, plasma, polygon, robinhood, solana |
| Testnet | **NOT FOUND IN DOCS** |
| Copy trading API | **NOT FOUND IN DOCS.** Prize page asks *you* to build social/copy on top of Flash |
| MCP | `@definitive-fi/flash-mcp` — setup, quote, balances, submit, get, list, cancel |
| Proof of fill | `GET /orders/{id}` returns fills, `transactionId`, venues, fees |
| Monetization | `flashIntegratorFeeBps` on quote and order |
| Public integrator key in docs | `dpka_513a2bd7_57a2_46d2_927b_2a3857fe271b` for playground/trading; own key for fee attribution |

**Failure points:** mainnet funds and gas; API key issuance (email account at app.definitive.fi); unlimited default approvals if you skip `forceMinimalAllowance`; policy bypass if a backend key signs without the engine; trigger already crossed → `REASON_ORDER_TRIGGERED_ON_ENTRY`; no Flash-native copy ledger.

## Arkiv — technical facts (CONFIRMED product docs; prize UNPUBLISHED)

https://docs.arkiv.network/start-here/fundamentals and cookbook.

- Entities with typed attributes, wallet-owned, expire at a chosen block.
- Query language (no external indexer). Writes are signed Ethereum txs.
- Tiramisu testnet: network id 7738577, RPC `https://rpc.tiramisu.db-chain.testnet.arkiv.network`.
- TS SDK `@arkiv-network/sdk`, agent skills repo Arkiv-Network/skills.
- Cookbook includes user profiles and leaderboards — strategy versions + execution records are a natural entity model (**INFERENCE**, not a prize rule).

## ENS — technical facts

- Mumbai about text is one sentence. Tokyo 2026 (ANALOG) required **ENSv2 Sepolia**, Permissioned Registry/Resolver, Enhanced Access Control, agent namespaces.
- App-developer quickstart still uses wagmi `useEnsName` / `useEnsAvatar` on chainId 1: https://docs.ens.domains/web/quickstart/
- Cosmetic `.eth` display on a Flash app is unlikely to win an ENSv2-style prize.

## 1inch Aqua — technical facts (CONFIRMED prize + GitHub)

- Contracts: https://github.com/1inch/aqua , SwapVM https://github.com/1inch/swap-vm
- SDK: https://github.com/1inch/sdks/tree/master/typescript/aqua
- Local forks allowed for the onchain-transfer demo.
- Tokyo 2026 Iceberg shipped custom opcodes + Uniswap v4 hook **on Base mainnet** — that is the bar.

## Partner combinations that are one product (INFERENCE)

| Combination | Product, not a bag |
| --- | --- |
| Definitive + (World if published) | Unique-human follower must approve oversized copies |
| Definitive + (ENS if ENSv2 published) | Leader/strategy/agent names as source of policy, only if ENS is read at decision time (DSAP pattern) |
| Definitive + Arkiv | Queryable strategy versions + ALLOW/BLOCK/FILL records |
| Definitive + Arc | Flash already lists Arc as a chain — only if Arc prize wants USDC settlement on Arc |
| 1inch Aqua + Uniswap v4 | Iceberg already did this at Tokyo. Need a new mechanism |
| World + Hedera + x402 | Agentic payments with personhood — crowded after Tokyo |

**Do not** wire 1inch Aqua and Flash in the MVP. They solve different jobs (AMM position vs order execution).
