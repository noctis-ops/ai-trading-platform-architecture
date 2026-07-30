import type { Decision, MarketRegime, Reason, ReasonCode, TradePlan } from "../intelligence/types";
import { fmtPrice, fmtPct } from "./messages.ar";

type Detail = Record<string, number | string> | undefined;

const REASON_EN: Record<ReasonCode, (d: Detail) => string> = {
  TREND_UP_ALIGNED: () => "Trend is up and aligned across moving averages",
  TREND_DOWN_ALIGNED: () => "Trend is down and aligned across moving averages",
  TREND_FLAT: () => "No clear trend currently",
  TREND_CONFLICT: () => "Conflict in trend reading between moving averages",

  STRUCTURE_BOS_UP: (d) => `Bullish break of structure above ${d?.level ? fmtPrice(Number(d.level)) : "previous high"}`,
  STRUCTURE_BOS_DOWN: (d) => `Bearish break of structure below ${d?.level ? fmtPrice(Number(d.level)) : "previous low"}`,
  STRUCTURE_CHOCH_UP: () => "Change of character favoring buyers",
  STRUCTURE_CHOCH_DOWN: () => "Change of character favoring sellers",
  STRUCTURE_RANGE: () => "Market is moving in a range with no clear structure",

  AT_DEMAND_ZONE: (d) => `Price at strong demand zone (${d?.touches ?? 0} touches)`,
  AT_SUPPLY_ZONE: (d) => `Price at strong supply zone (${d?.touches ?? 0} touches)`,
  AT_SUPPORT: (d) => `Price bouncing from established support (${d?.touches ?? 0} touches)`,
  AT_RESISTANCE: (d) => `Price facing established resistance (${d?.touches ?? 0} touches)`,
  MID_RANGE_NO_EDGE: () => "Price in mid-range, no clear edge",

  MOMENTUM_BULLISH: (d) => `Positive momentum${d?.rsi ? ` (RSI ${d.rsi})` : ""}`,
  MOMENTUM_BEARISH: (d) => `Negative momentum${d?.rsi ? ` (RSI ${d.rsi})` : ""}`,
  MOMENTUM_DIVERGENCE_BULL: () => "Bullish divergence between price and momentum",
  MOMENTUM_DIVERGENCE_BEAR: () => "Bearish divergence between price and momentum",
  MOMENTUM_EXHAUSTED: (d) => `Momentum is exhausted, a correction is likely${d?.rsi ? ` (RSI ${d.rsi})` : ""}`,

  VOLUME_CONFIRMS: (d) => `Volume confirms the move (${d?.ratio ?? "—"}x average)`,
  VOLUME_WEAK: (d) => `Volume is weak, move unconfirmed (${d?.ratio ?? "—"}x average)`,
  LIQUIDITY_SWEEP_LOW: (d) => `Liquidity sweep below ${d?.level ? fmtPrice(Number(d.level)) : "low"} and rejection`,
  LIQUIDITY_SWEEP_HIGH: (d) => `Liquidity sweep above ${d?.level ? fmtPrice(Number(d.level)) : "high"} and rejection`,
  LIQUIDITY_THIN: () => "Thin liquidity, move may be unreliable",

  VOLATILITY_NORMAL: (d) => `Normal volatility (${d?.atrPct ?? "—"}%)`,
  VOLATILITY_EXPANDING: (d) => `Expanding volatility (${d?.expansion ?? "—"}x normal)`,
  VOLATILITY_EXTREME: (d) => `Extreme volatility (${d?.atrPct ?? "—"}%) — uncalculated risk`,
  VOLATILITY_DEAD: (d) => `Dead market, very low volatility (${d?.atrPct ?? "—"}%)`,

  PA_BULLISH_ENGULFING: () => "Bullish engulfing candle",
  PA_BEARISH_ENGULFING: () => "Bearish engulfing candle",
  PA_REJECTION_WICK_UP: () => "Long upper wick indicates price rejection",
  PA_REJECTION_WICK_DOWN: () => "Long lower wick indicates absorption of selling",
  PA_INDECISION: () => "Indecision candle with no direction",

  MTF_ALIGNED: (d) => `Full alignment across ${d?.count ?? ""} timeframes`,
  MTF_PARTIAL: (d) => `Partial alignment (${d?.aligned ?? 0} out of ${d?.total ?? 0} timeframes)`,
  MTF_CONFLICT: () => "Conflict between timeframes",

  REJECT_LOW_CONFLUENCE: (d) => `Signal confluence ${d?.confluence ?? 0}% is below the required ${d?.required ?? 0}%`,
  REJECT_MTF_CONFLICT: () => "Timeframes are conflicting — waiting is better",
  REJECT_POOR_RR: (d) => `Risk/reward ratio ${d?.rr ?? 0} is below required ${d?.required ?? 0}`,
  REJECT_EXTREME_VOLATILITY: (d) => `Extreme volatility (${d?.atrPct ?? 0}%) exceeds safe limit ${d?.max ?? 0}%`,
  REJECT_DEAD_MARKET: () => "Market is dead, lacking sufficient movement",
  REJECT_NO_STRUCTURE_EDGE: () => "No structural edge at current price",
  REJECT_NEWS_WINDOW: () => "A major economic event is near — signals suspended",
  REJECT_LOW_PROBABILITY: (d) => `Probability ${d?.probability ?? 0}% is below required ${d?.required ?? 0}%`,
  REJECT_INSUFFICIENT_DATA: () => "Insufficient historical data",
  REJECT_COOLDOWN: () => "Cooldown period after a recent signal on this pair",
  REJECT_DAILY_LIMIT: (d) => `Daily signal limit reached (${d?.max ?? 0})`,
  REJECT_EXPOSURE_LIMIT: () => "An open trade already exists for this pair",
  WAIT_BETTER_PRICE: (d) =>
    d?.stopAtrMultiple
      ? `Price has moved too far from invalidation level (${d.stopAtrMultiple}x ATR) — waiting for pullback`
      : "Price is overextended — waiting for a better entry point",

  // v3.0 — Order Flow
  VWAP_BULLISH: () => "Price above VWAP — institutional buying pressure",
  VWAP_BEARISH: () => "Price below VWAP — institutional selling pressure",
  VWAP_CROSSOVER_UP: () => "Price crossed above VWAP",
  VWAP_CROSSOVER_DOWN: () => "Price crossed below VWAP",
  VP_POC_SUPPORT: (d) => `POC at ${d?.poc ?? "—"} acting as support`,
  VP_POC_RESISTANCE: (d) => `POC at ${d?.poc ?? "—"} acting as resistance`,
  VP_VALUE_AREA_BREAKOUT: () => "Value area breakout — volume-backed move",
  CVD_BULLISH: () => "CVD positive — net buying accumulation",
  CVD_BEARISH: () => "CVD negative — net selling accumulation",
  CVD_DIVERGENCE_BEAR: () => "CVD bearish divergence — hidden distribution",

  // v3.0 — Reversal
  REVERSAL_HAMMER: () => "Hammer candle — strong rejection of downside",
  REVERSAL_SHOOTING_STAR: () => "Shooting star — strong rejection of upside",
  REVERSAL_DIVERGENCE_BULL: () => "Bullish divergence — potential reversal",
  REVERSAL_DIVERGENCE_BEAR: () => "Bearish divergence — potential reversal",
  REVERSAL_OVERSOLD: (d) => `Oversold (RSI ${d?.rsi ?? "—"}) — bounce expected`,
  REVERSAL_OVERBOUGHT: (d) => `Overbought (RSI ${d?.rsi ?? "—"}) — correction expected`,

  // v3.0 — Breakout
  BREAKOUT_SQUEEZE_UP: (d) => `Bollinger squeeze (${d?.squeezeBars ?? 0} bars) — potential upside breakout`,
  BREAKOUT_SQUEEZE_DOWN: (d) => `Bollinger squeeze (${d?.squeezeBars ?? 0} bars) — potential downside breakout`,
  BREAKOUT_VOLUME_SURGE: (d) => `Volume surge (${d?.ratio ?? "—"}x) confirms breakout`,

  // v3.0 — On-Chain
  ONCHAIN_FUNDING_BULLISH: () => "Negative funding — bullish reversal signal",
  ONCHAIN_FUNDING_BEARISH: () => "Funding extremely high — liquidation risk",
  ONCHAIN_OI_TRENDING: () => "Open interest supports current trend",
  ONCHAIN_LS_EXTREME: () => "Long/short ratio at extreme — contrarian signal",

  // v3.0 — New gate
  REJECT_CORRELATION_OVERLAP: (d) =>
    `High correlation with ${d?.symbol ?? "another pair"} (${d?.correlation ?? "—"}) — position reduced`,
};

