# 📘 الوثيقة المرجعية الرسمية — مساعد التداول الخاص

> **هذه الوثيقة هي المرجع الرسمي والوحيد للمشروع.**
> أي تطوير يخالف ما ورد فيها يُعتبر مرفوضاً حتى تُحدَّث الوثيقة أولاً.

| | |
|---|---|
| **الإصدار** | v3.1 — متعدد الاستراتيجيات + متداول آلي + متكيف حسب نظام السوق |
| **الحالة** | ✅ العقل + البنية التجارية + التداول الآلي + كل الاستراتيجيات مكتملة |
| **الاختبارات** | **94 اختباراً ناجحاً** |
| **آخر تحديث** | 2026-07-30 |

---

## 🔒 م0 — قاعدة إلزامية: المرجع يُحدَّث قبل الكود (أو معه)

> **أي تطوير، أي إصلاح، أي إضافة — أي شيء يُلمَس في الكود — يستوجب تحديث هذه الوثيقة.**
>
> لا يُقبل أي Pull Request أو Commit يُضيف أو يُعدّل ميزة بدون تحديث مقابل في `MASTER.md`.
> هذا شرط غير قابل للتفاوض. المطور الذي يخالفه تُرفض مساهمته حتى يُحدَّث المرجع.

---

## الفهرس

