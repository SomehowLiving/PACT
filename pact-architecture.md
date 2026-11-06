# PACT — Production Architecture, Novelty and Build Order

Status date: November 6, 2026, 10:50 UTC · Submission: Sat 7 Nov 09:00 IST (03:30 UTC), about 16 hours away

This document reconciles three bodies of work and turns them into one layered design:

1. **Ideation** — `ideation/pact-depth.md` (Architecture & Scenario Handbook v0.2),
   `ideation/details.md`, `ideation/more-details.md`.
2. **Research** — an audit of PACT's Flash integration against Flash's docs, OpenAPI and
   about 15 live quote requests (no orders placed); and a source-code study of 15 apps built on Flash
   (flash-mcp, governed-flash-trader, Poros, Wayfinder, corvo-flash, shomei, phon3, sail,
   base-agent, Aegis and others, plus the Cantina audit of the settlement contract).
3. **The code** — what `pact/` actually does today (`pact-design.md`, `pact-ui-audit.md`).

Where the three disagree, this document says which one wins and why.

---

## 1. Reconciliation: what holds, what changes

| # | Claim (source) | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | "Entry drift becomes a hard bound, **enforced on-chain**" (handbook R3, demo number 1) | **Corrected.** The bound is real but enforced by **Flash's execution engine**, not by the signature or a contract. | The signed `FlashOrder` struct is `swapper, vault, recipient, fromToken, toToken, fromAmount, salt, deadline`. It has no price field (Wayfinder `FLASH_ORDER_FIELDS`, Poros `flash-orders.ts:22`, live typed data). blue-agent's call notes: "price protection is in Flash's offchain engine". |
| 2 | Signature guarantees what can happen to funds | **Holds, and is stronger than we say.** The signature binds the tokens, the maximum spend, recipient = the follower, and the deadline. A tampered price or trigger can only mis-time a trade back into the follower's own wallet; it cannot redirect funds. | Same struct; Cantina audit §3.1 (`pullFlashAllowance`). |
| 3 | Drift is wired via `limitCrossPrice` (details, more-details) | **Partly.** Both bases exist and are mutually exclusive. PACT uses `limitNotionalPrice`, which is valid for TWAP; **limit + attached bracket requires `limitCrossPrice`**, which PACT does not send. | Live: `400 "attached_bracket limit entries require limit_cross_price in v1"`. |
| 4 | "Breaker tripped = one signature cancels everything" (demo number 2) | **Corrected.** Batch cancel exists (up to 25 orders, one funder signature), but (a) **cancelling an entry does not cancel its attached bracket**, so the legs must be in the batch; (b) the breaker cannot sign, so the follower (or a future session key) signs at trip time. | docs `cancelling-orders`, `batch-cancel`; PACT stores no bracket leg ids today. |
| 5 | "Exit anytime, zero lockup" (demo number 3) | **Holds.** | Non-custodial by construction; cancel is idempotent. |
| 6 | Copy-eligibility requires the leader's matching Flash order (handbook L3, R15) | **Mechanism changes.** `GET /orders/{id}` only sees orders in **PACT's own API-key portfolio** (wrong funder → 404). An outside leader can never pass today, and PACT does not compare the order to the plan anyway. Workaround: verify leader fills **onchain** from the fill transactions (transfers out of and into the leader, the signed order recovering to the leader), or have leaders trade through PACT. | live 404s; shomei "orders placed under a different integrator key are not listed"; Cantina "order and signatures are visible on-chain". |
| 7 | Orders WebSocket for live TWAP progress | **Holds.** `wss://flash.definitive.fi/v1/ws`; subscribe `{channel:"orders", type:"subscribe", funderAddress, apiKey}` with heartbeats; snapshot then updates. `completedFillCount` is on the stream, not the REST order. | docs; phon3 `wsRelay.ts`. |
| 8 | REST is 5 req/s per endpoint per key | **Holds.** | docs `rate-limits`. |
| 9 | Execution cost > 30% → `REASON_EXECUTION_COST_EXCEEDS_LIMIT` | **Holds; unknown whether per TWAP slice or per order.** At demo sizes fees are 1.3% ($5 TWAP, 6 slices), 4.0% ($5 + bracket), 1.7% ($30 + bracket), 19% ($1). | live quotes `fees.estimatedFeeNotional`. |
| 10 | Fees: 10 bps promo through 2026, 20 bps after; integrator fee is ours | **Holds.** `flashIntegratorFeeBps` must be a string, and `"0"` is rejected (omit it instead). `erc8021AttributionCode` goes on the order only. | docs; shomei FEEDBACK, phon3 `monetization.ts`. |
| 11 | Trailing-stop exit mode (details) | **Holds with limits.** `trailing-stop(-limit)` exists (`trailPercent` 0.005–0.5, optional `activationPrice`), **cannot be modified, and cannot be attached** to an entry. It is a standalone order placed after the fill. | docs `placing-orders`. |
| 12 | Leverage cap, liquidation, funding (handbook R2, B3, D2) | **Not applicable to current scope.** PACT on Flash is spot on EVM. Ruin risk is expressed through size, stop-risk and concentration, not leverage. Keep these rules dormant until a perp venue exists. | Flash order types; PACT pairs. |
| 13 | Auto-ALLOW under a cap (details §2b, handbook F2) | **Feasible, with a hard boundary.** It needs delegated signing. An EIP-7702 ZeroDev Kernel account's signatures are accepted by Flash through ERC-1271 (Wayfinder), and a session-key validator can enforce every *signed* field (tokens, amount, recipient = self, vault, deadline) **onchain**. Price cannot be bound onchain. A Safe's 1271 handler accepts only the owner, so a Safe cannot do it (sail). | Wayfinder `adapter.py`; sail `src/sail.ts`. |
| 14 | Shadow-copy probation (more-details #1, handbook F4) | **Feasible.** It is quote-only, which is exactly what governed-flash-trader runs. Budget: 5 req/s for `/quote` per key. | governed-flash-trader. |
| 15 | Append-only receipts, hash-linked (handbook §8) | **Not built.** Today: a local JSON file. Patterns exist: hash-chained events (governed), an onchain commitment before execution (shomei). | code. |
| 16 | Quote "execution price" is the follower's price | **Wrong in code.** PACT uses `to.notional/to.amount` (market mark). All-in is `from.amount/to.amount` (buys); fees sit in `fees.estimatedFeeNotional` and PACT ignores them, so the drift check passes fills that are above the drift limit once fees are included. | live: $10 TWAP+bracket mark 2236.3 vs all-in 2302.4 (+3.0%). |
| 17 | Fill price from `fillPrice` | **Wrong for sells.** `fillPrice` is spent-per-received (≈0.00045 on a WETH sell). Use finalised fills' amounts and `filled.averageNotionalPrice`. | live `twaporder.json`; Poros `performance.ts`. |
| 18 | TP/SL are follower-signed | **Corrected.** "The trigger prices are not part of either signature." Workaround: the follower signs an intent message with the levels, PACT reads the bracket legs back and compares, and optionally re-states them with Flash's **signed Update Order** (PATCH). | docs `brackets`; corvo `updateMessageFor`. |
| 19 | Guard covers what the follower signs | **Incomplete.** The bracket's approval, Permit2 permit and order are signed unchecked. The direct-approval spender may be falsely blocked. Our own fee vault is not pinned. | `FollowDesk.tsx:854/879/903`; `guard.ts:227`. |
| 20 | Submit errors mean nothing happened | **Wrong.** `/order` can create, and even fill, an order and still return 4xx. Reconcile against the order list before any retry. | flash-mcp `submitOrderReconciled`. |

**Net effect on the pitch:** the three demo numbers become

1. "Your entry limit is written into the Flash order and enforced by Flash's engine, not just shown as a warning."
2. "One signature cancels the copy *and* its protection." (once bracket legs are tracked)
3. "Exit anytime, zero lockup, and your signature only ever lets funds return to you."

---

## 2. Novelty, honestly

### 2.1 Who already does what

| Product | What it already has | What it lacks |
| --- | --- | --- |
| Binance / Bybit / OKX copy trading | Risk settings, Bybit CopyGuard (skip copies worse than the master's entry), leaderboards | Custodial; settings are preferences inside the venue; no verifiable evidence |
| Hyperliquid vaults, Dexly | Non-custodial copying, budgets, size %, drawdown auto-pause | Perps; no follower-signed per-order authority; no evidence separation |
| **governed-flash-trader** (on Flash) | A mandate gate with 9 checks, auto stop-loss, hash-chained events, "not submitted" receipts when blocked | **Quote-only: refuses live submit.** No signing guard, no execution evidence. |
| **corvo-flash** (on Flash) | Telegram copy bot, attached brackets, signed PATCH updates | Custodial-ish delegated CDP signing; no policy engine; no evidence |
| shomei (on Flash) | Fee and price receipts with a MATCH / MISMATCH verdict; onchain commitments | Not a copy product |
| Poros, Wayfinder (on Flash) | Strict typed-data validation before signing | Not copy products |

### 2.2 What is genuinely new in PACT

Individually most pieces exist. **The composition does not**, and it is defensible because
each part is load-bearing for the others:

1. **A follower-specific decision per plan, recorded even when it refuses.** governed-flash-trader
   proves the gate concept; PACT is the version that executes for real.
2. **The follower's mandate is compiled into an advanced Flash order** (TWAP shape, entry
   limit, attached protection, size), so the copy is shaped for that follower, not mirrored.
   Bybit's CopyGuard is the nearest idea, but it is internal to a custodial venue.
3. **Two-sided, verifiable copy fidelity.** The leader's real fills (verified onchain,
   independent of any API key) against the follower's real fills, plus the policy decision in
   between. Nobody in the set verifies the *leader's* execution independently.
