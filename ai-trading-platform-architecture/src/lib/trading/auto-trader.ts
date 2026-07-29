// ---------------------------------------------------------------------------
// Auto-Trader — the main orchestrator.
//
// This is the bridge between the SignalEngine (brain) and the exchange.
// Responsibilities:
//   1. Receive decisions from the signal engine.
//   2. Run every entry through the risk manager.
//   3. Place orders via the exchange adapter.
//   4. Track positions and manage exits (TP/SL/trailing stop/breakeven).
//   5. Handle emergency halts.
//   6. Sync positions with exchange periodically.
//
// The auto-trader can operate in three modes:
//   - "off"      — signals only, no execution (original behaviour)
//   - "paper"    — simulated execution for testing
//   - "live"     — real exchange execution
// ---------------------------------------------------------------------------

import type { Decision, TradePlan } from "../intelligence/types";
import { evaluateRisk, shouldEmergencyHalt, suggestLeverage } from "./risk-manager";
import type {
  ExchangeAdapter,
  PlaceOrderRequest,
} from "./exchange-executor";
import { SimulatedExchange } from "./exchange-executor";
import type {
  OrderSide,
  RiskVerdict,
  TradeEvent,
  TradeEventCallback,
  TradingConfig,
  TradingOrder,
  TradingPosition,
} from "./types";
import { DEFAULT_TRADING_CONFIG } from "./types";

export type AutoTraderMode = "off" | "paper" | "live";

export type AutoTraderState = {
  mode: AutoTraderMode;
  config: TradingConfig;
  equity: number;
  peakEquity: number;
  dailyPnl: number;
  openPositions: TradingPosition[];
  openOrders: TradingOrder[];
  isHalted: boolean;
  haltReason: string | null;
};

export class AutoTrader {
  private state: AutoTraderState;
  private listeners: TradeEventCallback[] = [];

