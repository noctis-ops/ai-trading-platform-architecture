// ---------------------------------------------------------------------------
// Supported trading universe.
//
// The platform is exchange-agnostic (see /docs/ARCHITECTURE.md — Exchange
// Abstraction Layer). Each symbol carries the metadata required by the
// simulated market data engine and the risk engine (base volatility used
// for GBM simulation + margin/liquidation math).
// ---------------------------------------------------------------------------
export type SymbolMeta = {
  symbol: string;
  base: string;
  quote: string;
  displayName: string;
  startPrice: number;
  annualDriftPct: number; // long-run drift used by the synthetic price engine
  annualVolatilityPct: number; // annualized volatility used by the synthetic price engine
  maxLeverage: number;
};

export const SYMBOLS: SymbolMeta[] = [
  { symbol: "BTCUSDT", base: "BTC", quote: "USDT", displayName: "Bitcoin", startPrice: 64000, annualDriftPct: 18, annualVolatilityPct: 55, maxLeverage: 20 },
  { symbol: "ETHUSDT", base: "ETH", quote: "USDT", displayName: "Ethereum", startPrice: 3400, annualDriftPct: 20, annualVolatilityPct: 65, maxLeverage: 20 },
  { symbol: "SOLUSDT", base: "SOL", quote: "USDT", displayName: "Solana", startPrice: 145, annualDriftPct: 25, annualVolatilityPct: 90, maxLeverage: 15 },
  { symbol: "BNBUSDT", base: "BNB", quote: "USDT", displayName: "BNB", startPrice: 580, annualDriftPct: 12, annualVolatilityPct: 60, maxLeverage: 15 },
  { symbol: "XRPUSDT", base: "XRP", quote: "USDT", displayName: "XRP", startPrice: 0.62, annualDriftPct: 10, annualVolatilityPct: 80, maxLeverage: 15 },
  { symbol: "ADAUSDT", base: "ADA", quote: "USDT", displayName: "Cardano", startPrice: 0.45, annualDriftPct: 8, annualVolatilityPct: 75, maxLeverage: 10 },
  { symbol: "DOGEUSDT", base: "DOGE", quote: "USDT", displayName: "Dogecoin", startPrice: 0.14, annualDriftPct: 5, annualVolatilityPct: 100, maxLeverage: 10 },
  { symbol: "AVAXUSDT", base: "AVAX", quote: "USDT", displayName: "Avalanche", startPrice: 36, annualDriftPct: 15, annualVolatilityPct: 85, maxLeverage: 10 },
  { symbol: "LINKUSDT", base: "LINK", quote: "USDT", displayName: "Chainlink", startPrice: 14.5, annualDriftPct: 14, annualVolatilityPct: 80, maxLeverage: 10 },
  { symbol: "MATICUSDT", base: "MATIC", quote: "USDT", displayName: "Polygon", startPrice: 0.72, annualDriftPct: 9, annualVolatilityPct: 85, maxLeverage: 10 },
];

export const SYMBOL_MAP = new Map(SYMBOLS.map((s) => [s.symbol, s]));

export function getSymbolMeta(symbol: string): SymbolMeta {
  const meta = SYMBOL_MAP.get(symbol);
  if (!meta) throw new Error(`Unknown symbol: ${symbol}`);
  return meta;
}

export const TIMEFRAMES = ["5m", "15m", "1h", "4h", "1d"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
};
