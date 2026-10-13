# Previous winners and category patterns

**Access date:** 2026-10-13. Mumbai 2026 has not run yet, so there are **no Mumbai winners**. Closest event with overlapping sponsors and public showcase: **ETHGlobal Tokyo 2026** (25–27 Sep 2026). Definitive was **not** a Tokyo 2026 sponsor. **NO PRIOR DEFINITIVE ETHGLOBAL WINNERS FOUND** on showcase pages fetched.

Showcase index: https://ethglobal.com/showcase?event=tokyo2026 (33 projects listed). Prize *place* (1st/2nd) is often **not shown** on project pages — treat as “submitted at Tokyo 2026,” not as a confirmed first-place unless the page says so.

## What first place looks like (observed, not official rubric)

From project write-ups that actually loaded:

1. **The sponsor primitive is the product.** DSAP reads ENSv2 text records on every decision. Iceberg *is* a SwapVM opcode + v4 hook. Tap Pay refuses to show Pay until ENSv2 resolves the merchant.
2. **A visible fail-closed path.** Allowed action vs blocked action, with a reason. Axis, DSAP, Izanagi, NaAP, Agent PayGuard all demo this.
3. **Onchain or fork proof**, not a mocked swap. Iceberg: Base mainnet + Basescan. Izanagi: Base mainnet real USDC. 1inch prize explicitly allows local forks.
4. **Honest about what is not live.** Agent PayGuard states signing is disconnected. My Agent Ohana says tokens are valueless mocks. Judges appear to tolerate honesty; they punish fake completeness (INFERENCE from write-up tone, not a judge quote).
5. **Human-in-the-loop is bound to one action**, not a login screen. World ID analog prize text required this; Axis and DSAP implemented it.
6. **Git history and tests.** Iceberg: 52 Foundry tests. DSAP: six hook tests including `PermitMissing()` revert.

## Sponsor-by-sponsor (useful projects)

### Definitive

NO PRIOR WINNERS FOUND. Queries: ETHGlobal Tokyo/Lisbon/NY 2026 prize lists (no Definitive); showcase search. Mumbai is the first ETHGlobal prize page in this set that names Flash.

### 1inch Aqua / SwapVM

| Project | Event | What it actually built | Novelty | Functional? | Repo |
| --- | --- | --- | --- | --- | --- |
| Iceberg | Tokyo 2026 | Partially Active AMM: custom SwapVM opcodes + Uniswap v4 hook; idle reserves in Morpho; λ from real prices; 17.6–19.3% LVR cut in a 21 Sep 2026 replay | New AMM mechanism, not a wrapper | Live Base mainnet; 52 tests | https://github.com/SudeepGowda55/Iceberg https://ethglobal.com/showcase/iceberg-ea5f9 |
| RateSpace | Tokyo 2026 | Swap any staked-ETH token on Aqua at live oracle rate from one shared ETH balance (showcase blurb only) | Shared-balance LST AMM | UNVERIFIED beyond blurb | https://ethglobal.com/showcase/ratespace-ke33e |
| My Agent Ohana | Tokyo 2026 | Consent layer + ENSv2 names + Aqua pool with 1% cap per verified human | Agent blessing + Aqua custody-keeping balances | Sepolia; tokens disclosed as mocks | https://github.com/shakaleikaumaka/my-agent-ohana https://ethglobal.com/showcase/my-agent-ohana-v04gz |
| AegisNet | Tokyo 2026 | ENSv2 + SwapVM scripts + v4 AgentGatedHook + World ID | Permissioned agent matrix | Write-up is thinner on live txs than Iceberg/DSAP | https://github.com/shriyashsoni/aegisnet.eth https://ethglobal.com/showcase/aegisnet-3zc9u |

**1inch preference (INFERENCE from Iceberg vs AegisNet):** a new onchain position mechanism beats “agent calls Aqua.” SwapVM opcodes and a demo trade (or fork) are the proof.

### ENS / World / agent permissions (Tokyo 2026)

| Project | Problem | Workflow | Implementation | Novel vs thin API | Follow-on | Links |
| --- | --- | --- | --- | --- | --- | --- |
| DSAP Protocol | Give an agent a budget without giving it a key | Agent asks DSAP; ALLOW / BLOCK / ASK HUMAN; policy in ENSv2 text records | ENSv2 Permissioned Resolver; World ID for Agents on backend; Uniswap v4 LatchGateHook; x402 + Intercepta; MCP | ENS is source of truth; policy is a pure function; hook reverts without permit | NO FOLLOW-ON EVIDENCE FOUND | https://ethglobal.com/showcase/dsap-protocol-87152 https://github.com/prathamesh-mutkure/agent-latch |
| Axis | Treasury agent that can drain if unconstrained | 50/50 ETH-USDC; small auto, medium World ID, large blocked; EIP-712 mandate | Uniswap Trading API Sepolia; World ID OIDC; in-memory state | Three-tier policy + bound World ID approval | NO FOLLOW-ON EVIDENCE FOUND | https://ethglobal.com/showcase/axis-ybtp8 |
| Izanagi | x402 payment still stealable after sign | Pre-sign Intercepta + World ID; **post-sign revoke** via EIP-1271 on Coinbase x402 escrow | Countersign.sol on Base mainnet; real USDC; MCP | Post-signature stop — rare | NO FOLLOW-ON EVIDENCE FOUND | https://ethglobal.com/showcase/izanagi-0f8r1 https://github.com/Manvith-Shetty/Izanagi |
| NaAP | Agents crash on known incident patterns | Bare lane vs “airbag” policy; ENS-published incidents | Base-mainnet anvil fork; ENSv2 ratings; MCP | Crash-test product, not a wallet | NO FOLLOW-ON EVIDENCE FOUND | https://ethglobal.com/showcase/naap-9erp9 https://github.com/HemangVora/naap |
| Tollgate | Agents can’t buy leftover API credits | 402 per call; ENS listing; Intercepta; Curvegrid verify | Cloudflare Workers; Base Sepolia USDC; Privy | Marketplace, not just a payment demo | NO FOLLOW-ON EVIDENCE FOUND | https://ethglobal.com/showcase/tollgate-gq4dx |
| Agent PayGuard | Pre-signing control for agent purchases | Intercepta recipient check | Prototype; **signing disconnected** | Honest incomplete | n/a | https://ethglobal.com/showcase/agent-payguard-7pav2 |
| Tap Pay | Phone POS without trusting NFC payload | ENSv2 verify merchant before Pay button; Uniswap exact-output USDC | Android NFC + Sepolia ENSv2 + Base Sepolia | Identity is the security boundary | NO FOLLOW-ON EVIDENCE FOUND | https://ethglobal.com/showcase/tap-pay-4bcvt |
| Tripwire | Exploits outrun humans | Self-hosted circuit breaker; pause at N+1 | Mainnet demo contracts; MCP proposes rules off-by-default | Ops tool, not a dapp dashboard | NO FOLLOW-ON EVIDENCE FOUND | https://ethglobal.com/showcase/tripwire-7bqxn |

