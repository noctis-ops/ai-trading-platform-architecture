// ---------------------------------------------------------------------------
// Access Control & Entitlements
//
// ONE function decides whether a Telegram update is allowed to do anything:
// `evaluateAccess`. Every bot command handler and every signal fan-out call
// goes through it. Centralising this means a subscription bug can never be
// "fixed in one place and forgotten in another", and it gives us a single
// audit point for revenue-critical logic.
//
// Pure functions only — the caller loads the rows, this module decides.
// ---------------------------------------------------------------------------

export type AccessDenialCode =
  | "NOT_REGISTERED"
  | "PENDING_APPROVAL"
  | "SUSPENDED"
  | "BANNED"
  | "NO_SUBSCRIPTION"
  | "SUBSCRIPTION_EXPIRED"
  | "SUBSCRIPTION_PAUSED"
  | "SUBSCRIPTION_CANCELED"
  | "PLAN_FEATURE_LOCKED"
  | "RATE_LIMITED"
  | "SYMBOL_NOT_IN_PLAN";

export type PlanFeatures = {
  /** Max symbols the customer receives signals for; -1 = unlimited. */
  maxSymbols: number;
  /** Timeframes this tier is entitled to see. */
  timeframes: string[];
  /** On-demand /تحليل calls allowed per day; -1 = unlimited. */
  onDemandAnalysisPerDay: number;
  dailyReports: boolean;
  weeklyReports: boolean;
  monthlyReports: boolean;
  /** Delivered before lower tiers (seconds of head start). */
  prioritySeconds: number;
  /** Customer may override risk-per-trade in their preferences. */
  customRisk: boolean;
  /** Access to the full "شرح التحليل" breakdown vs the summary only. */
  fullAnalysisBreakdown: boolean;
};

export const DEFAULT_FEATURES: PlanFeatures = {
  maxSymbols: 3,
  timeframes: ["1h", "4h"],
  onDemandAnalysisPerDay: 5,
  dailyReports: true,
  weeklyReports: false,
  monthlyReports: false,
  prioritySeconds: 0,
  customRisk: false,
  fullAnalysisBreakdown: false,
};

export type CustomerPreferences = {
  quietHoursStart?: number;
  quietHoursEnd?: number;
  symbolFilters?: string[];
  riskProfile?: "conservative" | "aggressive";
};

export type CustomerRecord = {
  id: string;
  status: "pending" | "active" | "suspended" | "banned";
  languageCode?: string;
  preferences?: CustomerPreferences;
};

export type SubscriptionRecord = {
  id: string;
  status: "trialing" | "active" | "past_due" | "paused" | "canceled" | "expired";
  currentPeriodEnd: Date;
  pausedAt: Date | null;
  planCode: string;
  featuresSnapshot: Partial<PlanFeatures>;
};

export type AccessGrant = {
  allowed: true;
  customerId: string;
  planCode: string;
  features: PlanFeatures;
  daysRemaining: number;
  /** True inside the renewal-nudge window — the bot appends a reminder. */
  expiringSoon: boolean;
};

export type AccessDenial = {
  allowed: false;
  code: AccessDenialCode;
  /** Extra context for the Arabic message (e.g. days expired, limit hit). */
  detail?: Record<string, number | string>;
};

export type AccessResult = AccessGrant | AccessDenial;

export const EXPIRY_WARNING_DAYS = 3;

/**
 * The single access gate.
 *
 * Ordering is deliberate: account-level bans are checked before billing so a
 * banned user is never told "renew your subscription" — they get a terminal
 * answer and we never invite payment from someone we refuse to serve.
 */
export function evaluateAccess(
  customer: CustomerRecord | null,
  subscription: SubscriptionRecord | null,
  now: Date = new Date(),
): AccessResult {
  if (!customer) return { allowed: false, code: "NOT_REGISTERED" };

  switch (customer.status) {
    case "banned":
      return { allowed: false, code: "BANNED" };
    case "suspended":
      return { allowed: false, code: "SUSPENDED" };
    case "pending":
      // Pending is only a problem if there is no paid subscription yet.
      if (!subscription) return { allowed: false, code: "PENDING_APPROVAL" };
      break;
  }

  if (!subscription) return { allowed: false, code: "NO_SUBSCRIPTION" };
  if (subscription.pausedAt || subscription.status === "paused") {
    return { allowed: false, code: "SUBSCRIPTION_PAUSED" };
  }
  if (subscription.status === "canceled") {
    // Canceled but still inside a paid period => access continues to period end.
    if (subscription.currentPeriodEnd.getTime() <= now.getTime()) {
      return { allowed: false, code: "SUBSCRIPTION_CANCELED" };
    }
  }
  if (subscription.status === "expired") {
    return { allowed: false, code: "SUBSCRIPTION_EXPIRED" };
  }

  const msRemaining = subscription.currentPeriodEnd.getTime() - now.getTime();
  if (msRemaining <= 0) {
    return {
      allowed: false,
      code: "SUBSCRIPTION_EXPIRED",
      detail: { daysAgo: Math.floor(-msRemaining / 86_400_000) },
    };
  }

  const daysRemaining = Math.ceil(msRemaining / 86_400_000);

  return {
    allowed: true,
    customerId: customer.id,
    planCode: subscription.planCode,
    features: { ...DEFAULT_FEATURES, ...subscription.featuresSnapshot },
    daysRemaining,
    expiringSoon: daysRemaining <= EXPIRY_WARNING_DAYS,
  };
}

