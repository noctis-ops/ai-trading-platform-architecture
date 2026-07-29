// ---------------------------------------------------------------------------
// Correlation Matrix — prevents overexposure to correlated assets.
//
// Crypto markets are highly correlated. BTC and ETH typically move together
// at r ≈ 0.85. Opening full positions on both = ~1.7× intended exposure.
//
// This module:
//   1. Maintains a correlation matrix from price history
//   2. Checks new signals against open positions for correlation overlap
//   3. Reduces position size proportionally when correlation is high
//
// The matrix is recomputed periodically (daily) from a rolling window of
// log returns. All functions are PURE — the matrix is passed as input.
// ---------------------------------------------------------------------------

import type { Candle } from "./types";

export type CorrelationMatrix = {
  /** List of symbols in the matrix (ordered). */
  symbols: string[];
  /** Square matrix: matrix[i][j] = Pearson r between symbol i and j. */
  matrix: number[][];
  /** When this matrix was computed (unix ms). */
  computedAt: number;
  /** Number of data points used. */
  dataPoints: number;
  /** Lookback window in candles. */
  lookback: number;
};

/**
 * High correlation threshold. Above this, positions on two symbols are
 * considered overlapping exposure.
 */
export const HIGH_CORRELATION = 0.75;

/**
 * Very high correlation. Above this, treat as essentially the same trade.
 */
export const VERY_HIGH_CORRELATION = 0.90;

/**
 * Builds a correlation matrix from multi-symbol candle data.
 * Uses log returns over the specified lookback window.
 */
export function buildCorrelationMatrix(
  data: Record<string, Candle[]>,
  lookback = 100,
): CorrelationMatrix {
  const symbols = Object.keys(data).filter(s => (data[s]?.length ?? 0) >= lookback);

  if (symbols.length < 2) {
    return {
      symbols,
      matrix: symbols.length > 0 ? [[1]] : [],
      computedAt: Date.now(),
      dataPoints: 0,
      lookback,
    };
  }

  // Compute log returns for each symbol
  const returns: Record<string, number[]> = {};
  for (const sym of symbols) {
    const closes = data[sym]!.slice(-lookback).map(c => Math.log(c.close));
    returns[sym] = [];
    for (let i = 1; i < closes.length; i++) {
      returns[sym].push(closes[i] - closes[i - 1]);
    }
  }

  const n = returns[symbols[0]].length;
  const matrix: number[][] = [];

  for (let i = 0; i < symbols.length; i++) {
    matrix[i] = [];
    for (let j = 0; j < symbols.length; j++) {
      if (i === j) {
        matrix[i][j] = 1;
      } else {
        matrix[i][j] = pearsonCorrelation(returns[symbols[i]], returns[symbols[j]]);
      }
    }
  }

  return {
    symbols,
    matrix,
    computedAt: Date.now(),
    dataPoints: n,
    lookback,
  };
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 20) return 0;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }

  const denom = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (denom === 0) return 0;

  return (n * sumXY - sumX * sumY) / denom;
}

/**
 * Returns the correlation between two symbols.
 */
export function getCorrelation(matrix: CorrelationMatrix, a: string, b: string): number {
  const ia = matrix.symbols.indexOf(a);
  const ib = matrix.symbols.indexOf(b);
  if (ia < 0 || ib < 0) return 0;
  return matrix.matrix[ia]?.[ib] ?? 0;
}

/**
 * Given a candidate symbol and a list of open positions (with symbols),
 * returns the adjustment factor for position size.
 *
 *   1.0 = no overlap (full size)
 *   0.5 = moderate overlap (half size)
 *   0.0 = very high overlap with same-direction position (skip)
 *
 * The formula: factor = 1 - max(correlation with any open position)
 * bounded to [0.3, 1.0] so we never fully block a signal just from
 * correlation alone (other gates handle that).
 */
export function correlationOverlapFactor(
  matrix: CorrelationMatrix,
  candidateSymbol: string,
  openSymbols: string[],
): { factor: number; maxCorrelation: number; overlappingSymbol: string | null } {
  if (openSymbols.length === 0) return { factor: 1, maxCorrelation: 0, overlappingSymbol: null };

  let maxR = 0;
  let overlapping = null;

  for (const sym of openSymbols) {
    const r = getCorrelation(matrix, candidateSymbol, sym);
    if (r > maxR) {
      maxR = r;
      overlapping = sym;
    }
  }

  // If correlation is above very high threshold, reduce significantly
  if (maxR >= VERY_HIGH_CORRELATION) {
    return { factor: 0.3, maxCorrelation: maxR, overlappingSymbol: overlapping };
  }

  // If above high threshold, reduce proportionally
  if (maxR >= HIGH_CORRELATION) {
    const factor = 1 - (maxR - HIGH_CORRELATION) / (1 - HIGH_CORRELATION);
    return { factor: Math.max(0.3, factor), maxCorrelation: maxR, overlappingSymbol: overlapping };
  }

  return { factor: 1, maxCorrelation: maxR, overlappingSymbol: overlapping };
}

/**
 * Returns all symbols correlated ≥ threshold with the given symbol.
 */
export function correlatedSymbols(
  matrix: CorrelationMatrix,
  symbol: string,
  threshold = HIGH_CORRELATION,
): string[] {
  const idx = matrix.symbols.indexOf(symbol);
  if (idx < 0) return [];
  return matrix.symbols.filter((_, j) => j !== idx && matrix.matrix[idx][j] >= threshold);
}
