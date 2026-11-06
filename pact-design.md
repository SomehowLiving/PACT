# PACT — Product Design

Status date: November 6, 2026 · Scope: the whole product, by persona · Audience: the PACT team, before UI design

This document describes **what PACT does, for whom, and in what order**: every
capability, every user flow, every state an object can be in, and every rule
the system enforces. It deliberately says nothing about screens or layout. The
UI should be designed *from* this document, not the other way round.

`PACT.md` is the pitch and market evidence. `pact/IMPLEMENTATION_STATUS.md` is
the engineering handoff. This file sits between them.

**Status labels used throughout**

| Label | Meaning |
| --- | --- |
| **Built** | In the codebase and covered by tests or a live check |
| **Partial** | Built with a stated limitation |
| **Planned** | Agreed direction, not built |
| **Idea** | Proposed in ideation notes; not agreed, facts may need verifying |

---

## 1. What PACT is

PACT is a non-custodial social execution layer on Definitive Flash.

- A **leader** publishes a structured, expiring trade plan.
- A **follower** owns a mandate: which leaders, how much, what risk.
- PACT decides, per follower, what to do with each plan:
  `COPY`, `SCALE`, `WAIT`, `REVIEW` or `DECLINE`.
- The follower (or, later, an authorised agent) signs the exact Flash order.
- Flash executes. PACT records what actually happened.

**Thesis:** do not copy a leader's position. Copy only the part of their plan
that fits the follower's own risk envelope and can survive the execution path.

### 1.1 Principles that every feature must respect

1. **Non-custodial.** PACT never holds, requests, stores or exports a private
   key. Funds never leave the follower's wallet except through a Flash order the
   follower signed.
2. **Policy decides, executors act.** A deterministic policy engine decides what
   *may* happen. A human or an agent only decides whether to do an allowed
   thing. Nothing (including an LLM) can widen a limit or override a refusal.
3. **Policy is compiled into the order.** Where Flash allows it, a follower
   limit becomes a field of the Flash order (for example, entry drift becomes its
   limit price), enforced by Flash's engine even if PACT goes offline after
   signing. The follower's signature itself binds tokens, maximum spend,
   recipient, fee vault and deadline — not the price.
4. **Evidence layers stay separate.** A leader's *declaration*, PACT's *policy
   decision*, external *market context* and Flash's *execution facts* are
   different kinds of truth and are never blended.
5. **No invented numbers.** No PnL, win rate, Sharpe, correlation, ranking or
   "safe leader" score without real receipts behind it. Demo data is always
   labelled as demo.
6. **A refusal is a feature.** A blocked copy is recorded with the rule that
   fired, and no quote is ever requested for it.

---

## 2. System model

### 2.1 Actors

| Actor | Role | Holds authority over |
| --- | --- | --- |
| Leader | Publishes plans | Their own plans only |
| Follower | Owns a mandate, signs orders | Their funds and their mandate |
| Agent | Acts for a follower inside the mandate | Only what the follower delegates (see §6) |
| PACT | Evaluates policy, prepares and verifies orders, records evidence | Nothing on-chain; it cannot sign |
| Definitive Flash | Quotes, accepts signed orders, executes, reports fills | Execution of signed orders only |
| Follower wallet | Signs approvals, permits, orders, cancels | The follower's keys |
| GeckoTerminal | Market candles for Base WETH/USDC | Nothing; context only |

### 2.2 The four evidence layers

| Layer | Source | Example facts | May be presented as |
| --- | --- | --- | --- |
| Declaration | Leader input | entry 2,500, stop 2,450, thesis text | "the leader says" |
| Policy | PACT engine | SCALE to $25 because of `LEADER_DAILY_CAP` | "your mandate decided" |
| Market | GeckoTerminal | 5-minute candles, 24h change | "market context", never as a fill or route |
| Execution | Flash | order status, fills, average fill price, tx hashes | "what actually happened" |

### 2.3 Core objects

**Plan** (code name `Strategy`) — published by a leader.

| Field group | Fields |
| --- | --- |
| Identity | id, leader address, title, thesis, created time |
| Market | chain (base / arc), target asset, contra asset, side (buy / sell) |
| Order shape | order type (twap, limit, market, take-profit, stop-loss), quantity, TWAP duration, TWAP bucket count, TWAP start time, limit price bound, trigger price |
| Plan levels | reference entry, stop, target, invalidation text |
| Windows | entry expiry (copy window), protection expiry (bracket lifetime) |
| Capacity | maximum notional per follower |
| Quality | grade (`DISCIPLINED` / `CAUTION` / `INCOMPLETE`) and reasons, computed at publish |
| Evidence | optional leader Flash order id; status `UNVERIFIED` or `ORDER_FOUND` |

