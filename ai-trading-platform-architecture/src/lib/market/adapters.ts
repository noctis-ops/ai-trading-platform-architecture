// ---------------------------------------------------------------------------
// Concrete market data adapters.
//
// Public market data endpoints on all three venues require no API key, which
// is why this product can read prices from multiple exchanges while holding
// ZERO customer credentials (see DECISIONS.md #12). Each adapter only
// translates the venue's wire format into our canonical `Candle`.
//
// The simulator adapter stays in the roster as the last-priority fallback so
// local development, tests, and the health check never depend on the network.
// ---------------------------------------------------------------------------
import type { Candle, Timeframe } from "../intelligence/types";
import { generateCandles, getLatestPrice } from "./simulator";
import type { ExchangeId, MarketDataSource, Ticker } from "./exchange";
import { MarketDataError } from "./exchange";

const TF_BINANCE: Record<Timeframe, string> = { "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d" };
const TF_BYBIT: Record<Timeframe, string> = { "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D" };
const TF_OKX: Record<Timeframe, string> = { "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D" };

const DEFAULT_TIMEOUT_MS = 8_000;

async function getJson<T>(url: string, source: ExchangeId): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!res.ok) {
      // 4xx = our bug (bad symbol) and must not trip the breaker for other symbols.
      throw new MarketDataError(`HTTP ${res.status}`, source, res.status >= 500 || res.status === 429);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof MarketDataError) throw err;
    throw new MarketDataError((err as Error).message, source, true);
  } finally {
    clearTimeout(timer);
  }
}

const num = (v: unknown): number => Number(v);

export class BinanceAdapter implements MarketDataSource {
  readonly id: ExchangeId = "binance";
  constructor(
    readonly priority = 0,
    private readonly base = "https://api.binance.com",
  ) {}

  toVenueSymbol(symbol: string) {
    return symbol.toUpperCase();
  }

  async fetchCandles(symbol: string, timeframe: Timeframe, limit: number): Promise<Candle[]> {
    const url = `${this.base}/api/v3/klines?symbol=${this.toVenueSymbol(symbol)}&interval=${TF_BINANCE[timeframe]}&limit=${Math.min(limit, 1000)}`;
    const rows = await getJson<unknown[][]>(url, this.id);
    return rows.map((r) => ({
      time: num(r[0]),
      open: num(r[1]),
      high: num(r[2]),
      low: num(r[3]),
      close: num(r[4]),
      volume: num(r[5]),
    }));
  }

  async fetchTicker(symbol: string): Promise<Ticker> {
    const url = `${this.base}/api/v3/ticker/24hr?symbol=${this.toVenueSymbol(symbol)}`;
    const d = await getJson<Record<string, string>>(url, this.id);
    return {
      symbol,
      price: num(d.lastPrice),
      changePct24h: num(d.priceChangePercent),
      volume24h: num(d.quoteVolume),
      timestamp: Date.now(),
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await getJson(`${this.base}/api/v3/ping`, this.id);
      return true;
    } catch {
      return false;
    }
  }
}

export class BybitAdapter implements MarketDataSource {
  readonly id: ExchangeId = "bybit";
  constructor(
    readonly priority = 1,
    private readonly base = "https://api.bybit.com",
  ) {}

  toVenueSymbol(symbol: string) {
    return symbol.toUpperCase();
  }

  async fetchCandles(symbol: string, timeframe: Timeframe, limit: number): Promise<Candle[]> {
    const url = `${this.base}/v5/market/kline?category=spot&symbol=${this.toVenueSymbol(symbol)}&interval=${TF_BYBIT[timeframe]}&limit=${Math.min(limit, 1000)}`;
    const d = await getJson<{ retCode: number; retMsg: string; result: { list: string[][] } }>(url, this.id);
    if (d.retCode !== 0) throw new MarketDataError(d.retMsg, this.id, true);
    // Bybit returns newest-first; the brain requires oldest-first.
    return d.result.list
      .map((r) => ({
        time: num(r[0]),
        open: num(r[1]),
        high: num(r[2]),
        low: num(r[3]),
        close: num(r[4]),
        volume: num(r[5]),
      }))
      .reverse();
  }

