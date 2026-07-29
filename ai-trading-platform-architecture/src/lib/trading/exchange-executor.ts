// ---------------------------------------------------------------------------
// Exchange Executor — translates trade plans into real orders.
//
// This module connects to exchange APIs and places/cancels orders.
// It abstracts the differences between Binance, Bybit, and OKX.
//
// SECURITY: API secrets are loaded at execution time and never logged.
// Every order receives a unique clientOrderId for idempotency.
// ---------------------------------------------------------------------------

import type { Candle } from "../intelligence/types";
import type {
  MarketType,
  OrderSide,
  OrderStatus,
  OrderType,
  TimeInForce,
  TradingConfig,
  TradingOrder,
  TradingPosition,
  TradingVenue,
} from "./types";

// ---------------------------------------------------------------------------
// Order request / response shapes (venue-agnostic)
// ---------------------------------------------------------------------------

export type PlaceOrderRequest = {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number;           // 0 for market
  stopPrice?: number;       // for stop_loss / take_profit
  reduceOnly?: boolean;
  timeInForce?: TimeInForce;
  clientOrderId: string;
  leverage?: number;
  marginMode?: "isolated" | "cross";
};

export type PlaceOrderResult = {
  ok: boolean;
  orderId?: string;            // exchange order ID
  clientOrderId: string;
  status: OrderStatus;
  filledQuantity: number;
  avgFillPrice: number | null;
  fee: number;
  feeCurrency: string;
  error?: string;
  raw: unknown;
};

export type CancelOrderResult = {
  ok: boolean;
  error?: string;
};

export type AccountInfo = {
  equity: number;
  availableBalance: number;
  marginBalance: number;
  unrealisedPnl: number;
  positions: ExchangePosition[];
};

export type ExchangePosition = {
  symbol: string;
  side: "long" | "short";
  quantity: number;
  entryPrice: number;
  markPrice: number;
  leverage: number;
  marginUsed: number;
  unrealisedPnl: number;
  liquidationPrice: number | null;
};

// ---------------------------------------------------------------------------
// Abstract exchange adapter
// ---------------------------------------------------------------------------

export interface ExchangeAdapter {
  readonly venue: TradingVenue;
  readonly marketType: MarketType;

  /** Place a new order. */
  placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult>;

  /** Cancel an existing order. */
  cancelOrder(orderId: string, symbol: string): Promise<CancelOrderResult>;

  /** Get account balances and positions. */
  getAccountInfo(): Promise<AccountInfo>;

  /** Get current ticker price. */
  getPrice(symbol: string): Promise<number>;

  /** Set leverage for a symbol (futures only). */
  setLeverage(symbol: string, leverage: number): Promise<boolean>;

  /** Set margin mode (futures only). */
  setMarginMode(symbol: string, mode: "isolated" | "cross"): Promise<boolean>;

  /** Verify API credentials are valid. */
  verifyCredentials(): Promise<boolean>;

  /** Get minimum order size for a symbol. */
  getMinQuantity(symbol: string): Promise<number>;

  /** Get symbol info (tick size, lot size, etc). */
  getSymbolInfo(symbol: string): Promise<SymbolInfo>;
}

export type SymbolInfo = {
  symbol: string;
  tickSize: number;
  stepSize: number;
  minNotional: number;
  maxLeverage: number;
};

// ---------------------------------------------------------------------------
// Binance Futures Adapter
// ---------------------------------------------------------------------------