**Policy** — one per follower. The global mandate.

| Group | Fields (demo default) |
| --- | --- |
| Leaders | follows (up to 3), pausedLeaders, per-leader mandates |
| Size | per-order max ($30), daily max ($50), minimum notional ($5), copy ratio (25%), stop-risk budget ($2), allow scale-down (on) |
| Per leader | daily sleeve ($25), realized-loss breaker ($10/day, off by default) |
| Concentration | same-asset same-side exposure ($35), open plans (3 total, 1 per leader) |
| Market scope | chains (base), pairs (WETH/USDC on Base and Arc), order types (twap, limit), sides (buy) |
| Execution | max entry drift (1%), max quote price impact (0.5%), max market slippage (1%) |
| Plan quality | require invalidation (on), require plan quality + min reward:risk 1.5 (off), require leader Flash evidence (off) |
| Automation | mode: `REVIEW` or `ASSIST` |

**Leader mandate** — optional per-leader override inside a policy: sizing mode
(`PROPORTIONAL` / `FIXED` / `STOP_RISK`) with its value, daily sleeve, allowed
order types (intersected with the global list), exit mode (`FOLLOWER_BRACKET` or
`MANUAL`).

**Proposal** — one plan × one follower. A frozen copy of the plan plus the
follower-specific size, sizing mode, estimated loss at stop, and exit mode.

**Decision** — the policy result for a proposal: verdict (`ALLOW` / `MODIFY` /
`BLOCK`), action (`COPY` / `SCALE` / `WAIT` / `REVIEW` / `DECLINE`), reason codes,
and the scaled amount when modified.

**Quote** — Flash's response for a proposal: quote id, quantity, typed data to
sign, approval transaction or Permit2 data, estimated price impact, execution
price, the declared and effective price bound, and bracket signing data.

**Receipt** — created when an order is submitted: Flash order id, status, close
reason, fills, completed slices, bucket count, quoted price, declared entry,
average fill, entry drift in bps, notional, decision, and (when evidence
exists) realized PnL.

**Audit log** — one entry per decision: time, proposal hash, policy hash,
verdict, reasons, and later the quote id and Flash order id.

### 2.4 Lifecycles

**Plan**

```text
(draft in ticket) ──publish──▶ LIVE ──entry expiry passes──▶ EXPIRED
                      │
                      └─ rejected at publish if INCOMPLETE, invalid, or the
                         supplied Flash order id is not found for the leader
```

A leader cannot yet withdraw or edit a published plan (Planned).

**Proposal and order**

```text
CREATED ─▶ DECIDED ─┬─ COPY / SCALE ─▶ QUOTED ─▶ SIGNED ─▶ SUBMITTED ─▶ WORKING ─┬─▶ FILLED
                    │                   │                                         ├─▶ CANCELLED
                    │                   └─ quote breaks policy ─▶ WAIT / DECLINE   ├─▶ REJECTED
                    ├─ WAIT    (may become copyable later: expiry, pause, breaker)  └─▶ TERMINATED
                    ├─ REVIEW  (plan or evidence does not meet the mandate)
                    └─ DECLINE (hard rule; never quoted)
```

Any policy save re-decides every proposal the follower has not acted on (no
receipt yet) and discards their stale quotes.

**Decision actions**

| Action | Verdict | Meaning for the follower | Can be quoted |
| --- | --- | --- | --- |
| COPY | ALLOW | Fits every limit as sized | Yes |
| SCALE | MODIFY | Fits after reducing to the tightest remaining cap | Yes, at the scaled size |
| WAIT | BLOCK | Not now: expired, paused, breaker, or drifted at quote time | No |
| REVIEW | BLOCK | Plan or evidence does not meet the follower's quality bar | No |
| DECLINE | BLOCK | Outside the mandate (pair, type, side, limits, impact) | No |

**Flash order status:** pending, accepted, partially filled, filled,
cancelled, rejected, terminated. Cancellable while pending, accepted or
partially filled.

---

## 3. Policy engine reference

This is the single source of truth for every decision shown anywhere in PACT.
All of it is **Built**.

### 3.1 Sizing (when a plan is mirrored)

| Mode | Requested notional | Flash quantity |
| --- | --- | --- |
| Proportional | leader notional × copy ratio | buy: USDC amount · sell: WETH amount at live price |
| Fixed USD | the fixed amount | as above |
| Stop-risk | risk budget ÷ abs(entry − stop) × entry | buy: USDC · sell: target units |

A buy's leader notional is its USDC quantity. A sell is priced live from Flash;
if no price is available the copy is declined (`PRICE_UNAVAILABLE`). A stop-risk
plan with a missing or wrongly placed stop goes to `REVIEW`
(`STOP_RISK_PLAN_INVALID`). Stop-risk is a planned-loss estimate, not a
guaranteed maximum loss.

