// ---------------------------------------------------------------------------
// Risk Engine
//
// The single source of truth for whether a proposed order is allowed to
// execute. Every order — whether placed manually, by a strategy, or by the
// backtester — must pass through `validateOrder`. See /docs/ARCHITECTURE.md
// "Risk Management" for the full design rationale.
// ---------------------------------------------------------------------------
export type RiskSettings = {
  maxLeverage: number;
  riskPerTradePct: number;
  maxPositionPct: number;
  maxDailyLossPct: number;
  maxDrawdownPct: number;
  maxOpenPositions: number;
};

export type OpenPosition = {
  symbol: string;
  quantity: number;
  entryPrice: number;
  leverage: number;
  side: "long" | "short";
};

export type OrderRequest = {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  leverage: number;
};

export type RiskCheckContext = {
  equity: number;
  balance: number;
  openPositions: OpenPosition[];
  dailyRealizedPnl: number;
  peakEquity: number;
  maxSymbolLeverage: number;
};

export type RiskCheckResult = {
  allowed: boolean;
  reason?: string;
  warnings: string[];
};

export function validateOrder(order: OrderRequest, settings: RiskSettings, ctx: RiskCheckContext): RiskCheckResult {
  const warnings: string[] = [];

  if (order.quantity <= 0) {
    return { allowed: false, reason: "Order quantity must be positive.", warnings };
  }

  if (order.leverage > settings.maxLeverage) {
    return {
      allowed: false,
      reason: `Requested leverage ${order.leverage}x exceeds account max leverage ${settings.maxLeverage}x.`,
      warnings,
    };
  }

  if (order.leverage > ctx.maxSymbolLeverage) {
    return {
      allowed: false,
      reason: `Requested leverage ${order.leverage}x exceeds the exchange max leverage for ${order.symbol} (${ctx.maxSymbolLeverage}x).`,
      warnings,
    };
  }

  const notional = order.quantity * order.price;
  const margin = notional / order.leverage;

  if (margin > ctx.balance) {
    return { allowed: false, reason: "Insufficient free margin for this order.", warnings };
  }

  const positionPct = (notional / ctx.equity) * 100;
  if (positionPct > settings.maxPositionPct) {
    return {
      allowed: false,
      reason: `Position notional would be ${positionPct.toFixed(1)}% of equity, exceeding the ${settings.maxPositionPct}% cap.`,
      warnings,
    };
  }

  const alreadyOpenForSymbol = ctx.openPositions.some((p) => p.symbol === order.symbol);
  if (!alreadyOpenForSymbol && ctx.openPositions.length >= settings.maxOpenPositions) {
    return {
      allowed: false,
      reason: `Maximum open positions (${settings.maxOpenPositions}) reached.`,
      warnings,
    };
  }

  const dailyLossPct = ctx.equity > 0 ? (-ctx.dailyRealizedPnl / ctx.equity) * 100 : 0;
  if (ctx.dailyRealizedPnl < 0 && dailyLossPct >= settings.maxDailyLossPct) {
    return {
      allowed: false,
      reason: `Daily loss limit reached (${dailyLossPct.toFixed(1)}% >= ${settings.maxDailyLossPct}%). Trading halted until reset.`,
      warnings,
    };
  }

  const drawdownPct = ctx.peakEquity > 0 ? ((ctx.peakEquity - ctx.equity) / ctx.peakEquity) * 100 : 0;
  if (drawdownPct >= settings.maxDrawdownPct) {
    return {
      allowed: false,
      reason: `Account drawdown (${drawdownPct.toFixed(1)}%) has breached the max drawdown limit (${settings.maxDrawdownPct}%). Trading halted.`,
      warnings,
    };
  }

  if (order.leverage >= settings.maxLeverage * 0.8) {
    warnings.push("Leverage is close to the account maximum — liquidation risk is elevated.");
  }
  if (positionPct >= settings.maxPositionPct * 0.8) {
    warnings.push("Position size is close to the maximum allowed exposure per position.");
  }

  return { allowed: true, warnings };
}

/** Fixed-fractional position sizing based on distance to stop loss. */
export function computePositionSize(opts: {
  equity: number;
  riskPerTradePct: number;
  entryPrice: number;
  stopPrice: number;
  leverage: number;
}): number {
  const { equity, riskPerTradePct, entryPrice, stopPrice, leverage } = opts;
  const riskAmount = equity * (riskPerTradePct / 100);
  const stopDistance = Math.abs(entryPrice - stopPrice);
  if (stopDistance <= 0) return 0;
  const quantity = riskAmount / stopDistance;
  // cap by available margin at the given leverage (use full equity as margin ceiling)
  const maxQtyByMargin = (equity * leverage) / entryPrice;
  return Math.min(quantity, maxQtyByMargin);
}

export function computeLiquidationPrice(opts: {
  side: "long" | "short";
  entryPrice: number;
  leverage: number;
  maintenanceMarginRate?: number;
}): number {
  const { side, entryPrice, leverage, maintenanceMarginRate = 0.005 } = opts;
  const marginRatio = 1 / leverage;
  if (side === "long") {
    return entryPrice * (1 - marginRatio + maintenanceMarginRate);
  }
  return entryPrice * (1 + marginRatio - maintenanceMarginRate);
}
