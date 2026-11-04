# PACT — ETHGlobal Mumbai 2026

Policy-aware copy trading on **Definitive Flash**. Follower wallet signs; policy can still **BLOCK**.

Event: **5–7 Nov 2026**, Mumbai. Submission **Sat 7 Nov 09:00 IST**.  
Primary prize: Definitive Flash social app **$2,500** (plus the Continuity-only Most Creative **$2,500**). Arc Continuity bounty **$3,000**. Verified against the live prize pages on 18 Oct 2026.

## Start here

1. **Next steps** — [below](#next-steps)
2. **Guides** — [`guides/README.md`](guides/README.md)
3. **Why this product** — [`docs/README.md`](docs/README.md)
4. **Company gap + OSS** — [`guides/09-company-gap-and-oss.md`](guides/09-company-gap-and-oss.md)
5. **Workbook** — [`ETHGlobal_Mumbai_2026_Research.xlsx`](ETHGlobal_Mumbai_2026_Research.xlsx)

The product app lives in [`pact/`](pact/). It was written before kickoff, so it is submitted on the **Continuity** track (decision made 18 Oct 2026; see [`guides/00-classic-vs-continuity.md`](guides/00-classic-vs-continuity.md)).

## Next steps

### Now (this week)

| # | Action | Guide |
| --- | --- | --- |
| 1 | Confirm ETHGlobal acceptance + stake | Event start page |
| 2 | Read Flash guide once | [guides/02-flash-api.md](guides/02-flash-api.md) |
| 3 | Definitive email account + Flash API key | [guides/01-prep-checklist.md](guides/01-prep-checklist.md) |
| 4 | Two Base wallets, ~40 USDC + gas on the follower | same |
| 5 | Practice `GET /search` and `POST /quote` (do not commit scripts) | [guides/02-flash-api.md](guides/02-flash-api.md) |

### 1 Nov 2026

Recheck [mumbai/prizes](https://ethglobal.com/events/mumbai/prizes). Ten of twelve were unpublished on 13 Oct 2026. If World or Arkiv publish, add **one** stretch from [guides/07-stretch-sponsors.md](guides/07-stretch-sponsors.md).

### Thu 5 Nov, hour 0

Follow [guides/08-hour-zero.md](guides/08-hour-zero.md). Scaffold Next.js, implement policy tests, then TWAP fill, then UI, then video.

### Do not do before kickoff (Classic)

Implement Leader/Follower screens, `policyEngine` in an app package, or a Flash submit script in the repo you will submit.

## Product in one loop

Leader strategy → follower policy → proposal → **ALLOW / MODIFY / BLOCK** → follower signs Flash EIP-712 → fill receipt (`transactionId`).

## Layout

```
pact/          Next.js app (floor / lead / follow)
docs/          strategy research (sponsors, winners, PACT verdict)
guides/        how to integrate Flash, policy, demo, hour 0
specs/         data model, policy test vectors, MVP checklist
hackathon/     pointer to pact/
reports/       long strategy memo
```

## Official Flash docs

https://flash.definitive.fi/docs/llms.txt