4. **Honest boundaries as product.** The signature guarantees where funds can go; Flash
   enforces price; PACT shows which layer proves what.

**Defensible one-liner:** *PACT turns a leader's published plan into a follower-specific,
follower-signed Flash order, and proves afterwards — from both wallets' onchain fills —
how faithfully the copy executed.*

**Not novel, so don't lead with it:** risk caps, typed-data validation, non-custodial copying,
copy bots on Flash.

---

## 3. Production architecture

The handbook's L0–L5 mixes *data sources* (market, execution) with *logic* (analysis, alpha).
A production system separates them into layers with one responsibility each and strict
dependency direction: **a layer may only call the layer below it, and only the execution
layer writes to Flash.**

```text
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ L7  EXPERIENCE        pages, entity routes, API for clients             │
 ├──────────────────────────────────────────────────────────────────────────┤
 │ L6  AUTHORITY         who may sign: follower wallet · future session key │
 ├──────────────────────────────────────────────────────────────────────────┤
 │ L5  EXECUTION         compile → quote → guard → sign → submit → track   │
 │                       (the only writer to Flash)                         │
 ├──────────────────────────────────────────────────────────────────────────┤
 │ L4  POLICY            deterministic decisions with reason codes          │
 │                       plan-time · quote-time · signing-time              │
 ├──────────────────────────────────────────────────────────────────────────┤
 │ L3  SIGNALS           facts with provenance; never decide                │
 │                       quality · drift · cost · concentration · fidelity  │
 ├──────────────────────────────────────────────────────────────────────────┤
 │ L2  DOMAIN            entities and state machines (pure)                 │
 │                       Plan · Mandate · Proposal · Order · Position       │
 ├──────────────────────────────────────────────────────────────────────────┤
 │ L1  EVIDENCE STORE    append-only, hash-linked records                   │
 ├──────────────────────────────────────────────────────────────────────────┤
 │ L0  ADAPTERS          Flash REST+WS · Base RPC · market data · identity │
 └──────────────────────────────────────────────────────────────────────────┘
```

