# ETHGlobal Mumbai 2026 strategy

**Research cutoff:** 2026-10-13  
**Event:** ETHGlobal Mumbai, 5–7 November 2026, in-person, Mumbai, India  
**Recommendation:** Build a **narrow PACT** — policy-aware copy trading on Definitive Flash. Do not build the original three-sponsor PACT.

Companion files: `docs/README.md` and `ETHGlobal_Mumbai_2026_Research.xlsx`.

---

## Final decision (read this first)

### 1. Three best sponsor opportunities (verified fit)

1. **Definitive Flash — $3,500 social track (published).** Copy trading, agent-run products others follow, advanced orders, MCP, onchain demo, X+Discord video. This is the only Mumbai prize whose published text matches both PACT and an AI-reliability background. Amount is smaller than unpublished $15k pools; probability is higher because the brief is public and Flash had **no Tokyo 2026 winners**.
2. **1inch Aqua — $5,000 classic (published).** Clear rules, local forks allowed, SwapVM scored higher. Iceberg already shipped a mainnet Partially Active AMM at Tokyo 2026 three weeks earlier. Only take this if you have a *new position mechanism*, not an agent wrapper.
3. **Hold a slot for a $10–15k page that is still “coming soon.”** As of 2026-10-13 that is World ($12.5k), ENS ($10k), Arkiv ($15k), 0G, Arc, Hedera, EF, Uniswap, Whitechain, Chainlink. Tokyo/NY/Lisbon analogs suggest World ID for Agents, ENSv2 Sepolia, Arkiv queryable logs, Hedera agent payments, Chainlink CRE, 0G Compute. **Do not implement them until the Mumbai page publishes.** Recheck prizes on 1 Nov and at kickoff. You may select only **three** partners.

### 2. What distinguishes winners

Tokyo 2026 write-ups that loaded show: the sponsor primitive *is* the product; a fail-closed path (allow vs block); a real tx or allowed fork; honest about mocks; human approval bound to one action; tests and git history. Losers (pattern): chatbots, dashboards, cosmetic ENS, login-only World ID.

### 3. Where capital sits vs hackathon builders

Capital that was opened: Circle is a **public company** (NYSE 4 Jun 2025; Wikipedia SECONDARY) shipping **Arc L1** (blog 12 Aug 2025) plus a **Circle Agent Stack**. World/Tools for Humanity raised on the order of **$250M** (Wikipedia SECONDARY) and is on record exploring World ID to license AI agents (Jan 2025). Chamber rebranded from dHEDGE on **26 Apr 2026** as the vault layer for AI (“Agents can act, but the vault sets the rules”) with **trader delegation**. Definitive’s **round is still unopened**; the Mumbai **$3,500 social Flash bounty** is the only published capital aimed at non-custodial copy. Hackathon builders over-produce agent+ENS+World ID spend limiters (Tokyo) and under-produce **non-custodial social copy of advanced orders**.

### 4. Gaps that are real, not search holes

Real: Flash has no copy/policy API (docs). Chamber guards vaults, not “TWAP in my EOA.” Tokyo did not use Flash.  
Not real just because search failed: “nobody works on agent identity” (DSAP, Ohana, ENSIP-25/26).

### 5. Is PACT competitive?

The **idea** is aligned. The **proposed build** is too wide and partly saturated. ENS+Arkiv are unpublished and were specified as decoration. Flash will not enforce your policy (triggers are offchain, not in the signature). Narrow PACT is competitive for Definitive. Clone-of-DSAP is not.

### 6. What to build

Narrow PACT: leader strategy → follower policy → agent proposal → ALLOW/MODIFY/BLOCK → **follower signs Flash** → fill receipt. Primary prize Definitive. Backup: same engine, drop Flash only if the API is dead, then chase whichever large prize actually published — do not start Aqua on Saturday.

### 7. Smallest demo that proves the claim

Two wallets. Leader posts a small Base TWAP. Follower policy allows it; signature; Basescan hash. Leader posts a 500 USDC market; BLOCK; no order id.

### 8. What I would do in your position

Spend the next two weeks reading Flash `.md` docs and writing the policy function, not ENSv2. Get a Flash key and $20 on Base if Classic rules still allow tooling prep. At kickoff, ship the demo above. If World or Arkiv publish overnight, add ASK_HUMAN or a decision entity — one, not both. Attribute AI in the README. Tag @DefinitiveFi.

---

## Part 1 — The event

CONFIRMED from ethglobal.com (the `/events/mumbai` landing URL 500ed; `/events`, `/prizes`, `/info/details`, `/info/start` loaded).

- **Dates:** 5–7 Nov 2026. Submission **Sat 7 Nov 2026 09:00 IST**.
- **Stake ETH** to attend; teams ≤5; each member stakes.
- **Classic vs Continuity.** Classic: no prior project code; ineligible for partner prizes and Finalists if you cheat. Continuity: document the delta. 1inch and Definitive each have Continuity-only extra money.
- **≤3 partner prizes.** Multiple tracks of one partner count as one pick.
- **Video:** optional but pushed; 2–4 min; ≥720p; no AI voice; no phone.
- **Judging:** Technicality, Originality, Practicality, Usability, WOW. Finalist slot 4+3 minutes. Partners judge from the form; booth optional.

