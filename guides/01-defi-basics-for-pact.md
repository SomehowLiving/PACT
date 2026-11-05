# DeFi from zero, then PACT

For someone who has never traded onchain. Read Parts 1 to 5 first. Part 6 connects all of it to PACT. Part 7 is a cheat sheet for talking to the Flash team.

Nothing here assumes you know crypto. Where a stock market or banking comparison helps, I use it. Comparisons are never perfect, so I say where they break.

---

## Part 1: The very basics

### A blockchain is a shared spreadsheet nobody owns
- It records who owns what. Thousands of computers keep identical copies, so nobody can quietly edit it.
- You can only change the spreadsheet by sending a **transaction**: "move 30 USDC from my account to that account."
- Each blockchain is its own spreadsheet. **Base** and **Arc** (the two chains PACT uses) are two different ones. Money on Base is not on Arc.
  - **Base** is a cheap, fast chain built on top of Ethereum.
  - **Arc** is a newer chain from Circle (the company behind USDC), designed around USDC payments.
- **Mainnet** means the real chain with real money. A **testnet** is a practice copy with fake money. Flash only runs on mainnet, so a real test costs a little real money.

### A wallet is your account, and a key is your password
- Your **address** is like a bank account number (`0x8335…2913`). Anyone can see it and send money to it.
- Your **private key** is the secret that proves you own the address. Whoever has it can move the money, and there is no "forgot password" and no bank to call.
- A **wallet** (MetaMask, Rainbow and so on) is an app that holds your key and asks you to approve things.
- **Signing** means the wallet uses your key to approve a specific message or transaction. Nobody can fake your signature without your key.

### Gas is a small fee
Every transaction costs a tiny fee, called **gas**, paid to the chain's computers. On Base it is usually cents, paid in ETH. Some actions are free to sign (see Part 4) because they are messages, not transactions.

### Tokens
- **ETH** is the chain's native coin. **WETH** is "wrapped ETH", the same value in a standard token format that apps can handle easily.
- **USDC** is a stablecoin: one USDC is meant to equal one US dollar.
- Both USDC and WETH are **ERC-20 tokens**, which just means they follow a common standard that every app understands.
- A **trading pair** is two tokens swapped against each other, like USDC to WETH. PACT trades USDC and WETH.

---

## Part 2: Trading onchain

### Exchange vs DEX
- **Centralized exchange** (Coinbase, Binance): you deposit your money with them, and they hold it. You trust the company. This is **custodial**.
- **DEX** (decentralized exchange, like Uniswap): your money stays in your own wallet. You swap directly using smart contracts. This is **non-custodial**.
- A **smart contract** is a program that lives on the blockchain and runs exactly as written, with nobody able to change it.

### Swapping
A **swap** trades one token for another, for example 30 USDC for some WETH. Prices come from **liquidity**: pools of tokens that other people put in so swaps are possible.

Two words you will hear:
- **Slippage:** the price moved between when you asked and when the trade happened. "Max slippage 1%" means "cancel if it gets more than 1% worse."
- **Price impact:** a big trade moves the price against itself, because it uses up a lot of the pool. Small pools hurt big trades the most.

### Order types
On a normal stock app you know these. Onchain they are harder, and that is what Flash provides.

| Order | Plain meaning | Example |
|---|---|---|
| **Market** | Do it now at the current price | "Buy $30 of WETH now." |
| **Limit** | Do it only at my price or better | "Buy WETH only if it drops to $2,000." |
| **TWAP** | Split it into many small pieces over time to avoid moving the price | "Buy $60 of WETH in slices over 2 hours." |
| **Stop-loss** | Sell automatically if the price falls to a level, to limit a loss | "If WETH hits $1,800, sell." |
| **Take-profit** | Sell automatically if the price rises to a level, to lock in a gain | "If WETH hits $2,600, sell." |