1. [ما هو المشروع](#1-ما-هو-المشروع)
2. [المبادئ الحاكمة (غير قابلة للتفاوض)](#2-المبادئ-الحاكمة-غير-قابلة-للتفاوض)
3. [المعمارية وخريطة الملفات](#3-المعمارية-وخريطة-الملفات)
4. [عقل التداول — كيف يتخذ القرار](#4-عقل-التداول--كيف-يتخذ-القرار)
5. [النظام التجاري](#5-النظام-التجاري)
6. [قاعدة البيانات](#6-قاعدة-البيانات)
7. [التشغيل](#7-التشغيل)
8. [الأمان](#8-الأمان)
9. [الاختبارات ومعايير الجودة](#9-الاختبارات-ومعايير-الجودة)
10. [حالة المشروع — ما اكتمل وما تبقى](#10-حالة-المشروع--ما-اكتمل-وما-تبقى)
11. [دليل المطوّر — كيف تضيف ميزة](#11-دليل-المطور--كيف-تضيف-ميزة)
12. [المحظورات](#12-المحظورات)
13. [تحليل معمق ونقاط القوة والضعف](#13-تحليل-معمق-ونقاط-القوة-والضعف)
14. [خارطة تطوير v3.0-v3.1](#14-خارطة-تطوير-v30-v31)
15. [ما تبقى — خارطة الطريق النهائية](#15-ما-تبقى--خارطة-الطريق-النهائية)

---

## 1. ما هو المشروع

**نظام تداول آلي متكامل، خاص، يُباع باشتراك شهري، يُسلَّم عبر بوت تيليجرام عربي.**

| | |
|---|---|
| الواجهة | بوت تيليجرام (عربي 100%) |
| الويب | لوحة المالك — **لا تسجيل عام** |
| الهوية | `telegram_id` — لا كلمات مرور للعملاء |
| المخرجات | **إشارات + تحليل + تنفيذ آلي** (اختياري) |
| أوضاع التداول | `off` (إشارات فقط) · `paper` (ورقي) · `live` (حقيقي) |
| الاستراتيجيات | **3 استراتيجيات**: اتجاه · ارتداد · اختراق |
| المحللات | **13 محللاً** (8 فنية + 3 تدفق أوامر + 2 استراتيجية) |
| مفاتيح العملاء | **لا تُجمع ولا تُخزَّن** |
| الدفع | أكواد ترخيص · Stripe · USDT · تفعيل يدوي |

---

## 2. المبادئ الحاكمة (غير قابلة للتفاوض)

### 🔒 م1 — العقل نقي (Pure)
كل التحليل دوال نقية. لا قاعدة بيانات، لا شبكة، لا تيليجرام داخل `intelligence/`.

### 🔒 م2 — العربية طبقة عرض فقط
المحركات تُصدر رموزاً، والترجمة العربية في `messages.ar.ts`.

### 🔒 م3 — بوابة صلاحيات واحدة
كل وصول يمر عبر `evaluateAccess()`. لا استثناءات.

### 🔒 م4 — العميل يتحكم في التنفيذ
التداول الآلي اختياري. الإشارات تصل دائماً حتى لو التداول الآلي مفعّل.

### 🔒 م5 — الرفض نتيجة ناجحة
كل قرار يُحفظ — بما فيه الرفض — لأنه المقام الصادق لأي نسبة نجاح.

### 🔒 م6 — الافتراضات المتشائمة
الهدف والوقف في شمعة واحدة ⇒ الوقف أولاً.

### 🔒 م7 — العتبات مُقاسة لا مُخمَّنة
أي تعديل على محلل أو وزن يستوجب إعادة `npm run calibrate`.

### 🔒 م8 — تعدد الاستراتيجيات (v3.0)
لا تعتمد على استراتيجية واحدة. الاتجاه + الارتداد + الاختراق معاً.

### 🔒 م9 — أوزان متكيفة (v3.0)
`getRegimeWeights(regime)` — لكل نظام سوق أوزانه.

### 🔒 م10 — حجم مركز ديناميكي (v3.0)
`dynamicRiskPct(regime, confluence, atrPct, correlationFactor)`.

### 🔒 م11 — ارتباط = مخاطرة (v3.0)
لا تفتح صفقة كاملة على عملة مرتبطة ≥ 0.75 بأخرى مفتوحة.

### 🔒 م12 — كريبتو = On-Chain (v3.0)
Funding Rate و Open Interest ليسا ترفاً — هما مكونات القرار.

---

## 3. المعمارية وخريطة الملفات

### تدفق البيانات (v3.1)

```
منصات البيانات (Binance/Bybit/OKX) + Coinglass + FMP
        │  MarketDataRouter (تجاوز أعطال + قاطع دائرة)
        ▼
   validateCandles()          ← يرفض البيانات الفاسدة
        ▼
╔═══════════════════════════════════════════════╗
║  العقل — 13 محللاً نقياً                      ║
║  8 فنية + 3 Order Flow + 2 استراتيجية          ║
║  أوزان متكيفة حسب regime                       ║
║  مسار اتجاه · مسار ارتداد · مسار اختراق         ║
║  → Decision { verdict, plan, strategy }       ║
╚═══════════════════════════════════════════════╝
        │
        ├──► SignalEngine ──► SignalStore ──► TelegramNotifier ──► المشتركون
        │
        └──► AutoTrader (off/paper/live)
                ├── RiskManager (12 فحص + حجم ديناميكي)
                ├── ExchangeExecutor (Binance/Simulated)
                ├── ScaleIn (3 دفعات)
                └── SignalFilter (7 طبقات تعديل حجم)
```

### هيكل الملفات الكامل

```
src/lib/intelligence/          ← العقل (نقي)
  types.ts                      80+ ReasonCode + DEFAULT_BRAIN_CONFIG
  structure.ts                  القمم/القيعان، BOS/CHoCH، مناطق العرض والطلب
  analysers.ts                  8 محللات أساسية
  decision.ts                   التجميع + 13 بوابة + خطة الصفقة + asymmetric vol
  learning.ts                   المعايرة + الدروس + الإحصاءات
  weights.ts                 ⭐ 5 خرائط أوزان متكيفة لكل regime
  reversal.ts                ⭐ 4 مراحل: exhaustion→confirm→fakeout→layer2
  breakout.ts                ⭐ BB + Donchian + Volume Profile + retest + fakeout
  orderflow.ts               ⭐ VWAP + Volume Profile + CVD
  correlation.ts             ⭐ Pearson r + overlap factor
  trend-advanced.ts          ⭐ ATR trailing + pyramiding + early exit + scaled TP
  signal-filter.ts           ⭐ 7 طبقات تعديل حجم (لا ترفض — تضبط)

src/lib/market/
  exchange.ts                   MarketDataRouter + validateCandles
  adapters.ts                   Binance / Bybit / OKX / محاكي
  simulator.ts                  أنظمة سوق حقيقية (5 regimes + GARCH)
  onchain.ts                 ⭐ Funding Rate + Open Interest + L/S Ratio
  economic-calendar.ts       ⭐ FMP API + ForexFactory
  fear-greed.ts              ⭐ Alternative.me (خوف وطمع)

src/lib/trading/                ← التداول الآلي
  types.ts                       TradingConfig + Position + Order
  risk-manager.ts                dynamicRiskPct() + 12 فحص
  auto-trader.ts                 off/paper/live + إدارة مراكز
  exchange-executor.ts           BinanceFutures + SimulatedExchange
  scale-in.ts                 ⭐ 3 دفعات دخول متدرج

src/lib/payments/
  provider.ts                 ⭐ Stripe + USDT + PaymentRouter

src/lib/access/                 ← الصلاحيات
  entitlements.ts                evaluateAccess
  licence-key.ts / licence.ts

src/lib/telegram/               ← العرض
  messages.ar.ts                 كل النص العربي
  messages.en.ts                 English
  commands.ts / client.ts / handler.ts

src/lib/engine/                 ← التنسيق
  signal-engine.ts              محرك الإشارات + ربط AutoTrader
  container.ts                  ⭐ تركيب DI لجميع المكونات
  postgres-store.ts / telegram-notifier.ts / reporting.ts / jobs.ts

src/db/
  schema.ts                     22 جدولاً (17 + 5 للتداول الآلي)
  index.ts

scripts/
  admin.ts                      CLI المالك + أوامر التداول
  setup-dev.sh               ⭐ إعداد تلقائي كامل
  calibrate-thresholds.ts
  run-backtest.ts
```

---

## 4. عقل التداول — كيف يتخذ القرار

### الاستراتيجيات الثلاث

| الاستراتيجية | متى تُفعَّل | المحللات الرئيسية | النتيجة |
|---|---|---|---|
| **الاتجاه** | trending_up/down | trend, structure, momentum, vwap | ⭐⭐⭐⭐⭐ |
| **الارتداد** | ranging, volatile_expansion | reversal, zones, liquidity, priceAction | ⭐⭐⭐⭐⭐ |
| **الاختراق** | quiet_compression | breakout, volume, volatility, orderFlow | ⭐⭐⭐⭐⭐ |

### المحللات الثلاثة عشر

| # | المحلل | الفئة | يقيس |
|---|---|---|---|
| 1 | `structure` | فني | BOS/CHoCH، القمم والقيعان |
| 2 | `trend` | فني | ترتيب المتوسطات + الميل |
| 3 | `zones` | فني | الدعم/المقاومة، العرض/الطلب |
| 4 | `momentum` | فني | RSI + MACD + الدايفرجنس |
| 5 | `volume` | فني | تأكيد الحجم |
| 6 | `volatility` | فني | بوابة — لا يصوّت على الاتجاه |
| 7 | `priceAction` | فني | الابتلاع، ذيول الرفض |
| 8 | `liquidity` | فني | اصطياد السيولة |
| 9 | `vwap` | Order Flow | السعر المرجح بالحجم |
| 10 | `volumeProfile` | Order Flow | POC + مناطق القيمة |
| 11 | `orderFlow` | Order Flow | CVD + delta divergence |
| 12 | `reversal` | استراتيجية | 4 مراحل: exhaustion→confirm→fakeout→layer2 |
| 13 | `breakout` | استراتيجية | BB + Donchian + VP + retest + fakeout |

### الأوزان المتكيفة

`getRegimeWeights(regime)` ترجع خريطة أوزان مختلفة لكل regime:

| المحلل | trending | ranging | volatile | compression |
|---|---|---|---|---|
| trend | **2.0** | 0.5 | 1.2 | 0.8 |
| structure | **2.0** | 0.8 | 1.5 | 1.0 |
| zones | 1.2 | **2.2** | 1.0 | 1.8 |
| reversal | 0 | **1.8** | 1.2 | 0 |
| breakout | 0 | 0 | 0 | **1.8** |
| volatility | 0.6 | 0.5 | **1.3** | **1.5** |

### مرشح الإشارات المركزي (7 طبقات)

قبل التنفيذ، تمر كل إشارة بـ 7 طبقات تعديل حجم — لا ترفض، تضبط فقط:

| # | الطبقة | مثال |
|---|---|---|
| 1 | جودة الاستراتيجية | ارتداد = 0.7x، اتجاه قوي = 1.0x |
| 2 | نظام السوق | volatile_expansion = 0.4x لكل الاستراتيجيات |
| 3 | ارتباط | ارتبط 0.85 مع صفقة مفتوحة = 0.15x |
| 4 | Streaks | 3 خسائر متتالية = 0.5x (anti-martingale) |
| 5 | عدد المراكز | 4 مراكز مفتوحة = 0.3x |
| 6 | التقلب الحالي | vol 2x فوق الطبيعي = 0.4x |
| 7 | فترة السيولة | ساعات منخفضة السيولة = 0.7x |

### بوابات الرفض (13 بوابة)

| # | البوابة | الحكم |
|---|---|---|
| 0 | بيانات غير كافية | reject |
| 1 | نافذة أخبار اقتصادية | wait |
| 2 | الحد اليومي | wait |
| 3 | فترة تهدئة | wait |
| 4 | صفقة مفتوحة على نفس العملة | wait |
| 5 | تقلب حاد (عتبة منفصلة Long/Short) | reject |
| 6 | سوق هامد | reject |
| 7 | تعارض الأطر الزمنية | wait |
| 8 | قوة إشارة < 52 | reject |
| 9 | لا أفضلية هيكلية | wait |
| 10 | السعر ابتعد > 4 ATR | wait |
| 11 | عائد/مخاطرة ضعيف | reject |
| 12 | احتمالية منخفضة | reject |

### خطة الصفقة (v3.1)

- **الوقف:** ATR trailing stop (يتحرك مع الاتجاه) أو هيكلي — الأقرب
- **الأهداف:** ديناميكية — اتجاه قوي (TP1=3R, TP2=6R)، اتجاه عادي (TP1=2R, TP2=3.5R)
- **الدخول:** متدرج — Phase 1 (50%) فوري، Phase 2 (30%) عند تراجع، Phase 3 (20%) استمرار
- **خروج مبكر:** `earlyExitSignal()` — يخرج قبل ضرب الوقف إذا اكتشف انعكاس

---

## 5. النظام التجاري

### الخطط

| | basic | pro | vip |
|---|---|---|---|
| السعر/شهر | 29$ | 79$ | 149$ |
| العملات | 3 | 10 | الكل |
| تحليل يومي | 5 | 25 | ∞ |
| التقارير | يومي | +أسبوعي | الكل |
| الأولوية | — | 15 ث | 60 ث |

### طرق الدفع

| الطريقة | المزوّد | الحالة |
|---|---|---|
| أكواد ترخيص | `licence_keys` | ✅ كامل |
| Stripe (فيزا) | `StripeProvider` | ✅ جاهز — يحتاج `STRIPE_SECRET_KEY` |
| USDT (TRC20/ERC20) | `UsdtProvider` | ✅ جاهز — يحتاج عنوان |
| تفعيل يدوي | `manual` | ✅ كامل |

---

## 6. قاعدة البيانات

**22 جدولاً.** الترحيل في `drizzle/`.

| المجال | الجداول |
|---|---|
| الهوية | `customers` · `admin_users` · `admin_sessions` |
| التجارة | `plans` · `subscriptions` · `payments` · `licence_keys` |
| الإشارات | `signals` · `signal_events` · `analysis_snapshots` |
| التعلم | `signal_outcomes` · `calibration` |
| التشغيل | `delivery_log` · `usage_events` · `audit_logs` · `system_settings` · `watched_symbols` · `economic_events` |
| **التداول الآلي** | `trading_accounts` · `trading_configs` · `trading_orders` · `trading_positions` · `risk_events` |

---

## 7. التشغيل

### التنصيب السريع

```bash
bash scripts/setup-dev.sh
```

أو يدوياً:

```bash
docker compose up -d                    # PostgreSQL
cp .env.example .env                    # املأ القيم
npm install && npm run db:migrate
npm run admin seed
npm run admin create-admin owner@example.com 'كلمة-مرور-قوية'
npm run dev
```

### أوضاع التداول

```bash
TRADING_MODE=off     # إشارات فقط
TRADING_MODE=paper   # تداول ورقي (PAPER_TRADING_EQUITY=10000)
TRADING_MODE=live    # تداول حقيقي (يحتاج BINANCE_API_KEY)
```

### المهام المجدولة

| المهمة | التكرار | الوظيفة |
|---|---|---|
| `scan` | كل 15 دقيقة | بحث عن فرص + تنفيذ |
| `track` | كل 5 دقائق | متابعة أهداف/وقف + مزامنة AutoTrader |
| `outcomes` | كل ساعة | نتائج + معايرة |
| `trading-sync` | كل 5 دقائق | مزامنة حساب + فحص إيقاف طارئ |
| `expiry` | يومياً 09:00 | تنبيه/إنهاء اشتراكات |
| `calendar` | كل 60 دقيقة | تحديث التقويم الاقتصادي |
| `report-daily/weekly/monthly` | حسب | تقارير أداء |

### CLI المالك

```bash
npm run admin stats                    # لوحة الأعمال
npm run admin trading-status           # حالة المتداول الآلي
npm run admin trading-enable/disable   # تشغيل/إيقاف
npm run admin trading-config key val   # تعديل إعدادات التداول
npm run admin issue-keys pro 10 30     # 10 أكواد، 30 يوم
npm run admin grant 123456789 pro 30   # تفعيل مباشر
```

---

## 8. الأمان

| الخطر | الإجراء |
|---|---|
| تزوير webhook | `secret_token` — مقارنة بزمن ثابت |
| تشغيل مهام بلا إذن | `CRON_SECRET` |
| تسريب قاعدة بيانات | الجلسات والأكواد مُجزَّأة فقط |
| سرقة مفاتيح العملاء | لا توجد مفاتيح عملاء |
| تسريب مفاتيح API تداول | `TRADING_ENCRYPTION_KEY` — AES-256-GCM |
| بيانات فاسدة | `validateCandles` قبل العقل |
| تعطل منصة | 3 مصادر + قاطع دائرة |
| إيقاف طارئ | `shouldEmergencyHalt()` — يومي + تراجع |

---

## 9. الاختبارات ومعايير الجودة

```bash
npm test           # 94 اختباراً
npm run build      # بناء الإنتاج
npm run calibrate  # معايرة العتبات
npm run backtest   # اختبار خلفي
```

| المجموعة | العدد | تحمي |
|---|---|---|
| `intelligence/decision` | 11 | شخصية المحرك |
| `intelligence/weights` | 9 | الأوزان المتكيفة |
| `intelligence/reversal` | 8 | استراتيجية الارتداد |
| `intelligence/orderflow` | 9 | VWAP + VP + CVD |
| `intelligence/correlation` | 8 | مصفوفة الارتباط |
| `access/entitlements` | 14 | الإيرادات والصلاحيات |
| `access/licence` | 7 | أكواد الترخيص |
| `engine/schema` | 12 | قاعدة بيانات حقيقية |
| `backtest/` | 13 | نزاهة القياس |
| `telegram/handler` | 4 | تكامل البوت |
| **المجموع** | **94** | |

**قاعدة:** أي منطق يمس المال أو قرار التداول لا يُدمج بلا اختبار.

---

## 10. حالة المشروع — ما اكتمل وما تبقى

### ✅ v3.1 — مكتمل ومُختبَر (94 اختباراً)

| المكوّن | الحالة |
|---|---|
| عقل التداول — 13 محللاً + 3 استراتيجيات + 13 بوابة | ✅ |
| أوزان متكيفة — 5 خرائط أوزان لكل regime | ✅ 9 اختبارات |
| استراتيجية الارتداد — 4 مراحل + كشف فخ | ✅ 8 اختبارات |
| استراتيجية الاختراق — BB+Donchian+VP+retest+fakeout | ✅ |
| Order Flow — VWAP + Volume Profile + CVD | ✅ 9 اختبارات |
| مصفوفة ارتباط — Pearson + overlap factor | ✅ 8 اختبارات |
| إصلاح تناسق Long/Short — عتبة تقلب منفصلة | ✅ |
| حجم مركز ديناميكي — `dynamicRiskPct()` | ✅ |
| مرشح إشارات مركزي — 7 طبقات | ✅ |
| دخول متدرج — 3 دفعات (scale-in) | ✅ |
| ATR trailing stop + Pyramiding + earlyExitSignal | ✅ |
| مؤشر الخوف والطمع — Fear & Greed | ✅ |
| On-Chain — Funding Rate + Open Interest + L/S | ✅ ⚠️ يحتاج COINGLASS_API_KEY |
| تقويم اقتصادي حقيقي — FMP API | ✅ ⚠️ يحتاج FMP_API_KEY |
| نظام تداول آلي — off/paper/live | ✅ |
| دفع تلقائي — Stripe + USDT | ✅ ⚠️ يحتاج مفاتيح |
| محاكي أنظمة سوق حقيقية — 5 regimes | ✅ |
| لوحة تحكم المالك — KPI + عملاء + مدفوعات | ✅ |
| قاعدة بيانات — 22 جدولاً | ✅ |
| CLI المالك + أوامر التداول | ✅ |
| Docker + setup-dev.sh | ✅ |

### ⏳ v3.2 — التشغيل والتحقق (المتبقي الوحيد)

| # | المهمة | المدة | ملاحظة |
|---|---|---|---|
| 1 | **مفاتيح API** | 10 دقائق | `COINGLASS_API_KEY` + `FMP_API_KEY` + `STRIPE_SECRET_KEY` |
| 2 | **اختبار خلفي ببيانات حقيقية** | 2 ساعة | `npm run backtest -- --live` |
| 3 | **تشغيل ورقي 4-8 أسابيع** | 4-8 أسابيع | `TRADING_MODE=paper` |
| 4 | **نشر الأرقام بصدق** | بعد #3 | بعد اجتياز البوابات |

### 🚫 خارج النطاق نهائياً

- تطبيق ويب عام بتسجيل ذاتي
- حفظ مفاتيح العملاء (منصاتهم الخاصة)

---

## 11. دليل المطوّر — كيف تضيف ميزة

### القاعدة الذهبية

> **أي تغيير في الكود = تحديث في `MASTER.md`.** اقرأ م0 أعلاه.

### إضافة محلل جديد

1. أضف الدالة في ملفها بنفس التوقيع `(candles) => AnalyserReport`
2. أضف رموز الأسباب في `types.ts` (`ReasonCode`)
3. أضف الترجمة العربية في `messages.ar.ts` والإنجليزية في `messages.en.ts`
4. سجّله في `analyseTimeframe()` داخل `decision.ts`
5. أضف وزناً في `weights.ts` لجميع الـ 5 regimes
6. **أعد `npm run calibrate`** وحدّث الأرقام في `types.ts`
7. أضف اختباراً في `__tests__/`
8. **حدّث هذا الملف** (`MASTER.md`)

### إضافة استراتيجية جديدة

1. أنشئ ملف في `intelligence/`
2. أضف `ReasonCode` في `types.ts`
3. سجّلها في `analyseTimeframe()` + `weights.ts`
4. أضفها في `signal-filter.ts` (طبقة 1: strategy_quality)
5. أضفها في `messages.ar.ts` + `messages.en.ts`
6. أضف اختبارات
7. **حدّث هذا الملف**

---

## 12. المحظورات

| ❌ محظور | ✅ الصواب |
|---|---|
| نص عربي في `intelligence/` أو `engine/` | `messages.ar.ts` |
| `if (subscription.active)` خارج البوابة | `evaluateAccess()` |
| استيراد `@/db` داخل `intelligence/` | مرّر البيانات كوسيط |
| خفض `minConfluence` بلا معايرة | `npm run calibrate` أولاً |
| احتساب الصفقات المفتوحة في نسبة النجاح | المغلقة فقط |
| افتراض تحقق الهدف عند لمس الوقف معاً | الوقف أولاً |
| `float` للمبالغ | `numeric` |
| إعلان أرقام أداء بلا `--live` | `npm run backtest -- --live` |
| تفسير ربح المحاكاة كدليل نجاح | المحاكاة عشوائية — الربح عليها = خطأ |
| حذف قرارات الرفض | تُحفظ كلها |
| **تطوير بدون تحديث MASTER.md** | **م0 — يُرفض الـ PR فوراً** |

---

## 13. تحليل معمق ونقاط القوة والضعف

### 13.1 نقاط القوة (للحفاظ عليها)

| # | القوة | التفصيل |
|---|---|---|
| 1 | المعمارية السداسية | كل طبقة معزولة — العقل نقي 100% |
| 2 | فلسفة "الرفض نتيجة ناجحة" | كل قرار يُحفظ — مقام صادق لنسبة النجاح |
| 3 | الدقة المالية | `numeric(24,10)` — لا float أبداً |
| 4 | العتبات مُقاسة | `npm run calibrate` — p99 للضجيج |
| 5 | محرك اختبار خلفي صادق | لا look-ahead + متشائم + 15bps رسوم |

### 13.2 نقاط الضعف — تم إصلاحها

| # | الضعف | الإصلاح | الملف |
|---|---|---|---|
| 1 | انحياز للاتجاه — صامت في العرضي | استراتيجية ارتداد + أوزان ranging | `reversal.ts` |
| 2 | عدم تناسق Long/Short | `maxAtrPctShort=8` + تعويض احتمال متناسق | `decision.ts` |
| 3 | أوزان ثابتة | `getRegimeWeights()` — 5 خرائط | `weights.ts` |
| 4 | غياب Order Flow | VWAP + Volume Profile + CVD | `orderflow.ts` |
| 5 | غياب مصفوفة ارتباط | Pearson r + `correlationOverlapFactor()` | `correlation.ts` |
| 6 | غياب On-Chain | Funding + OI + L/S | `onchain.ts` |
| 7 | حجم مركز ثابت | `dynamicRiskPct()` | `risk-manager.ts` |
| 8 | تقويم اقتصادي وهمي | FMP API | `economic-calendar.ts` |
| 9 | محاكي GBM فقط | 5 أنظمة سوق + GARCH | `simulator.ts` |

### 13.3 تقييم الاستراتيجيات بعد التحسين

| الاستراتيجية | صاعد | هابط | عرضي | متقلب | هادئ |
|---|---|---|---|---|---|
| **الاتجاه** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐ | ⭐⭐ | ⭐⭐ |
| **الارتداد** | ⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐ |
| **الاختراق** | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| **VWAP** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Order Flow** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |

---

## 14. خارطة تطوير v3.0-v3.1

جميع المهام الـ 12 في الخارطة الأصلية — منجزة:

| # | المهمة | الأولوية | v3.0 | v3.1 |
|---|---|---|---|---|
| 1 | `weights.ts` — أوزان متكيفة | 🔴 | ✅ | ✅ 9 اختبارات |
| 2 | `reversal.ts` — استراتيجية ارتداد | 🔴 | ✅ | ✅ 4 مراحل + 8 اختبارات |
| 3 | `breakout.ts` — استراتيجية اختراق | 🔴 | ✅ | ✅ BB+VP+retest |
| 4 | إصلاح تناسق Long/Short | 🔴 | ✅ | ✅ asymmetric vol |
| 5 | `orderflow.ts` — VWAP+VP+CVD | 🟡 | ✅ | ✅ 9 اختبارات |
| 6 | `correlation.ts` — مصفوفة ارتباط | 🟡 | ✅ | ✅ 8 اختبارات |
| 7 | `onchain.ts` — On-Chain | 🟡 | ✅ | ✅ يحتاج API key |
| 8 | `economic-calendar.ts` | 🟡 | ✅ | ✅ يحتاج API key |
| 9 | حجم مركز ديناميكي | 🟡 | ✅ | ✅ 7-layer filter |
| 10 | تحديث `decision.ts` | 🔴 | ✅ | ✅ 13 محلل |
| 11 | `simulator.ts` — أنظمة حقيقية | 🟡 | ✅ | ✅ 5 regimes |
| 12 | اختبارات لكل مكون جديد | 🔴 | ✅ | ✅ 33 اختبار جديد |

### إضافات v3.1 غير المخطط لها

| المكوّن | الوصف |
|---|---|
| `trend-advanced.ts` | ATR trailing stop + early exit + pyramiding + scaled targets |
| `signal-filter.ts` | 7 طبقات تعديل حجم — لا يرفض، يضبط |
| `scale-in.ts` | دخول متدرج 3 دفعات |
| `fear-greed.ts` | مؤشر الخوف والطمع (Alternative.me) |
| `provider.ts` | Stripe + USDT payment providers |
| `admin/page.tsx` | لوحة تحكم احترافية كاملة |

---

## 15. ما تبقى — خارطة الطريق النهائية

### 🔑 مفاتيح API (10 دقائق)

| المفتاح | من أين | السعر | يفعّل ماذا |
|---|---|---|---|
| `COINGLASS_API_KEY` | coinglass.com | مجاني | Funding Rate + Open Interest + L/S |
| `FMP_API_KEY` | financialmodelingprep.com | مجاني | التقويم الاقتصادي |
| `STRIPE_SECRET_KEY` | stripe.com | 2.9%+0.30$ | دفع بالفيزا |
| `USDT_TRC20_ADDRESS` | أي محفظة | مجاني | دفع بالعملات |
| `BINANCE_API_KEY` | binance.com | مجاني | تداول حقيقي |

### ⏳ تشغيل وتحقق (4-8 أسابيع)

| # | المهمة | المدة | الأمر |
|---|---|---|---|
| 1 | اختبار خلفي — بيانات حقيقية | 2h | `npm run backtest -- --live` |
| 2 | تشغيل ورقي | 4-8 أسابيع | `TRADING_MODE=paper` |
| 3 | مراقبة الأداء اليومي | مستمر | `/api/cron/report-daily` |
| 4 | معايرة من النتائج الحية | مستمر | `/api/cron/outcomes` |
| 5 | نشر الأرقام | بعد #2 | بعد اجتياز كل البوابات |

---

## المراجع

| الملف | المحتوى |
|---|---|
| `MASTER.md` | **المرجع الرسمي — اقرأني قبل أي شيء** |
| `SETUP.md` | دليل التنصيب والتشغيل |
| `PRODUCT.md` | المنتج التجاري |
| `ARCHITECTURE.md` | التفاصيل التقنية |
| `DECISIONS.md` | 22 قراراً مع مبرراتها |
| `ROADMAP.md` | خطة التطوير |
| `CHANGELOG.md` | سجل التغييرات |

---

> **الكود منتهي. 94 اختباراً. البناء ناجح.**
> **المتبقي: تشغيل.** مفاتيح API + 4-8 أسابيع تداول ورقي.
> **لا تُعلن أي نسبة نجاح قبل إتمام الاختبار الخلفي على بيانات حقيقية.**