  constructor(
    private readonly adapter: ExchangeAdapter,
    config?: Partial<TradingConfig>,
    private mode: AutoTraderMode = "paper",
  ) {
    this.state = {
      mode,
      config: { ...DEFAULT_TRADING_CONFIG, ...config },
      equity: 0,
      peakEquity: 0,
      dailyPnl: 0,
      openPositions: [],
      openOrders: [],
      isHalted: false,
      haltReason: null,
    };
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Create a paper-trading auto-trader (no real money). */
  static paper(initialEquity = 10000, config?: Partial<TradingConfig>): AutoTrader {
    const sim = new SimulatedExchange(initialEquity);
    const trader = new AutoTrader(sim, { ...config, enabled: true }, "paper");
    trader.state.equity = initialEquity;
    trader.state.peakEquity = initialEquity;
    return trader;
  }

  /** Create a live auto-trader with a real exchange adapter. */
  static live(adapter: ExchangeAdapter, config?: Partial<TradingConfig>): AutoTrader {
    return new AutoTrader(adapter, { ...config, enabled: true }, "live");
  }

  /** Register an event listener. */
  onEvent(cb: TradeEventCallback): void {
    this.listeners.push(cb);
  }

  private async emit(event: TradeEvent): Promise<void> {
    for (const cb of this.listeners) {
      try { await cb(event); } catch { /* swallow listener errors */ }
    }
  }

  getState(): Readonly<AutoTraderState> {
    return this.state;
  }

  /** Sync account info from exchange. Call periodically. */
  async syncAccount(): Promise<void> {
    if (this.mode === "off") return;

    try {
      const info = await this.adapter.getAccountInfo();
      const prevEquity = this.state.equity;
      this.state.equity = info.equity;
      this.state.peakEquity = Math.max(this.state.peakEquity, info.equity);

      // Daily PnL tracking (resets conceptually at midnight; simplified here)
      if (prevEquity > 0) {
        this.state.dailyPnl += info.equity - prevEquity;
      }
    } catch (err) {
      await this.emit({
        type: "order_failed",
        orderId: "",
        error: `Account sync failed: ${(err as Error).message}`,
      });
    }
  }

  /** Daily reset — call at midnight via cron. */
  resetDaily(): void {
    this.state.dailyPnl = 0;
  }

  /** Enable or disable auto-trading. */
  setEnabled(enabled: boolean): void {
    this.state.config.enabled = enabled;
    this.state.isHalted = !enabled;
    if (!enabled) this.state.haltReason = "Manually disabled";
    else this.state.haltReason = null;
  }

  /** Update trading configuration at runtime. */
  updateConfig(patch: Partial<TradingConfig>): void {
    this.state.config = { ...this.state.config, ...patch };
  }

  // -----------------------------------------------------------------------
  // Trade execution
  // -----------------------------------------------------------------------

  /**
   * Called when the brain produces a decision.
   * Only `enter` verdicts with a plan are actioned.
   */
  async onDecision(decision: Decision): Promise<{
    executed: boolean;
    positionId?: string;
    reason?: string;
  }> {
    if (this.state.mode === "off" || !this.state.config.enabled) {
      return { executed: false, reason: "Auto-trading disabled" };
    }

    if (decision.verdict !== "enter" || !decision.plan || !decision.direction) {
      return { executed: false, reason: `Not an entry signal (${decision.verdict})` };
    }

    // Emergency halt check
    const haltCheck = shouldEmergencyHalt(
      this.state.config,
      this.state.equity,
      this.state.peakEquity,
      this.state.dailyPnl,
    );

    if (haltCheck.halt) {
      this.state.isHalted = true;
      this.state.haltReason = haltCheck.reason ?? null;
      await this.emit({ type: "emergency_halt", reason: haltCheck.reason! });
      return { executed: false, reason: haltCheck.reason };
    }

    await this.emit({ type: "signal_received", signalId: "", symbol: decision.symbol, direction: decision.direction });

    // Risk evaluation
    const riskCtx = {
      equity: this.state.equity,
      dailyPnl: this.state.dailyPnl,
      peakEquity: this.state.peakEquity,
      openPositions: this.state.openPositions.filter(p => p.status === "open"),
      plan: decision.plan,
      confidence: decision.confidence,
      probability: decision.probability,
      symbol: decision.symbol,
    };

    const verdict = evaluateRisk(this.state.config, riskCtx);

    if (!verdict.allowed) {
      await this.emit({ type: "risk_rejected", signalId: "", reason: verdict.reason! });
      return { executed: false, reason: verdict.reason };
    }

    await this.emit({ type: "risk_approved", signalId: "", riskVerdict: verdict });

    // Execute
    return this.executeEntry(decision.symbol, decision.plan, decision.direction, verdict);
  }

  /**
   * Called when a signal closes — close the corresponding position.
   */
  async onSignalClose(
    symbol: string,
    direction: "long" | "short",
    exitPrice: number,
    outcome: "tp1" | "tp2" | "stop" | "breakeven",
    signalId?: string,
  ): Promise<void> {
    const position = this.state.openPositions.find(
      p => p.symbol === symbol && p.direction === direction && p.status === "open",
    );

    if (!position) return;

    await this.closePosition(position, exitPrice, outcome);
  }

  /**
   * Track open positions against current prices. Called every few minutes.
   * Checks TP/SL levels and manages trailing stops.
   */
  async trackPositions(): Promise<void> {
    if (this.state.isHalted) return;

    for (const position of this.state.openPositions) {
      if (position.status !== "open") continue;

      try {
        const currentPrice = await this.adapter.getPrice(position.symbol);
        this.evaluatePositionExit(position, currentPrice);
      } catch {
        // Skip if we can't get price — better than closing on stale data
      }
    }
  }

  // -----------------------------------------------------------------------
  // Position management
  // -----------------------------------------------------------------------

  private async executeEntry(
    symbol: string,
    plan: TradePlan,
    direction: "long" | "short",
    verdict: RiskVerdict,
  ): Promise<{ executed: boolean; positionId?: string; reason?: string }> {
    const side: OrderSide = direction === "long" ? "buy" : "sell";
    const price = await this.adapter.getPrice(symbol).catch(() => plan.entry);
    const quantity = this.computeQuantity(symbol, verdict.suggestedSizeQuote, price);

    if (quantity <= 0) {
      return { executed: false, reason: "Computed quantity is zero" };
    }

    // Set leverage for futures
    if (this.state.config.marketType === "futures" && verdict.suggestedLeverage > 0) {
      await this.adapter.setLeverage(symbol, verdict.suggestedLeverage);
      if (this.state.config.isolatedMargin) {
        await this.adapter.setMarginMode(symbol, "isolated");
      }
    }

    const clientOrderId = `at_${symbol}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const orderReq: PlaceOrderRequest = {
      symbol,
      side,
      type: "market",
      quantity,
      clientOrderId,
      leverage: verdict.suggestedLeverage,
      marginMode: this.state.config.isolatedMargin ? "isolated" : "cross",
    };

    await this.emit({ type: "order_placed", orderId: clientOrderId, symbol, side });

    const result = await this.adapter.placeOrder(orderReq);

    if (!result.ok) {
      await this.emit({ type: "order_failed", orderId: clientOrderId, error: result.error! });
      return { executed: false, reason: result.error };
    }

    const fillPrice = result.avgFillPrice ?? price;
    const positionId = `pos_${symbol}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // Calculate stop and take profit prices from the plan
    const stopLoss = plan.stopLoss;
    const tp1 = plan.takeProfit1;
    const tp2 = plan.takeProfit2;

    const notional = quantity * fillPrice;
    const riskAmount = Math.abs(fillPrice - stopLoss) * quantity;

    const position: TradingPosition = {
      id: positionId,
      tradingAccountId: "default",
      signalId: null,
      symbol,
      direction,
      marketType: this.state.config.marketType,
      status: "open",
      entryPrice: fillPrice,
      markPrice: fillPrice,
      quantity,
      notional,
      leverage: verdict.suggestedLeverage,
      marginUsed: this.state.config.marketType === "futures"
        ? notional / verdict.suggestedLeverage
        : notional,
      unrealisedPnl: 0,
      unrealisedPnlPct: 0,
      riskAmount,
      riskPct: this.state.equity > 0 ? (riskAmount / this.state.equity) * 100 : 0,
      stopLossPrice: stopLoss,
      takeProfit1Price: tp1,
      takeProfit2Price: tp2,
      stopMovedToBreakeven: false,
      trailingStopActive: false,
      trailingStopPrice: null,
      mfeR: 0,
      maeR: 0,
      openedAt: Date.now(),
      closedAt: null,
      closeReason: null,
      realisedPnl: 0,
      rMultiple: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.state.openPositions.push(position);

    await this.emit({ type: "position_opened", positionId, symbol });
    await this.emit({ type: "order_filled", orderId: clientOrderId, positionId });

    // Place stop-loss and take-profit orders
    await this.placeProtectionOrders(position);

    return { executed: true, positionId };
  }

  private async closePosition(
    position: TradingPosition,
    exitPrice: number,
    reason: "tp1" | "tp2" | "stop" | "breakeven" | "trailing_stop" | "manual",
  ): Promise<void> {
    const side: OrderSide = position.direction === "long" ? "sell" : "buy";
    const clientOrderId = `at_close_${position.symbol}_${Date.now()}`;

    const result = await this.adapter.placeOrder({
      symbol: position.symbol,
      side,
      type: "market",
      quantity: position.quantity,
      reduceOnly: true,
      clientOrderId,
    });

    const actualExitPrice = result.ok && result.avgFillPrice
      ? result.avgFillPrice
      : exitPrice;

    // Calculate PnL
    const isLong = position.direction === "long";
    const signedPnl = isLong
      ? (actualExitPrice - position.entryPrice) * position.quantity
      : (position.entryPrice - actualExitPrice) * position.quantity;

    const risk = Math.abs(position.entryPrice - (position.stopLossPrice ?? position.entryPrice));
    const rMultiple = risk > 0 ? signedPnl / (risk * position.quantity) : 0;

    position.status = "closed";
    position.closedAt = Date.now();
    position.closeReason = reason;
    position.realisedPnl = signedPnl;
    position.rMultiple = rMultiple;
    position.updatedAt = Date.now();

    this.state.equity += signedPnl - (result.fee ?? 0);
    this.state.peakEquity = Math.max(this.state.peakEquity, this.state.equity);

    await this.emit({
      type: "position_closed",
      positionId: position.id,
      reason,
      pnl: signedPnl,
    });
  }

  private evaluatePositionExit(position: TradingPosition, currentPrice: number): void {
    const isLong = position.direction === "long";

    // Update MFE/MAE
    const risk = Math.abs(position.entryPrice - (position.stopLossPrice ?? position.entryPrice));
    if (risk > 0) {
      const moveR = isLong
        ? (currentPrice - position.entryPrice) / risk
        : (position.entryPrice - currentPrice) / risk;
      position.mfeR = Math.max(position.mfeR, moveR);
      position.maeR = Math.min(position.maeR, moveR);
    }

    // Check stop loss
    const effectiveStop = position.stopMovedToBreakeven
      ? position.entryPrice
      : (position.stopLossPrice ?? 0);

    const stopHit = isLong ? currentPrice <= effectiveStop : currentPrice >= effectiveStop;

    if (stopHit) {
      const reason = position.stopMovedToBreakeven ? "breakeven" : "stop";
      this.closePosition(position, effectiveStop, reason);
      return;
    }

    // Check TP2
    const tp2 = position.takeProfit2Price;
    if (tp2) {
      const tp2Hit = isLong ? currentPrice >= tp2 : currentPrice <= tp2;
      if (tp2Hit) {
        this.closePosition(position, tp2, "tp2");
        return;
      }
    }

    // Check TP1
    const tp1 = position.takeProfit1Price;
    if (tp1 && position.status === "open") {
      const tp1Hit = isLong ? currentPrice >= tp1 : currentPrice <= tp1;
      if (tp1Hit) {
        // Move stop to breakeven
        if (this.state.config.moveStopToBreakeven) {
          position.stopMovedToBreakeven = true;
          position.status = "tp1_hit";
        }

        // Scale out at TP1
        if (this.state.config.scaleOutAtTp1) {
          // Close a portion
          const closeQty = position.quantity * this.state.config.scaleOutTp1Fraction;
          position.quantity -= closeQty;
          // Adjust notional
          position.notional = position.quantity * currentPrice;
        }

        // Activate trailing stop
        if (this.state.config.trailStop) {
          position.trailingStopActive = true;
          position.trailingStopPrice = isLong
            ? currentPrice * (1 - this.state.config.trailStopAtrMult * 0.01)
            : currentPrice * (1 + this.state.config.trailStopAtrMult * 0.01);
        }
      }
    }

    // Update trailing stop
    if (position.trailingStopActive && position.trailingStopPrice) {
      const newTrailStop = isLong
        ? currentPrice * (1 - this.state.config.trailStopAtrMult * 0.01)
        : currentPrice * (1 + this.state.config.trailStopAtrMult * 0.01);

      if (isLong && newTrailStop > position.trailingStopPrice) {
        position.trailingStopPrice = newTrailStop;
        this.emit({
          type: "stop_moved",
          positionId: position.id,
          newStop: newTrailStop,
        });
      } else if (!isLong && newTrailStop < position.trailingStopPrice) {
        position.trailingStopPrice = newTrailStop;
        this.emit({
          type: "stop_moved",
          positionId: position.id,
          newStop: newTrailStop,
        });
      }

      // Check if trailing stop was hit
      const trailHit = isLong
        ? currentPrice <= position.trailingStopPrice!
        : currentPrice >= position.trailingStopPrice!;

      if (trailHit) {
        this.closePosition(position, currentPrice, "trailing_stop");
        return;
      }
    }
  }

  private async placeProtectionOrders(position: TradingPosition): Promise<void> {
    // Place stop-loss order
    if (position.stopLossPrice) {
      const slSide: OrderSide = position.direction === "long" ? "sell" : "buy";
      await this.adapter.placeOrder({
        symbol: position.symbol,
        side: slSide,
        type: "stop_loss",
        quantity: position.quantity,
        stopPrice: position.stopLossPrice,
        reduceOnly: true,
        clientOrderId: `sl_${position.id}`,
      });
    }

    // Place take-profit orders
    if (position.takeProfit2Price) {
      const tpSide: OrderSide = position.direction === "long" ? "sell" : "buy";
      await this.adapter.placeOrder({
        symbol: position.symbol,
        side: tpSide,
        type: "take_profit",
        quantity: position.quantity,
        stopPrice: position.takeProfit2Price,
        reduceOnly: true,
        clientOrderId: `tp_${position.id}`,
      });
    }
  }

  private computeQuantity(symbol: string, notionalQuote: number, price: number): number {
    if (price <= 0) return 0;
    const raw = notionalQuote / price;
    // Round to standard lot sizes (simplified — production should use exchange info)
    return Math.floor(raw * 1000) / 1000;
  }
}
