# Operations

Run, configure, test and deploy PACT. The app lives in `pact/` (Next.js 16, React 19, wagmi
and viem; contracts in Foundry).

## Run locally

```bash
cd pact
npm install
cp .env.example .env.local    # fill in the values below
npm run dev                   # http://localhost:3000
```

Open `/` for the product page and **Launch app** for the terminal. Load the DEMO desks from the
Demo lab, or connect a wallet.

## Configuration

| Variable | Needed for |
| --- | --- |
| `FLASH_API_KEY` | Flash quotes and orders (required) |
| `EVM_RPC_URL`, `NEXT_PUBLIC_EVM_RPC_URL` | Base RPC for reads (default: the public endpoint) |
| `BASE_LOGS_RPC_URL` | Base endpoint for log reads (default `https://base-rpc.publicnode.com`; `mainnet.base.org` refuses log queries) |
| `NEXT_PUBLIC_FLASH_VAULT` | Pin the integrator fee vault in the wallet guard |
| `FLASH_BUILDER_CODE` | Optional Flash builder code |
| `PACT_SESSION_SECRET` | Session cookie key (generated beside the store if unset) |
| `PACT_STORE_FILE` | State location (default `.data/store.json`); sidecars sit beside it |
| `PACT_AUTOSEED=1` | Seed the DEMO desks on the first read of an empty store |
| `PACT_ORDER_STREAM=off` | Poll Flash instead of using its order stream |
| `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_PRIVATE_KEY` | World ID (the last is the RP signing key) |
| `WORLD_ENV=staging` | Use World's simulator instead of World App |
| `NEXT_PUBLIC_PACT_FACTORY_BASE`, `NEXT_PUBLIC_PACT_ACCOUNT_IMPL_BASE` (and `_ARC`) | Autopilot contracts once deployed |
| `PACT_AUTOPILOT_SUBMIT=1` | Let an active Autopilot session submit (otherwise a dry run) |

Never commit `.env.local`. Never paste a private key anywhere: every order is signed in the
wallet.

## Storage

| File | Contents |
| --- | --- |
| `store.json` | Plans, mandates, proposals, decisions, quotes, receipts, conduct |
| `store.evidence.jsonl` | The append-only, hash-chained evidence log |
| `store.grants.json` | Autopilot grants (session keys AES-GCM encrypted) |
| `store.humans.json` | World ID bindings (nullifiers) |
| `session-secret` | Session cookie key, when `PACT_SESSION_SECRET` is unset |

## Tests

```bash
cd pact
npm test                                        # unit
npm run lint && npx tsc --noEmit
FLASH_LIVE=1 npx vitest run lib/flash.live.test.ts       # live Flash quotes, no orders
PACT_ANVIL=1 npx vitest run lib/session-account.anvil.test.ts
(cd contracts && forge test)                     # session account and factory
(cd contracts && PACT_FORK=true forge test --fork-url https://mainnet.base.org --match-test fork)
```

End-to-end suites run against a server. Use an isolated server and store, never the one you use
day to day:

```bash
NEXT_DIST_DIR=.next-e2e PACT_STORE_FILE=/tmp/pact-e2e/store.json npx next dev -p 3920
PACT_URL=http://localhost:3920 npm run e2e          # follower flow, Flash, Arc, Autopilot, conduct
PACT_URL=http://localhost:3920 node e2e/ui.e2e.mjs  # navigation and UI
# World ID with World's simulator: start the server with WORLD_ENV=staging, then
PACT_URL=http://localhost:3920 npm run e2e:world
```

The World suite needs a store where the simulator's human has not verified yet (delete
`<store>.humans.json` first).

| Suite | Covers |
| --- | --- |
| Unit | Policy, sizing, guard, evidence chain, positions, order stream, signals, conduct, World ID, Autopilot, wallet facts |
| Live Flash | Real quotes for TWAP with protection, limit with bracket, Arc; the order WebSocket; Base reads; paper copies; three prices; exit marks |
| Foundry + anvil | `PactSessionAccount` and `PactAccountFactory`, PACT's encoders against them, real Permit2 on a Base fork |
| Follow e2e | Sessions, connect → guard → sign → submit, a tampered quote refused, holds, leader evidence, paper copies, signals, Arc, Autopilot dry run, ten-leader mandates, conduct holds |
| UI e2e | One navigation, URL state, back and forward, every route, landing, watchlist, live data |
| World e2e | Leader verification in the browser, one human per leader, refusals, verified-only rule, Autopilot approval |

## Deploy (Vercel)

`pact/vercel.json` declares Next.js; `pact/.vercelignore` keeps `.env*`, `.data` and build
output out of uploads.

```bash
cd pact
vercel link
vercel env add FLASH_API_KEY production          # and WORLD_*, PACT_SESSION_SECRET
vercel env add PACT_STORE_FILE production        # /tmp/pact/store.json
vercel env add PACT_AUTOSEED production          # 1
vercel deploy --prod
```

Vercel's only writable disk is `/tmp`, which is per instance and temporary: hosted desks, plans
and receipts can reset when the server is recycled (Flash keeps every order; the DEMO desks
re-seed). Run real-money tests against a server with persistent storage.

## Real-money test

Smallest useful test on Base: a leader wallet (no funds) and a dedicated follower wallet with
about $30 USDC and $1 of ETH.

1. **Leader**, My Plans: publish a TWAP: quantity 100, entry at today's price, stop −2%,
   target +4%, duration 600 s, 2 slices.
2. **Follower**: Discover → the leader → Follow with the default mandate (a $25 copy).
3. **Proposals** → the COPY → review → wallet guard "safe to sign" → sign the approvals,
   permits and orders.
4. **Orders**: watch both slices fill; open the order for fills, transaction links and the
   evidence bundle.
5. The stop and target stay live on Flash for 24 hours; cancel from the review page to remove
   them.

Expected cost: about $0.16 of Flash fees for two slices, a few cents of gas, and a little price
impact.
