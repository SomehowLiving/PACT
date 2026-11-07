# PACT

**Non-custodial copy trading where the follower owns the rules.**

PACT is a copy-trading layer built on [Definitive Flash](https://flash.definitive.fi).
Leaders publish structured trade plans. Each follower's own mandate decides what to copy,
how much, and how to exit. The follower signs every order in their own wallet (or through
a session key they created and limited on chain), and Flash executes it.

PACT does not hold a private key, custody funds, promise returns, or claim that copying a
profitable leader makes a follower profitable.

**Live:** https://pactfi.vercel.app · **Documentation:** [`docs/`](docs/README.md) ·
**Real copy on Base:** [fill 1](https://basescan.org/tx/0x0d3ed912328e1379a60a8506eb6a53b24e52bb7a7d85c68878a376e05fe25474),
[fill 2](https://basescan.org/tx/0x682b4fd438bc90dbe5b49d24bb09e565e5f7f76a28744f107e5f9a39225f3a81)
(a $5 TWAP copy executed by Flash at +2.0 bps from the leader's entry; see
[README](README.md#a-real-copy-on-base))

> **Status (Nov 6, 2026).** Everything below is built and covered by tests. The follower
> flow has been run end to end against live Flash on Base and Arc with throwaway wallets:
> real quotes, the browser wallet guard, real EIP-712 signatures, and Flash verifying them
> before refusing on balance. World ID is tested on World's staging network with World's
> simulator. **Not yet proven with real money:** a funded mainnet fill, a funded Arc fill, a
> production World ID proof from World App, and a live Autopilot session (its contracts
> are not deployed yet). See [Verification](#verification).

---

## Contents

1. [Thesis](#thesis)
2. [The problem](#the-problem)
3. [Market evidence](#market-evidence)
4. [How PACT works](#how-pact-works)
5. [What is built](#what-is-built)
6. [Architecture](#architecture)
7. [App surfaces](#app-surfaces)
8. [Verification](#verification)
9. [Running locally](#running-locally)
10. [Real-money test runbook](#real-money-test-runbook)
11. [Demo runbook](#demo-runbook)
12. [Honest constraints](#honest-constraints)
13. [Roadmap](#roadmap)
14. [Related documents and sources](#related-documents-and-sources)

---

## Thesis

> Do not copy a leader's position. Copy only the part of their plan that fits a
> follower-owned risk envelope, survives the execution path, and comes from a leader whose
> own execution backs it.

PACT's distinctive work is concentrated in four places: the **mandate** (per-leader rules
the follower owns), the **policy verdict** (COPY, SCALE, WAIT, REVIEW or DECLINE, with the
reason), **evidence** (what the leader and the follower actually executed), and **follower
fairness** (whether a leader traded against their own followers). Everything else is
deliberately familiar trading-terminal chrome.

## The problem

Copy trading fails for followers even when the leader is green. The follower gets a
different trade: a worse entry, a size that does not fit their capital, costs that erase
the edge, the same bet duplicated across several leaders, and an exit they do not control.
And some leaders use their followers as exit liquidity: buy early, publish, sell into the
buying the copy flow creates.

| Follower risk | PACT response | Status |
| --- | --- | --- |
| Position too large for the follower | Per-order, daily, per-leader, same-asset and open-plan caps; three sizing modes | Built |
| Leader's entry becomes a worse follower fill | Entry drift becomes the Flash limit price, enforced by Flash's engine | Built |
| Excessive impact, slippage or fees | Quote-time impact, slippage and execution-cost gates | Built |
| Plan has no invalidation or stop | Structured plan fields, quality grade, optional hard gate | Built |
| Several leaders, one directional bet | Same-asset/same-side concentration view and cap | Built |
| Follower cannot control the exit | Flash TP/SL pair on the follower's own position; PACT never mirrors leader exits | Built |
| Leader claims a trade they did not make | Leader's Flash order and Base transactions checked against the plan | Built |
| Leader front-runs or sells into followers | Follower-fairness detection; a repeat holds new copies | Built |
| Fake leader accounts, reset after losses | World ID: one unique human per leader address | Built (staging-tested) |
| Follower cannot see whether the copy stayed faithful | Receipts: quote, fills, drift, fees, protection, MATCH/MISMATCH verdicts | Built |
| Follower wants automation without handing over a key | Autopilot session key with limits enforced on chain | Built; not deployed |

## Market evidence

Copy trading is already a large, automated category. The evidence supports PACT's narrow
claim: the follower's outcome can diverge materially from the leader's, so the copy
mechanism and the follower's risk envelope deserve independent controls.

| Evidence | What it says | PACT implication |
| --- | --- | --- |
| [90-day multi-exchange outcome report](https://www.yieldfund.com/news/is-copy-trading-profitable-a-90-day-multi-exchange-study) | The publisher reports **100,236** Binance, Bybit and MEXC copier outcomes: **48.48%** ended profitable; **97.04%** of leaders were green on their own PnL, while only **43.61%** produced positive follower PnL. | A leader's displayed PnL is not enough. PACT controls size, entry bound, impact, cost and exit independently. |
| [IOSCO Final Report, May 2025](https://www.iosco.org/library/pubdocs/pdf/IOSCOPD793.pdf) | Imitative trading is often associated with short-term, higher-risk strategies; frequent trading fees can erode retail returns. | PACT shows a specific follower mandate before execution instead of presenting imitation as passive investing. |
| [Binance Copy Trading developer docs](https://developers.binance.com/en/docs/products/copy-trading/Introduction) | After the user picks an amount, the system automatically copies followed leaders' trades. | PACT starts from review-and-self-sign; its Autopilot is bounded by a session permission the follower creates and the chain enforces. |
| [Hyperliquid vault leader docs](https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/vaults/for-vault-leaders) | Legacy vault leaders take a **10%** profit share and must keep at least **5%** of vault capital. | Incentives and skin in the game matter, but PACT does not pool funds or treat a leader incentive as a substitute for follower-side controls. |
| [Social-learning trading-network study](https://arxiv.org/pdf/2507.01817) | Users select traders by popularity even when popularity correlates poorly with performance; static mirroring underperforms. | Discovery emphasises plan evidence, policy compatibility and execution fidelity, not follower counts or a PnL leaderboard. |

The 100,236-outcome report is publisher-produced, not an audited industry dataset. PACT uses
it to motivate a testable hypothesis, not as a promise:

> Even if a leader's idea is valid, a follower can lose because their entry, size,
> execution cost, portfolio context and exit are different.

## How PACT works

```text
Leader publishes a structured plan (optionally with their own Flash order and Base trades)
        │
        ├── PACT checks the leader's evidence, paper-copies the plan at Flash's real price,
        │   and watches the leader's conduct toward followers
        ▼
Follower selects leaders (up to 10) and owns a mandate per leader
        ▼
PACT policy returns COPY / SCALE / WAIT / REVIEW / DECLINE, with reasons
        ▼                                   (a blocked plan never reaches Flash)
Flash quote for the follower's size, with the follower's price bound
        ▼
Browser wallet guard re-checks the exact Flash payloads
        ▼
Follower signs approvals, permits, entry and protective TP/SL pair
   (or an Autopilot session key signs, inside limits the chain enforces)
        ▼
Flash executes; PACT tracks the order over Flash's order stream, reads fills back,
records the receipt, and appends every step to a hash-chained evidence log
```

Policy outcomes:

| Decision | Meaning |
| --- | --- |
| **COPY** | Fits the mandate as declared |
| **SCALE** | Fits, at a smaller size (a cap, a sleeve, or a leader trading out of character) |
| **WAIT** | Not now (plan expired, a cap is full, a loss breaker tripped) |
| **REVIEW** | Held for the follower's eyes (plan incomplete, evidence missing or contradicted, probation, conduct, unverified human) |
| **DECLINE** | Outside the mandate (pair, chain, side or order type not allowed; price unavailable) |

COPY and SCALE are policy decisions, not execution statuses. Following a leader never
places a trade.

## What is built

### Leaders and plans

A leader publishes a plan with: title, thesis, invalidation; chain, pair, side and Flash
order type (market, limit, TWAP with duration, optional bucket count and start time,
optional price bound); quantity; reference entry, stop and target; entry window and a
separate protection window; follower capacity; and optional evidence (a Flash order ID
and Base transaction hashes).

Plan structure is validated (`stop < entry < target` for longs, the reverse for shorts)
and graded **DISCIPLINED**, **CAUTION** or **INCOMPLETE** from reward:risk and
completeness. Each plan has a canonical page (`/plans/[id]`) with the chart and its levels.

### Leader evidence

PACT reads the leader's evidence itself, read-only:

- **Flash order:** looked up under the leader's wallet and compared with the plan (pair,
  side, order type, size, timing, price controls).
- **Base transactions:** receipts and ERC-20 transfers read from Base RPC, including the
  leader's Flash fill transactions. Each transaction can back only one plan, and only
  finalized blocks count as final.

Statuses: `UNVERIFIED` (a declaration only), `ORDER_FOUND`, `PLAN_MATCHED`,
`ONCHAIN_VERIFIED`, and `MISMATCH` (the leader's own execution contradicts the plan). A
contradicted plan is held for **every** follower (`LEADER_EXECUTION_MISMATCH`); a follower
can also require a minimum evidence level.

### Paper copies and probation

Every new plan is paper-copied at Flash's real all-in quote, with no signature, and settled
against market candles. A leader is **on probation** until three paper copies have settled
and none of their plans is contradicted. A follower can require that a leader has passed
probation (`LEADER_ON_PROBATION`). Paper copies that mostly could not be copied within
default limits mark the leader "hard to copy".

### Follower fairness: front-running and selling into followers' buys

First-party detection, from facts PACT already holds for each copied plan
(`lib/conduct.ts`, scanner `lib/conduct-run.ts`):

- **Traded well before publishing.** The leader's own evidenced trade came at least 30
  minutes before the plan was published, and followers' real Flash fills paid at least
  100 bps worse than the leader. Trading just before publishing is normal skin in the game
  and is not flagged.
- **Sold into followers' buys.** The plan's asset left the leader's wallet on Base (ERC-20
  `Transfer` logs from the leader, on any Base venue, not only Flash) while followers'
  copies were filling, from the first fill to 30 minutes after the last: at least 25% of the
  leader's evidenced position, or of what followers bought when the position is unknown.
- **One occurrence is a caution** (a badge on Discover and the profile). **A repeat is an
  alert:** PACT holds every follower's new copies of that leader for review
  (`LEADER_SOLD_INTO_FOLLOWERS`, `LEADER_FRONT_RAN_FOLLOWERS`) and records the finding in
  the evidence log. Copies are re-decided only when a hold starts or ends.
- Re-checked when followers' fills arrive and when the leader's profile is read. The
  profile's **Follower fairness** panel shows each plan's numbers.
- **Limits, stated in the UI:** Base only. Sales on a centralized exchange, another chain or
  another wallet are not visible, and a transfer out counts like a sale.

### Signals

- **Style drift:** a plan far outside the leader's usual size. A proportional copy is
  scaled back to the usual size and says why (`LEADER_SIZE_OUT_OF_CHARACTER`).
- **Revenge re-entry:** a bigger re-entry right after a stop-out is held for review
  (`LEADER_REVENGE_PATTERN`).
- **Three prices at quote time:** Chainlink ETH/USD on Base, the GeckoTerminal chart and
  Flash's executable quote, side by side. A copy waits if Flash or the chart diverges from
  the oracle beyond the follower's limit (default 1%, `REFERENCE_PRICE_DIVERGENCE`).

### Follower mandates

A follower selects up to **10 leaders** and owns a mandate for each, inside portfolio-wide
limits.

| Control | Default |
| --- | ---: |
| Leaders selected | up to 10 |
| Sizing | 25% proportional |
| Stop-risk budget | $2 planned loss at the declared stop |
| Per order | $5 to $30 |
| Daily budget | $50 |
| Per-leader daily sleeve | $25 |
| Same-asset, same-side exposure | $35 |
| Open plans | 3 total, 1 per leader |
| Order types / sides | TWAP and limit; buys |
| Maximum entry drift | 1% |
| Maximum quote price impact | 0.5% |
| Maximum market slippage | 1% |
| Maximum execution cost | 3% of size |
| Plan must have an invalidation | yes |

Sizing modes per leader:

1. **Proportional:** a fraction of the leader's notional.
2. **Fixed USD:** a fixed follower notional.
3. **Stop-risk budget:** the most the follower would lose at the leader's declared stop.

```text
risk per unit = |entry − stop|
units         = risk budget / risk per unit
buy qty       = units × entry   (USDC)
sell qty      = units           (target asset)
```

A planned-loss estimate, not a guaranteed maximum: gaps, partial fills, costs and an
unfilled stop can lose more.

Optional gates the follower can switch on: plan quality, minimum leader evidence, passed
probation, verified-human leaders only, a per-leader realized-loss breaker, and World ID
approval before Autopilot. Each leader can be paused without losing their mandate.

### Flash execution

PACT integrates Flash's quote, order, order status, cancel and batch cancel endpoints, and
Flash's **order WebSocket** (one scope per connection, heartbeats) with REST polling as a
fallback.

For each follower quote PACT applies:

- the follower's entry drift as the Flash limit price (`limitNotionalPrice`, or
  `limitCrossPrice` on a limit entry with protection), a stricter leader bound winning;
- slippage limits for market orders and price-impact limits for advanced orders, sent on
  the quote and echoed on submit;
- an **execution-cost budget**: Flash's estimated fees (platform, network, integrator) as
  a share of size, separate from drift. A small TWAP whose automatic slice count would
  exceed it is re-quoted once with two slices;
- copies that never outlive the plan (a resting copy expires with the copy window; a TWAP
  finishes inside it);
- a Flash **TP/SL pair** on the follower's own position when the follower chooses bracket
  exits. Its expiry is never earlier than the entry's.

**Who enforces what.** The limit price and TP/SL triggers are enforced by Flash's engine;
they are not inside the follower's signature (which binds tokens, maximum spend, recipient,
fee vault and deadline). So PACT reads the live levels back after submit and flags any
difference, and every receipt carries MATCH/MISMATCH verdicts for the price bound, fees,
recipient, integrator fee and protection.

### Browser wallet guard

Before any wallet prompt, the follower's browser re-checks Flash's raw payloads for the
entry and the protection pair: recipient and swapper, tokens and chain (the protection sells
what the entry buys), policy-approved amount and a bound on what protection may sell, the
Permit2 or approval spender and amount, the integrator fee vault when pinned
(`NEXT_PUBLIC_FLASH_VAULT`), the signing domain, and a future deadline.

The guard proves **where funds can go**, not at what price: even a tampered price or trigger
can only mis-time a trade back into the follower's own wallet. In the end-to-end test a
server inflating the amount 20× is refused before the wallet is asked for anything.

### Receipts, positions and P&L

For each submitted order PACT records the leader's declared entry, the quoted price and
all-in price, the Flash order ID, status and close reason, fills with transaction hashes,
TWAP progress, average fill, entry drift in bps, fees (finalised fills only, reorg-safe),
protection status and its own fills. Buy copies become **positions** from Flash's own fill
rows; open P&L is marked at Flash's exit quote. Nothing is shown until a copy has filled.
Each order has a downloadable `evidence.json`.

### Evidence log

Every mandate change, plan, decision, quote, submit, rejection, status change, cancel,
leader evidence, paper copy, conduct finding, World ID verification and Autopilot action is
appended to an **append-only, hash-chained** log (`<store>.evidence.jsonl`): SHA-256 over
canonical JSON, linked both globally and within each thread. The browser recomputes every
hash; editing or deleting an event shows as broken.

### Wallet sessions

Writes require a Sign-In with Ethereum (EIP-4361) session: a gasless message, then a
12-hour HMAC cookie. Saving a mandate, publishing, quoting, submitting and cancelling are
refused without one (401) or for another wallet (403).

### World ID

World ID 4.0 (IDKit 4.6), identity only, never trading authority and never a skill signal:

- **Verified-human leaders.** A leader proves one unique human is behind their wallet; the
  proof's signal is the wallet address. PACT signs the request (the RP signing key stays on
  the server), forwards the proof to World's `/v4/verify`, checks environment, action and
  signal, and binds the nullifier. One human backs one leader address; a second address for
  the same human is refused (409). Followers see a badge, can filter Discover by it, and can
  copy verified humans only (`LEADER_NOT_VERIFIED_HUMAN`).
- **Autopilot approval (mandate step-up).** Opt-in: before an Autopilot session key is
  created, the follower approves its exact limits in World App. The signal is the follower
  plus those limits, so an approval for $25/order cannot be replayed for $2,500/order. The
  first approving human becomes the desk's approver; a different human is refused.
- The public log records a SHA-256 digest of a nullifier, never the nullifier itself.

### Autopilot

Optional automation without handing PACT a key the chain does not limit:

- `PactSessionAccount` (Foundry, `contracts/`): an EIP-7702 / clone account deployed by
  `PactAccountFactory`. It grants and revokes a session key and validates signatures through
  EIP-1271 for three kinds only: Flash orders, Permit2 permits and cancels. The scope is
  enforced on chain: who signs, until when, which tokens, the most per order and per permit,
  and that every order pays out to the follower's PACT wallet.
- PACT's policy, wallet guard, daily cap and evidence log apply on top.
- The session key is generated server-side, stored AES-GCM encrypted, and never returned.
- Until the factory is deployed and `PACT_AUTOPILOT_SUBMIT=1` is set, Autopilot quotes,
  checks and signs as a **dry run** and never submits. The default session is 72 hours,
  which must outlast the 24-hour protection it signs.

### Arc

The same follower flow runs on Arc (chain 5042): a follower opts in to Arc in the mandate,
and leaders publish Arc plans. Flash quotes Arc, the wallet guard passes Arc payloads, the
wallet signs permits and orders, and Flash verifies the signatures.

### PACT Assist

Deterministic, optional review queue: it maps stored policy results to *prepare review*,
*hold* or *decline*. It cannot change a policy, request a quote, sign, submit or cancel.

### Real-world data

- **Live market strip** on Discover, Portfolio and Orders: the WETH/USDC pool price, 24h
  change, 24h volume and liquidity (Uniswap v3 on Base via GeckoTerminal), Chainlink ETH/USD
  on Base with its age, and Flash's quote against the oracle. A failed read retries in 5 s.
- **On-chain profile for every leader** (profile Overview, and "On Base" in the Discover
  leader panel), read live from Base: ETH, USDC and WETH balances, transactions sent,
  contract or plain wallet, USDC and WETH in and out over the last 6 hours, and the last
  token move, with a Basescan link (`lib/wallet-facts.ts`, `/api/wallets/[address]`,
  cached 2 minutes). These are facts about the wallet, not a performance record. DEMO
  addresses are never read and say so.
- **Live-priced DEMO plans:** reloading the demo prices every DEMO plan off Chainlink's
  ETH/USD (entry at market, stop −2%, target +4%, resting limits 0.5% under), with the same
  policy outcomes as before. The Publish ticket also starts at today's price.
- Log reads (`eth_getLogs`, used by the wallet profile and the follower-fairness check) go
  to an endpoint that serves them: `mainnet.base.org` rate-limits them to nothing, so PACT
  uses `base-rpc.publicnode.com` (override with `BASE_LOGS_RPC_URL`).

### Watchlist

Star a leader to watch without following. A per-browser convenience (localStorage);
starring never follows, sizes or copies anything.

## Architecture

PACT is layered so that each layer's facts are kept apart from the layer that judges them.

| Layer | Responsibility | Key files (`pact/`) |
| --- | --- | --- |
| L0 Adapters | Flash REST and WebSocket, Base RPC, Chainlink, GeckoTerminal | `lib/flash.ts`, `lib/flash-stream.ts`, `lib/base-rpc.ts`, `lib/oracle.ts`, `lib/market.ts` |
| L1 Evidence store | State and the hash-chained log | `lib/store.ts`, `lib/evidence.ts`, `lib/evidence-verify.ts` |
| L2 Domain | Plans, proposals, receipts, positions | `lib/types.ts`, `lib/positions.ts`, `lib/receipts.ts`, `lib/tracker.ts` |
| L3 Signals | Leader evidence, paper copies, style and revenge, references, conduct | `lib/leader-evidence.ts`, `lib/leader-verify.ts`, `lib/shadow*.ts`, `lib/signals.ts`, `lib/reference.ts`, `lib/conduct*.ts` |
| L4 Policy | The decision and its reasons; copyability preview | `lib/policy.ts`, `lib/copyability.ts` |
| L5 Execution | Quote shaping, cost budget, submit, cancel | `lib/copy-quote.ts`, `lib/submit-order.ts`, `app/api/quote`, `app/api/order` |
| L6 Authority | Sessions, wallet guard, Autopilot, World ID | `lib/session.ts`, `lib/guard.ts`, `lib/autopilot.ts`, `lib/session-account.ts`, `lib/world*.ts`, `contracts/` |
| L7 Experience | The trading terminal | `components/`, `app/` |

The UI follows one navigation system (`components/AppShell.tsx`): the header holds the five
workspaces; the rail's top group is the current workspace's sections; its bottom group
("You") is My Plans, Mandate and Settings; the account menu holds the wallet and tools. No
destination is listed twice, every route belongs to exactly one place, and every object has
one canonical URL. Rules: `pact/PACT_UI_DESIGN_RULES.md`, `pact/AGENTS.md`.

## App surfaces

| Route | What it is |
| --- | --- |
| `/` | Landing page |
| `/trade` | Market terminal: chart, the selected plan and your mandate check, incoming plans |
| `/discover`, `/following`, `/watchlist` | Leaders (table and leader panel), the leaders you follow, your watchlist |
| `/leaders/[address]` | Leader profile: overview, plans, execution evidence and follower fairness, paper copies |
| `/plans/[id]` | A published plan with its chart, copies, leader execution and evidence log |
| `/proposals`, `/assist` | Your proposal inbox by decision; PACT Assist |
| `/review/[proposalId]` | Proposal review: plan, your execution, policy check, Flash quote, wallet guard, signing |
| `/portfolio`, `/desk` | Positions, exposure and sleeves; the desk overview |
| `/execution`, `/orders/[id]`, `/history` | Orders with fills, policy, plan and evidence; a canonical order link; the activity log |
| `/leader` | My Plans: publish a plan, verify as a human |
| `/settings/mandate`, `/settings/wallet`, `/settings/preferences` | Mandate; wallet, Autopilot and World ID; preferences |
| `/lab`, `/follower`, `/leader/classic` | Tools: demo lab, the classic follower desk, the classic leader ticket |

API (`app/api`): `state`, `policy`, `strategies` (+ `[id]/evidence`), `proposals`, `quote`,
`order`, `orders/[id]` (+ `cancel`, `evidence`), `positions`, `reference`, `market/weth`,
`leaders/[address]`, `evidence`, `session` (+ `nonce`), `autopilot` (+ `run`), `world`
(+ `sign`, `verify`), `agent`, `demo`, `health`, `preflight`.

## Verification

Full run, Nov 6, 2026 (no funds; throwaway wallets):

| Suite | Result | What it covers |
| --- | --- | --- |
| Typecheck, lint, production build | pass | — |
| Unit (`npm test`) | 173 passed | Policy, sizing, guard, evidence chain, positions, stream, signals, conduct, World ID, Autopilot, copyability |
| Live Flash (`FLASH_LIVE=1`) | 9 passed | Real Flash quotes (limit with bracket, TWAP with protection, Arc), the order WebSocket, a real Base transaction, a paper copy on real candles, three prices, an exit mark; no orders placed |
| Foundry (`forge test`) | 14 passed, plus the Base-fork Permit2 test | Session account and factory |
| Anvil (`PACT_ANVIL=1`) | 3 passed | PACT's encoders against the deployed contracts |
| Follow e2e (`npm run e2e`) | 48/48 | Sessions; connect, guard, sign, submit to Flash; tampered quote refused; BLOCK locked; leader evidence contradicted; paper copies; three prices; style drift; Arc; Autopilot dry run; six leaders; conduct hold |
| UI e2e (`node e2e/ui.e2e.mjs`) | 39/39 | One navigation, nothing listed twice, URL state, back and forward, routes, landing, watchlist, Settings tabs, live market strip, on-chain profile, tablet drawer |
| World e2e (`npm run e2e:world`, staging) | 22/22 | Leader verification in the browser with World's simulator, one human per leader, wrong-wallet and replay refusals, verified-only rule, Autopilot approval |

Not yet proven: a funded mainnet fill and its protection, a funded Arc fill, a production
World ID proof from World App, a live Autopilot session (factory not deployed), and leader
conduct on a real leader with real follower fills.

## Running locally

```bash
cd pact
npm install
cp .env.example .env.local   # then fill in the values below
npm run dev                  # http://localhost:3000
```

| Variable | Needed for |
| --- | --- |
| `FLASH_API_KEY` | Flash quotes and orders (required) |
| `EVM_RPC_URL`, `NEXT_PUBLIC_EVM_RPC_URL` | Base RPC (defaults to the public endpoint) |
| `BASE_LOGS_RPC_URL` | Base endpoint for log reads (default `https://base-rpc.publicnode.com`) |
| `NEXT_PUBLIC_FLASH_VAULT` | Pin the integrator fee vault in the wallet guard |
| `FLASH_BUILDER_CODE` | Optional Flash builder code |
| `PACT_SESSION_SECRET` | Session cookie key (generated into the store folder if unset) |
| `PACT_STORE_FILE` | Store location (default `.data/store.json`) |
| `PACT_ORDER_STREAM=off` | Poll Flash instead of using its order stream |
| `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_PRIVATE_KEY` | World ID (the last is the RP signing key) |
| `WORLD_ENV=staging` | Use World's simulator instead of World App |
| `NEXT_PUBLIC_PACT_FACTORY_BASE`, `NEXT_PUBLIC_PACT_ACCOUNT_IMPL_BASE` (and `_ARC`) | Autopilot contracts once deployed |
| `PACT_AUTOPILOT_SUBMIT=1` | Let an active Autopilot session submit (off: dry run) |

Tests:

```bash
npm test && npm run lint && npx tsc --noEmit
FLASH_LIVE=1 npx vitest run lib/flash.live.test.ts
PACT_ANVIL=1 npx vitest run lib/session-account.anvil.test.ts
(cd contracts && forge test)
npm run e2e                                 # against a running server (PACT_URL)
node e2e/ui.e2e.mjs
WORLD_ENV=staging npm run dev & npm run e2e:world
```

**Hosted (Vercel).** `pact/vercel.json` declares Next.js; `pact/.vercelignore` keeps `.env*`,
`.data` and build output out of uploads. Production sets `PACT_STORE_FILE=/tmp/pact/store.json`
(Vercel's only writable disk), `PACT_SESSION_SECRET`, `PACT_AUTOSEED=1` (an empty store seeds
the live-priced DEMO desks on first read), `FLASH_API_KEY` and the `WORLD_*` values. `/tmp` is
per instance and temporary, so hosted desks, plans and receipts can reset when Vercel recycles
the server (Flash keeps every order); use a local server for the real-money test.

Run end-to-end tests against an isolated server and store, e.g. `NEXT_DIST_DIR=.next-e2e
PACT_STORE_FILE=/tmp/pact-e2e/store.json npx next dev -p 3920`, never against the store
you use day to day.

## Real-money test runbook

Smallest useful test, on Base.

- **Leader wallet:** any wallet; no funds needed.
- **Follower wallet:** a dedicated wallet with about $30 USDC and about $1 of ETH on Base.
  Never paste a private key anywhere; everything is signed in the wallet.

1. **Leader**, at `/leader`: optionally verify with World ID. Publish a TWAP plan: quantity
   100, reference entry at today's price, stop −2%, target +4%, duration 600 s, 2 slices.
2. **Follower**: Discover → the leader → Follow with the default mandate. The copy is 25%
   of 100, so $25.
3. **Proposals** → the COPY → Proposal Review. Confirm the wallet guard says "safe to sign",
   then sign: two small USDC approvals (gas), then permits and orders.
4. **Orders**: watch both slices fill; open the order for fills, transaction links and
   `evidence.json`.
5. **After the fill**, the stop and target stay live on Flash for 24 hours and can trade.
   Cancel from the review page to stop them.

Expected cost: about $0.16 of Flash fees for two slices, a few cents of gas, and a little
price impact.

## Demo runbook

1. Open `/` (landing), then **Launch app**. Choose a DEMO desk from the desk picker, or load
   the demo scenario from the Demo lab.
2. **Discover**: the leader table, the leader panel, copyability for your desk; Leader BBBB
   carries the "sold into followers" badge.
3. **Leader profile**: evidence, paper copies, probation, and the Follower fairness panel.
4. **Proposals**: COPY, SCALE, WAIT, REVIEW and DECLINE cases with their reasons.
5. **Proposal Review**: the plan's levels on the chart, your execution under the mandate,
   the policy check, the Flash quote and the wallet guard.
6. **Portfolio and Orders**: sleeves, exposure, positions, order detail with fills, policy,
   plan and evidence.
7. **Mandate**: per-leader sizing, caps, exits, the World ID and Autopilot options.

DEMO data is seeded, labelled DEMO everywhere, and read-only.

## Honest constraints

- Hackathon software: no security audit.
- State is a local JSON store and an append-only log file, not multi-user persistence.
- Pairs: WETH/USDC on Base and Arc; spot only. No leverage, liquidation or funding controls.
- Leader conduct reads the leader's wallet on Base only. Centralized exchanges, other chains
  and other wallets are invisible, and a transfer out counts like a sale.
- Open P&L appears only after a copy has filled; PACT has no leader PnL leaderboard and
  computes no correlation, Sharpe or "safe leader" score from thin history.
- Autopilot's contracts are not deployed; until they are, Autopilot only dry-runs.
- World ID is staging-tested; a production proof from World App has not been recorded.
- No funded mainnet or Arc fill has been recorded yet.

## Roadmap

1. Record the funded Base fill and its protection; then Arc.
2. Deploy the session factory on Base and record a live session-signed fill.
3. A PACT integrator key and pinned fee vault; leader revenue from follower outcomes (for
   example a share above the follower sleeve's high-water mark), so dumping followers
   costs the leader.
4. Markouts, venue split and a one-signature leader kill switch.
5. Token-side risk (holder concentration, deployer-linked wallets) from external
   clustering data, beside PACT's behavioural conduct signal.

## Related documents and sources

- `pact/IMPLEMENTATION_STATUS.md`: what was built, step by step, with test results.
- `pact/PACT_UI_DESIGN_RULES.md`, `pact/AGENTS.md`: UI rules and the navigation model.
- `pact/PRODUCT_DIRECTION.md`: terminal information architecture.
- `pact/CRITIQUE_AND_WORLD_DECISION.md`: critique response, Flash facts, World ID decision.
- `pact/FOLLOWER_OUTCOME_STRATEGY.md`: follower-risk product strategy.
- `pact/AGENT_AUTOMATION_ARCHITECTURE.md`: Assist and Autopilot authority model.
- `docs/`: the product documentation (concepts, formulas, policy, execution, leaders, security, architecture, API, operations).

External sources:

- YieldFund, *Is Copy Trading Profitable? A 90-Day, Multi-Exchange Study*:
  https://www.yieldfund.com/news/is-copy-trading-profitable-a-90-day-multi-exchange-study
- IOSCO, *Online Imitative Trading Practices: Copy Trading, Mirror Trading, Social Trading*
  (May 2025): https://www.iosco.org/library/pubdocs/pdf/IOSCOPD793.pdf
- Binance Developer Docs, *Copy Trading Introduction*:
  https://developers.binance.com/en/docs/products/copy-trading/Introduction
- Hyperliquid Docs, *For Vault Leaders (Legacy)*:
  https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/vaults/for-vault-leaders
- Joseph et al., *When Influence Misleads: Informational and Strategic Limits of Social
  Learning in Trading Networks* (arXiv): https://arxiv.org/pdf/2507.01817
- Definitive Flash docs: https://flash.definitive.fi/docs
- World ID docs: https://docs.world.org/world-id/overview
