import { BPS, runBars } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const LOOKBACK = 24;
const HARD_STOP_BPS = 600;
const MAX_SLIPPAGE_BPS = 10_000;

// A trailing 24-bar return compares the current close with the close 24 bars
// earlier: 25 observed closes. Missing bars add no synthetic close.
const closes: bigint[] = [];
let entered = false;
let stopping = false;

// runBars owns hello / batch / orders / bar protocol handling: hello provides
// capital, caps and scales; each batch supplies account/fills and the closed bar;
// returned orders become one reply and fill at the next bar's open, if present.
// It also consumes done, when the harness has flattened any remaining position.
await runBars({
  onBatch(state, batch) {
    const bar = batch.bars.find((candidate) => candidate.symbol === SYMBOL);
    if (bar !== undefined) {
      closes.push(BigInt(bar.c));
      if (closes.length > LOOKBACK + 1) closes.shift();
    }

    // Warm-up bars seed history, but never generate orders.
    if (state.warmingUp || bar === undefined) return [];
    const { caps, fees } = state.hello;
    if (caps.max_orders_per_bar < 1) return [];

    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      // The authoritative account confirms the one filled entry. Its cost
      // includes the buy fee; price impact/slippage are reflected in its quantity.
      entered = true;
      if (state.value(SYMBOL, held.qty) * BPS <= held.cost * (BPS - BigInt(HARD_STOP_BPS))) {
        stopping = true;
      }
      // Latch the stop: retry a rejected exit on each fresh bar until flat,
      // even if price recovers. Never buy again after a confirmed entry.
      if (stopping) {
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    if (entered || stopping || state.positions.size > 0 || caps.max_open_positions < 1) return [];
    if (closes.length < LOOKBACK + 1 || closes[0] <= 0n) return [];
    // Exact integer comparison for return >= 0 bps; no rounding or entropy.
    if (closes[LOOKBACK] < closes[0]) return [];

    const byWeight = (state.equity * BigInt(caps.max_weight_bps)) / BPS;
    const spend = state.cash < byWeight ? state.cash : byWeight;
    if (spend <= 0n || spend < BigInt(fees.min_notional_quote_units)) return [];

    // A rejected buy may be retried if the signal still holds. Each batch
    // reports the previous order's result before we can decide another one.
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  },
});
