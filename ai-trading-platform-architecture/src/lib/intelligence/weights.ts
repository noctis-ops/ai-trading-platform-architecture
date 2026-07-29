// ---------------------------------------------------------------------------
// Adaptive Weights — Regime-aware analyser weights.
//
// Problem (v2.x): weights were STATIC across all market regimes.
//   - structure=1.8 in a ranging market → wasted weight on silent analysers
//   - volatility=0.6 in volatile_expansion → underweighted gate
//   - zones=1.5 should dominate in ranging, not trending
//
// Solution: getRegimeWeights(regime) returns a different weight map for each
// of the 5 market regimes. The weights sum to approximately the same total
// so confluence scores remain comparable across regimes.
// ---------------------------------------------------------------------------

import type { MarketRegime } from "./types";

export type WeightMap = Record<string, number>;

/**
 * Base weights — the calibrated v2.x defaults.
 * Used as the reference point. All other regimes are expressed as deltas
 * from this base, which keeps the relationship transparent and auditable.
 */
export const BASE_WEIGHTS: WeightMap = {
  trend: 1.6,
  structure: 1.8,
  zones: 1.5,
  momentum: 1.2,
  volume: 0.9,
  volatility: 0.6,
  priceAction: 1.1,
  liquidity: 1.0,
  // v3.0 additions
  vwap: 0.8,
  volumeProfile: 0.7,
  orderFlow: 0.6,
  reversal: 0.0,  // 0 by default — only active in ranging
  breakout: 0.0,  // 0 by default — only active in quiet_compression
};

/**
 * Regime-specific weight maps.
 *
 * Design rationale for each regime:
 *
 * TRENDING (up/down):
 *   - Trend + structure dominate (strongest edge in trends)
 *   - Order flow confirms or denies continuation
 *   - VWAP is highly relevant for institutional participation
 *   - Reversal/breakout are suppressed — don't fade a trend
 *
 * RANGING:
 *   - Zones + liquidity are the primary edge (support/resistance holds)
 *   - Reversal is activated — mean-reversion is the play
 *   - Trend + structure are DECREASED because they produce false signals
 *   - Order flow helps identify accumulation/distribution within range
 *
 * VOLATILE_EXPANSION:
 *   - Volatility gate weight INCREASED — this regime needs caution
 *   - VWAP is critical — deviation from VWAP signals exhaustion
 *   - Momentum reduced — RSI/MACD whipsaw in expansion
 *   - Reversal activated — extreme moves tend to snap back
 *
 * QUIET_COMPRESSION:
 *   - Breakout activated — compression precedes expansion
 *   - Volume + liquidity increased — watching for the trigger
 *   - Volatility acts as a "coiled spring" detector
 *   - Zones still relevant — compression happens at boundaries
 */
