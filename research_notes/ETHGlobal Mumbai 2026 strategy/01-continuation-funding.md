# Continuation pass — prizes recheck and capital sources

**Access:** 2026-10-13 (same cutoff as the first pass). Search tools: `web_search` 401; DuckDuckGo HTML captcha (`error-lite+aab3`). Used direct HTTP GET and Wikipedia API.

## Prizes recheck (CONFIRMED)

`https://ethglobal.com/events/mumbai` still **HTTP 500**.

`https://ethglobal.com/events/mumbai/prizes` still lists 12 partner pools summing to **$144,500**. RSC payload includes `"isMissingPrize":true` for unpublished sponsors. Published criteria remain **only 1inch and Definitive**.

| Sponsor | Amount | Criteria |
| --- | --- | --- |
| World | $12,500 | coming soon |
| 1inch | $7,000 | Aqua $5,000 + Continuity $2,000 — published |
| 0G | $15,000 | coming soon |
| Uniswap Foundation | $15,000 | coming soon |
| Arc | $15,000 | coming soon |
| Hedera | $15,000 | coming soon |
| Arkiv | $15,000 | coming soon |
| Whitechain | $15,000 | coming soon |
| Ethereum Foundation | $15,000 | coming soon |
| ENS | $10,000 | coming soon |
| Definitive | $5,000 | Social Flash $3,500 + Continuity $1,500 — published |
| Chainlink | $5,000 | coming soon |

## Capital sources opened this pass

### Circle / Arc — CONFIRMED product; Wikipedia for corporate capital (SECONDARY encyclopedia)

- Circle blog, dated **12 Aug 2025**, page also shows **14 May 2026**: [Introducing Arc: An Open Layer-1 Blockchain Purpose-Built for Stablecoin Finance](https://www.circle.com/blog/introducing-arc-an-open-layer-1-blockchain-purpose-built-for-stablecoin-finance). Arc is Circle’s L1 for stablecoin finance / “Economic OS.” Nav also lists **Circle Agent Stack**.
- [docs.arc.io/llms.txt](https://docs.arc.io/llms.txt) and [arc-chain.md](https://docs.arc.io/arc-chain.md): Arc **Testnet and Mainnet** exist; **USDC is gas** (not ETH); sub-second finality; Osaka EVM baseline; native USDC is **18 decimals** on Arc; faucet `https://faucet.circle.com`. Skill: `circlefin/skills` `use-arc`.
- Flash `supported-chains.md` already lists `arc` chain id **5042** (mainnet list). Flash docs still list **no testnet**.
- Wikipedia *Circle Internet Group* (revision ~29 Sep 2026): raised **US$1.1 billion by 2019**; **NYSE IPO 4 Jun 2025** (sought $624 million at up to $6.7 billion; day-two market value about $28.6 billion). **Do not treat this as an “Arc round.”** Arc is a product of a public issuer.

### World — Wikipedia SECONDARY

- Wikipedia *World (blockchain)*: Tools for Humanity / World (ex-Worldcoin). **~$250 million** VC including Andreessen Horowitz; **$25 million Oct 2021** then **+$100 million within six months**. Rebranded World 2024. January 2025: CPO said the company was looking into World ID being used to **license AI agents** to act on a user’s behalf. Privacy enforcement actions in Philippines (Oct 2025) and Thailand (Nov 2025) cited on the same page.

### Chamber (formerly dHEDGE) — CONFIRMED vendor

- Rebrand post **26 Apr 2026**: [dHEDGE is now Chamber: The Vault Layer for the AI Age](https://chamberfi.com/blog/dhedge-is-now-chamber-the-vault-layer-for-the-ai-age). Quote: **“Agents can act, but the vault sets the rules.”** Contracts/vaults/token continuity claimed.
- [Trader delegation](https://docs.chamberfi.com/manage/trader-delegation.md): one trader address; can execute inside Guard System; **cannot withdraw depositor funds**; **cannot** change fees or rotate manager. Default: trader **can** change enabled assets (must be turned off explicitly).
- Ondo tokenized stocks/ETFs/commodities in Chamber vaults: blog **17 Jun 2026**.
- Protocol fee: **10% protocol cut** (fees-performance.md index blurb in llms.txt).
- **Round-level VC for dHEDGE/Chamber still NOT OPENED.** CoinGecko lists DHT; that is a token listing, not a round.

### Definitive — CONFIRMED product; funding UNVERIFIED

- [flash getting-started.md](https://flash.definitive.fi/docs/getting-started.md): create integrator key at app.definitive.fi → More → Flash → Create Flash Key. Playground key `dpka_513a2bd7_57a2_46d2_927b_2a3857fe271b` for trading/docs. Integrator Admin email can cancel orders.
- [docs.definitive.fi](https://docs.definitive.fi): non-custodial platform + API; TWAP/limit/stops; 200+ DEXs in marketing copy on this page (Flash overview says 900+ — **inconsistent marketing**, do not treat as a measured count).
- `blog.definitive.fi` still **HTTP 403**. No funding round page opened.

### 0G — CONFIRMED product docs; funding UNVERIFIED

- [docs.0g.ai](https://docs.0g.ai): Galileo testnet; inference / storage / fine-tuning / validator docs. Landing marketing: “350+ Partners, 20M+ Accounts, 250M+ Transactions” — **MARKETING**. No Series amount opened.

### Still not opened

Definitive round, 0G round, Arkiv/Golem round, Whitechain/WhiteBIT round, ENS DAO treasury as “funding,” Hedera as a public network (not a seed). Do not infer absence of capital.

## Implication for the Mumbai build

Capital is **concentrated in Circle (public, Arc L1 + Agent Stack)** and **World (large identity raise + agent-license narrative)**. Chamber is the **commercialized vault-guardrail** answer to “AI must not send funds anywhere.” Definitive is paying a **small published bounty** for the **non-custodial social** version of that problem. The Type 4 gap (follower-signed Flash copy) is still not owned by Chamber, because Chamber requires a deposit into a vault.
