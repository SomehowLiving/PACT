# Trading principles and formulas

The rules PACT trades by, and the exact maths behind every number it shows. Formulas are
the ones the code computes (`pact/lib/policy.ts`, `lib/flash.ts`, `lib/positions.ts`,
`lib/signals.ts`, `lib/reference.ts`, `lib/conduct.ts`).

## Principles

1. **Copy the plan, not the position.** A leader's size fits the leader's capital, not the
   follower's. PACT copies the plan's direction and levels, and sizes it under the follower's
   own rules.
2. **The follower owns size, risk and exit.** Caps, sleeves, sizing mode and exit are the
   follower's. A leader cannot change them, and PACT never widens them.
3. **Policy before price, price before signature.** A plan is decided before it is quoted,
   and quoted (with its own checks) before anything is signed. A blocked plan never reaches
   Flash.
4. **A claim needs execution behind it.** A plan is a declaration. The leader's own Flash
   order and Base trades are evidence; a plan they contradict is held for every follower.
5. **Keep facts apart.** The leader's declared entry, the market price, Flash's quote and the
   actual fill are four different numbers, and PACT shows each with its source.
6. **No number without a source.** PnL comes from Flash fill rows; prices from Flash,
   Chainlink and the pool. PACT computes no win rate, Sharpe ratio or "safe leader" score from
   thin history.
7. **Followers are not exit liquidity.** A leader who repeatedly sells while followers buy,
   or gets in long before publishing at a better price, has their copies held.
8. **Bounded automation.** Automation signs only inside limits the chain enforces, and the
   follower can revoke it in one call.

## Sizing

The **leader size** is the plan's quantity: for a buy, the USDC the leader spends; for a sell,
the units of the asset sold.

**Proportional** (default 25%):

```math
\text{copy} = \text{leader size} \times \text{copy ratio}
```

**Fixed:**

```math
\text{copy notional} = \text{fixed USD}
```

**Stop-risk budget** (default $2): size the copy so that a fill at entry and an exit at the
leader's stop loses the budget.

```math
\text{risk per unit} = |\text{entry} - \text{stop}|
\qquad
\text{units} = \frac{\text{risk budget}}{\text{risk per unit}}
\qquad
\text{notional} = \text{units} \times \text{entry}
```

A buy is sent to Flash as `notional` USDC, a sell as `units` of the asset. The stop must be on
the losing side (below entry for a buy); otherwise the copy is held (`STOP_RISK_PLAN_INVALID`).
This is a planned-loss estimate, not a guaranteed maximum: gaps, partial fills, costs and an
unfilled stop can lose more.

**Style drift.** If the plan is far larger than the leader's usual size, a proportional copy is
brought back to the usual size:

```math
\text{ratio} = \frac{\text{plan size}}{\text{median}(\text{leader's last same-side plans})}
\qquad (\ge 3 \text{ prior plans})
```

`ratio ≥ 2` is a caution; `ratio ≥ 3` is an alert, and the proportional copy is multiplied by
`1 / ratio` and marked SCALE with `LEADER_SIZE_OUT_OF_CHARACTER`.

## Caps and SCALE

After sizing, the copy must fit every cap. If it does not, PACT scales it to the largest size
that fits:

```math
\text{cap} = \min(\text{per-order max},\ \text{daily max} - \text{spent today},\ \text{leader sleeve} - \text{leader spent today},\ \text{asset cap} - \text{asset exposure},\ \text{plan capacity})
```

- `cap ≥ minimum order` and scaling allowed → **SCALE** to `cap`, with the cap's reasons
  (`SIZE_EXCEEDS_MAX`, `DAILY_CAP`, `LEADER_DAILY_CAP`, `ASSET_EXPOSURE_CAP`, `PLAN_CAPACITY`).
- Otherwise → **DECLINE**.

**Same-asset concentration** counts approved and live copies on the same asset and side,
across all leaders:

```math
\text{asset exposure} = \sum_{\text{copies, same asset and side}} \text{notional}
\qquad \le \text{asset cap (default \$35)}
```

Open plans are also capped: 3 in total and 1 per leader by default.

## Reward to risk and plan grade

```math
\text{R:R}_{\text{long}} = \frac{\text{target} - \text{entry}}{\text{entry} - \text{stop}}
\qquad
\text{R:R}_{\text{short}} = \frac{\text{entry} - \text{target}}{\text{stop} - \text{entry}}
```

| Grade | Rule |
| --- | --- |
| `INCOMPLETE` | entry, stop or target missing, or not ordered `stop < entry < target` (long) / `target < entry < stop` (short) |
| `CAUTION` | ordered correctly, R:R below the minimum (default 1.5) |
| `DISCIPLINED` | ordered correctly, R:R at or above the minimum |

## The follower's price bound

For TWAP and limit copies, the follower's maximum entry drift becomes the **Flash limit
price**, so Flash's engine itself refuses to fill worse:

```math
\text{bound}_{\text{buy}} = \text{entry} \times (1 + \text{max drift})
\qquad
\text{bound}_{\text{sell}} = \text{entry} \times (1 - \text{max drift})
```

If the leader declared a stricter bound, it wins: the lower one for a buy, the higher one for a
sell. (On a limit entry that carries a TP/SL pair, Flash requires the bound as
`limitCrossPrice` instead of `limitNotionalPrice`.)

## Quote-time checks

Run on Flash's real quote, before anything is signed (`decideExecution`):

