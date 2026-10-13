# PACT evaluation

**Verdict: Build a much narrower version.**  
Not “build as proposed.” Not “abandon.” Not a full pivot unless Flash onchain execution is impossible before kickoff.

Access date: 2026-10-13.

## Scorecard (analyst 1–5, not a market fact)

| Criterion | Score | Evidence |
| --- | --- | --- |
| 1. Sponsor-prize alignment | 5 for Definitive; 2 for the rest until they publish | Mumbai Definitive prize literally lists copy trading, agent-run products others follow, Flash advanced orders, MCP |
| 2. Novelty vs previous winners | 4 if Flash+social; 1 if ENS+World+policy agent | DSAP/Axis/AegisNet already did policy+ENS+World. Nobody used Flash |
| 3. Competition | 3 | Chamber vault guards; CEX copy; Tokyo agent wallets. Different custody model |
| 4. Real user demand | 2 | Chamber’s existence is demand for *guarded delegated trading*. Demand for *non-custodial copy of TWAPs* is hypothesized |
| 5. Technical feasibility in 72h | 4 if you stay on Flash REST + one chain (Base) | MCP exists; docs are LLM-oriented. Mainnet-only is the tax |
| 6. Risk/safety complexity | 3 | Policy is offchain unless it gates the follower’s signature. Flash does not embed triggers in the signature |
| 7. Demo quality / judge comprehension | 5 if ALLOW vs BLOCK is the first 30 seconds | Matches World/Tokyo winning pattern |
| 8. Chance of 1st / specialist prize | 4 for Definitive $3.5k; 2 for $15k unpublished pools | Small pool, exact brief, few Flash-native rivals expected |
| 9. Ease of proving sponsor tech | 5 Definitive; 3 Arkiv; 2 ENS unless ENSv2 | Flash `transactionId` on GET order |
| 10. Post-hackathon commercial | 3 | Integrator fees exist; social trading is a graveyard; Chamber is the incumbent vault |
| 11. Scope risk | 2 as originally proposed; 4 if narrowed | Original: strategy market + agent + policy + Flash + ENS + Arkiv |
| 12. Feature vs decoration | ENS/Arkiv as proposed = decoration unless they are the decision log / name of record | DSAP only won the ENS argument because ENS was read every time |

**Weighted read:** the original PACT idea is pointed at the right prize and the wrong surface area.

## What Flash actually is (vs what PACT assumed)

| Assumption | Docs (2026-10-13) |
| --- | --- |
| DCA, stop-loss, take-profit, TWAP, limit, bracket | Documented. Prize page matches |
| Copy-trading protocol | **Not in the API.** You build social/copy |
| Flash enforces follower risk policy | **No.** Policy must run before `userSignature` |
| Conditional params in the signature | **No.** “held offchain by Flash’s execution engine and are not embedded in the signature” (non-custodial.md) |
| Testnet | **Not in supported-chains.md** |
| Leader can place orders in follower wallet | Only if follower (or a key they delegated) signs. If PACT’s backend holds the key, PACT *is* the custodian |

That last row is the product-defining choice.

## Closest competitors

| Competitor | Custody | Follower policy leader cannot override | Verified execution | Status | Difference PACT must keep |
| --- | --- | --- | --- | --- | --- |
| Chamber (dHEDGE) | Deposit into vault; manager or **one delegated trader** trades | Yes — Guard System onchain. Trader cannot withdraw depositor funds; default trader **can** change enabled assets unless turned off | Vault txs | Rebrand 26 Apr 2026; live since 2020 (self-claim) | PACT: funds stay in follower wallet; Flash order types; no vault share token |
| eToro copy | Broker | Platform risk tools, not user’s chain policy | Offchain | Live | PACT is non-custodial and onchain |
| Tokyo DSAP | Agent never holds key; DSAP executor does | ENS policy + human ask | Sepolia swaps / x402 | Hackathon | DSAP is agent spend, not following a trader’s strategy |
| Axis | Agent key on treasury | Mandate + World ID tiers | Uniswap API Sepolia | Hackathon | No social/copy; no Flash |
| Definitive Prime/Turbo | User signs in Definitive UI | Account-level product, not follower policies | Flash/engine | Live product | No copy-trading social layer in docs |
| Enzyme / Yearn | Vault | Strategy constraints | Onchain | Live | Vault, not copy of a person’s advanced orders |
| Hyperliquid / GMX copy (if any UI) | Venue-specific | Venue rules | Venue | Live-ish | Not Flash; not ETHGlobal sponsor |