export function reasonEn(reason: Reason): string {
  const formatter = REASON_EN[reason.code];
  if (!formatter) return `Unrecognized condition (${reason.code})`;
  return formatter(reason.detail);
}

const REGIME_EN: Record<MarketRegime, string> = {
  trending_up: "Bullish Trend",
  trending_down: "Bearish Trend",
  ranging: "Ranging",
  volatile_expansion: "Volatile Expansion",
  quiet_compression: "Quiet Compression",
};

export function marketStatusEn(symbol: string, decision: Decision): string {
  const verdictMap = {
    enter: "🟢 Valid Setup Detected",
    wait: "🟡 Waiting / Observing",
    reject: "🔴 Rejected (No Setup)",
  };

  const score = Math.round(decision.confidence * 100);
  const tf = decision.timeframes[0];

  const lines = [
    `📊 Market Status — ${symbol}`,
    `━━━━━━━━━━━━━━━`,
    `Regime: ${REGIME_EN[decision.regime] ?? decision.regime}`,
    `Directional Score: ${score}/100`,
    `Current Price: ${fmtPrice(tf?.lastPrice ?? 0)}`,
    "",
    `Verdict: ${verdictMap[decision.verdict]}`,
  ];

  if (decision.verdict !== "enter" && decision.blockedBy) {
    lines.push(`Reason: ${reasonEn({ code: decision.blockedBy, detail: {}, score: 0 })}`);
  }

  if (decision.supporting.length > 0) {
    lines.push("", "✅ Supporting Factors:");
    decision.supporting.forEach((r) => lines.push(` • ${reasonEn(r)}`));
  }

  if (decision.objections.length > 0) {
    lines.push("", "⚠️ Objections:");
    decision.objections.forEach((r) => lines.push(` • ${reasonEn(r)}`));
  }

  return lines.join("\n");
}