### L0 — Adapters

One module per external system, each with a typed, validated contract. No business logic.

| Adapter | Responsibilities | Must handle | Today |
| --- | --- | --- | --- |
| **Flash REST** | quote, order, get/list orders, cancel, batch cancel, update, search, balances | schema validation of every response; `chainId` string → number; 201 on submit; 404 for about 2 s after submit; `error.details`; 429 with `RateLimit-Reset` backoff; a per-key request budget | Partial (no validation, no backoff, no list/batch/update) |
| **Flash WebSocket** | one upstream connection; subscribe per active funder; heartbeats | reconnect with backoff, resync from `GET /orders` after a gap, fan-out to browsers | Not built |
| **Base RPC** | transaction receipts, logs, balances, code at address (7702 detection) | reorgs (only use finalised blocks), decoding settlement calls and transfer events | Balances only |
| **Market data** | GeckoTerminal candles; Pyth Hermes reference price (planned) | caching, freshness labels, free-tier limits | Gecko only |
| **Identity** | wallet connect; signed sessions (SIWE) for every mandate change and publish | message replay protection | Not built (APIs trust the posted address) |

### L1 — Evidence store

Every fact PACT relies on is a record, written once, linked by hash to the previous record
for the same proposal. Records are the audit trail and the data for every later metric.