### 3.2 Evaluation order (first match wins for the gates)

| # | Check | Result | Reason code |
| --- | --- | --- | --- |
| 0 | Leader paused by follower | WAIT | `LEADER_PAUSED` |
| 1 | Entry window expired | WAIT | `PLAN_EXPIRED` |
| 2 | Invalidation required but missing | REVIEW | `PLAN_NEEDS_INVALIDATION` |
| 3 | Plan quality required but plan not DISCIPLINED | REVIEW | `PLAN_NEEDS_*`, `PLAN_INVALID_STOP_OR_TARGET`, `PLAN_REWARD_RISK_TOO_LOW` |
| 4 | Leader evidence required but not `ORDER_FOUND` | REVIEW | `LEADER_EXECUTION_UNVERIFIED` |
| 5 | Loss breaker on and today's realized loss ≥ limit | WAIT | `LEADER_LOSS_CIRCUIT_BREAKER` |
| 6 | Hard rules (all collected) | DECLINE | `CHAIN_NOT_ALLOWED`, `PAIR_NOT_ALLOWED`, `ORDER_TYPE_NOT_ALLOWED`, `SIDE_NOT_ALLOWED`, `SLIPPAGE_TOO_HIGH`, `PRICE_IMPACT_TOO_HIGH`, `ACTIVE_PLAN_LIMIT`, `LEADER_ACTIVE_PLAN_LIMIT` |
| 7 | Caps exceeded | SCALE to the tightest cap if scale-down is on and the result ≥ minimum; otherwise DECLINE | `SIZE_EXCEEDS_MAX`, `DAILY_CAP`, `LEADER_DAILY_CAP`, `ASSET_EXPOSURE_CAP`, `PLAN_CAPACITY` |
| 8 | Otherwise | COPY | — |

The scaled amount is the minimum of: per-order max, remaining daily budget,
remaining leader sleeve, remaining same-asset exposure, and plan capacity.

Risk context used: today's (UTC) submitted notional overall and per leader,
today's realized loss per leader, live same-asset same-side exposure, open
plans overall and per leader.

### 3.3 Quote-time checks

When the follower requests a Flash quote, PACT re-checks the live quote:

| Check | Result | Code |
| --- | --- | --- |
| Estimated price impact above the follower's maximum | DECLINE, quote discarded | `PRICE_IMPACT_TOO_HIGH` |
| Quoted execution price drifts from the declared entry by more than the follower's maximum | WAIT | `ENTRY_DRIFT_TOO_HIGH` |

