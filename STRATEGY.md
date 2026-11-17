# Patient momentum

This entry is a deterministic, long-only CBBTC paper trading bot for
`btc-race-24h-20261117-0603`. It starts with the harness's 1,000 USDC of
paper capital and uses only the incoming replay protocol. It makes no network
requests, signs no transactions and spends no real funds.

## Trading rule

Build a rolling history from CBBTC closes actually present in `batch.bars`,
including warm-up bars. `LOOKBACK = 24` means comparing the current close with
the close 24 observed bars earlier, requiring 25 closes. Gaps add no observation.
After warm-up, remain in cash until this trailing return is at least 0 bps.
Then buy with `min(cash, equity * max_weight_bps / 10,000)`, subject to the
minimum notional and position/order caps. A rejected entry can be retried on a
later fresh bar whose signal still qualifies; there can be only one filled buy.

Hold the position without rebalancing or taking small profits. If its marked
value falls to 94% or less of its entry cost, including the buy fee, trigger
`HARD_STOP_BPS = 600` and sell all. Once triggered, keep requesting an exit on
fresh bars until the position is flat, even if price recovers. Never re-enter.
Otherwise the harness sells the position at the window's final close.
Orders use the wide `max_slippage_bps = 10,000` allowed by the protocol.

`runBars` handles hello, each batch and bar, order serialization, unique client
IDs and done. Decisions use integer prices and amounts, with no clock,
environment, file reads or randomness. Orders decided at a close fill at the
next bar's open; a missing next bar can cause rejection. Every warm-up reply is
empty, while warm-up closes still build history.

## Why this approach

The published local grades show hold-cash at zero, buy-and-hold around +1.07
USDC and the house momentum bot around +2.45 USDC, each of the latter with one
trade. EMA cross, RSI/Bollinger and ADX momentum suffered large losses from
frequent trading. A full-size round trip costs approximately 26 bps in fees,
slippage and impact, so repeated minute-scale trades need substantial moves
just to break even.

This bot keeps the house momentum bot's simple 24-bar horizon, adds an absolute
nonnegative-return entry filter, and stops after a substantial adverse move.
Buy-and-hold enters immediately; this entry waits for an observed signal.
House momentum selects the only asset regardless of whether its return is
negative; this entry can stay flat. Hold-cash avoids loss but cannot pass the
strictly positive dev gate. The active indicator bots can repeatedly pay
trading costs; this entry normally pays only for entry and the final sale, or
entry and one stop exit.

The constants are fixed by the requested design, not fitted by a parameter
sweep. No dev prices, dates, bar numbers, future observations or precomputed
orders are embedded in the bot. A positive local grade checks the dev gate;
one published day cannot establish a profitable edge on the unknown race day.

## Risk and eligibility

The aim is to avoid fee churn and exposure during an initially falling market,
which may help against aggressive bots on a typical day. Once it enters it
uses full permitted cash, so its market risk is substantial. A 6% stop is
relative to entry cost, not the running equity peak: it does not guarantee
maximum drawdown below 25%. A price gap, next-open execution, liquidity impact
or a rejected exit can also make the realized loss exceed 6%.

If no qualifying signal occurs, the bot makes no trade and misses the race
guardrail. A late signal can also produce an after-end rejection. There is no
forced trade or hindsight exception. Prizes require at least one own filled
order and maximum drawdown at most 25%; final liquidation does not count as a
trade. Ranking uses net PnL on the future race window alone. Dev profitability
and future profitability must be assessed separately.

## Local validation

Run the kit's offline grader on the committed bot:

```sh
node /workspace/btc-kit/btc-race-24h-20261117-0603-kit/cli/makefun.mjs grade-local --kit /workspace/btc-kit/btc-race-24h-20261117-0603-kit --bot /workspace/btc-race --driver process --json
```

The grader verifies the kit and dataset, derives bars from the recorded
samples, and executes the bot twice to check identical action logs. Acceptance
for this step requires positive `net_pnl_quote_units`; also inspect `trades`,
`max_drawdown`, rejections and the guardrail result. The process driver checks
the replay behavior locally; the competition uses its own isolated sandbox.
