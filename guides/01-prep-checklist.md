# Prep checklist (now → kickoff)

Do these in calendar order. None of this is the PACT codebase.

## This week

- [ ] Apply / confirm ETHGlobal Mumbai acceptance and **stake ETH** (each teammate). https://ethglobal.com/events/mumbai/info/start
- [ ] Join the event Discord when the start page lists it
- [ ] Read [02-flash-api.md](02-flash-api.md) once, then the official pages it cites
- [ ] Create a **new** Definitive account with email at https://app.definitive.fi (integrator contact)
- [ ] Desktop: **More → Flash → Create Flash Key**. Store the key in a password manager, not in git
- [ ] Optional: add Flash MCP for **your** learning only (`npx -y @definitive-fi/flash-mcp`). Do not point it at a follower key

## Wallets and funds (Base mainnet)

Flash `supported-chains.md` lists **mainnets only**. There is no Flash testnet in that doc.

- [ ] Two fresh wallets: **Leader**, **Follower** (Rabby / Rainbow / MetaMask)
- [ ] Label them in the wallet UI so the demo cannot mix them up
- [ ] Follower: ETH for gas + **~40 USDC** on Base (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)
- [ ] Leader: enough ETH to post strategies (no Flash spend required for “post strategy”)
- [ ] Confirm USDC is **Base native USDC**, not bridged leftovers

Small sizes. The demo TWAP is ~25 USDC.

## Practice (keep off the submission repo)

Using the **public** playground key is allowed by Flash docs for development:

`dpka_513a2bd7_57a2_46d2_927b_2a3857fe271b`

- [ ] `GET https://flash.definitive.fi/v1/search?query=weth&chain=base` with `x-definitive-api-key`
- [ ] `POST /quote` market buy 1 USDC of WETH on Base with `funderAddress` = follower
- [ ] Read `evm.orderTypedData` — do **not** submit from a script you will later commit as PACT
- [ ] Note whether `evm.approveTx` appears (first token approval)

## 1 Nov 2026 and kickoff morning

- [ ] Open https://ethglobal.com/events/mumbai/prizes
- [ ] If World / Arkiv / ENS / others published, pick **at most one** stretch from [07-stretch-sponsors.md](07-stretch-sponsors.md)
- [ ] Partner form: **Definitive** + at most two others. Cap is **three**

## Gear for the video

- [ ] Laptop screen recording ≥720p (OBS / native). No phone. No AI voiceover. No music-over-text
- [ ] X account that can tag `@DefinitiveFi`
- [ ] Discord login for the Definitive channel

## Do not

- Train a model
- Build a chain
- Start Aqua
- Implement ENSv2 or Arkiv before the Mumbai page publishes
- Put private keys in `.env` committed to git