**Policy compiled into the order (Built; enforced by Flash's engine, not by the signature).** For TWAP and limit entries, the
follower's maximum entry drift becomes Flash `limitNotionalPrice`: buy → entry ×
(1 + drift) as a maximum, sell → entry × (1 − drift) as a minimum. If the leader
declared a stricter bound, the stricter one is used.

**Attached bracket (Built).** A follower-owned Flash take-profit/stop-loss is
attached at the leader's declared levels when the exit mode is bracket, the
entry is a buy, the order type is market, limit or TWAP, and the plan has a
stop, target and protection expiry.

### 3.4 Signature guard (Built)

Run on the server and again in the follower's browser on the raw Flash payload,
before any wallet prompt. Each check passes, warns, or fails:

| Check | Verifies |
| --- | --- |
| `order.present` | Flash returned a readable order |
| `order.chain` | Signing domain chain is the expected chain |
| `order.verifier` | Verifying contract is Flash's |
| `order.swapper` | The swapper is the follower |
| `order.recipient` | Output goes to the follower |
| `order.tokens` | Input and output tokens are the plan's pair |
| `order.amount` | Amount is within the policy-approved size |
| `order.deadline` | Deadline is in the future |
| `permit.contract` | Permit2 is the canonical contract |
| `permit.token` | Permit token is the token being spent |
| `permit.spender` | Spender is Flash's allowance contract |
| `permit.amount` | Permit covers this order plus other open orders, not more |
| `permit.expiry` | Permit expiry is sane |
| `approve.shape` / `approve.amount` | A direct approval targets the right token, spender and amount |

A failing check blocks signing. PACT never calls the quote or order endpoint
for a blocked proposal.

---

## 4. Leader

### 4.1 Goals

- Publish a trade idea once and let many followers copy it safely.
- Get distribution for real trades without taking custody or responsibility for
  anyone's sizing.
- (Later) build a verifiable reputation and earn from copies.

### 4.2 Capabilities

| Capability | Status | Notes |
| --- | --- | --- |
| Publish a structured plan | Built | Thesis, invalidation, entry, stop, target, windows, capacity, order shape |
| Plan validation at publish | Built | Rejects incomplete or invalid plans (see L1) |
| Plan quality grade | Built | `DISCIPLINED` (≥1.5R), `CAUTION` (below 1.5R), `INCOMPLETE` (rejected) |
| TWAP shaping | Built | Duration ≥300s, 2–2560 buckets, optional start time, optional price bound |
| Exit plans (take-profit / stop-loss orders) | Built | Published as sells with a trigger |
| Attach own Flash order as evidence | Partial | `ORDER_FOUND` proves Flash found the order under the leader wallet, not that it matches the plan |
| Plan-to-order matching (`PLAN_MATCHED`) | Planned | Needs the real Flash order schema from a live fill |
| See own published plans | Built | List of all plans on the store |
| See who copied and how it went | Planned | Aggregate, anonymised follower outcomes for the leader |
| Withdraw / close / amend a live plan | Planned | Today a plan lives until its entry window ends |
| Copy-fidelity reputation from receipts | Planned | Descriptive only; never a "safe" or "profitable" score |
| Leader economics (share of integrator fee) | Idea | Flash lets an integrator set its own fee; any split is PACT-defined |
| Unique-human check for a public leader directory (World ID) | Planned | Never login, KYC or wallet authority |
| Leader-wallet authentication on publish | Planned | Today the leader is the connected address; publishing is not signed |

### 4.3 Flows

**L1 · Publish a plan (Built)**

1. Leader connects their wallet. The connected address is the leader.
2. Leader fills the plan: title, thesis, pair (WETH/USDC), chain, side, order
   type, quantity (USDC for buys, WETH for sells), and the type-specific fields:
   - TWAP: duration, buckets, optional start time, optional price bound.
   - Limit: limit price (also used as the reference entry if none is given).
   - Take-profit / stop-loss: trigger price; the side becomes sell.
3. Leader sets plan levels: reference entry, stop, target, invalidation.
4. Leader sets windows and capacity: copy window (default 4h), bracket
   protection (default 24h), maximum notional per follower.
5. While editing, PACT shows the live quality grade, reward:risk, stop distance
   and structural issues.
6. Optional: leader pastes an existing Flash order id as evidence.
7. Publish. PACT validates:
   - address format, supported chain and order type, quantity > 0;
   - copy window and protection window in the future, capacity > 0;
   - limit price for limit orders, trigger price for exit orders;
   - TWAP duration ≥ 300s, buckets 2–2560, start time is a valid timestamp;
   - plan structure (long: stop < entry < target; short: target < entry < stop);
     an `INCOMPLETE` plan is rejected with its reasons;
   - if an order id was given: Flash must find it with the leader as funder,
     otherwise publishing fails.
8. On success the plan is LIVE and is immediately mirrored into a proposal for
   **every follower who selected this leader**, each decided against that
   follower's own mandate.

Errors are returned in plain words and never published partially.

**L2 · Prove execution (Partial)**

The leader places their own order on Flash, then publishes with that order id.
PACT marks the plan `ORDER_FOUND`. Followers who require evidence will only copy
such plans. Limitation: PACT does not yet compare the order's fields to the
plan.

**L3 · Watch copies (Planned)**

Leader sees per plan: how many followers received it, how many copied, scaled,
waited or declined (aggregated, no follower identities), total copied notional,
and descriptive fill fidelity across followers.

**L4 · Manage a live plan (Planned)**

Close a plan early (new copies stop; existing follower orders are untouched,
because only followers can cancel their orders), or publish an amendment as a
new plan that references the old one.

### 4.4 Leader edge cases

| Case | Behaviour |
| --- | --- |
| Plan with no stop or target | Rejected at publish (`INCOMPLETE`) |
| Low reward:risk (below 1.5R) | Published as `CAUTION`; followers may treat it as a warning or a block |
| Evidence order not found | Publish fails; the leader can retry without the id |
| Leader followed by nobody | Plan is published; no proposals are created |
| Copy window passes | Unacted proposals become WAIT `PLAN_EXPIRED` on next evaluation |
| Leader publishes many plans at once | Each follower's open-plan limits decide how many can be live |
| Thesis or invalidation text contains instructions | Treated as untrusted display text; never interpreted by policy or any agent (see §6.5) |

---

## 5. Follower

### 5.1 Goals

- Copy a few chosen leaders without ever risking more than they decided.
- Never get a worse entry, larger size or longer exposure than their mandate allows.
- See exactly why each copy was taken, scaled, held or refused.
- Verify afterwards that execution stayed faithful to what they approved.

### 5.2 Capabilities

| Capability | Status | Notes |
| --- | --- | --- |
| Connect wallet, default policy created | Built | Base mainnet via injected wallet |
| Discover leaders by published facts | Built | Plans, grades, reward:risk, evidence, PACT followers, copies, mean drift |
| Copyability check for a leader | Built | Runs live plans through the follower's mandate with the real engine; mirrored plans use stored decisions |
| Follow up to 3 leaders with per-leader mandates | Built | Sizing mode, sleeve, order types, exit mode |
| Global mandate controls | Built | All fields in §2.3 |
| Pause / resume a leader | Built | WAIT `LEADER_PAUSED`; keeps the mandate; does not cancel live orders |
| Unfollow | Built | Removes mandate and pause |
| Mirror open plans into proposals | Built | Manual "mirror open intents"; automatic when a followed leader publishes |
| Proposal queue with decisions and reasons | Built | Filter by action |
| Review: plan vs adjusted order, chart, policy checks | Built | Chart shows declared levels plus the follower's Flash bound |
| Flash quote with quote-time policy re-check | Built | §3.3 |
| Browser signature guard | Built | §3.4 |
| Approve / Permit2 / sign entry / sign bracket / submit | Built | Each is an explicit wallet prompt |
| Order tracking: status, TWAP slices, fills, drift | Built | Polled every 4s until terminal |
| Cancel an order | Built | Follower signs a Flash cancel message |
| Batch cancel / per-leader kill switch | Planned | Waits on Flash confirming endpoint and signature shape |
| Exposure, concentration, remaining capacity | Built | Approved vs live split by asset and side |
| Wallet balances (ETH, USDC, WETH on Base) | Built | Read over Base RPC for the connected wallet |
| Per-leader execution fidelity history | Built | From this follower's own fills only |
| Evidence export per order | Built | JSON bundle with raw Flash response |
| Realized-loss breaker | Partial | Acts only when trusted realized PnL exists on receipts |
| Realized and unrealized PnL | Planned | Needs closed receipts and a labelled mark price |
| Trailing-stop exit mode | Idea | Ideation notes say Flash supports it; verify before planning |
| DCA copies | Idea | Unconfirmed on the Flash API |
| Notifications (new plan, fill, breaker) | Planned | |
| Signed policy edits | Planned | Today the policy API trusts the posted follower address (see §10) |

### 5.3 Flows

**F1 · Onboard (Built)**

1. Follower connects a wallet. If the wallet is not on Base, PACT offers a
   switch.
2. PACT creates the default policy if none exists. Nothing is followed yet
   (an empty follow list copies nobody).
3. Without a wallet, the follower can view seeded demo desks read-only, clearly
   marked as demo.

**F2 · Evaluate a leader (Built)**

1. Follower browses leaders: filter (disciplined, evidence-backed, TWAP,
   following, demo), search by address, sort by published facts.
2. For a leader, the follower sees their plans with declared levels and
   reward:risk, evidence status, and how PACT copies of them have filled.
3. **Copyability check:** PACT runs the leader's live plans through the
   follower's current mandate and returns a verdict (Copyable / Partly /
   Not copyable / No live plans), counts per action, the most common blocking
   reasons, and a per-plan result. Plans already mirrored show their stored
   decision. This is a preview; the binding decision happens on mirror.