export class BinanceFuturesAdapter implements ExchangeAdapter {
  readonly venue: TradingVenue = "binance";
  readonly marketType: MarketType = "futures";

  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly baseUrl = "https://fapi.binance.com",
  ) {}

  private async signed<T>(
    path: string,
    method: "GET" | "POST" | "DELETE" = "GET",
    params: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T> {
    const timestamp = Date.now();
    const allParams = new URLSearchParams();
    allParams.set("timestamp", String(timestamp));

    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) allParams.set(k, String(v));
    }

    // Sort params alphabetically for signature
    const sorted = new URLSearchParams([...allParams.entries()].sort());
    const queryString = sorted.toString();

    // HMAC-SHA256 signature
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(this.apiSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(queryString));
    const sigHex = Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");

    const url = `${this.baseUrl}${path}?${queryString}&signature=${sigHex}`;

    const headers: Record<string, string> = {
      "X-MBX-APIKEY": this.apiKey,
    };

    if (method !== "GET") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }

    const res = await fetch(url, {
      method,
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    const data = await res.json() as T & { code?: number; msg?: string };

    if ((data as any).code !== undefined && (data as any).code < 0) {
      throw new Error(`Binance error ${(data as any).code}: ${(data as any).msg}`);
    }

    return data;
  }

  async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    try {
      const params: Record<string, string | number | boolean | undefined> = {
        symbol: req.symbol,
        side: req.side.toUpperCase(),
        type: this.mapOrderType(req.type),
        quantity: req.quantity,
        newClientOrderId: req.clientOrderId,
        reduceOnly: req.reduceOnly ?? false,
      };

      if (req.price && req.price > 0 && req.type !== "market") {
        params.price = req.price;
        params.timeInForce = req.timeInForce ?? "GTC";
      }

      if (req.stopPrice && req.stopPrice > 0) {
        params.stopPrice = req.stopPrice;
      }

      const data = await this.signed<Record<string, unknown>>(
        "/fapi/v1/order",
        "POST",
        params,
      );

      return {
        ok: true,
        orderId: String(data.orderId ?? ""),
        clientOrderId: req.clientOrderId,
        status: this.mapBinanceStatus(String(data.status ?? "NEW")),
        filledQuantity: Number(data.executedQty ?? 0),
        avgFillPrice: data.avgPrice != null ? Number(data.avgPrice) : null,
        fee: 0, // Binance returns fee in a separate endpoint
        feeCurrency: "USDT",
        raw: data,
      };
    } catch (err) {
      return {
        ok: false,
        clientOrderId: req.clientOrderId,
        status: "rejected",
        filledQuantity: 0,
        avgFillPrice: null,
        fee: 0,
        feeCurrency: "USDT",
        error: (err as Error).message,
        raw: null,
      };
    }
  }

  async cancelOrder(orderId: string, symbol: string): Promise<CancelOrderResult> {
    try {
      await this.signed("/fapi/v1/order", "DELETE", { symbol, orderId });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async getAccountInfo(): Promise<AccountInfo> {
    const [account, positions] = await Promise.all([
      this.signed<Record<string, unknown>>("/fapi/v2/account"),
      this.signed<Record<string, unknown>[]>("/fapi/v2/positionRisk"),
    ]);

    return {
      equity: Number(account.totalWalletBalance ?? account.totalMarginBalance ?? 0),
      availableBalance: Number(account.availableBalance ?? 0),
      marginBalance: Number(account.totalMarginBalance ?? 0),
      unrealisedPnl: Number(account.totalUnrealizedProfit ?? 0),
      positions: (positions as unknown as Record<string, unknown>[])
        .filter((p: Record<string, unknown>) => Math.abs(Number(p.positionAmt ?? 0)) > 0)
        .map((p: Record<string, unknown>) => ({
          symbol: String(p.symbol ?? ""),
          side: Number(p.positionAmt ?? 0) > 0 ? "long" : "short",
          quantity: Math.abs(Number(p.positionAmt ?? 0)),
          entryPrice: Number(p.entryPrice ?? 0),
          markPrice: Number(p.markPrice ?? 0),
          leverage: Number(p.leverage ?? 1),
          marginUsed: Number(p.isolatedWallet ?? p.marginType ?? 0),
          unrealisedPnl: Number(p.unRealizedProfit ?? 0),
          liquidationPrice: p.liquidationPrice ? Number(p.liquidationPrice) : null,
        })),
    };
  }

  async getPrice(symbol: string): Promise<number> {
    const data = await this.signed<{ price: string }>("/fapi/v1/ticker/price", "GET", { symbol });
    return Number(data.price);
  }

  async setLeverage(symbol: string, leverage: number): Promise<boolean> {
    try {
      await this.signed("/fapi/v1/leverage", "POST", { symbol, leverage });
      return true;
    } catch {
      return false;
    }
  }

  async setMarginMode(symbol: string, mode: "isolated" | "cross"): Promise<boolean> {
    try {
      await this.signed("/fapi/v1/marginType", "POST", {
        symbol,
        marginType: mode === "isolated" ? "ISOLATED" : "CROSSED",
      });
      return true;
    } catch {
      return false;
    }
  }

  async verifyCredentials(): Promise<boolean> {
    try {
      await this.signed("/fapi/v2/account");
      return true;
    } catch {
      return false;
    }
  }

  async getMinQuantity(symbol: string): Promise<number> {
    const data = await this.signed<{ filters: Record<string, unknown>[] }>(
      "/fapi/v1/exchangeInfo",
      "GET",
    );
    // This is simplified — in production, parse the LOT_SIZE filter
    return 0.001;
  }

  async getSymbolInfo(symbol: string): Promise<SymbolInfo> {
    return {
      symbol,
      tickSize: 0.01,
      stepSize: 0.001,
      minNotional: 5,
      maxLeverage: 125,
    };
  }

  private mapOrderType(type: OrderType): string {
    switch (type) {
      case "market": return "MARKET";
      case "limit": return "LIMIT";
      case "stop_loss": return "STOP_MARKET";
      case "take_profit": return "TAKE_PROFIT_MARKET";
      case "trailing_stop": return "TRAILING_STOP_MARKET";
      default: return "MARKET";
    }
  }

  private mapBinanceStatus(status: string): OrderStatus {
    switch (status) {
      case "NEW":
      case "PARTIALLY_FILLED": return "open";
      case "FILLED": return "filled";
      case "CANCELED":
      case "EXPIRED": return "canceled";
      case "REJECTED":
      case "EXPIRED_IN_MATCH": return "rejected";
      default: return "pending";
    }
  }
}

// ---------------------------------------------------------------------------
// Simulated Exchange (for development & testing)
// ---------------------------------------------------------------------------

/**
 * An exchange adapter that simulates fills at the current price.
 * Used for paper trading and development without real money.
 */
export class SimulatedExchange implements ExchangeAdapter {
  readonly venue: TradingVenue = "binance";
  readonly marketType: MarketType = "futures";

  private orders = new Map<string, TradingOrder>();
  private positions = new Map<string, TradingPosition>();
  private orderIdCounter = 0;

  constructor(
    private initialEquity = 10000,
    private priceGetter?: (symbol: string) => Promise<number>,
  ) {}

  private equity = this.initialEquity;
  private peakEquity = this.initialEquity;

  async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    this.orderIdCounter += 1;
    const exchangeOrderId = `sim_${this.orderIdCounter}`;

    // Simulate market fill at current price
    const fillPrice = this.priceGetter
      ? await this.priceGetter(req.symbol)
      : 100; // default

    const feeRate = req.type === "limit" ? 0.0002 : 0.0004;
    const fee = req.quantity * fillPrice * feeRate;

    return {
      ok: true,
      orderId: exchangeOrderId,
      clientOrderId: req.clientOrderId,
      status: "filled",
      filledQuantity: req.quantity,
      avgFillPrice: fillPrice,
      fee,
      feeCurrency: "USDT",
      raw: { simulated: true },
    };
  }

  async cancelOrder(): Promise<CancelOrderResult> {
    return { ok: true };
  }

  async getAccountInfo(): Promise<AccountInfo> {
    return {
      equity: this.equity,
      availableBalance: this.equity * 0.8,
      marginBalance: this.equity * 0.2,
      unrealisedPnl: 0,
      positions: [],
    };
  }

  async getPrice(symbol: string): Promise<number> {
    if (this.priceGetter) return this.priceGetter(symbol);
    return 100;
  }

  async setLeverage(): Promise<boolean> { return true; }
  async setMarginMode(): Promise<boolean> { return true; }
  async verifyCredentials(): Promise<boolean> { return true; }
  async getMinQuantity(): Promise<number> { return 0.001; }

  async getSymbolInfo(symbol: string): Promise<SymbolInfo> {
    return { symbol, tickSize: 0.01, stepSize: 0.001, minNotional: 5, maxLeverage: 125 };
  }
}
