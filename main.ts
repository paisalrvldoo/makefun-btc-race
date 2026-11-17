import { BPS, runBars } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
// Include the current fresh close in a 30-observation simple moving average.
const LOOKBACK = 30;
// Enter at least 1% below the SMA; exits compare marked value with entry cost.
const ENTRY_DIP_BPS = 100n;
const TAKE_PROFIT_BPS = 100n;
const STOP_LOSS_BPS = 200n;
// If no own order has filled, mark participation in the last hour (zero-based seq).
const MARKER_SEQ = 1380;
// Allow the protocol's widest slippage tolerance for all paper orders.
const MAX_SLIPPAGE_BPS = 10_000;

// Only fresh CBBTC bars extend the history; a gap adds no synthetic close.
const closes: bigint[] = [];
let sum = 0n;
let traded = false;
let markerHolding = false;

// runBars owns hello / batch / orders / bar protocol handling: hello provides
// capital, caps and scales; each batch supplies account/fills and the closed bar;
// returned orders become one reply and fill at the next bar's open, if present.
// It also consumes done, when the harness has flattened any remaining position.
await runBars({
  onBatch(state, batch) {
    // Rejections do not satisfy the trade guardrail. Identify a filled marker
    // by its client ID so that its tiny position is held through done.
    for (const fill of batch.fills) {
      if (fill.symbol !== SYMBOL || fill.status !== 'filled') continue;
      traded = true;
      if (fill.side === 'buy') markerHolding = fill.client_id.startsWith('marker-');
    }

    const bar = batch.bars.find((candidate) => candidate.symbol === SYMBOL);
    if (bar !== undefined) {
      const close = BigInt(bar.c);
      closes.push(close);
      sum += close;
      if (closes.length > LOOKBACK) sum -= closes.shift()!;
    }

    // Warm-up bars seed history, but never generate orders.
    if (state.warmingUp) return [];
    const { caps, fees } = state.hello;
    if (caps.max_orders_per_bar < 1) return [];

    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      if (markerHolding || bar === undefined) return [];
      // Entry cost includes the buy fee; fills already reflect slippage/impact.
      // Re-evaluate rejected exits on later fresh bars. Re-entry is allowed.
      const value = state.value(SYMBOL, held.qty);
      if (value * BPS >= held.cost * (BPS + TAKE_PROFIT_BPS)
          || value * BPS <= held.cost * (BPS - STOP_LOSS_BPS)) {
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    if (state.positions.size > 0 || caps.max_open_positions < 1) return [];
    const byWeight = (state.equity * BigInt(caps.max_weight_bps)) / BPS;
    const spend = state.cash < byWeight ? state.cash : byWeight;
    const minimum = BigInt(fees.min_notional_quote_units);
    if (spend <= 0n || spend < minimum) return [];

    // Retry the minimum-notional marker each later batch until an order fills.
    // A cached close suffices for this order; dip entries/exits need a fresh bar.
    // A final-batch order, if reached without a fill, is harmlessly rejected.
    if (!traded && batch.seq >= MARKER_SEQ && state.close(SYMBOL) !== null) {
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: minimum,
        max_slippage_bps: MAX_SLIPPAGE_BPS, client_id: `marker-${batch.seq}` }];
    }

    if (bar === undefined || closes.length < LOOKBACK) return [];
    // close <= SMA * 0.99, cross-multiplied without a rounded SMA or floats.
    if (BigInt(bar.c) * BigInt(LOOKBACK) * BPS > sum * (BPS - ENTRY_DIP_BPS)) return [];

    // The next batch resolves this order before another decision can be sent.
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  },
});