Venue Jio World Convention Centre is SECONDARY. India Crypto Research’s 6–8 Nov dates conflict with official 5–7. DevGrants’ $175k / World $20k (19 Sep 2026) conflict with the live 12-pool **$144,500** partner board (World $12,500). Finalist pool for Mumbai: UNPUBLISHED.

Full sponsor table: `docs/01-event-sponsors.md`.

**Published criteria exist only for Definitive and 1inch.** Everyone else: “Prize details coming soon.”

---

## Part 2 — Previous winners

Mumbai has not occurred. Definitive: **NO PRIOR ETHGLOBAL WINNERS FOUND**.

Tokyo 2026 (25–27 Sep 2026) is the relevant corpus (33 showcase projects). Inspected:

| Project | Why it matters to you |
| --- | --- |
| DSAP | ALLOW/BLOCK/ASK_HUMAN, ENS as policy store, World ID, MCP — **do not clone** |
| Axis | Three-tier treasury agent on Uniswap API |
| Iceberg | Aqua+v4 mainnet — **1inch bar** |
| Izanagi | Post-sign stop on x402 — reliability inspiration, not copy trading |
| NaAP | Agent crash tests; your skill theme, weaker Definitive fit |
| Tripwire | Circuit breaker; steal cancel-on-break as a PACT stretch |
| AegisNet / Ohana | Agent+ENS+Aqua+World — saturated combo |

Details: `docs/02-winners-and-patterns.md`.

---

## Part 3 — Success by category

The Mumbai board is heavy DeFi (1inch, Uniswap, Definitive, Arc), identity (World, ENS), AI infra (0G), data (Arkiv), oracles (Chainlink), alt-L1/L2 (Hedera, Whitechain, Arc). Consumer social is **named only in Definitive’s published track**.

Weekend-excellent: Flash social copy; Arkiv log if prize appears; World fail-closed approval if prize appears.  
Weekend-poor: RWA, DePIN, new L1-from-scratch, training models.  
Saturated: agent permission dashboards.

---

## Part 4 — Where the ecosystem is moving

Narrative: agents transact, x402, ERC-8004, World ID for Agents, ENSv2 namespaces.  
Capital (opened): Circle public-company Arc L1 + Agent Stack; World ~$250M identity raise (Wikipedia); Chamber vault+delegation product; Definitive Flash API. Round-level table for Definitive/0G/Arkiv is **still unopened** — see workbook sheet 5 and `research_notes/.../01-continuation-funding.md`.  
Building: Tokyo 2026 was an agent-permissions hackathon.  
Adoption: Flash and Chamber are production; x402 used in hackathon mainnet demos (Izanagi claim).  
Unsolved: policy at the signer; copy trading without vault deposit; Flash signatures that omit trigger semantics.

---

## Part 5 — Crosswalk

Type 1 funded+built: agent wallets with ENS/World limits — clone risk.  
Type 2 funded/sponsored+underbuilt: Flash social copy; Arkiv logs.  
Type 3 built+weak commerce: agent chatbots, decorative identity.  
Type 4 real gap: follower-signed, policy-gated Flash copy. Chamber is the substitute, with a different custody model.

---

## Part 6 — PACT

**Verdict: much narrower version.** Full evaluation: `docs/04-pact-evaluation.md`.

Flash confirms DCA/SL/TP/TWAP/limit/bracket. It does not confirm copy trading, testnet, or policy enforcement. Chamber already implements onchain guards for *vault* copy/delegation. PACT only differentiates if the follower signs and BLOCK cannot reach Flash.

Cut ENS and Arkiv from MVP. Keep the ALLOW/MODIFY/BLOCK loop.

---

## Part 7 — Three concepts

A. Narrow PACT (primary).  
B. 1inch Aqua novel position (backup only if you are already an AMM engineer).  
C. Flash Order Tripwire (module inside A, not the headline — prize wants social).

`docs/05-competing-concepts.md`.

---

## Part 8 — Winning strategy

Primary: Narrow PACT. Backup: do not context-switch to Aqua on Saturday; if Flash dies, live-demo BLOCK and recorded fill, then retarget a newly published partner you actually used.

Architecture, 72h plan, demo script: `docs/06-build-plan.md`.

---

## Part 9 — Workbook

`ETHGlobal_Mumbai_2026_Research.xlsx` — 13 sheets as specified.

---

## Counterarguments (required)

- **$3.5k is small.** True. Unpublished $15k prizes may dominate expected value *after they publish*. Until then, building for a blank page is how you miss Definitive too.
- **Chamber already did policy.** True for vaults. False for Flash EOAs. If judges want vaults, you lose; your demo must say “funds never left the follower wallet.”
- **Two wallets is not social.** Risk. Mitigate with a public leader feed URL and the X video the prize requires.
- **Mainnet Flash is a demo footgun.** Real. Pre-record a fill; keep sizes tiny; Base not Ethereum L1.
- **You might just be DSAP.** Only if you add ENS+World and skip Flash. Don’t.
