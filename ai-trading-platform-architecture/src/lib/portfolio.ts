// ---------------------------------------------------------------------------
// Portfolio aggregation helpers — combine an account's cash balance with
// mark-to-market valuation of open positions using live simulated prices.
// ---------------------------------------------------------------------------
import { getLatestPrice } from "@/lib/market/simulator";
import { computeLiquidationPrice } from "@/lib/risk/engine";

export type PositionRow = {
  id: string;
  symbol: string;
  side: string;
  quantity: string | number;
  entryPrice: string | number;
  leverage: string | number;
  stopLoss: string | number | null;
  takeProfit: string | number | null;
  status: string;
};

export type EnrichedPosition = PositionRow & {
  markPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  notional: number;
  margin: number;
  liquidationPrice: number;
};

export function enrichPosition(p: PositionRow): EnrichedPosition {
  const quantity = Number(p.quantity);
  const entryPrice = Number(p.entryPrice);
  const leverage = Number(p.leverage);
  const markPrice = getLatestPrice(p.symbol);
  const side = p.side as "long" | "short";
  const priceDelta = side === "long" ? markPrice - entryPrice : entryPrice - markPrice;
  const unrealizedPnl = priceDelta * quantity;
  const notional = quantity * entryPrice;
  const margin = notional / (leverage || 1);
  const unrealizedPnlPct = margin > 0 ? (unrealizedPnl / margin) * 100 : 0;
  const liquidationPrice = computeLiquidationPrice({ side, entryPrice, leverage: leverage || 1 });

  return {
    ...p,
    markPrice,
    unrealizedPnl,
    unrealizedPnlPct,
    notional,
    margin,
    liquidationPrice,
  };
}

export function summarizePortfolio(balance: number, positions: EnrichedPosition[]) {
  const usedMargin = positions.reduce((a, p) => a + p.margin, 0);
  const unrealizedPnl = positions.reduce((a, p) => a + p.unrealizedPnl, 0);
  const equity = balance + unrealizedPnl;
  const freeMargin = balance - usedMargin;
  const marginLevel = usedMargin > 0 ? (equity / usedMargin) * 100 : Infinity;

  return {
    balance,
    equity,
    usedMargin,
    freeMargin,
    unrealizedPnl,
    marginLevel: Number.isFinite(marginLevel) ? marginLevel : null,
    openPositions: positions.length,
  };
}
