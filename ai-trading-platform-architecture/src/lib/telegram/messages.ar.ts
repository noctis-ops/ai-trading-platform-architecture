// ---------------------------------------------------------------------------
// Arabic presentation layer.
//
// ARCHITECTURAL RULE: this is the ONLY place Arabic user-facing copy lives.
// The intelligence core, database, and API speak machine codes; everything the
// customer reads is rendered here. That keeps the engine testable in English
// terms while giving the product a fully Arabic surface, and means adding a
// second language later is one new file, not a rewrite.
// ---------------------------------------------------------------------------
import type { Decision, MarketRegime, Reason, ReasonCode, TradePlan } from "../intelligence/types";

// ---------------------------------------------------------------------------
// Number & price formatting (Western digits — traders read prices this way)
// ---------------------------------------------------------------------------
export function fmtPrice(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const dp = v >= 1000 ? 2 : v >= 1 ? 4 : 6;
  return v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fmtPct(v: number, dp = 2): string {
  if (!Number.isFinite(v)) return "—";
  return `${v >= 0 ? "" : "-"}${Math.abs(v).toFixed(dp)}%`;
}

// ---------------------------------------------------------------------------
// Reason codes -> Arabic sentences
// ---------------------------------------------------------------------------
type Detail = Record<string, number | string> | undefined;

const REASON_AR: Record<ReasonCode, (d: Detail) => string> = {
  TREND_UP_ALIGNED: () => "الاتجاه العام صاعد ومتوافق على المتوسطات",
  TREND_DOWN_ALIGNED: () => "الاتجاه العام هابط ومتوافق على المتوسطات",
  TREND_FLAT: () => "لا يوجد اتجاه واضح حالياً",
  TREND_CONFLICT: () => "تضارب في قراءة الاتجاه بين المتوسطات",

  STRUCTURE_BOS_UP: (d) => `كسر هيكلي صاعد فوق مستوى ${d?.level ? fmtPrice(Number(d.level)) : "القمة السابقة"}`,
  STRUCTURE_BOS_DOWN: (d) => `كسر هيكلي هابط تحت مستوى ${d?.level ? fmtPrice(Number(d.level)) : "القاع السابق"}`,
  STRUCTURE_CHOCH_UP: () => "تغيّر في طبيعة السوق لصالح المشترين",
  STRUCTURE_CHOCH_DOWN: () => "تغيّر في طبيعة السوق لصالح البائعين",
  STRUCTURE_RANGE: () => "السوق يتحرك في نطاق عرضي بدون هيكل واضح",

  AT_DEMAND_ZONE: (d) => `السعر عند منطقة طلب قوية (${d?.touches ?? 0} لمسات سابقة)`,
  AT_SUPPLY_ZONE: (d) => `السعر عند منطقة عرض قوية (${d?.touches ?? 0} لمسات سابقة)`,
  AT_SUPPORT: (d) => `السعر يرتد من دعم مؤكد (${d?.touches ?? 0} لمسات)`,
  AT_RESISTANCE: (d) => `السعر يصطدم بمقاومة مؤكدة (${d?.touches ?? 0} لمسات)`,
  MID_RANGE_NO_EDGE: () => "السعر في منتصف النطاق بلا أفضلية واضحة",

  MOMENTUM_BULLISH: (d) => `الزخم إيجابي${d?.rsi ? ` (RSI ${d.rsi})` : ""}`,
  MOMENTUM_BEARISH: (d) => `الزخم سلبي${d?.rsi ? ` (RSI ${d.rsi})` : ""}`,
  MOMENTUM_DIVERGENCE_BULL: () => "دايفرجنس إيجابي بين السعر والزخم",
  MOMENTUM_DIVERGENCE_BEAR: () => "دايفرجنس سلبي بين السعر والزخم",
  MOMENTUM_EXHAUSTED: (d) => `الزخم مُتشبع وقد يحتاج لتصحيح${d?.rsi ? ` (RSI ${d.rsi})` : ""}`,

  VOLUME_CONFIRMS: (d) => `الحجم يدعم الحركة (${d?.ratio ?? "—"}× المتوسط)`,
  VOLUME_WEAK: (d) => `الحجم ضعيف ولا يدعم الحركة (${d?.ratio ?? "—"}× المتوسط)`,
  LIQUIDITY_SWEEP_LOW: (d) => `اصطياد سيولة أسفل ${d?.level ? fmtPrice(Number(d.level)) : "القاع"} ثم ارتداد`,
  LIQUIDITY_SWEEP_HIGH: (d) => `اصطياد سيولة أعلى ${d?.level ? fmtPrice(Number(d.level)) : "القمة"} ثم انعكاس`,
  LIQUIDITY_THIN: () => "السيولة ضعيفة والحركة قد تكون غير موثوقة",

  VOLATILITY_NORMAL: (d) => `التقلب ضمن المعدل الطبيعي (${d?.atrPct ?? "—"}%)`,
  VOLATILITY_EXPANDING: (d) => `توسّع في التقلب (${d?.expansion ?? "—"}× المعتاد)`,
  VOLATILITY_EXTREME: (d) => `تقلب مرتفع جداً (${d?.atrPct ?? "—"}%) — المخاطرة غير محسوبة`,
  VOLATILITY_DEAD: (d) => `السوق هامد وحركته ضعيفة جداً (${d?.atrPct ?? "—"}%)`,

  PA_BULLISH_ENGULFING: () => "شمعة ابتلاع شرائية",
  PA_BEARISH_ENGULFING: () => "شمعة ابتلاع بيعية",
  PA_REJECTION_WICK_UP: () => "ذيل علوي طويل يدل على رفض السعر",
  PA_REJECTION_WICK_DOWN: () => "ذيل سفلي طويل يدل على امتصاص البيع",
  PA_INDECISION: () => "شمعة تردد بدون اتجاه",

  MTF_ALIGNED: (d) => `توافق كامل على ${d?.count ?? ""} أطر زمنية`,
  MTF_PARTIAL: (d) => `توافق جزئي (${d?.aligned ?? 0} من ${d?.total ?? 0} أطر)`,
  MTF_CONFLICT: () => "تعارض بين الأطر الزمنية",

  REJECT_LOW_CONFLUENCE: (d) => `قوة الإشارة ${d?.confluence ?? 0}% أقل من الحد المطلوب ${d?.required ?? 0}%`,
  REJECT_MTF_CONFLICT: () => "الأطر الزمنية متعارضة — الانتظار أفضل من الدخول",
  REJECT_POOR_RR: (d) => `نسبة العائد للمخاطرة ${d?.rr ?? 0} أقل من الحد ${d?.required ?? 0}`,
  REJECT_EXTREME_VOLATILITY: (d) => `تقلب حاد (${d?.atrPct ?? 0}%) يتجاوز الحد الآمن ${d?.max ?? 0}%`,
  REJECT_DEAD_MARKET: () => "السوق بلا حركة كافية لتغطية تكاليف الصفقة",
  REJECT_NO_STRUCTURE_EDGE: () => "لا توجد أفضلية هيكلية عند السعر الحالي",
  REJECT_NEWS_WINDOW: () => "هناك حدث اقتصادي مؤثر قريب — تم تعليق الإشارات",
  REJECT_LOW_PROBABILITY: (d) => `احتمالية النجاح ${d?.probability ?? 0}% أقل من الحد ${d?.required ?? 0}%`,
  REJECT_INSUFFICIENT_DATA: () => "البيانات التاريخية غير كافية لتحليل موثوق",
  REJECT_COOLDOWN: () => "فترة تهدئة بعد الإشارة السابقة على نفس العملة",
  REJECT_DAILY_LIMIT: (d) => `تم بلوغ الحد اليومي للإشارات (${d?.max ?? 0})`,
  REJECT_EXPOSURE_LIMIT: () => "توجد صفقة مفتوحة على نفس العملة",
  WAIT_BETTER_PRICE: (d) =>
    d?.stopAtrMultiple
      ? `السعر ابتعد كثيراً عن مستوى الإبطال (${d.stopAtrMultiple}× ATR) — ننتظر ارتداداً لدخول أفضل`
      : "في انتظار سعر أفضل للدخول",

  // v3.0 — Order Flow
  VWAP_BULLISH: () => "السعر فوق VWAP — ضغط شرائي مؤسسي",
  VWAP_BEARISH: () => "السعر تحت VWAP — ضغط بيعي مؤسسي",
  VWAP_CROSSOVER_UP: () => "اختراق السعر لـ VWAP للأعلى",
  VWAP_CROSSOVER_DOWN: () => "كسر السعر لـ VWAP للأسفل",
  VP_POC_SUPPORT: (d) => `نقطة التحكم (POC) عند ${d?.poc ?? "—"} تعمل كدعم`,
  VP_POC_RESISTANCE: (d) => `نقطة التحكم (POC) عند ${d?.poc ?? "—"} تعمل كمقاومة`,
  VP_VALUE_AREA_BREAKOUT: () => "اختراق منطقة القيمة — حركة مدعومة بحجم",
  CVD_BULLISH: () => "تراكم دلتا الحجم إيجابي — شراء متراكم",
  CVD_BEARISH: () => "تراكم دلتا الحجم سلبي — بيع متراكم",
  CVD_DIVERGENCE_BEAR: () => "دايفرجنس في دلتا الحجم — توزيع خفي",

  // v3.0 — Reversal
  REVERSAL_HAMMER: () => "شمعة مطرقة ارتدادية — رفض واضح للهبوط",
  REVERSAL_SHOOTING_STAR: () => "شمعة نجمة هابطة — رفض واضح للصعود",
  REVERSAL_DIVERGENCE_BULL: () => "دايفرجنس إيجابي — ارتداد محتمل",
  REVERSAL_DIVERGENCE_BEAR: () => "دايفرجنس سلبي — انعكاس محتمل",
  REVERSAL_OVERSOLD: (d) => `تشبع بيعي (RSI ${d?.rsi ?? "—"}) — ارتداد متوقع`,
  REVERSAL_OVERBOUGHT: (d) => `تشبع شرائي (RSI ${d?.rsi ?? "—"}) — تصحيح متوقع`,

  // v3.0 — Breakout
  BREAKOUT_SQUEEZE_UP: (d) => `انضغاط بولينجر (${d?.squeezeBars ?? 0} شمعة) — اختراق صاعد محتمل`,
  BREAKOUT_SQUEEZE_DOWN: (d) => `انضغاط بولينجر (${d?.squeezeBars ?? 0} شمعة) — انهيار هابط محتمل`,
  BREAKOUT_VOLUME_SURGE: (d) => `ارتفاع حاد في الحجم (${d?.ratio ?? "—"}×) يؤكد الاختراق`,

  // v3.0 — On-Chain
  ONCHAIN_FUNDING_BULLISH: () => "التمويل سالب — إشارة ارتداد إيجابية",
  ONCHAIN_FUNDING_BEARISH: () => "التمويل مرتفع جداً — خطر تصفية",
  ONCHAIN_OI_TRENDING: () => "العقود المفتوحة تدعم الاتجاه الحالي",
  ONCHAIN_LS_EXTREME: () => "نسبة الشراء/البيع في تطرف — إشارة عكسية",

  // v3.0 — New gate
  REJECT_CORRELATION_OVERLAP: (d) =>
    `ارتباط عالي مع ${d?.symbol ?? "عملة أخرى"} (${d?.correlation ?? "—"}) — تم تقليل الحجم`,
};

export function reasonAr(reason: Reason): string {
  const fn = REASON_AR[reason.code];
  return fn ? fn(reason.detail) : reason.code;
}

const REGIME_AR: Record<MarketRegime, string> = {
  trending_up: "اتجاه صاعد",
  trending_down: "اتجاه هابط",
  ranging: "نطاق عرضي",
  volatile_expansion: "تقلب متوسّع",
  quiet_compression: "انكماش وهدوء",
};

export const regimeAr = (r: MarketRegime): string => REGIME_AR[r];

const DIRECTION_AR = { long: "شراء", short: "بيع" } as const;
export const directionAr = (d: "long" | "short"): string => DIRECTION_AR[d];

/**
 * Confidence bucket wording.
 *
 * Buckets are anchored to the engine's actual entry threshold (52), NOT to a
 * generic 0-100 feel. Anything published as a signal has already cleared the
 * gate, so it must never be labelled "منخفضة" — telling a paying customer his
 * signal is low-confidence while still sending it destroys trust in the
 * product. Sub-threshold scores only ever appear in /الحالة readouts.
 */
export function confidenceLabelAr(confidence: number): string {
  if (confidence >= 78) return "عالية جداً";
  if (confidence >= 66) return "عالية";
  if (confidence >= 52) return "جيدة";
  return "غير كافية";
}

// ---------------------------------------------------------------------------
// Message templates
// ---------------------------------------------------------------------------
const SEP = "━━━━━━━━━━━━━━━";

/** New signal / trade opened. */
export function signalOpenedAr(params: {
  symbol: string;
  plan: TradePlan;
  decision: Decision;
  maxReasons?: number;
}): string {
  const { symbol, plan, decision } = params;
  const dir = directionAr(plan.direction);
  const icon = plan.direction === "long" ? "🟢" : "🔴";
  const reasons = decision.supporting
    .slice(0, params.maxReasons ?? 4)
    .map((r, i) => `${i + 1}. ${reasonAr(r)}`)
    .join("\n");

  return [
    `${icon} تم فتح صفقة ${dir} على ${symbol}`,
    SEP,
    `📥 سعر الدخول: ${fmtPrice(plan.entry)}`,
    `🎯 الهدف الأول: ${fmtPrice(plan.takeProfit1)}  (${plan.riskReward1}R)`,
    `🎯 الهدف الثاني: ${fmtPrice(plan.takeProfit2)}  (${plan.riskReward2}R)`,
    `🛑 وقف الخسارة: ${fmtPrice(plan.stopLoss)}  (${fmtPct(plan.stopDistancePct)})`,
    SEP,
    `⚖️ نسبة المخاطرة: ${fmtPct(plan.riskPerTradePct)} من رأس المال`,
    `📊 حجم المركز المقترح: ${fmtPct(plan.positionSizePct, 1)} من المحفظة`,
    `🎚️ نسبة الثقة: ${decision.confidence}% (${confidenceLabelAr(decision.confidence)})`,
    `🌡️ حالة السوق: ${regimeAr(decision.regime)}`,
    SEP,
    "🧠 سبب الدخول:",
    reasons || "—",
    SEP,
    "⚠️ هذه إشارة تحليلية وليست نصيحة استثمارية. القرار النهائي والمسؤولية عليك.",
  ].join("\n");
}

/** Position closed — profit, loss, or breakeven. */
export function signalClosedAr(params: {
  symbol: string;
  direction: "long" | "short";
  entry: number;
  exit: number;
  pnlPct: number;
  rMultiple: number;
  outcome: "tp1" | "tp2" | "stop" | "manual" | "breakeven";
  durationMinutes: number;
}): string {
  const { symbol, direction, entry, exit, pnlPct, rMultiple, outcome, durationMinutes } = params;
  const win = pnlPct > 0;
  const icon = outcome === "stop" ? "🛑" : win ? "✅" : "⚪";
  const title =
    outcome === "tp1"
      ? "تحقق الهدف الأول"
      : outcome === "tp2"
        ? "تحقق الهدف الثاني"
        : outcome === "stop"
          ? "تم ضرب وقف الخسارة"
          : outcome === "breakeven"
            ? "إغلاق عند نقطة التعادل"
            : "إغلاق يدوي للصفقة";

  const hours = Math.floor(durationMinutes / 60);
  const mins = Math.round(durationMinutes % 60);
  const duration = hours > 0 ? `${hours} ساعة و ${mins} دقيقة` : `${mins} دقيقة`;

  return [
    `${icon} ${title} — ${symbol} (${directionAr(direction)})`,
    SEP,
    `📥 الدخول: ${fmtPrice(entry)}`,
    `📤 الخروج: ${fmtPrice(exit)}`,
    `${win ? "📈" : "📉"} النتيجة: ${fmtPct(pnlPct)}  (${rMultiple >= 0 ? "+" : ""}${rMultiple.toFixed(2)}R)`,
    `⏱️ مدة الصفقة: ${duration}`,
    SEP,
    win
      ? "تمت إدارة الصفقة حسب الخطة. الاستمرارية أهم من الصفقة الواحدة."
      : "الخسارة كانت ضمن حدود المخاطرة المحددة مسبقاً — حماية رأس المال أولاً.",
  ].join("\n");
}

/** "Why no trade?" — the brain explaining its patience. */
export function noTradeAr(symbol: string, decision: Decision): string {
  const blocked = decision.objections[0];
  const detail = decision.objections
    .slice(1, 4)
    .map((r) => `• ${reasonAr(r)}`)
    .join("\n");

  return [
    `⏸️ لا توجد فرصة مناسبة على ${symbol}`,
    SEP,
    `السبب الرئيسي: ${blocked ? reasonAr(blocked) : "المعايير غير مكتملة"}`,
    detail ? `\nملاحظات إضافية:\n${detail}` : "",
    SEP,
    `🌡️ حالة السوق: ${regimeAr(decision.regime)}`,
    `🎚️ قوة الإشارة الحالية: ${decision.confidence}%`,
    "",
    "الانتظار قرار تداولي بحد ذاته. لا ندخل صفقة بدون سبب قوي.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Market status summary for a symbol. */
export function marketStatusAr(symbol: string, decision: Decision): string {
  const lines = decision.timeframes.map((tf) => {
    const biasAr = tf.bias === "long" ? "صاعد" : tf.bias === "short" ? "هابط" : "محايد";
    const icon = tf.bias === "long" ? "🟢" : tf.bias === "short" ? "🔴" : "⚪";
    return `${icon} ${tf.timeframe}: ${biasAr} (${Math.round(Math.abs(tf.score) * 100)}%)`;
  });

  return [
    `🌡️ حالة السوق — ${symbol}`,
    SEP,
    `السعر الحالي: ${fmtPrice(decision.timeframes[0]?.lastPrice ?? 0)}`,
    `النظام السوقي: ${regimeAr(decision.regime)}`,
    SEP,
    "قراءة الأطر الزمنية:",
    ...lines,
    SEP,
    decision.verdict === "enter"
      ? `✅ يوجد إعداد صالح للدخول (ثقة ${decision.confidence}%)`
      : `⏸️ لا يوجد إعداد صالح حالياً — ${decision.objections[0] ? reasonAr(decision.objections[0]) : ""}`,
  ].join("\n");
}

export type PerformanceSummary = {
  periodLabel: string;
  totalSignals: number;
  wins: number;
  losses: number;
  open: number;
  winRatePct: number;
  avgRMultiple: number;
  totalR: number;
  bestSymbol?: string;
  worstSymbol?: string;
};

/** Daily / weekly / monthly report. */
export function performanceReportAr(s: PerformanceSummary): string {
  return [
    `📊 تقرير الأداء — ${s.periodLabel}`,
    SEP,
    `عدد الإشارات: ${s.totalSignals}`,
    `الصفقات الرابحة: ${s.wins}`,
    `الصفقات الخاسرة: ${s.losses}`,
    `الصفقات المفتوحة: ${s.open}`,
    SEP,
    `نسبة النجاح: ${s.winRatePct.toFixed(1)}%`,
    `متوسط العائد لكل صفقة: ${s.avgRMultiple >= 0 ? "+" : ""}${s.avgRMultiple.toFixed(2)}R`,
    `صافي النتيجة: ${s.totalR >= 0 ? "+" : ""}${s.totalR.toFixed(2)}R`,
    s.bestSymbol ? `\n🏆 أفضل أداء: ${s.bestSymbol}` : "",
    s.worstSymbol ? `⚠️ أضعف أداء: ${s.worstSymbol}` : "",
    SEP,
    "R = مضاعف المخاطرة. صفقة بـ +2R تعني ربح ضعف ما خاطرت به.",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Subscription & access messages
// ---------------------------------------------------------------------------
export function subscriptionExpiredAr(): string {
  return [
    "🔒 انتهى اشتراكك",
    SEP,
    "لم يعد بإمكانك استقبال الإشارات أو استخدام أوامر التحليل.",
    "للتجديد أرسل الأمر: /تجديد",
    "أو تواصل مع الدعم لإتمام التفعيل.",
  ].join("\n");
}

export function subscriptionActiveAr(plan: string, daysLeft: number, expiresAt: Date): string {
  return [
    "✅ اشتراكك فعّال",
    SEP,
    `الخطة: ${plan}`,
    `المتبقي: ${daysLeft} يوم`,
    `تاريخ الانتهاء: ${expiresAt.toISOString().slice(0, 10)}`,
  ].join("\n");
}

export function subscriptionExpiringSoonAr(daysLeft: number): string {
  return [
    "⏳ تنبيه: اشتراكك يقارب على الانتهاء",
    SEP,
    `المتبقي: ${daysLeft} يوم فقط.`,
    "جدّد الآن حتى لا تنقطع عنك الإشارات — أرسل /تجديد",
  ].join("\n");
}

export function notSubscribedAr(): string {
  return [
    "👋 أهلاً بك",
    SEP,
    "هذا البوت خاص بالمشتركين فقط.",
    "لعرض الخطط المتاحة أرسل: /الخطط",
    "وللتواصل مع الدعم أرسل: /الدعم",
  ].join("\n");
}

export function helpAr(): string {
  return [
    "📖 قائمة الأوامر",
    SEP,
    "/الحالة — حالة السوق الحالية",
    "/تحليل [العملة] — تحليل مفصل لعملة",
    "/الصفقات — الصفقات المفتوحة",
    "/الأداء — ملخص الأداء",
    "/تقرير_يومي — تقرير اليوم",
    "/تقرير_أسبوعي — تقرير الأسبوع",
    "/تقرير_شهري — تقرير الشهر",
    "/اشتراكي — حالة اشتراكك",
    "/الخطط — الخطط والأسعار",
    "/الإعدادات — تفضيلات التنبيهات",
    "/الدعم — التواصل مع الدعم",
    "/مساعدة — عرض هذه القائمة",
  ].join("\n");
}
