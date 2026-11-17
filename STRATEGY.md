# Rare deep dips with a participation marker

This deterministic, long-only CBBTC/USDC bot targets a top-10 finish in
`btc-race-24h-20261117-0603`, a crowded field of roughly 1,240 entries ranked
on one unknown future day. All capital and orders are paper money. The bot
makes no network requests, signs no transactions and spends no real funds.

## Trading rule

Keep the latest 30 fresh CBBTC closes from `batch.bars` and their integer sum,
including warm-up observations. Missing bars add nothing. Once flat with
30 closes, buy when the current close is at least 1% below the simple moving
average, including that close. The exact comparison is:

```text
close * 30 * 10000 <= sum(last 30 closes) * (10000 - 100)
```

Spend `min(cash, equity * max_weight_bps / 10000)`, subject to the minimum
notional, order cap and one-position cap. While holding a dip position, on
each fresh bar sell all when its marked value is at least 101% of entry cost
or at most 98% of entry cost. Cost includes the buy fee. Rejected entries and
exits are evaluated again on later fresh bars; exit signals are not latched.
Re-entry is allowed after a sale, using the same dip rule. A sale's proceeds
cannot fund a buy in that same reply.

Track `traded` only from own CBBTC fills with `status: "filled"`, including
buys or sells. If nothing has filled by zero-based batch `seq = 1380`, a flat
bot prioritizes a minimum-notional marker buy using
`fees.min_notional_quote_units` (1 USDC in this kit). Retry on every subsequent
batch until a fill, subject to cash and caps; a cached close is enough for the
marker. Identify its fill by client ID and hold that tiny position through the
window's end, without dip exits or another entry. A rejected order does not
satisfy the guardrail. The final batch can issue an order that the harness
harmlessly rejects as `after_end`.

All orders use `max_slippage_bps = 10000`. `runBars` handles hello, batch,
orders, each bar, unique client IDs and done. Financial arithmetic uses
integers; decisions use no clock, environment, file reads or randomness.
Warm-up replies are empty. Decisions fill at the next bar's open if present,
and remaining holdings are liquidated by the harness at the final close.

## Why target this behavior

Top 10 is approximately the top 0.8% of a 1,240-entry field. Maximizing that
chance on one day differs from maximizing average profit. The supplied dev
board research describes around 1,000 of 1,237 entrants as tuned dip buyers.
If those competitors lose together during a broad sell-off, staying mostly
in cash can place well with a tiny loss. Zero trades fail the guardrail, so
the marker seeks the required filled order with minimal exposure and fees.
Rare deep dips also offer a chance to catch capitulation rebounds when they
occur, while avoiding frequent trades in ordinary minute-scale noise.

The house buy-and-hold and single-asset momentum bots maintain broad market
exposure. Hold-cash has zero PnL but fails the trade guardrail and dev gate.
The active EMA, RSI/Bollinger and ADX baselines repeatedly pay trading costs;
a full-size round trip in this kit costs around 26 bps. This bot trades a
deeper event, takes profit at +1%, stops at -2%, and otherwise waits in cash.

## Supplied research evidence

Research performed outside this repository used 120 days of Coinbase BTC-USD
one-minute candles: 118 daily windows aligned at 12:18 UTC and 471 windows
starting every six hours. Fills were at the next open with an assumed 13 bps
per side. The synthetic competitor field contained approximately 640
dev-profitable dip-buy variants plus buy-and-hold clones, motivated by the
reported dev board composition. These experiments were supplied with the
implementation request and have not been independently rerun here.

- On the 118 aligned days, this family reached the synthetic field's top 1%
  on 13.6% of days, versus 3.4% for the previous patient momentum bot, 3.4%
  for buy-and-hold, and 1.7% for the house momentum bot.
- Median daily PnL was approximately 0 USDC, versus approximately -2.5 USDC
  for the previous bot and buy-and-hold. The deep-dip rule fired on roughly
  18% of days; otherwise participation came from the marker.
- On the 471 six-hour-spaced windows, top-1% frequency was 17.2%, versus
  1.5% for the previous bot. Varying how many rivals also used a marker left
  the family's result around 16.6–17.6%.
- The field's top-1% PnL threshold was negative on approximately 18% of days.
  These are the sell-off days where a mostly-flat entrant can outperform.
- Nearby take-profit settings of 0.6–2.5% and stop settings of 0.6–2% produced
  top-1% frequencies around 15–18%, indicating a parameter plateau rather
  than one isolated maximum.

The supplied prototype graded at +8.496932 USDC, two trades and approximately
0.57% drawdown on the real dev window. The implementation reproduced that
result below. Synthetic top-1% frequency is a proxy for the top-10 objective,
not a measured probability of placing in this competition.

## Risks and eligibility

The competitor model is an assumption. Actual entrants, marker use and future
market conditions can differ considerably. Coinbase BTC-USD candles and fixed
13-bps costs do not reproduce cbBTC pool prices, flat bars or changing depth.
Historical experiments overlap and guided strategy selection; parameter
stability does not establish an independent future success rate.

On rising days we will likely finish mid-pack while invested rivals profit.
A deep dip can keep falling; full permitted cash, repeated stop-outs,
next-open gaps and liquidity impact can cause material losses. Neither the
2% entry-cost stop nor a marker guarantees maximum drawdown below 25%.
The marker carries one hour of small market exposure and fees. Identical
marker behavior can tie other entrants: exact PnL ties favor fewer trades,
then earlier receipt. The rules also exclude behavior identical to an earlier
entry from prizes.

The marker seeks at least one fill; repeated missing bars, rejected orders,
insufficient cash or caps can prevent it. Automatic final liquidation does
not count as an own trade. Dev net PnL must remain strictly positive, and
race prizes require at least one own filled order and drawdown at most 25%.
Under Force_Last, the final submission replaces the previous version for
the race; an older profitable submission cannot rescue a losing last one.

## Local validation

```sh
node /workspace/btc-kit/btc-race-24h-20261117-0603-kit/cli/makefun.mjs grade-local --kit /workspace/btc-kit/btc-race-24h-20261117-0603-kit --bot /workspace/btc-race --driver process --json
```

The implementation's local grade finished with `net_pnl_quote_units = 8496932`
(+8.496932 USDC), `trades = 2`, `max_drawdown = 0.005737613` (0.5737613%) and
zero rejections. The dev gate and trade/drawdown guardrails passed, and the
two executions agreed. The SDK remains byte-for-byte identical to the kit.

An uncommitted Node self-test in `out/self-test.mjs` feeds a falling-then-flat
series and checks a single filled marker, retry after rejection across a
missing bar, holding the marker to the end and byte-identical replay output.
Run it locally with `node out/self-test.mjs`; `out/` is ignored by Git.

The local process driver runs outside the server sandbox, and its Node version
differs from the server's. Prize eligibility still requires the submission's
transcript checks; a successful offline trading grade alone is insufficient.