| Record | Written when | Key fields |
| --- | --- | --- |
| `Declaration` | leader publishes | plan fields, leader signature (planned), optional onchain commitment |
| `LeaderExecution` | leader fill verified onchain | tx hash, block, transfers, recovered signer, matched plan fields |
| `Decision` | policy evaluates (plan-time, quote-time) | rule set version, mandate hash, signals used, verdict, reasons |
| `Quote` | Flash quote accepted for review | quote id, all-in price, fees, typed-data hashes (entry and bracket) |
| `GuardReport` | before signing | every check with pass/warn/fail, for entry and bracket |
| `Intent` | follower signs PACT intent | quote id, levels (TP/SL), signature |
| `Submission` | order submitted or reconciled | order id, bracket leg ids, submitted body hash |
| `Fill` | finalised fill observed | amounts, fees (trade, network, integrator), venue, tx, chain status |
| `Protection` | bracket leg state changes | leg ids, trigger read-back, match verdict |
| `Close` | order terminal | status, raw `closeReason` |
| `Attribution` | position closed | leader vs follower price, drift cost, fee cost |

Storage: a database (Postgres or similar) with per-user isolation; the hash chain makes
tampering detectable. Today: one local JSON file, mutable.

### L2 — Domain

Pure types and state machines. No I/O.

- **Plan:** draft → live → expired | closed (planned) | superseded (planned).
- **Mandate:** versioned; every decision references the exact version hash.
- **Proposal:** created → decided → (quoted → reviewed → signed → submitted) | held | refused.
- **Order:** pending → accepted → partially filled → filled | cancelled | rejected | terminated,
  with linked **protection legs** (pending activation → active → fired | expired | cancelled).
- **Position (planned):** opened by fills, closed by exits; the unit of attribution.

### L3 — Signals

Facts with provenance; a signal never makes a decision. Each signal declares its source layer.