4. No PnL or win rate is shown, because none is verified.

**F3 · Follow and set a mandate (Built)**

1. Follower picks a sizing mode and value (presets: 10/25/50/100% · $5/10/25/50
   · $1/2/5/10 at stop), a daily sleeve, an exit mode, and allowed order types
   (only those the global mandate allows).
2. A live preview shows what these settings would do to the leader's current
   plans.
3. Confirm saves the policy. No order is placed. Limit: 3 leaders.
4. Saving re-decides every unacted proposal against the new mandate.

**F4 · Configure the global mandate (Built)**

Sections: leaders and sizing → risk limits → concentration → exit and plan
quality → automation. Client-side validation mirrors the server: daily max ≥
per-order max, ratios 0–100%, sleeves and exposure ≥ minimum notional, at least
one chain, type and side, ≤3 leaders, each mandate's leader must be followed,
reward:risk ≥ 1, pauses only for followed leaders. Unsaved changes are explicit;
a save that the server rejects shows the server's reason.

**F5 · Receive and triage proposals (Built)**

1. Proposals arrive when a followed leader publishes, or when the follower
   mirrors open plans.
2. Each proposal shows its action and reasons in plain words, requested vs
   approved size, sizing math (for stop-risk: budget, risk per unit, planned
   loss at stop), and the declared plan.
3. Only COPY and SCALE proceed to review. WAIT, REVIEW and DECLINE explain what
   would have to change.
4. Optional: Assist scan (see §6).

**F6 · Review and sign (Built)** — the core moment

1. Follower opens a COPY or SCALE proposal.
2. PACT shows, side by side, the leader's declaration and the follower's
   adjusted order: size, sizing mode, entry vs the follower's Flash price bound,
   stop/target vs bracket or manual exit, and windows.
