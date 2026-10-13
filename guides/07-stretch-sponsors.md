# Stretch sponsors

Recheck https://ethglobal.com/events/mumbai/prizes on **1 Nov 2026** and at **kickoff**.

As of 2026-10-13 only **Definitive** and **1inch** have criteria. You may select **three** partners. Default: Definitive + leave two slots empty until a page publishes.

**Do not implement a stretch until the Mumbai prize text exists.** Analog text from Tokyo/NY/Lisbon is not a rule.

## Add at most one

| If Mumbai publishes like… | Add this | Skip if… |
| --- | --- | --- |
| World ID for Agents (Tokyo analog: denied path must not execute) | ASK_HUMAN when notional > X; World ID on the follower; show failure path | You do not have time for IDKit + backend verify |
| Arkiv ($15k unpublished) | One entity: `{strategyId, decision, flashOrderId, tx}` on Tiramisu | Prize requires something heavier than SDK write |
| ENSv2 Sepolia (Tokyo analog: must be ENSv2, not cosmetic `.eth`) | Read policy or leader name from Permissioned Resolver **at decide time** | You only planned a name badge |
| Chainlink CRE (NY analog) | Skip unless a day remains | — |
| 1inch Aqua | Skip. Iceberg already set a mainnet bar at Tokyo | — |
| Arc / Hedera / 0G / Whitechain / EF / Uniswap | Only if the published brief is a small add to the existing demo | It becomes a second product |

## World ASK_HUMAN (sketch, analog only)

- New verdict `ASK_HUMAN` when `notionalUsd > policy.askHumanUsd`
- World ID proof verified **on the server** before Sign enables
- Expired / failed proof → same as BLOCK (no Flash order)
- Tokyo analog required the denied path to be real

## Arkiv (sketch)

- Tiramisu testnet id `7738577`
- RPC `https://rpc.tiramisu.db-chain.testnet.arkiv.network`
- SDK `@arkiv-network/sdk`
- Write after decision + after fill. Query in the UI. Prize page still unpublished.

## ENS (sketch)

Tokyo required **ENSv2 on Sepolia**, live demo, open source, feature central. Cosmetic `useEnsName` on mainnet will not clear that bar.

## Continuity extras

Definitive Continuity $1,500 and 1inch Continuity Aqua are **Continuity-track** money. Classic submissions do not plan on them.
