# Three competing project concepts

## A. Narrow PACT — Policy-Aware Copy on Flash (primary)

**User:** A follower who wants to mirror a trader’s *order intent* without depositing into a vault or handing an agent their key.

**Pain:** Copy bots want a hot wallet. Vaults (Chamber) require depositing. Flash can place TWAP/SL/TP but has no copy or policy layer.

**Workflow:**

1. Leader posts a structured Strategy (chain, pair, side, orderType, qty or qtyPct, optional trigger).
2. Follower attaches Policy (maxNotionalUsd, maxDailyUsd, allowPairs, allowOrderTypes, maxSlippage).
3. Agent maps the latest leader order into a Flash quote request.
4. Policy engine returns ALLOW / MODIFY (clip qty) / BLOCK with reasons.
5. Follower signs Flash `orderTypedData` only on ALLOW/MODIFY.
6. `POST /order`; UI polls `GET /orders/{id}` until FILLED/REJECTED; show `transactionId`.

**Smallest MVP:** two wallets on Base, one ALLOW TWAP or limit, one BLOCK oversized market, both decisions visible, one real fill.

**Sponsors:** Primary Definitive. Secondary only if published: World (ASK_HUMAN), Arkiv (log), ENS (leader name as record).

**Precedents:** Definitive prize text; DSAP’s ALLOW/BLOCK (do not copy ENS/World unless needed); Chamber as commercial foil.

**Demo proves:** Flash advanced order + social copy + policy that can stop a signature.

**72h:** REST quote/sign/submit, policy module, two-account UI, Discord/X video.

**Do not build:** vaults, backtests, ENSv2 registries, Aqua, multi-chain, auto-signer.

**Risks:** mainnet Flash; API key; “not social enough.” Mitigation: two-person live follow; pre-fund tiny USDC; recorded backup fill.

**Why it can win:** it is the prize brief.

**After the event:** integrator fee on copy flow; only proceed if strangers follow a leader twice.

---

## B. Prize-max published alternative — 1inch Aqua position (not recommended as primary)

**User:** LP who wants a self-custodial position with a new curve/guard.

**Pain:** LVR / idle liquidity. Iceberg already answered this at Tokyo.

**Workflow:** custom SwapVM instruction + tests + one fork or mainnet fill.

**MVP:** one opcode, invariant tests, UI or script that swaps.

**Sponsors:** 1inch $5k classic. Optional Uniswap v4 if that prize publishes.

**Precedents:** Iceberg (the bar), RateSpace.

**72h:** only if you already understand SwapVM this week.

**Do not build:** an agent wrapper around Aqua (Ohana/AegisNet).

**Why it could win:** published criteria, local forks allowed, $5k+$2k continuity.

**Why not you:** Iceberg-level Solidity in a weekend fights Tokyo’s winner; weaker fit to agent-reliability skills than PACT.

---

## C. Unconventional gap — Flash Order Tripwire (reliability product)

**User:** a team whose agent or copy bot places Flash orders.

**Pain:** NaAP’s claim: losses happen when the executor acts on untrusted text. Flash signatures do not include trigger/limit semantics. After submit, you need cancel/pause when policy or market state breaks.

**Workflow:**

1. Every proposed Flash order is a typed intent.
2. Pre-trade: policy + `forceMinimalAllowance` + simulation of quote.
3. Post-trade: poll Flash order status; if closeReason or fill deviation exceeds bound, `cancel` while status is PENDING/ACCEPTED/PARTIALLY_FILLED.
4. Optional Arkiv log of intents vs fills.

**MVP:** submit a TWAP, then cancel remaining slices when a fake “drawdown” policy trips; show status machine.

**Sponsors:** Definitive Continuity track is a poor fit if you start from scratch. Classic social prize is a weaker match unless you frame “team trading ops” as social. Arkiv if published.

**Precedents:** Tripwire, NaAP, Flash cancel docs.

**Why unconventional:** ops console, not a consumer copy app.

**Why it might lose Definitive:** prize wants a *social app*, not a circuit breaker.

**Use as a module inside A**, not as the headline, unless Definitive judges at the booth clearly prefer infra.

---

## Choice

Ship **A**, steal **C**’s cancel-on-policy-break as a stretch, ignore **B** unless Flash is dead on Friday night.