/** Feature-flag check for a granted session. */
export function requireFeature(grant: AccessGrant, feature: keyof PlanFeatures): AccessResult {
  const value = grant.features[feature];
  const enabled = typeof value === "boolean" ? value : Array.isArray(value) ? value.length > 0 : value !== 0;
  if (!enabled) {
    return { allowed: false, code: "PLAN_FEATURE_LOCKED", detail: { feature: String(feature), plan: grant.planCode } };
  }
  return grant;
}

/**
 * Quota check for metered features. `usedToday` is supplied by the caller from
 * `usage_events`, so this stays pure and trivially testable.
 */
export function checkQuota(grant: AccessGrant, usedToday: number): AccessResult {
  const limit = grant.features.onDemandAnalysisPerDay;
  if (limit === -1) return grant;
  if (usedToday >= limit) {
    return { allowed: false, code: "RATE_LIMITED", detail: { used: usedToday, limit, plan: grant.planCode } };
  }
  return grant;
}

/** Is this symbol inside the customer's tier? */
export function checkSymbolAccess(grant: AccessGrant, symbol: string, tierSymbols: string[]): AccessResult {
  if (grant.features.maxSymbols === -1) return grant;
  const allowed = tierSymbols.slice(0, grant.features.maxSymbols);
  if (!allowed.includes(symbol)) {
    return { allowed: false, code: "SYMBOL_NOT_IN_PLAN", detail: { symbol, plan: grant.planCode } };
  }
  return grant;
}

export const isGrant = (r: AccessResult): r is AccessGrant => r.allowed;

// ---------------------------------------------------------------------------
// Arabic rendering of denials — kept here beside the codes so a new denial
// reason can never ship without its customer-facing sentence.
// ---------------------------------------------------------------------------
export const DENIAL_AR: Record<AccessDenialCode, (d?: Record<string, number | string>) => string> = {
  NOT_REGISTERED: () => "لست مسجلاً بعد. أرسل /بدء للتسجيل، أو /الخطط لعرض الاشتراكات.",
  PENDING_APPROVAL: () => "حسابك قيد المراجعة. سيتم تفعيله بعد تأكيد الاشتراك.",
  SUSPENDED: () => "تم إيقاف حسابك مؤقتاً. تواصل مع الدعم عبر /الدعم.",
  BANNED: () => "تم إنهاء وصولك لهذه الخدمة نهائياً.",
  NO_SUBSCRIPTION: () => "لا يوجد اشتراك فعّال على حسابك. أرسل /الخطط لعرض الخطط المتاحة.",
  SUBSCRIPTION_EXPIRED: (d) =>
    d?.daysAgo
      ? `انتهى اشتراكك منذ ${d.daysAgo} يوم. أرسل /تجديد لاستعادة الخدمة.`
      : "انتهى اشتراكك. أرسل /تجديد لاستعادة الخدمة.",
  SUBSCRIPTION_PAUSED: () => "اشتراكك متوقف مؤقتاً. تواصل مع الدعم لإعادة التفعيل.",
  SUBSCRIPTION_CANCELED: () => "تم إلغاء اشتراكك. أرسل /الخطط للاشتراك من جديد.",
  PLAN_FEATURE_LOCKED: (d) => `هذه الميزة غير متاحة في خطتك الحالية (${d?.plan ?? ""}). أرسل /الخطط للترقية.`,
  RATE_LIMITED: (d) => `استهلكت حدّك اليومي (${d?.used ?? 0}/${d?.limit ?? 0}). جدّد غداً أو رقِّ خطتك عبر /الخطط.`,
  SYMBOL_NOT_IN_PLAN: (d) => `العملة ${d?.symbol ?? ""} غير مشمولة في خطتك. أرسل /الخطط للترقية.`,
};

export function denialAr(denial: AccessDenial): string {
  return DENIAL_AR[denial.code](denial.detail);
}