export function noTradeEn(symbol: string, decision: Decision): string {
  return [
    `📭 No clear setup for ${symbol} currently.`,
    `Reason: ${decision.blockedBy ? reasonEn({ code: decision.blockedBy, detail: {}, score: 0 }) : "Confluence too low."}`,
  ].join("\n");
}

export function signalOpenedEn(args: { symbol: string; plan: TradePlan; decision: Decision }): string {
  const { symbol, plan, decision } = args;
  const dir = plan.direction === "long" ? "🟢 LONG" : "🔴 SHORT";
  
  return [
    `🚨 NEW SIGNAL 🚨`,
    `━━━━━━━━━━━━━━━`,
    `${dir} — ${symbol}`,
    "",
    `🎯 Entry: ${fmtPrice(plan.entry)}`,
    `🛑 Stop Loss: ${fmtPrice(plan.stopLoss)} (${fmtPct(plan.stopDistancePct)})`,
    `💰 Target 1: ${fmtPrice(plan.takeProfit1)} (+${plan.riskReward1}R)`,
    `🏆 Target 2: ${fmtPrice(plan.takeProfit2)} (+${plan.riskReward2}R)`,
    "",
    `⚖️ Recommended Risk: ${fmtPct(plan.riskPerTradePct)} per trade`,
    `📦 Max Position Size: ${fmtPct(plan.positionSizePct)} of portfolio`,
    "",
    `📝 Key Reasons:`,
    ...decision.supporting.slice(0, 3).map((r) => ` • ${reasonEn(r)}`),
  ].join("\n");
}