3. PACT shows the policy checks that passed and the market chart with declared
   levels and the bound.
4. Follower requests a quote. PACT applies quote-time checks (§3.3). If the
   quote breaks the mandate, the decision changes to WAIT or DECLINE and the
   flow stops.
5. The browser guard re-verifies the raw signing payload (§3.4). Any failure
   stops the flow.
6. Wallet prompts, in order and each explicit: switch chain if needed, token
   approval or Permit2 permit, sign the entry order, sign the bracket (if any).
7. PACT submits to Flash and creates the receipt. Policy is re-checked at
   submit: a proposal blocked in the meantime cannot be submitted.

**F7 · Watch execution (Built)**

Status, TWAP slice progress (fills ÷ buckets), each fill with price, notional,
time and transaction link, average fill, quoted price, declared entry, and entry
drift in bps (positive = the follower paid worse). Polling stops when the order
is terminal.

**F8 · Intervene (Built / Planned)**

- Cancel one order: follower signs Flash's cancel message (Built).
- Pause a leader: stops new copies, keeps the mandate, leaves live orders alone
  (Built).
- Unfollow (Built).
- Kill switch: cancel every open order from one leader with one signature
  (Planned).

**F9 · Understand the portfolio (Built)**

Approved-but-unsigned vs live-on-Flash exposure by asset and side, how many
leaders contribute to each, same-asset concentration against its cap, remaining
daily budget, open plans, and each leader's sleeve. Wallet balances for the
connected wallet. No PnL until it can be verified.

**F10 · Prove what happened (Built)**

Per order: export an evidence bundle (decision, proposal and policy hashes,
quote summary, receipt, fills, explorer links, raw Flash response, caveats). Per
leader: fidelity history (submitted, filled, mean and worst drift, fills within
the drift bound, close reasons).

### 5.4 Follower edge cases

| Case | Behaviour |
| --- | --- |
| Two leaders publish the same direction | Same-asset exposure cap scales or declines the second |
| Leader publishes more than the open-plan limit allows | Extra plans DECLINE `LEADER_ACTIVE_PLAN_LIMIT` |
| Market moves between decision and quote | Quote-time drift check → WAIT `ENTRY_DRIFT_TOO_HIGH` |
| Market moves after signing | Flash cannot fill beyond the signed price bound |
| Follower changes the mandate with proposals open | Unacted proposals are re-decided; acted ones keep their receipt |
| Follower pauses a leader with a live order | New plans wait; the live order continues until filled, cancelled or expired |
| Sell copy, Flash price unavailable | DECLINE `PRICE_UNAVAILABLE`; never sized blind |
| Wallet on the wrong chain | Switch prompt before signing |
| Guard check fails | Signing is blocked; the failing check is shown |
| Flash rate-limits health checks | Last good status is reused briefly; not reported as an outage |
| Demo desk selected | Everything is visible; every change and signature is disabled |

---

## 6. Agent

The agent is the follower's delegate. Its authority grows in levels, and each
level is gated by what the follower can verify and revoke.

### 6.1 Authority levels

