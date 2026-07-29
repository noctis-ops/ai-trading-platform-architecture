// ---------------------------------------------------------------------------
// Auto-Trading Core — Shared Types
//
// This module represents the shift from "signals only" to "full auto-trading".
// The system can now execute trades, manage positions, and handle risk
// automatically based on the brain's decisions.
//
// Key design principles:
//   - Risk-first: no trade executes without passing all risk gates
//   - Capital-aware: position sizing uses Kelly, fixed fractional, or fixed ratio
//   - Leverage-respecting: margin/leverage limits are hard constraints
//   - Idempotent: every order is tracked and verifiable
// ---------------------------------------------------------------------------

import type { Direction, Timeframe } from "../intelligence/types";

/** Supported exchange venues for trading. */
export type TradingVenue = "binance" | "bybit" | "okx";

/** Spot or futures. */
export type MarketType = "spot" | "futures";

/** Order types. */
export type OrderType = "market" | "limit" | "stop_loss" | "take_profit" | "trailing_stop";

/** Order side. */
export type OrderSide = "buy" | "sell";

/** Order status lifecycle. */
export type OrderStatus =
  | "pending"       // created, not yet sent
  | "open"          // sent to exchange, awaiting fill
  | "partially_filled"
  | "filled"
  | "canceled"
  | "rejected"
  | "expired";

/** Time-in-force. */
export type TimeInForce = "GTC" | "IOC" | "FOK" | "GTD";

/** Position status. */
export type PositionStatus = "open" | "tp1_hit" | "closing" | "closed";

/** The result of a risk evaluation. */
export type RiskVerdict = {
  allowed: boolean;
  reason?: string;
  /** Max position size allowed after all constraints. */
  maxSizeQuote: number;
  /** Suggested position size in quote currency. */
  suggestedSizeQuote: number;
  /** Suggested leverage. */
  suggestedLeverage: number;
  /** Detailed breakdown of each risk check. */
  checks: RiskCheck[];
};

export type RiskCheck = {
  name: string;
  passed: boolean;
  value: number;
  limit: number;
  unit: string;
};

// ---------------------------------------------------------------------------
// Trading configuration (per account)
// ---------------------------------------------------------------------------

export type TradingConfig = {
  /** Whether auto-trading is enabled at all. */
  enabled: boolean;
  /** Which venue to execute on. */
  venue: TradingVenue;
  /** Spot or futures. */
  marketType: MarketType;
  /** Base currency for risk calculations, e.g., "USDT". */
  quoteCurrency: string;

  // --- Risk ---
  /** Risk per trade as % of equity (e.g., 1 = 1%). */
  riskPerTradePct: number;
  /** Hard cap on risk per trade regardless of signal strength. */
  maxRiskPerTradePct: number;
  /** Max daily loss as % of equity. Trading halts if exceeded. */
  maxDailyLossPct: number;
  /** Max total drawdown from peak before emergency halt. */
  maxDrawdownPct: number;
  /** Max concurrent positions (all symbols). */
  maxConcurrentPositions: number;
  /** Max exposure as % of equity (sum of all position notionals). */
  maxTotalExposurePct: number;
  /** Max position size as % of equity for a single trade. */
  maxPositionSizePct: number;
  /** Min risk-reward ratio required to enter. */
  minRiskReward: number;

  // --- Leverage ---
  /** Leverage for futures. 1 = spot. Max depends on venue. */
  leverage: number;
  /** Max allowed leverage regardless of signal. */
  maxLeverage: number;
  /** Whether to use isolated margin (safer) or cross. */
  isolatedMargin: boolean;

  // --- Position sizing method ---
  /** "fixed_fractional" | "kelly" | "fixed_ratio" | "risk_based" */
  sizingMethod: "fixed_fractional" | "kelly" | "fixed_ratio" | "risk_based";
  /** For fixed_fractional: fraction of equity per trade. */
  fixedFraction: number;
  /** For kelly: fraction of Kelly to use (0.5 = half-Kelly, safer). */
  kellyFraction: number;
  /** For fixed_ratio: delta per unit of profit. */
  fixedRatioDelta: number;

  // --- Trade management ---
  /** Whether to trail stops after TP1. */
  trailStop: boolean;
  /** ATR multiplier for trailing stop distance. */
  trailStopAtrMult: number;
  /** Whether to scale out partially at TP1. */
  scaleOutAtTp1: boolean;
  /** Fraction to close at TP1 (0.5 = close half). */
  scaleOutTp1Fraction: number;
  /** Whether to move stop to breakeven after TP1. */
  moveStopToBreakeven: boolean;

  // --- Filters ---
  /** Only trade these symbols (empty = all). */
  allowedSymbols: string[];
  /** Never trade these symbols. */
  blockedSymbols: string[];
  /** Max notional per trade in quote currency. */
  maxNotionalPerTrade: number;
  /** Min notional per trade (exchange minimums). */
  minNotionalPerTrade: number;

  // --- Slippage & fees ---
  /** Estimated slippage in bps. */
  slippageBps: number;
  /** Maker fee in bps. */
  makerFeeBps: number;
  /** Taker fee in bps. */
  takerFeeBps: number;
};