  async fetchTicker(symbol: string): Promise<Ticker> {
    const url = `${this.base}/v5/market/tickers?category=spot&symbol=${this.toVenueSymbol(symbol)}`;
    const d = await getJson<{ result: { list: Record<string, string>[] } }>(url, this.id);
    const t = d.result.list[0];
    if (!t) throw new MarketDataError(`unknown symbol ${symbol}`, this.id, false);
    return {
      symbol,
      price: num(t.lastPrice),
      changePct24h: num(t.price24hPcnt) * 100,
      volume24h: num(t.turnover24h),
      timestamp: Date.now(),
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await getJson(`${this.base}/v5/market/time`, this.id);
      return true;
    } catch {
      return false;
    }
  }
}

export class OkxAdapter implements MarketDataSource {
  readonly id: ExchangeId = "okx";
  constructor(
    readonly priority = 2,
    private readonly base = "https://www.okx.com",
  ) {}

  /** OKX uses dashed instrument ids: BTCUSDT -> BTC-USDT. */
  toVenueSymbol(symbol: string) {
    const s = symbol.toUpperCase();
    for (const quote of ["USDT", "USDC", "BTC", "ETH"]) {
      if (s.endsWith(quote)) return `${s.slice(0, -quote.length)}-${quote}`;
    }
    return s;
  }

  async fetchCandles(symbol: string, timeframe: Timeframe, limit: number): Promise<Candle[]> {
    const url = `${this.base}/api/v5/market/candles?instId=${this.toVenueSymbol(symbol)}&bar=${TF_OKX[timeframe]}&limit=${Math.min(limit, 300)}`;
    const d = await getJson<{ code: string; msg: string; data: string[][] }>(url, this.id);
    if (d.code !== "0") throw new MarketDataError(d.msg || `code ${d.code}`, this.id, true);
    return d.data
      .map((r) => ({
        time: num(r[0]),
        open: num(r[1]),
        high: num(r[2]),
        low: num(r[3]),
        close: num(r[4]),
        volume: num(r[5]),
      }))
      .reverse();
  }

  async fetchTicker(symbol: string): Promise<Ticker> {
    const url = `${this.base}/api/v5/market/ticker?instId=${this.toVenueSymbol(symbol)}`;
    const d = await getJson<{ data: Record<string, string>[] }>(url, this.id);
    const t = d.data[0];
    if (!t) throw new MarketDataError(`unknown symbol ${symbol}`, this.id, false);
    const open24h = num(t.open24h);
    return {
      symbol,
      price: num(t.last),
      changePct24h: open24h > 0 ? ((num(t.last) - open24h) / open24h) * 100 : 0,
      volume24h: num(t.volCcy24h),
      timestamp: Date.now(),
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await getJson(`${this.base}/api/v5/public/time`, this.id);
      return true;
    } catch {
      return false;
    }
  }
}

/** Deterministic offline source — always last, never fails. */
export class SimulatorAdapter implements MarketDataSource {
  readonly id: ExchangeId = "simulator";
  constructor(readonly priority = 99) {}

  toVenueSymbol(symbol: string) {
    return symbol;
  }

  async fetchCandles(symbol: string, timeframe: Timeframe, limit: number): Promise<Candle[]> {
    return generateCandles(symbol, timeframe, limit);
  }

  async fetchTicker(symbol: string): Promise<Ticker> {
    return { symbol, price: getLatestPrice(symbol), changePct24h: 0, volume24h: 0, timestamp: Date.now() };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

/**
 * Builds the venue roster from env.
 * `MARKET_DATA_SOURCES=binance,bybit,okx` — order defines failover priority.
 * The simulator is appended only when explicitly allowed, so production can
 * never silently serve customers synthetic prices.
 */
export function buildSources(env: Record<string, string | undefined> = process.env): MarketDataSource[] {
  const list = (env.MARKET_DATA_SOURCES ?? "binance,bybit,okx")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const sources: MarketDataSource[] = [];
  list.forEach((name, i) => {
    if (name === "binance") sources.push(new BinanceAdapter(i));
    else if (name === "bybit") sources.push(new BybitAdapter(i));
    else if (name === "okx") sources.push(new OkxAdapter(i));
    else if (name === "simulator") sources.push(new SimulatorAdapter(i));
  });
  if (env.ALLOW_SIMULATED_DATA === "true" && !sources.some((s) => s.id === "simulator")) {
    sources.push(new SimulatorAdapter(99));
  }
  if (sources.length === 0) throw new Error("No market data sources configured (MARKET_DATA_SOURCES).");
  return sources;
}
