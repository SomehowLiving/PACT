# Demo and submission

Deadline: **Saturday 7 Nov 2026, 09:00 IST**. Late submissions are not accepted.  
https://ethglobal.com/events/mumbai/info/details

## Video (do this even if “optional”)

- 2–4 minutes, ≥720p
- No AI voiceover, no phone recording, no music-over-text
- Post on **Discord and X**, tag **@DefinitiveFi**
- Record a **backup of the ALLOW fill** around hour 40 in case live Flash is slow on stage

## Script (~2:30)

| Time | On screen | Line |
| --- | --- | --- |
| 0:00 | Two labeled wallets | “PACT lets you follow a trader without giving them your wallet.” |
| 0:15 | Leader form | “Leader posts TWAP buy 25 USDC of WETH on Base, 10 minutes.” |
| 0:30 | Policy JSON | “Follower max 30 USDC, TWAP and limit only, this pair only.” |
| 0:45 | Green ALLOW, Sign, Basescan | “Policy allows it. Follower signs Flash. Here is the transaction.” |
| 1:30 | Leader market 500 | “Same follower, a 500 USDC market.” |
| 1:45 | Red BLOCK, Sign disabled | “Blocked: market is not allowed, size is over 30. No order id.” |
| 2:10 | One architecture slide | “Leader untrusted. Model untrusted. Policy deterministic. Follower signs. Flash executes.” |
| 2:25 | | “We did not backtest the leader. We proved the follower cannot be overrun.” |

First 30 seconds must already show numbers and a color. No chatbot.

## README (repo you submit)

- One-paragraph pitch
- Tx hash(es) and Flash `orderId`
- How Flash is used (quote → sign → TWAP)
- Threat model: who cannot sign
- AI tools used + prompts/specs path (ETHGlobal allows AI with attribution; spec-driven is allowed if specs are in the repo — these `guides/` and `specs/` count)
- Classic track, start timestamp, no prior product code

## Hacker Dashboard

- Title, description, **public GitHub**
- Select **≤3** partner prizes. Pick **Definitive**. Add others only if you actually integrated them
- Multiple Definitive tracks count as **one** partner selection
- Partner judging uses the form; booth visit is optional

## Git

Commit as you go. A single Friday dump can be disqualified.

## If live Flash fails on stage

Play the pre-recorded ALLOW fill. Live-demo BLOCK (no Flash needed). Do not invent a tx hash. If the API is down all weekend, Definitive is ineligible (onchain execution required). Do not start Aqua on Saturday morning.

## Failure modes judges punish

| Failure | Fix |
| --- | --- |
| Market-swap chatbot | Lead with TWAP |
| Policy banner only | Disable Sign + server 403 |
| Server `privateKeyToAccount` | Browser sign |
| Fake PnL | Don’t show |
| ENS without a fill | Inverse priority |
| Unlimited approve | `forceMinimalAllowance` |
| AI voice / <720p / phone | ETHGlobal video rules |