export const DEFAULT_TRADING_CONFIG: TradingConfig = {
  enabled: false,
  venue: "binance",
  marketType: "futures",
  quoteCurrency: "USDT",

  riskPerTradePct: 1,
  maxRiskPerTradePct: 2,
  maxDailyLossPct: 5,
  maxDrawdownPct: 20,
  maxConcurrentPositions: 3,
  maxTotalExposurePct: 300,   // 3x with leverage
  maxPositionSizePct: 100,
  minRiskReward: 1.8,

  leverage: 3,
  maxLeverage: 10,
  isolatedMargin: true,

  sizingMethod: "risk_based",
  fixedFraction: 0.02,
  kellyFraction: 0.5,
  fixedRatioDelta: 500,

  trailStop: true,
  trailStopAtrMult: 2.0,
  scaleOutAtTp1: false,
  scaleOutTp1Fraction: 0.5,
  moveStopToBreakeven: true,

  allowedSymbols: [],
  blockedSymbols: [],
  maxNotionalPerTrade: 50000,
  minNotionalPerTrade: 50,

  slippageBps: 5,
  makerFeeBps: 2,
  takerFeeBps: 4,
};

// ---------------------------------------------------------------------------
// Position & order models
// ---------------------------------------------------------------------------

export type TradingPosition = {
  id: string;
  tradingAccountId: string;
  signalId: string | null;
  symbol: string;
  direction: Direction;
  marketType: MarketType;
  status: PositionStatus;
  /** Entry average price. */
  entryPrice: number;
  /** Current mark price or last known price. */
  markPrice: number;
  /** Total quantity (base asset). */
  quantity: number;
  /** Notional value in quote currency. */
  notional: number;
  /** Leverage used. */
  leverage: number;
  /** Margin used (quote currency). */
  marginUsed: number;
  /** Current unrealised PnL in quote. */
  unrealisedPnl: number;
  /** Current unrealised PnL as %. */
  unrealisedPnlPct: number;
  /** Risk (stop distance) in quote. */
  riskAmount: number;
  /** Risk as % of equity at entry time. */
  riskPct: number;
  stopLossPrice: number | null;
  takeProfit1Price: number | null;
  takeProfit2Price: number | null;
  /** Whether stop has been moved to breakeven. */
  stopMovedToBreakeven: boolean;
  /** Whether trailing stop is active. */
  trailingStopActive: boolean;
  /** Current trailing stop trigger price. */
  trailingStopPrice: number | null;
  mfeR: number;
  maeR: number;
  openedAt: number;
  closedAt: number | null;
  closeReason: "tp1" | "tp2" | "stop" | "breakeven" | "trailing_stop" | "manual" | "liquidation" | null;
  realisedPnl: number;
  rMultiple: number;
  createdAt: number;
  updatedAt: number;
};

export type TradingOrder = {
  id: string;
  tradingAccountId: string;
  positionId: string | null;
  exchangeOrderId: string | null;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  /** Requested price (0 for market). */
  price: number;
  /** Requested quantity. */
  quantity: number;
  /** Filled quantity so far. */
  filledQuantity: number;
  /** Average fill price. */
  avgFillPrice: number | null;
  /** Quote value of filled portion. */
  filledQuoteValue: number;
  /** Fee paid. */
  fee: number;
  /** Fee currency. */
  feeCurrency: string;
  reduceOnly: boolean;
  postOnly: boolean;
  timeInForce: TimeInForce;
  /** Client order ID for idempotency. */
  clientOrderId: string;
  error: string | null;
  rawResponse: unknown;
  createdAt: number;
  updatedAt: number;
  filledAt: number | null;
};

/** Represents a connected exchange account. */
export type TradingAccount = {
  id: string;
  customerId: string | null;    // null = owner's account
  label: string;
  venue: TradingVenue;
  marketType: MarketType;
  /** Encrypted API key. */
  apiKeyEncrypted: string;
  /** Encryption IV. */
  apiKeyIv: string;
  /** We only store a hash of the secret to verify it's correct. */
  secretHash: string;
  /** Optional passphrase hash (for OKX). */
  passphraseHash: string | null;
  /** Current equity (from exchange or computed). */
  equity: number;
  /** Available balance. */
  availableBalance: number;
  /** Margin balance. */
  marginBalance: number;
  /** Unrealised PnL. */
  unrealisedPnl: number;
  /** Daily PnL. */
  dailyPnl: number;
  /** Daily loss so far. */
  dailyLoss: number;
  /** Peak equity (for drawdown calc). */
  peakEquity: number;
  isActive: boolean;
  lastSyncAt: number | null;
  createdAt: number;
  updatedAt: number;
};

// ---------------------------------------------------------------------------
// Auto-trader events
// ---------------------------------------------------------------------------

export type TradeEvent =
  | { type: "signal_received"; signalId: string; symbol: string; direction: Direction }
  | { type: "risk_approved"; signalId: string; riskVerdict: RiskVerdict }
  | { type: "risk_rejected"; signalId: string; reason: string }
  | { type: "order_placed"; orderId: string; symbol: string; side: OrderSide }
  | { type: "order_filled"; orderId: string; positionId: string }
  | { type: "order_failed"; orderId: string; error: string }
  | { type: "position_opened"; positionId: string; symbol: string }
  | { type: "position_closed"; positionId: string; reason: string; pnl: number }
  | { type: "stop_moved"; positionId: string; newStop: number }
  | { type: "trailing_stop_triggered"; positionId: string; price: number }
  | { type: "daily_loss_limit_hit"; loss: number; limit: number }
  | { type: "drawdown_limit_hit"; drawdown: number; limit: number }
  | { type: "emergency_halt"; reason: string };

export type TradeEventCallback = (event: TradeEvent) => void | Promise<void>;