Two terms:
- **Notional** means the dollar size of an order. "$60 notional" means "worth $60."
- **Buy** vs **sell**: PACT buys WETH with USDC, and sells WETH back to USDC.

### Why onchain orders are hard
A blockchain only does something when someone sends a transaction. It cannot "wait until the price hits $2,000". So a "limit order" needs something to watch the market and act at the right time. That watcher cannot be allowed to take your money, only to carry out the order you signed.

---

## Part 3: What Flash is

**Definitive** is a company that sells professional trading tools for crypto. **Flash** is their API (a way for programs to talk to them). With Flash, an app can place all the order types in Part 2 on many chains, including Base and Arc, and Definitive handles the watching, routing to the best prices and executing.

The sequence in plain steps:
1. **Quote:** your app asks Flash, "I want to buy WETH with 30 USDC, here is my wallet." Flash replies with exactly what the wallet needs to sign.
2. **Sign:** the wallet signs. The money stays in the wallet.
3. **Submit:** your app sends the signed order to Flash.
4. **Execute:** Flash carries out the order (now, later or in slices) and reports the fills.

A **fill** is one executed piece of an order. A TWAP order has many fills.

Flash is aimed at pro traders, apps and AI agents. Their hackathon prize asks for a social trading app, and "copy trading" is the first example they list.

---

## Part 4: Permission and signatures

This part matters most for PACT. It is also where people get confused.

### Two different kinds of "approve"
1. **Token approval (a transaction, costs gas).** Before an app can move your USDC, you must tell the USDC token "this contract is allowed to spend my USDC." Many apps ask for an **unlimited** approval (the largest number, "max uint256") so you don't have to approve again. That is convenient and also risky: if that contract is ever compromised, the whole balance is exposed.
2. **Signing a message (free, no gas).** Wallets can sign a structured message that is not a transaction. Flash uses these for the actual order and the exact spending limit.

### Permit2
**Permit2** is a shared contract (made by Uniswap) that sits between your tokens and apps. You approve Permit2 once (the unlimited one), and then for each app you sign a message that says "this app may spend up to X, until this time." The real limit lives in that signed message, not in the token approval.

### EIP-712
The standard way to sign a **readable** message. Your wallet shows fields (amount, token, who gets the money, deadline) instead of a blob of letters. It is also the standard that lets software check what you are about to sign.

### The danger PACT is built around
You sign what the wallet shows you. If a server hands you the wrong order (a bigger amount, or proceeds sent to someone else) and you click "sign," you have approved it. Most people don't read these screens.

---

## Part 5: Copy trading

### The idea
A **leader** trades. **Followers** automatically do the same trades with their own money. Followers get the leader's skill, and leaders may earn from it.

### The two usual designs, and their problems
- **Vaults (custodial):** you deposit into a pool the leader controls. If the leader or the platform goes wrong, your money goes with it. You are trusting a person.
- **Mirror bots (copy blindly):** a bot repeats every trade at whatever size. A leader comfortable with $5,000 trades puts a $5,000-sized bet on a follower who only has $30 they're comfortable losing.

Both ignore the follower's own limits at the moment money moves.

---

## Part 6: PACT in this language

**PACT = policy-aware copy trading on Flash.** The follower keeps their keys, and their own rules decide what to copy.