| Signal | Source | Status |
| --- | --- | --- |
| Plan quality (structure, reward:risk, invalidation) | Declaration | Built |
| Entry drift (declared vs all-in quote) | Quote | Built, but uses the market mark, not all-in (fix) |
| Execution cost (fees ÷ notional) | Quote | Not used (fix) |
| Price impact | Quote | Built |
| Concentration (same asset and side) | Domain | Built |
| Leader execution evidence | LeaderExecution | API-key-bound (replace with onchain) |
| Copy fidelity per leader | Fill + LeaderExecution | Follower side built; leader side planned |
| Style drift (size vs leader's history) | LeaderExecution history | Planned (needs history) |
| Reference-price divergence (Pyth vs chart vs quote) | Market + Quote | Planned |
| Mark-to-market via reverse-side quote | Quote | Planned (honest unrealized PnL) |

### L4 — Policy

Deterministic, versioned, pure. Three checkpoints, each producing a `Decision` record:

| Checkpoint | Inputs | Can return |
| --- | --- | --- |
| **Plan-time** | plan, mandate, portfolio context, signals | COPY / SCALE / WAIT / REVIEW / DECLINE |
| **Quote-time** | quote (all-in price, fees, impact), mandate | proceed, or WAIT / DECLINE |
| **Signing-time** | guard report, intent | proceed, or block |

Rules carry an id, a version and a reason code (the handbook's R1–R15 map in §4). Posture,
from the handbook: **bound, don't veto**: prefer scale, delay or limit over refuse, except on
integrity failures.

### L5 — Execution

The only component that writes to Flash. Stateless steps, each idempotent:

1. **Compile** a decision into a Flash request: `limitCrossPrice` when a limit carries a bracket;
   entry expiry ≤ plan expiry ≤ bracket expiry; price impact sent on quote *and* submit;
   TWAP bucket count chosen from expected fee per fill; bracket legs' impact set explicitly.
2. **Quote** and compute the all-in price and cost.
3. **Guard** every payload the follower will sign, both entry and bracket: domain, verifying
   contract, swapper = recipient = funder, **our pinned vault**, tokens, amount, deadline, permit
   spender and amount (cumulative open orders), approval calldata.
4. **Seal** the reviewed quote (server HMAC) so submit only accepts what was reviewed.
5. **Sign** (L6), including the follower's intent message.
6. **Submit**, then **reconcile**: snapshot open orders before, diff after, capture bracket leg
   ids; on any error, poll the list before retrying.
7. **Track** through the WebSocket; read back bracket triggers and compare to the intent.
8. **Cancel** as a set: entry plus bracket legs via batch cancel; treat `422 already filled` as executed.

### L6 — Authority

| Mode | Signer | Enforcement | Status |
| --- | --- | --- | --- |
| Review | follower wallet (EOA, or ERC-1271 smart wallet) | the follower reads the guard report | Built |
| Autopilot | session key on a follower-owned EIP-7702 Kernel account | validator checks every signed field onchain; price bound by Flash's engine and disclosed | Planned (after Flash Q4) |

Never: a pasted private key, a server-held key, or a Safe-based session (its 1271 handler
cannot delegate).

### L7 — Experience

Entity pages backed by L1/L2 (from `pact-ui-audit.md`): Leader, Plan, Proposal/Review, Order,
plus lists (Leaders, Proposals, Orders, Portfolio) and the Trade terminal. Every number shows
its source layer. Mandate changes and publishing are signed (L0 identity).

---

## 4. Handbook mapping (rules R1–R15)

| Rule | Layer | Status | Correction |
| --- | --- | --- | --- |
| R1 size cap | L4 plan-time | Built | — |
| R2 leverage cap | — | Dormant | Spot only; no leverage on current venue |
| R3 drift bound | L4 + L5 compile | Built | "Enforced by Flash's engine", and use the all-in price |
| R4 cost budget | L4 quote-time | Not built | Use `fees.estimatedFeeNotional`; funding not applicable |
| R5 price impact | L4 quote-time | Built | Send on submit too |
| R6 / R7 heat caps | L4 plan-time | Partial (same asset and side) | Correlation needs history; keep descriptive |
| R8 style drift | L3 + L4 | Planned | Needs verified leader history (onchain) |
| R9 revenge signature | L3 + L4 | Planned | Needs leader history |
| R10 invalidation required | L4 plan-time | Built (follower option) | Decide whether to require it at publish |
| R11 oracle divergence | L3 + L4 | Planned | Pyth Hermes adapter |
| R12 plan TTL | L2 + L5 | Partial | Copy expiry must not outlive the plan (today 7-day limits) |
| R13 breaker → kill switch | L4 + L5 + L6 | Partial | Needs bracket legs in the batch and a signer at trip time |
| R14 un-copyable flag | L3 | Planned | Needs fidelity history |
| R15 probation gate | L3 + L4 | Planned | Shadow-copy via quotes; evidence onchain |

---

## 5. Scenario coverage (handbook §7), with the corrected mechanism

| Scenario | Today | With this architecture |
| --- | --- | --- |
| A1 leader goes 4× size, no exit | Size caps and plan-quality check | + style drift once onchain history exists |
| A2 leader chases | WAIT at quote-time; entry limit sent to Flash | + all-in price including fees |
| A3 revenge re-entry | Open-plan limits | + revenge signal (needs history) |
| A4 scalper | Not detected | + un-copyable flag from fidelity |
| A5 hidden hedge | Concentration cap | Same; disclosed limitation |
| A6 no matching order | Only works for orders placed through PACT's key | Onchain verification of leader fills |
| B1 thin liquidity | Price-impact limit | Same |
| B2 news shock / divergence | Not built | Pyth vs chart vs quote panel |
| B4 crash mid-TWAP | Single cancel (bracket stays live) | Batch cancel of entry and legs |
| C1 wallet runs dry | Raw close reason | + balance pre-check (`GET /balances`) |
| C3 tiny order cost | Not checked | Cost gate and bucket sizing |
| D3 three leaders, one bet | Concentration view | Same, plus correlation once history exists |
| E1 crowding | Plan capacity | Same |

---

## 6. Build order

Ordered so every phase leaves a working, honest product. Phases 0 and 1 matter before the
submission; the rest is the roadmap.

### Phase 0 — Correctness of the existing path (before any live run)

Exit criterion: a follower can copy a TWAP and a limit plan, with protection, and every
number shown is correct.

1. Compile: `limitCrossPrice` for limit + bracket; align expiries (copy ≤ plan ≤ protection);
   send price impact on submit; set bracket legs' impact.
2. Guard the bracket payloads; accept the direct-approval spender; pin our vault.
3. All-in price and fee cost in the quote-time check.
4. Fill parsing from finalised amounts and `averageNotionalPrice`; skip reorged fills.
5. Submit reconciliation and bracket leg capture (order-list diff); cancel entry and legs together.
6. Adapter fixes: `chainId` coercion, 201 handling, 404-after-submit, 429 backoff.
7. Correct the claims in `PACT.md`, the UI and the demo script (§1).

### Phase 1 — The live proof (submission artifact)

1. A follower-signed Base WETH/USDC TWAP with an attached bracket, sized from Phase 0's cost rule.
2. Archive the evidence bundle (order, fills, fees, bracket legs, tx hashes, raw Flash response).
3. Receipt verdict card: MATCH / MISMATCH for price within bound and fees as disclosed.

### Phase 2 — Evidence spine

Database-backed append-only store with hash links; WebSocket tracking; signed sessions for
mandate changes and publishing; mark-to-market by reverse quote.

### Phase 3 — Leader credibility

Onchain verification of leader fills; plan ↔ fill matching; two-sided copy fidelity per leader;
shadow-copy probation (quote-only); leader page with this evidence.

### Phase 4 — Signals

Cost budget, reference-price divergence (Pyth), style drift and un-copyable flag once history
exists.

### Phase 5 — Authority

Autopilot on a 7702 Kernel session validator after Flash confirms ERC-7579 validator support;
breaker → batch cancel signed by the session.

### Phase 6 — Experience restructure

Entity pages and link rules from `pact-ui-audit.md`. This can run in parallel with Phases 2–4
because it reads existing data.

---

## 7. Questions for the Flash team (only what code and docs can't settle)

1. Do `POST /order` or `GET /orders/{entryId}` return the attached bracket's leg order ids, and can
   the legs be re-priced with the signed Update Order, so the levels become follower-signed?
2. The verified ABI and event names of `DefinitiveFlashAllowance` and the vault's `flashSwap` on
   Base, so leader fills can be verified onchain reliably.
3. Is the 30% execution-cost rule applied per TWAP slice or per order, and is a network fee
   charged per slice?
4. Are ERC-7579 session-key validator signatures (Kernel, Safe 7579) accepted for `FlashOrder` on Base?
5. Is `to` net of all fees on both sides? (shomei measured it is not on sells.) Could the quote
   split network and integrator fees?

---

## 8. Decision for today

Given about 16 hours to submission, the recommended cut is **Phase 0 + Phase 1**, with the
claim corrections in Phase 0.7 done regardless. Phases 2–6 are presented as the roadmap,
and this document is the architecture judges can read.
