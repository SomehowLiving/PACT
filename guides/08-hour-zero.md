# Hour zero — Classic kickoff

Create the **product** repo when the hackathon starts. Keep this research repo as a private reference, or copy `guides/` + `specs/` into the new repo as documentation (ETHGlobal allows spec-driven workflows if specs live in the submitted repo).

## Create the app

```bash
npx create-next-app@latest pact --typescript --tailwind --eslint --app --src-dir
cd pact
git init
git add .
git commit -m "chore: next.js scaffold at hackathon start"
```

Copy in:

- `guides/` and `specs/` from this research repo
- `.env.example` → `.env.local` with `FLASH_API_KEY` and `EVM_RPC_URL`

```bash
npm i viem wagmi @tanstack/react-query
```

Pick a wallet kit you already know (RainbowKit / ConnectKit).

## Order of work (from the build plan)

| Hours | Done when |
| --- | --- |
| 0–6 | `lib/flash.ts` market quote+sign+submit from the **follower** browser on Base, 1–5 USDC |
| 6–12 | Same path with `orderType: twap`, `durationSeconds: 600`. Screenshot `orderId` |
| 12–20 | `lib/policy.ts` + tests from `specs/policy-cases.json` |
| 20–32 | Leader page + Follower page, colors |
| 32–40 | E2E ALLOW fill + BLOCK; backup video of the fill |
| 40–48 | README, hashes, Discord+X, dashboard form, ≤3 partners |
| 48–60 | One stretch **if** published |
| 60–72 | Rehearse the 2:30 script. Sleep. No new sponsors |

## First Flash script shape

Follow https://flash.definitive.fi/docs/twap-order.md and https://flash.definitive.fi/docs/market-order.md — **except** replace `privateKeyToAccount` with wagmi `signTypedData` / `sendTransaction`.

## Do not start with

- Aqua
- ENSv2
- A design system rewrite
- Agent chat UI
- Training anything
