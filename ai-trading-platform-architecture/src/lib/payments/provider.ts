// ---------------------------------------------------------------------------
// Payment Provider abstraction — Stripe & USDT (v3.1)
// ---------------------------------------------------------------------------

import { db } from "@/db";
import { payments } from "@/db/schema";
import { eq } from "drizzle-orm";

export type PaymentProviderKind = "stripe" | "usdt" | "licence_key" | "manual";

export type PaymentRequest = {
  customerId: string; subscriptionId?: string; amount: number;
  currency: string; provider: PaymentProviderKind; periodDays: number;
  metadata?: Record<string, unknown>;
};

export type PaymentResult = {
  ok: boolean; paymentId?: string; providerRef?: string;
  checkoutData?: string; error?: string;
};

export interface PaymentSource {
  readonly provider: PaymentProviderKind;
  createPayment(req: PaymentRequest): Promise<PaymentResult>;
  verifyPayment(providerRef: string): Promise<{ confirmed: boolean; amount: number }>;
}

export class StripeProvider implements PaymentSource {
  readonly provider: PaymentProviderKind = "stripe";
  constructor(private readonly secretKey: string) {}

  async createPayment(req: PaymentRequest): Promise<PaymentResult> {
    try {
      const params = new URLSearchParams({
        "payment_method_types[]": "card",
        "mode": "payment",
        "success_url": `${process.env.NEXT_PUBLIC_URL ?? "http://localhost:3000"}/admin?payment=success`,
        "cancel_url": `${process.env.NEXT_PUBLIC_URL ?? "http://localhost:3000"}/admin?payment=cancelled`,
        "line_items[0][price_data][currency]": req.currency.toLowerCase(),
        "line_items[0][price_data][product_data][name]": `Trading Assistant — ${req.periodDays} days`,
        "line_items[0][price_data][unit_amount]": String(Math.round(req.amount * 100)),
        "line_items[0][quantity]": "1",
      });

      const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${this.secretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        signal: AbortSignal.timeout(10_000),
      });

      const data = await res.json();
      if (!res.ok) return { ok: false, error: (data as any).error?.message ?? "Stripe error" };

      const sessionId = (data as any).id as string;
      await db.insert(payments).values({
        customerId: req.customerId, subscriptionId: req.subscriptionId,
        amount: String(req.amount), currency: req.currency,
        provider: "stripe", providerRef: sessionId, status: "pending",
        periodDays: req.periodDays, metadata: req.metadata ?? {},
      });

      return { ok: true, paymentId: sessionId, providerRef: sessionId, checkoutData: (data as any).url };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async verifyPayment(sessionId: string): Promise<{ confirmed: boolean; amount: number }> {
    try {
      const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
        headers: { "Authorization": `Bearer ${this.secretKey}` },
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json();
      return { confirmed: (data as any).payment_status === "paid", amount: Number((data as any).amount_total ?? 0) / 100 };
    } catch { return { confirmed: false, amount: 0 }; }
  }
}

export class UsdtProvider implements PaymentSource {
  readonly provider: PaymentProviderKind = "usdt";
  private address: string;

  constructor() {
    this.address = process.env.USDT_TRC20_ADDRESS || process.env.USDT_ERC20_ADDRESS || "";
  }

  async createPayment(req: PaymentRequest): Promise<PaymentResult> {
    if (!this.address) {
      return { ok: false, error: "USDT address not configured. Set USDT_TRC20_ADDRESS." };
    }
    const ref = `PAY-${req.customerId.slice(0, 8)}-${Date.now().toString(36)}`;
    const network = process.env.USDT_TRC20_ADDRESS ? "TRC20" : "ERC20";

    await db.insert(payments).values({
      customerId: req.customerId, amount: String(req.amount), currency: "USDT",
      provider: "usdt", providerRef: ref, status: "pending",
      periodDays: req.periodDays, metadata: { address: this.address, network },
    });

    return {
      ok: true, paymentId: ref, providerRef: ref,
      checkoutData: `Send ${req.amount} USDT to:\n${this.address}\nNetwork: ${network}\nRef: ${ref}`,
    };
  }

  async verifyPayment(): Promise<{ confirmed: boolean; amount: number }> {
    return { confirmed: false, amount: 0 };
  }
}

export class PaymentRouter {
  private providers = new Map<PaymentProviderKind, PaymentSource>();

  register(source: PaymentSource): void { this.providers.set(source.provider, source); }
  get(provider: PaymentProviderKind): PaymentSource | undefined { return this.providers.get(provider); }
  listProviders(): PaymentProviderKind[] { return [...this.providers.keys()]; }

  async confirmPayment(paymentId: string, adminUserId: string): Promise<boolean> {
    const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
    if (!payment || payment.status !== "pending") return false;
    await db.update(payments).set({
      status: "confirmed", confirmedByAdminId: adminUserId, confirmedAt: new Date(),
    }).where(eq(payments.id, paymentId));
    return true;
  }
}

let _router: PaymentRouter | null = null;

export function getPaymentRouter(): PaymentRouter {
  if (!_router) {
    _router = new PaymentRouter();
    if (process.env.STRIPE_SECRET_KEY) _router.register(new StripeProvider(process.env.STRIPE_SECRET_KEY));
    if (process.env.USDT_TRC20_ADDRESS || process.env.USDT_ERC20_ADDRESS) _router.register(new UsdtProvider());
  }
  return _router;
}