| Check | Rule | Outcome if broken |
| --- | --- | --- |
| Three prices | Flash's quote and the pool's price each within the reference limit (default 1%) of Chainlink ETH/USD | WAIT `REFERENCE_PRICE_DIVERGENCE` |
| Price impact | Flash's estimated impact ≤ max impact (default 0.5%) | DECLINE `PRICE_IMPACT_TOO_HIGH` |
| Entry drift | `abs(execution price / entry − 1) ≤ max drift` (default 1%) | WAIT `ENTRY_DRIFT_TOO_HIGH` |
| Execution cost | cost ratio ≤ max cost (default 3%) | WAIT `EXECUTION_COST_TOO_HIGH` |

**Reference divergence:**

```math
\text{divergence (bps)} = (\frac{\text{price}}{\text{Chainlink}} - 1) \times 10{,}000
```

**Execution cost.** Flash can report fees in a fee field or fold them into the price, so PACT
takes whichever is larger:

```math
\text{value lost}_{\text{buy}} = \max(0,\ \text{USD in} - \text{USD value out})
\qquad
\text{cost} = \max(\text{reported fee},\ \text{value lost})
\qquad
\text{cost ratio} = \frac{\text{cost}}{\text{size}}
```

A small TWAP whose automatic slice count pushes the cost over budget is re-quoted once with
two slices.

**All-in price** (what one unit really costs, fees included):

```math
\text{all-in}_{\text{buy}} = \frac{\text{USD in}}{\text{units out}}
\qquad
\text{all-in}_{\text{sell}} = \frac{\text{USD out} - \text{fee}}{\text{units in}}
```

## After the fill

**Entry drift** of the actual fill against the leader's declared entry (positive = the follower
paid worse):

```math
\text{drift}_{\text{buy}} = \frac{\overline{\text{fill}} - \text{entry}}{\text{entry}} \times 10{,}000
\qquad
\text{drift}_{\text{sell}} = \frac{\text{entry} - \overline{\text{fill}}}{\text{entry}} \times 10{,}000 \ \text{bps}
```

where the average fill is volume-weighted over finalized fills. Fees count finalized fills
only, so a reorged fill cannot be double-counted.

**Position and P&L** (buys; from Flash's own fill rows):

```math
\text{average cost} = \frac{\text{entry USD}}{\text{entry units}}
\qquad
\text{exit units} = \min(\text{protection fills},\ \text{entry units})
```

```math
\text{realized} = (\text{exit USD} - \text{exit fees}) - \text{exit units} \times \text{average cost}
```

```math
\text{open units} = \text{entry units} - \text{exit units}
\qquad
\text{unrealized} = \text{open units} \times \text{mark} - \text{open units} \times \text{average cost}
```

The **mark** is Flash's executable sell quote for the open units, net of fees, so it sits below
the mid-price. Nothing is shown until a copy has filled.

## Leader signals

**Paper copies and probation.** Every new plan is paper-copied at Flash's real all-in quote
(no signature) and settled on market candles against its stop and target. A leader is **on
probation** until 3 paper copies have settled and none of their plans is contradicted by their
own execution.

**Revenge re-entry.** A plan larger than the leader's last stopped-out plan, published within
24 hours of that stop-out, is held for review (`LEADER_REVENGE_PATTERN`).

**Front-running.** For a plan with the leader's evidenced trade and followers' real fills:

```math
\text{lead (min)} = \frac{t_{\text{published}} - t_{\text{leader trade}}}{60}
\qquad
\text{advantage}_{\text{buy}} = \frac{\overline{\text{follower fill}} - \overline{\text{leader price}}}{\overline{\text{leader price}}} \times 10{,}000 \ \text{bps}
```

Flagged when the lead is at least 30 minutes **and** the advantage at least 100 bps. Trading
just before publishing is normal skin in the game.

**Selling into followers' buys.** The window runs from the first follower fill to 30 minutes
after the last. Using the plan asset's transfers out of the leader's wallet on Base:

```math
\text{sell ratio} = \frac{\text{units leaving the leader's wallet in the window}}{\text{leader's evidenced position (or units followers bought)}}
```

Flagged at a sell ratio of at least 25%.

**Conduct level.** One flagged plan is a **caution**. Two of the same kind is an **alert**,
and every follower's new copies of that leader are held for review
(`LEADER_SOLD_INTO_FOLLOWERS`, `LEADER_FRONT_RAN_FOLLOWERS`).

**Loss breaker** (optional). When the follower enables it, a leader whose copies realized at
least the daily loss limit today (default $10) has new copies wait
(`LEADER_LOSS_CIRCUIT_BREAKER`).

## Order types on Flash

| Order type | How PACT copies it |
| --- | --- |
| **TWAP** | Split into slices over a duration (≥ 300 s; 2–2560 slices). The follower's bound is the limit price; the copy finishes inside the plan's entry window. |
| **Limit** | Rests at the bound; expires with the plan's entry window. With a TP/SL pair, the bound is sent as `limitCrossPrice`. |
| **Market** | Fills now within the follower's slippage limit (default 1%). Not allowed by the default mandate. |
| **TP/SL pair** | Attached to the entry on the follower's own position; its expiry is never earlier than the entry's (default protection window 24 h). |

## Defaults

| Control | Default |
| --- | ---: |
| Leaders selected | up to 10 |
| Sizing | 25% proportional |
| Stop-risk budget | $2 at the declared stop |
| Per order | $5 to $30 |
| Daily budget | $50 |
| Per-leader daily sleeve | $25 |
| Same-asset, same-side exposure | $35 |
| Open plans | 3 total, 1 per leader |
| Order types / sides | TWAP and limit; buys |
| Max entry drift | 1% |
| Max price impact | 0.5% |
| Max market slippage | 1% |
| Max execution cost | 3% |
| Reference divergence limit | 1% |
| Minimum reward:risk | 1.5 |
| Plan must have an invalidation | yes |
| Leader daily loss limit (if enabled) | $10 |