**World / ENS preference:** a protected action with a failed path. Login-only World ID and avatar-only ENS are the losing pattern.

### Arkiv

NO PRIOR HACKATHON WINNERS FOUND on ETHGlobal showcase fetches. Product is young (Tiramisu testnet). Closest evidence: official cookbooks (profiles, leaderboards), not prize winners.

## Category table

| Category | Observed winning patterns | Representative projects | Common weaknesses | Mumbai sponsor relevance | Remaining opportunities |
| --- | --- | --- | --- | --- | --- |
| AI / autonomous agents | Policy between model and money; MCP; fail-closed; identity for agent or owner | DSAP, Axis, Izanagi, NaAP, AegisNet | Chatbots; agents that “just swap”; no denial path | Definitive (published), 0G/World/Hedera/ENS unpublished | **Social copy** of advanced orders — not done at Tokyo |
| DeFi / advanced trading | New mechanism (hook, opcode), mainnet or fork proof, numbers | Iceberg, OniBlock, RateSpace | Dashboards over a router | 1inch published; Uniswap/Definitive | Copy-trading *execution quality* (TWAP/SL) not AMM design |
| Social / consumer | Shared experience with money actually moving | KawaiPay, Tap Pay, ScalpLess | Leaderboards with fake stats | Definitive social prize **explicit** | Copy trading as a two-sided product |
| Wallets / AA / automation | Session limits, post-sign stop, mandate signatures | Izanagi, Axis, DSAP | Infinite approvals | Definitive `forceMinimalAllowance` | Bound Flash permits to policy |
| Smart-contract security | Pause before humans; exploit proof | Tripwire, NaAP Deploy Guard | Scanners with no action | EF/Chainlink unpublished | Circuit breaker for copy-trading agents |
| Identity / permissions | ENS as policy store; World ID bound to one action | DSAP, Tap Pay, Ohana | Cosmetic `.eth` | ENS, World unpublished | Only if prize pages publish ENSv2 / Agents |
| Cross-chain | SuwappuBot blurb (SDK/MCP/Telegram) | SuwappuBot | Bridges with no user | Flash lists cross-chain orders | Secondary; don’t make it the demo |
| Stablecoins / payments | x402 + USDC + screen payee | Izanagi, Tollgate, KawaiPay | 402 wrappers with no risk check | Arc, Hedera, World unpublished | Machine payments ≠ Flash social prize |
| RWA / tokenization | Brick Finance, Unison blurbs | Brick Finance | Fake NAV | Arc analog | Weak weekend fit |
| Data / indexing / storage | Arkiv queryable entities; Tripwire evidence | (no Arkiv winners) | Decorative IPFS links | Arkiv $15k unpublished | Versioned strategy + decision log |
| Privacy / ZK | Thin at Tokyo 2026 list | Himitsu blurb | ZK for its own sake | World, Chainlink Confidential AI analog | Not MVP |
| DePIN | Waterline GPU proof; Dedan CDN | Waterline | Hardware theater | Weak | Skip |
| Devtools | Tripwire MCP; NaAP arena | Tripwire, NaAP | Tools with no user | 0G infra analog | Agent reliability tests — your background, weaker Definitive fit |
| Gaming | Mental Poker blurb | Mental Poker | Unfinished games | Weak | Skip |

## Saturated at Mumbai if you copy Tokyo

- Agent spend limiter + ENS text records + World ID approval (DSAP, Axis, AegisNet, Ohana).
- x402 paywall + Intercepta screen (Tollgate, Izanagi, Agent PayGuard).
- “AI agent that trades on Uniswap.”
- Generic protocol dashboard.
- Cosmetic ENS names.

## Not saturated

- **Copy trading / social following using Flash advanced orders.** Definitive is asking for it; Tokyo winners did not use Flash.
- Follower-owned wallet + per-order EIP-712 signature + deterministic policy **before** the only signature Flash will honor.
- Visible TWAP / stop-loss / take-profit as the social object (not a market swap chatbot).

## Weekend feasibility vs wow

High wow, weekend-feasible: Flash quote→sign→submit on Base with a blocked oversized copy.  
High wow, painful: custom SwapVM opcodes (Iceberg-level).  
Low wow: ENS avatar next to a swap.