### What each piece is
| PACT piece | In plain words |
|---|---|
| **Leader** | The person who posts a trade idea. Cannot touch a follower's money. |
| **Follower** | The person copying. Their wallet is the only thing that can spend their funds. |
| **Policy** | The follower's rules: max per order, max per day, which chains, which order types, buy or sell, max slippage. Like a card spending limit. |
| **Verdict** | The decision on each trade: **ALLOW** (copy as is), **MODIFY** (shrink it to the follower's limit), **BLOCK** (refuse; nothing is sent to Flash). |
| **Policy engine** | The code that gives the verdict. Pure rules, no AI guessing. |
| **Wallet guard** | A second, independent check in the follower's browser. Before the wallet pops up, it reads what Flash returned and refuses if anything is off. |
| **Fill timeline** | A step-by-step view: quote, guard, approve, sign, submit, then live status and fills. |
| **Cancel** | Stop a resting order by signing a free message. |
| **History** | A log of every decision, with the reason, and a hash (fingerprint) of the proposal and the rules used. |

### The one rule everything follows
**The policy decides whether the signature is allowed to happen.** Flash only honors an order the follower signed, and the follower's wallet never signs a BLOCKED or tampered order.

### Why there are two checks (policy and guard)
The server runs the policy, but a server could lie: it could say "allowed, $30" and then hand the wallet a $600 order. The guard in the browser checks the real payload from Flash, so it does not have to trust the server. This is the main original idea, and the best thing to explain.

What the guard checks, simply: right chain, right Flash contract, the follower is both the sender and the receiver, the right tokens, the amount is no more than the approved size, and the permission and deadline are sane.

### The demo in one sentence
One leader posts a $60 buy and three followers see three different results: "steady" gets it cut to $30, "bold" gets the full $60, "careful" is blocked and nothing is sent.

### What's real and what is not
- **Real:** the policy engine, the guard (19 tests), live quotes on Base and Arc, a browser test with a mock wallet.
- **Not yet proven:** a real order filled onchain. Flash refused our unfunded test wallet, and a funded run is the missing step.
- **Honest limits:** the unlimited Permit2 approval is still unlimited (the real cap is the signed amount), TWAP timing is not part of the signature, and PACT does not judge whether a strategy is any good.

---

## Part 7: Cheat sheet for the Flash conversation

### Say it in one sentence
"Copy trading where each follower's own risk rules decide what gets signed, so nobody else can move their money."

### Words you can now use confidently
quote, Permit2, EIP-712, fill, TWAP, notional, slippage, non-custodial, policy, guard.

### Likely questions and simple answers
- **"Why not just use a vault?"** Vaults make you trust the leader with your money. Here the follower signs everything.
- **"Why not just copy automatically?"** Blind copying ignores the follower's limits, so the sizes can be far too big.
- **"What if your server is hacked?"** The browser guard checks every payload before signing, so a changed order is refused. It cannot move funds without the follower's signature.
- **"Is this a real order yet?"** Not yet. Quotes and signing flow work, and a funded run is next.
- **"What do you want from us?"** A way to test with a funded key or credits, and answers on the questions in the previous message.

### What to avoid saying
- "Fully tested end to end" (it is not, until a real fill).
- "Completely secure" (the guard checks what is signed, not what happens afterward).

### Questions worth asking them
See the list in the earlier message. The two that matter most:
1. Why does `/order` return a signature error for an unfunded wallet, and is there a way to test without real funds?
2. Could the order's duration and trigger prices be part of the signed data, so wallets can verify them?

---

## Glossary
- **Address:** public account number on a chain.
- **Approve:** permission for a contract to spend a token.
- **Chain:** one blockchain (Base, Arc).
- **Custodial / non-custodial:** someone else holds your money / you do.
- **DEX:** an exchange built from smart contracts.
- **ERC-20:** the standard format for tokens.
- **Fill:** one executed piece of an order.
- **Gas:** the fee for a transaction.
- **Liquidity:** the tokens in a pool that make swaps possible.
- **Mainnet / testnet:** real chain / practice chain.
- **Notional:** dollar size of an order.
- **Permit2:** shared contract that lets you grant limited, signed spending permission.
- **Policy:** a follower's personal rules.
- **Price impact:** how much your own trade moves the price.
- **Private key:** the secret that controls an address.
- **Quote:** Flash's reply with exactly what to sign.
- **Slippage:** the price moving against you before the trade happens.
- **Smart contract:** a program living on a chain.
- **Stablecoin (USDC):** a token meant to equal one dollar.
- **TWAP:** an order split into slices over time.
- **WETH:** ETH wrapped as a standard token.