**Table-stakes check:** personal risk controls are table stakes **inside Chamber vaults**. They are **not** table stakes on Flash, because Flash has no copy layer and no policy engine. Differentiation is real **if** the policy actually gates the signature. If policy is a UI banner and the agent signs anyway, PACT is weaker than Chamber and weaker than DSAP.

## Critical weaknesses and weekend fixes

| Weakness | Weekend-feasible fix |
| --- | --- |
| Policy bypassed if execution does not enforce it | **Follower signs every Flash `orderTypedData`.** Backend never has a key that can pull funds. Policy engine runs in the app; the Sign button is disabled on BLOCK. Optional: `forceMinimalAllowance: true` so leftover unlimited approvals are not the hole |
| Copying ≠ profitable | Demo **never** shows ROI. Show “mirrored intent under limits.” README: “PACT does not evaluate alpha” |
| SL/TP depend on liquidity / already-crossed triggers | Surface Flash `closeReason` (e.g. `REASON_ORDER_TRIGGERED_ON_ENTRY`). One demo order that Flash rejects for trigger-already-crossed |
| Track records are gameable | Do not show backtests. Show only orders PACT itself submitted, with `transactionId` |
| Audit log ≠ authorization | Log must include the policy decision, the hashed EIP-712 payload, and the Flash order id. Optional Arkiv entity if prize publishes |
| ENS + Arkiv decoration | MVP: skip. Stretch: Arkiv stores `{strategyVersion, proposal, decision, flashOrderId, tx}`. ENS only if Mumbai requires ENSv2 and you read the name at decision time |

## Proposed integrations — keep / cut

| Integration | Mumbai prize 2026-10-13 | Keep in MVP? |
| --- | --- | --- |
| Definitive Flash | Published, exact match | **Yes — the product** |
| ENS | Unpublished; Tokyo analog wants ENSv2 as core | No, unless prize publishes and you store policy on the name |
| Arkiv | Unpublished; product can store versions/logs | Stretch only |
| World | Unpublished; Tokyo analog is a strong second prize | Stretch: unique-human follower for ASK_HUMAN tier |
| 1inch Aqua | Published, different job | No |
| Chainlink / Arc / Hedera / 0G / Whitechain / EF | Unpublished | Do not block MVP |

## Original workflow vs required narrow workflow

Original: trader publishes strategy → follower sets policy → agent proposes → policy ALLOW/MODIFY/BLOCK → follower authorizes → venue executes → verify.

Keep that loop. Cut:

- Strategy marketplace with social graph
- Multi-chain
- DCA+TWAP+bracket all in one demo (pick **one** advanced type plus a market copy)
- Auto-execution without follower signature
- Performance charts
- Leader token / fees beyond a hardcoded `flashIntegratorFeeBps` if you have a key

Add:

- Two demo accounts: Leader and Follower
- One proposal that is ALLOW (small TWAP or limit) and one BLOCK (size or pair not allowed)
- Flash fill with Basescan link
- Discord+X video tagged @DefinitiveFi (eligibility)

## Candid verdict

**Build a much narrower version.**

Evidence: (1) Definitive’s published brief is PACT’s social-trading sentence. (2) Flash cannot be assumed to enforce policy — Chamber already does that onchain for vaults. (3) Tokyo 2026 burned the “agent policy + ENS + World ID” slot. (4) Scope of three sponsor integrations with two unpublished prizes is how you ship a bag of APIs. (5) Your advantage is reliability engineering: ALLOW/BLOCK, recovery, verification of the fill — not AMM research and not ENSv2 registries.