export const REGIME_WEIGHTS: Record<MarketRegime, WeightMap> = {
  trending_up: {
    trend: 2.0,           // +0.4 — trend is most reliable in uptrends
    structure: 2.0,       // +0.2 — BOS confirms continuation
    zones: 1.2,           // -0.3 — less relevant; trend breaks zones
    momentum: 1.3,        // +0.1 — momentum confirms trend health
    volume: 0.9,          // unchanged
    volatility: 0.6,      // unchanged
    priceAction: 1.1,     // unchanged
    liquidity: 0.8,       // -0.2 — less sweep hunting in clean trends
    vwap: 1.0,            // +0.2 — institutional participation signal
    volumeProfile: 0.7,   // unchanged
    orderFlow: 0.8,       // +0.2 — CVD confirms trend
    reversal: 0.0,        // SUPPRESSED — never fade an uptrend
    breakout: 0.0,        // suppressed
  },

  trending_down: {
    trend: 2.0,           // +0.4 — same as uptrend
    structure: 2.0,       // +0.2 — BOS confirms
    zones: 1.2,           // -0.3
    momentum: 1.3,        // +0.1
    volume: 0.9,          // unchanged
    volatility: 0.7,      // +0.1 — downtrends are more volatile
    priceAction: 1.1,     // unchanged
    liquidity: 0.9,       // -0.1 — sweeps less common in clean downtrends
    vwap: 1.0,            // +0.2
    volumeProfile: 0.7,   // unchanged
    orderFlow: 0.9,       // +0.3 — selling pressure more detectable
    reversal: 0.0,        // suppressed
    breakout: 0.0,        // suppressed
  },

  ranging: {
    trend: 0.5,           // -1.1 — trend signals are false in ranges
    structure: 0.8,       // -1.0 — no BOS/CHoCH happening
    zones: 2.2,           // +0.7 — THE dominant edge in ranges
    momentum: 0.9,        // -0.3 — RSI is range-bound
    volume: 1.0,          // +0.1 — volume at boundaries matters
    volatility: 0.5,      // -0.1 — low vol = good for mean reversion
    priceAction: 1.4,     // +0.3 — engulfing/rejection at boundaries
    liquidity: 1.6,       // +0.6 — sweep hunting IS the edge
    vwap: 0.6,            // -0.2 — less relevant in ranges
    volumeProfile: 1.2,   // +0.5 — POC and value areas define range
    orderFlow: 0.5,       // -0.1
    reversal: 1.8,        // ACTIVATED — mean-reversion is the primary strategy
    breakout: 0.0,        // suppressed — no breakout in a confirmed range
  },

  volatile_expansion: {
    trend: 1.2,           // -0.4 — trends are unreliable in expansion
    structure: 1.5,       // -0.3 — structure breaks constantly
    zones: 1.0,           // -0.5 — zones blown through
    momentum: 0.8,        // -0.4 — whipsaw in expansion
    volume: 1.2,          // +0.3 — volume spike detection matters
    volatility: 1.3,      // +0.7 — CRITICAL gate in expansion
    priceAction: 0.8,     // -0.3 — candles are erratic
    liquidity: 1.2,       // +0.2 — sweeps signal reversal
    vwap: 1.3,            // +0.5 — deviation from VWAP = exhaustion
    volumeProfile: 1.0,   // +0.3 — HVN/LVN matter for targets
    orderFlow: 1.1,       // +0.5 — CVD divergence signals reversal
    reversal: 1.2,        // ACTIVATED — snap-back after extreme expansion
    breakout: 0.0,        // suppressed
  },

  quiet_compression: {
    trend: 0.8,           // -0.8 — no trend in compression
    structure: 1.0,       // -0.8 — no structure activity
    zones: 1.8,           // +0.3 — compression happens at boundaries
    momentum: 0.7,        // -0.5 — momentum is flat in compression
    volume: 1.4,          // +0.5 — volume contraction IS the signal
    volatility: 1.5,      // +0.9 — volatility contraction = coil detection
    priceAction: 1.2,     // +0.1
    liquidity: 1.4,       // +0.4 — liquidity builds up at levels
    vwap: 0.9,            // +0.1
    volumeProfile: 1.4,   // +0.7 — POC convergence signals breakout
    orderFlow: 1.0,       // +0.4 — delta accumulation before breakout
    reversal: 0.0,        // suppressed
    breakout: 1.8,        // ACTIVATED — compression = pre-breakout
  },
};

/**
 * Returns the weight map for the given market regime.
 * Falls back to base weights if the regime has no custom map
 * (should never happen — all 5 regimes are defined above).
 */
export function getRegimeWeights(regime: MarketRegime): WeightMap {
  return REGIME_WEIGHTS[regime] ?? BASE_WEIGHTS;
}

/**
 * Returns true if a given analyser/strategy is active in this regime.
 * "Active" means its weight > 0 in the regime-specific weight map.
 */
export function isAnalyserActive(name: string, regime: MarketRegime): boolean {
  const weights = getRegimeWeights(regime);
  return (weights[name] ?? 0) > 0;
}

/**
 * Normalises a weight map so the sum equals the sum of BASE_WEIGHTS.
 * This ensures cross-regime confluence scores remain comparable.
 */
export function normaliseWeights(weights: WeightMap): WeightMap {
  const baseTotal = Object.values(BASE_WEIGHTS).reduce((a, b) => a + b, 0);
  const regimeTotal = Object.values(weights).reduce((a, b) => a + b, 0);
  if (regimeTotal === 0) return { ...weights };

  const ratio = baseTotal / regimeTotal;
  const normalised: WeightMap = {};
  for (const [k, v] of Object.entries(weights)) {
    normalised[k] = Math.round(v * ratio * 100) / 100;
  }
  return normalised;
}
