// ---------------------------------------------------------------------------
// Exchange Abstraction Layer (market data only).
//
// SCOPE DECISION (see DECISIONS.md #12): this product is signals-only. The
// interface below deliberately has NO order-placement methods and the system
// never stores customer exchange credentials. That is a security and
// regulatory posture encoded in the type system, not just in documentation —
// you cannot accidentally place an order through an interface that has no
// method to do so.
//
// Multiple venues sit behind `MarketDataSource` with automatic failover, so a
// single exchange outage degrades data quality rather than taking the product
// down.
// ---------------------------------------------------------------------------
import type { Candle, Timeframe } from "../intelligence/types";

export type ExchangeId = "binance" | "bybit" | "okx" | "simulator";

export type Ticker = {
  symbol: string;
  price: number;
  /** 24h change in percent. */
  changePct24h: number;
  volume24h: number;
  timestamp: number;
};

export interface MarketDataSource {
  readonly id: ExchangeId;
  /** Priority for failover; lower is tried first. */
  readonly priority: number;
  /** Normalises "BTCUSDT" to the venue's own symbol format. */
  toVenueSymbol(symbol: string): string;
  fetchCandles(symbol: string, timeframe: Timeframe, limit: number): Promise<Candle[]>;
  fetchTicker(symbol: string): Promise<Ticker>;
  /** Cheap liveness check used by the router's circuit breaker. */
  healthCheck(): Promise<boolean>;
}

export class MarketDataError extends Error {
  constructor(
    message: string,
    readonly source: ExchangeId,
    readonly retryable: boolean = true,
  ) {
    super(message);
    this.name = "MarketDataError";
  }
}

type BreakerState = { failures: number; openedAt: number | null };

/**
 * Routes every read to the healthiest available venue.
 *
 * Why a circuit breaker rather than plain retries: during an exchange outage,
 * blind retries turn one slow call into N slow calls and stall the whole
 * scanning loop. After `threshold` consecutive failures a source is skipped
 * for `cooldownMs` and traffic moves to the next venue immediately.
 */
export class MarketDataRouter {
  private readonly sources: MarketDataSource[];
  private readonly breakers = new Map<ExchangeId, BreakerState>();

  constructor(
    sources: MarketDataSource[],
    private readonly threshold = 3,
    private readonly cooldownMs = 60_000,
  ) {
    this.sources = [...sources].sort((a, b) => a.priority - b.priority);
    for (const s of this.sources) this.breakers.set(s.id, { failures: 0, openedAt: null });
  }

  private isAvailable(id: ExchangeId, now: number): boolean {
    const b = this.breakers.get(id);
    if (!b || b.openedAt === null) return true;
    if (now - b.openedAt >= this.cooldownMs) {
      // Half-open: allow one probe through.
      b.openedAt = null;
      b.failures = 0;
      return true;
    }
    return false;
  }

  private recordSuccess(id: ExchangeId) {
    this.breakers.set(id, { failures: 0, openedAt: null });
  }

  private recordFailure(id: ExchangeId, now: number) {
    const b = this.breakers.get(id) ?? { failures: 0, openedAt: null };
    b.failures += 1;
    if (b.failures >= this.threshold) b.openedAt = now;
    this.breakers.set(id, b);
  }

  private async withFailover<T>(op: (s: MarketDataSource) => Promise<T>): Promise<T> {
    const now = Date.now();
    const errors: string[] = [];
    for (const source of this.sources) {
      if (!this.isAvailable(source.id, now)) {
        errors.push(`${source.id}: circuit open`);
        continue;
      }
      try {
        const result = await op(source);
        this.recordSuccess(source.id);
        return result;
      } catch (err) {
        this.recordFailure(source.id, now);
        errors.push(`${source.id}: ${(err as Error).message}`);
      }
    }
    throw new MarketDataError(`All market data sources failed — ${errors.join(" | ")}`, "simulator", false);
  }

  fetchCandles(symbol: string, timeframe: Timeframe, limit: number): Promise<Candle[]> {
    return this.withFailover((s) => s.fetchCandles(symbol, timeframe, limit));
  }

  fetchTicker(symbol: string): Promise<Ticker> {
    return this.withFailover((s) => s.fetchTicker(symbol));
  }

  /** Fetches every timeframe the brain needs for one symbol, in parallel. */
  async fetchMultiTimeframe(
    symbol: string,
    timeframes: Timeframe[],
    limit: number,
  ): Promise<Partial<Record<Timeframe, Candle[]>>> {
    const results = await Promise.all(
      timeframes.map(async (tf) => [tf, await this.fetchCandles(symbol, tf, limit)] as const),
    );
    return Object.fromEntries(results) as Partial<Record<Timeframe, Candle[]>>;
  }

  status(): { id: ExchangeId; healthy: boolean; failures: number }[] {
    const now = Date.now();
    return this.sources.map((s) => ({
      id: s.id,
      healthy: this.isAvailable(s.id, now),
      failures: this.breakers.get(s.id)?.failures ?? 0,
    }));
  }
}

// ---------------------------------------------------------------------------
// Candle sanity validation
//
// Bad upstream data is the most dangerous input to a trading brain: a single
// zero-price candle can invent a "crash" and trigger a signal. Every candle
// array is validated before it reaches the intelligence core.
// ---------------------------------------------------------------------------
export type ValidationResult = { valid: boolean; issues: string[]; cleaned: Candle[] };

export function validateCandles(candles: Candle[], timeframe: Timeframe): ValidationResult {
  const issues: string[] = [];
  const cleaned: Candle[] = [];
  const expectedGap = TIMEFRAME_MS[timeframe];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (![c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v) && v > 0)) {
      issues.push(`candle ${i}: non-positive or non-finite price`);
      continue;
    }
    if (c.high < c.low || c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close)) {
      issues.push(`candle ${i}: inconsistent OHLC`);
      continue;
    }
    if (!Number.isFinite(c.volume) || c.volume < 0) {
      issues.push(`candle ${i}: invalid volume`);
      continue;
    }
    if (cleaned.length > 0) {
      const gap = c.time - cleaned[cleaned.length - 1].time;
      if (gap <= 0) {
        issues.push(`candle ${i}: non-monotonic timestamp`);
        continue;
      }
      if (gap > expectedGap * 1.5) {
        issues.push(`candle ${i}: gap of ${Math.round(gap / expectedGap)} bars`);
      }
    }
    cleaned.push(c);
  }

  // A few gaps are tolerable; losing >2% of bars means the feed is unreliable.
  const lossRatio = candles.length === 0 ? 1 : 1 - cleaned.length / candles.length;
  return { valid: lossRatio <= 0.02 && cleaned.length > 0, issues, cleaned };
}

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};