| Level | Name | Status | Can do | Cannot do |
| --- | --- | --- | --- | --- |
| 0 | Review only | Built (default) | — | — |
| 1 | PACT Assist | Built | Read the follower's proposals and stored decisions; sort them into a review queue; explain | Quote, sign, submit, cancel, change any mandate, hold any key |
| 2 | Autopilot | Planned | Request quotes and execute COPY / SCALE plans within the mandate using a scoped session key | Anything outside the session's on-chain scope; widen a limit; override a refusal; withdraw funds |
| 3 | Bring-your-own agent | Idea | An external agent (for example via Flash's MCP tooling) operates a bounded sub-account under a PACT mandate | Same limits as level 2 |

### 6.2 Assist (Built)

Flow A1 · scan:

1. Follower turns Assist on (policy `automationMode = ASSIST`).
2. On scan, Assist reads the same stored decisions the follower sees.
3. Mapping: ALLOW / MODIFY → `PREPARE_REVIEW`; WAIT / REVIEW → `HOLD`
   ("Held; you paused this leader" for pauses); BLOCK → `DECLINE`.
4. Each prepared item links to the normal review flow. The follower still signs.

Assist is deterministic. It is not an LLM and it has no execution authority.

### 6.3 Autopilot (Planned)

Required authority model:

```text
Follower owner wallet
  └─ signs a short-lived session permission on a follower-owned smart account
       └─ the agent's session key may sign only permitted Flash orders:
            Base only · Flash settlement / Permit2 path only · allowlisted assets ·
            selected leaders · TWAP and limit · exact policy caps and stop-risk
            budget · exact entry bound · no transfers or withdrawals ·
            small per-period spend limit · expiry · owner revocation
```

Gates before any Autopilot switch exists:

1. The smart account validates Flash's typed-data signature (EIP-1271).
2. A session-key validator enforces chain, contracts, assets, side, order type,
   recipient, quantity, time window and no-withdrawal on-chain.
3. Every execution limit is derived from the exact policy snapshot the follower
   accepted.
4. Approval and Permit2 behaviour is tested with the smart account; no approval
   is silently widened.
5. The follower can revoke immediately; expiry is short by default.
6. Every agent action records session id, policy hash, quote, signature path,
   order id, fills and close reason.
7. A missing, expired or revoked session means `HOLD`, never a fallback key.
8. A small-value mainnet test succeeds first.

Flow A2 · autopilot loop (Planned):

```text
plan published → policy decision → COPY/SCALE only → size ≤ autopilot cap?
   yes → quote → quote-time checks → guard → session key signs → submit → receipt
   no  → route to the follower's review queue
anything else (WAIT / REVIEW / DECLINE, guard fail, session invalid) → HOLD, explain
```

Flow A3 · revoke (Planned): follower revokes the session from the owner wallet;
the agent drops to Assist instantly; open orders remain the follower's to cancel.

Optional (Planned): World ID step-up before enabling a material Autopilot
mandate. It confirms a human; it never authorises a wallet.

### 6.4 Bring-your-own agent (Idea)

From ideation notes, to be verified: the agent signs from a funded sub-account
(EIP-1271) holding only the sleeve, so a compromise is bounded to that sleeve;
the mandate gains an `executor` field (`human` or `agent`); the same policy
engine and evidence apply. Demo idea: one plan, two followers — the agent
follower auto-executes an allowed copy in seconds while the human follower's
copy is held because of drift.

### 6.5 Rules for any agent (non-negotiable)

1. **Policy decides what may happen; the agent decides only whether to do it.**
2. An LLM may summarise a plan or explain a decision. It may never set size,
   price, or turn a refusal into an approval.
3. Leader text (thesis, invalidation, title) is untrusted input. It is never
   given to a model as instructions.
4. Every agent decision is logged with the plan snapshot, policy hash, decision,
   quote and outcome, so it can be replayed.
5. When anything is uncertain, the agent holds.

---

## 7. Cross-persona scenarios

**S1 · The core copy** — Leader publishes a $80 TWAP buy at entry 2,500, stop
2,450, target 2,600. Follower A (25% proportional, $25 sleeve) gets COPY $20.
Follower B (100%) gets SCALE to $25 (`LEADER_DAILY_CAP`). Each reviews, the
quote holds inside 1% drift, each signs entry and bracket, Flash fills in slices,
receipts show drift per follower.

**S2 · The refusal** — Leader publishes a $40 market chase. Followers allowing
only TWAP and limit get DECLINE `ORDER_TYPE_NOT_ALLOWED`. No quote is requested.
The refusal is logged with its rule.

**S3 · The late copy** — Follower opens review after price moved 2% above the
declared entry. Quote-time check returns WAIT `ENTRY_DRIFT_TOO_HIGH`. Had they
signed earlier, Flash would not have filled it above entry × 1.01 (the limit price on the order).

**S4 · Concentration** — Two followed leaders both buy WETH. The second plan
scales or declines on `ASSET_EXPOSURE_CAP`; the portfolio shows two leaders
contributing to one WETH-buy exposure.

**S5 · Evidence-first follower** — A follower requiring leader evidence sees
every `UNVERIFIED` plan as REVIEW `LEADER_EXECUTION_UNVERIFIED` and copies only
`ORDER_FOUND` plans.

**S6 · Pause** — Follower pauses a leader mid-day: queued plans move to WAIT,
Assist shows them as held by the follower, the leader's live order keeps working
until filled or cancelled by the follower.

**S7 · Assist** — Follower in Assist scans: two plans are prepared for review,
one held, one declined; the follower opens a prepared one and signs.

**Seeded demo cases (Built):** core TWAP copy, sleeve scale, market refusal,
expired plan, low reward:risk caution, evidence required, high-beta pair
refusal. Loading the demo resets the local store.

---

## 8. What the product may and may not claim

| PACT may say | PACT must not say |
| --- | --- |
| "Your mandate decided SCALE because of your leader sleeve" | "This leader is safe" |
| "Flash won't fill this above $2,525" (the order's limit price) | "Copying this leader is profitable" |
| "Your signature only lets funds come back to you, up to $25" | "Your signature guarantees the price" |
| "Flash found an order under this leader's wallet" | "The leader's order matches this plan" (until `PLAN_MATCHED`) |
| "Your average fill was 10 bps worse than the declared entry" | A PnL, win rate or drawdown without receipts |
| "Planned loss at the declared stop is about $2" | "Your maximum loss is $2" |
| "Market context from GeckoTerminal" | That the chart is Flash's route, quote or fill |
| "Assist queued this for review" | That Assist executed, or that Autopilot exists |
| "Pausing stops new copies" | That pausing or a breaker cancels live orders |

---

## 9. Integrations

| Integration | Status | Used for |
| --- | --- | --- |
| Definitive Flash `POST /quote` | Built | Follower quotes with policy-shaped parameters |
| Flash `POST /order` | Built | Submitting follower-signed orders |
| Flash `GET /orders/{id}` | Built | Status, fills, leader evidence lookup (funder required) |
| Flash `POST /orders/{id}/cancel` | Built | Follower-signed cancel |
| Flash `GET /search` | Built | Health check and WETH price (cached 30s, latency measured) |
| Flash batch cancel | Planned | Needs confirmation from Definitive |
| Flash integrator fee | Built at 0 bps | Any fee shows in the quote before signing; leader share is an Idea |
| Base builder attribution code | Idea | From ideation notes; verify with Flash |
| GeckoTerminal OHLCV | Built | Base WETH/USDC candles, context only |
| wagmi + viem on Base | Built | Connect, switch chain, sign typed data and messages, approvals, balances |
| Permit2 | Built | Through Flash's response; spender and amount verified |
| Arc | Partial | Configured, not live-tested |
| Smart-account session keys (ERC-7579 class) | Planned | Autopilot |
| World ID | Planned | Leader directory uniqueness; Autopilot step-up |
| LLM explanations | Idea | Summaries only, under §6.5 |

---

## 10. Open questions and known gaps

1. **Policy and publish authentication.** Policy saves and plan publishing are
   not signed today; the API trusts the posted address. Decide: signed
   messages (SIWE-style) for every mandate change and every publish.
2. **Persistence.** State is a local JSON file. Multi-user use needs a database
   and per-user isolation.
3. **Live proof.** No real follower-signed Base fill is recorded yet. This
   blocks `PLAN_MATCHED`, fee and venue fields, fidelity history and any
   receipt-based leader reputation.
4. **Batch cancel.** Confirm Flash endpoint, signature shape and limits.
5. **Leader plan lifecycle.** Decide close and amend semantics.
6. **Exit modes.** Confirm trailing stop on Flash; decide whether it is a third
   follower exit mode.
7. **Sells.** Sells are sized from a live Flash price; decide whether follower
   sells (exits) are in scope, or only leader-declared exit orders.
8. **Autopilot provider.** Pick one smart-account and session-key provider and
   test EIP-1271 plus Permit2 with Flash before building.
9. **Economics.** Integrator fee level and any leader share; must appear as its
   own line before signing.
10. **Pairs.** Only Base WETH/USDC is fully supported (chart, decimals). Each new
    pair needs token mapping and data checks.

---

## 11. Appendix

### 11.1 API surface

| Method and path | Purpose |
| --- | --- |
| `GET /api/state?follower=` | Full desk state plus today's spend and blocked notional |
| `GET /api/policy?follower=` · `POST /api/policy` | Read (creates default) · save and re-decide |
| `GET /api/strategies` · `POST /api/strategies` | List plans · publish and mirror to followers |
| `GET /api/proposals` · `POST /api/proposals` | List · mirror one plan for one follower |
| `GET /api/agent?follower=` | Assist scan |
| `POST /api/quote` | Policy-shaped Flash quote with quote-time checks |
| `POST /api/order` | Submit a signed order and create the receipt |
| `GET /api/orders/{id}` | Refresh status and fills |
| `POST /api/orders/{id}/cancel` | Relay a follower-signed cancel |
| `GET /api/orders/{id}/evidence` | Evidence bundle (`?download` for a file) |
| `GET /api/market/weth` | GeckoTerminal snapshot and candles |
| `GET /api/health` | Flash reachability, WETH price, latency |
| `POST /api/demo` | Reset the store and seed the demo cases |

### 11.2 Glossary

| Term | Meaning |
| --- | --- |
| Plan | A leader's published, expiring trade intent |
| Mandate | A follower's limits, globally and per leader |
| Sleeve | The daily amount one leader may use of a follower's budget |
| Proposal | One plan evaluated for one follower |
| Copyability | How many of a leader's live plans fit a follower's mandate right now |
| Entry drift | Distance between the declared entry and the quote or fill, in bps |
| Price bound | The follower's maximum (buy) or minimum (sell) price, signed into the order |
| Bracket | A follower-owned take-profit and stop attached to the entry |
| Receipt | PACT's record of a submitted order and its fills |
| Fidelity | Whether execution stayed within what the follower approved |
| `ORDER_FOUND` | Flash found an order under the leader's wallet; not a plan match |