export function signalClosedEn(args: {
  symbol: string;
  direction: "long" | "short";
  entry: number;
  exit: number;
  pnlPct: number;
  rMultiple: number;
  outcome: "tp1" | "tp2" | "stop" | "breakeven";
  durationMinutes: number;
}): string {
  const { symbol, direction, entry, exit, pnlPct, rMultiple, outcome, durationMinutes } = args;
  const dir = direction === "long" ? "LONG" : "SHORT";
  
  let header = "";
  if (outcome === "tp2") header = "✅ Target 2 Hit (Full Profit)";
  else if (outcome === "tp1") header = "🔶 Target 1 Hit (Stop to Breakeven)";
  else if (outcome === "breakeven") header = "⚪ Trade closed at Breakeven";
  else header = "❌ Stop Loss Hit";

  return [
    `🔔 Trade Update — ${symbol} ${dir}`,
    `━━━━━━━━━━━━━━━`,
    header,
    "",
    `Entry: ${fmtPrice(entry)}`,
    `Exit: ${fmtPrice(exit)}`,
    `Move: ${fmtPct(pnlPct)}`,
    `Result: ${rMultiple > 0 ? "+" : ""}${rMultiple.toFixed(2)}R`,
    `Duration: ${Math.round(durationMinutes)} mins`,
  ].join("\n");
}

// v3.2: Locale system required exports
export function helpText(): string {
  return [
    "📖 Help",
    "━━━━━━━━━━━━━━━",
    "/status — Market status",
    "/analyze [pair] — Detailed analysis",
    "/trades — Open positions",
    "/performance — Performance summary",
    "/daily — Daily report",
    "/weekly — Weekly report",
    "/monthly — Monthly report",
    "/mysub — Subscription status",
    "/plans — Plans and pricing",
    "/settings — Alert preferences",
    "/support — Contact support",
    "/help — Show this menu",
  ].join("\n");
}

export function notSubscribedText(): string {
  return [
    "👋 Welcome",
    "━━━━━━━━━━━━━━━",
    "This bot is for subscribers only.",
    "To view plans: /plans",
    "For support: /support",
  ].join("\n");
}

export function subscriptionActiveText(plan: string, daysLeft: number, expiresAt: Date): string {
  return [
    "✅ Your subscription is active",
    "━━━━━━━━━━━━━━━",
    `Plan: ${plan}`,
    `Remaining: ${daysLeft} days`,
    `Expires: ${expiresAt.toISOString().slice(0, 10)}`,
  ].join("\n");
}

export function subscriptionExpiredText(): string {
  return [
    "🔒 Your subscription has expired",
    "━━━━━━━━━━━━━━━",
    "You can no longer receive signals.",
    "To renew: /renew",
    "Or contact support.",
  ].join("\n");
}

export function subscriptionExpiringText(daysLeft: number): string {
  return [
    "⏳ Your subscription is expiring soon",
    "━━━━━━━━━━━━━━━",
    `Only ${daysLeft} days remaining.`,
    "Renew now — /renew",
  ].join("\n");
}

export function performanceReportEn(s: any): string {
  return [
    `📊 Performance Report — ${s.periodLabel}`,
    "━━━━━━━━━━━━━━━",
    `Signals: ${s.totalSignals}`,
    `Wins: ${s.wins}`,
    `Losses: ${s.losses}`,
    `Open: ${s.open}`,
    "",
    `Win Rate: ${s.winRatePct.toFixed(1)}%`,
    `Avg Return: ${s.avgRMultiple >= 0 ? "+" : ""}${s.avgRMultiple.toFixed(2)}R`,
    `Net: ${s.totalR >= 0 ? "+" : ""}${s.totalR.toFixed(2)}R`,
  ].join("\n");
}
