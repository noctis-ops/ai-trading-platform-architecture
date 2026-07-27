// ---------------------------------------------------------------------------
// Schema + query integration tests, run against a REAL Postgres engine
// (PGlite — Postgres compiled to WASM, in-process, no external service).
//
// Why this exists: typechecking proves a Drizzle query compiles, not that the
// SQL is valid or that the constraints behave as designed. These tests catch
// the class of bug that only appears against a real database — broken
// migrations, unique constraints that do not fire, cascade rules, and the
// numeric-as-string boundary.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, inArray } from "drizzle-orm";

import * as schema from "@/db/schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

let client: PGlite;
let db: Db;

const MIGRATIONS_DIR = join(process.cwd(), "drizzle");

async function applyMigrations(pg: PGlite) {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  assert.ok(files.length > 0, "no migration files found — run `npm run db:generate`");
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await pg.exec(trimmed);
    }
  }
}

before(async () => {
  client = new PGlite();
  await applyMigrations(client);
  db = drizzle(client, { schema });
});

after(async () => {
  await client.close();
});


/**
 * Asserts a Postgres SQLSTATE rather than matching on message text.
 *
 * Drizzle wraps driver errors, so the constraint violation lives in
 * `error.cause`, not in `error.message` — matching the outer message silently
 * passes for ANY failure, which would make these tests worthless.
 *
 *   23505 = unique_violation
 *   23503 = foreign_key_violation
 *   23001 = restrict_violation (what ON DELETE RESTRICT actually raises —
 *           distinct from a plain FK violation, which is easy to get wrong)
 */
async function assertPgError(fn: () => Promise<unknown>, sqlState: "23505" | "23503" | "23001") {
  try {
    await fn();
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause;
    assert.equal(cause?.code, sqlState, `expected SQLSTATE ${sqlState}, got ${cause?.code}`);
    return;
  }
  assert.fail(`expected the query to fail with SQLSTATE ${sqlState}, but it succeeded`);
}

async function seedPlan(code = "pro", features: Record<string, unknown> = {}) {
  const [plan] = await db
    .insert(schema.plans)
    .values({ code, nameAr: "احترافية", nameEn: "Pro", priceMonthly: "49.00", features })
    .returning();
  return plan;
}

async function seedCustomer(telegramId: bigint, status = "active") {
  const [customer] = await db
    .insert(schema.customers)
    .values({ telegramId, status, displayName: "Test" })
    .returning();
  return customer;
}

describe("migration", () => {
  test("creates every table the application queries", async () => {
    const res = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const tables = new Set(res.rows.map((r) => r.table_name));
    for (const expected of [
      "customers", "admin_users", "admin_sessions", "plans", "subscriptions", "payments",
      "licence_keys", "signals", "signal_events", "signal_outcomes", "analysis_snapshots",
      "calibration", "delivery_log", "usage_events", "audit_logs", "system_settings",
      "watched_symbols",
    ]) {
      assert.ok(tables.has(expected), `missing table: ${expected}`);
    }
  });
});

describe("constraints that protect the business", () => {
  test("a telegram id can only ever map to one customer", async () => {
    await seedCustomer(1001n);
    await assertPgError(() => seedCustomer(1001n), "23505");
  });

  test("the same payment reference cannot be recorded twice", async () => {
    const customer = await seedCustomer(1002n);
    const row = {
      customerId: customer.id,
      amount: "49.00",
      provider: "crypto",
      providerRef: "0xdeadbeef",
      status: "confirmed",
    };
    await db.insert(schema.payments).values(row);
    // Without this constraint, a replayed webhook would credit a customer twice.
    await assertPgError(() => db.insert(schema.payments).values(row), "23505");
  });

  test("a licence key hash is unique", async () => {
    const plan = await seedPlan("basic-unique");
    const row = { keyHash: "hash-abc", keyPrefix: "ABCD", planId: plan.id, durationDays: 30 };
    await db.insert(schema.licenceKeys).values(row);
    await assertPgError(() => db.insert(schema.licenceKeys).values(row), "23505");
  });

  test("calibration is unique per scope so upserts cannot fork", async () => {
    const row = { scope: "regime", scopeKey: "trending_up", sampleSize: 30, multiplier: "1.050" };
    await db.insert(schema.calibration).values(row);
    await assertPgError(() => db.insert(schema.calibration).values(row), "23505");
  });

  test("a plan in use cannot be deleted out from under a subscription", async () => {
    const plan = await seedPlan("locked");
    const customer = await seedCustomer(1003n);
    await db.insert(schema.subscriptions).values({
      customerId: customer.id,
      planId: plan.id,
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
    });
    // onDelete: "restrict" — deleting a plan must not orphan paying customers.
    await assertPgError(() => db.delete(schema.plans).where(eq(schema.plans.id, plan.id)), "23001");
  });

  test("deleting a customer cascades to their subscription", async () => {
    const plan = await seedPlan("cascade");
    const customer = await seedCustomer(1004n);
    await db.insert(schema.subscriptions).values({
      customerId: customer.id,
      planId: plan.id,
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
    });
    await db.delete(schema.customers).where(eq(schema.customers.id, customer.id));
    const left = await db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.customerId, customer.id));
    assert.equal(left.length, 0);
  });
});

describe("signal persistence", () => {
  test("stores refusals as records, never as open positions", async () => {
    await db.insert(schema.signals).values({
      symbol: "BTCUSDT",
      verdict: "reject",
      confidence: 31,
      probability: "0.4200",
      regime: "ranging",
      entryTimeframe: "1h",
      blockedBy: "REJECT_LOW_CONFLUENCE",
      status: "invalidated",
    });

    // The tracking loop must never pick a refusal up as a live trade.
    const open = await db
      .select()
      .from(schema.signals)
      .where(inArray(schema.signals.status, ["open", "tp1_hit"]));
    assert.equal(open.filter((s) => s.verdict !== "enter").length, 0);
  });

  test("round-trips a full trade plan through numeric columns without drift", async () => {
    const [row] = await db
      .insert(schema.signals)
      .values({
        symbol: "ETHUSDT",
        verdict: "enter",
        direction: "long",
        confidence: 55,
        probability: "0.6100",
        regime: "trending_up",
        entryTimeframe: "15m",
        entryPrice: "3421.1234567890",
        stopLoss: "3380.5000000000",
        takeProfit1: "3502.3469135780",
        riskReward: "2.000",
        supportingReasons: [{ code: "STRUCTURE_BOS_UP", score: 0.7 }],
        status: "open",
        publishedAt: new Date(),
      })
      .returning();

    // numeric arrives as a string — the store layer is responsible for the
    // conversion, and precision must survive the round trip exactly.
    assert.equal(typeof row.entryPrice, "string");
    assert.equal(Number(row.entryPrice), 3421.123456789);
    const reasons = row.supportingReasons as { code: string }[];
    assert.equal(reasons[0]?.code, "STRUCTURE_BOS_UP");
  });

  test("only one outcome may exist per signal", async () => {
    const [signal] = await db
      .insert(schema.signals)
      .values({
        symbol: "SOLUSDT", verdict: "enter", direction: "long", confidence: 60,
        probability: "0.6000", regime: "trending_up", entryTimeframe: "1h", status: "tp1_hit",
      })
      .returning();

    const outcome = {
      signalId: signal.id, symbol: "SOLUSDT", regime: "trending_up",
      predictedProbability: "0.6000", confidence: 60, won: true, rMultiple: "2.000",
    };
    await db.insert(schema.signalOutcomes).values(outcome);
    // Guarantees the outcomes job is safe to re-run.
    await assertPgError(() => db.insert(schema.signalOutcomes).values(outcome), "23505");
  });
});

describe("entitlement queries", () => {
  test("the delivery audience query returns only live subscribers", async () => {
    const plan = await seedPlan("audience", { maxSymbols: -1 });
    const live = await seedCustomer(2001n);
    const lapsed = await seedCustomer(2002n);

    await db.insert(schema.subscriptions).values([
      {
        customerId: live.id, planId: plan.id, status: "active",
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
        featuresSnapshot: { maxSymbols: -1 },
      },
      {
        customerId: lapsed.id, planId: plan.id, status: "expired",
        currentPeriodEnd: new Date(Date.now() - 86_400_000),
        featuresSnapshot: { maxSymbols: -1 },
      },
    ]);

    const rows = await db
      .select({ customerId: schema.customers.id })
      .from(schema.subscriptions)
      .innerJoin(schema.customers, eq(schema.subscriptions.customerId, schema.customers.id))
      .where(
        and(
          inArray(schema.subscriptions.status, ["active", "trialing"]),
          inArray(schema.customers.id, [live.id, lapsed.id]),
        ),
      );

    assert.deepEqual(rows.map((r) => r.customerId), [live.id]);
  });

  test("usage events support the daily quota count", async () => {
    const customer = await seedCustomer(2003n);
    await db.insert(schema.usageEvents).values([
      { customerId: customer.id, action: "analyse", allowed: true },
      { customerId: customer.id, action: "analyse", allowed: true },
      // Denied attempts must NOT consume quota, only inform upsell.
      { customerId: customer.id, action: "analyse", allowed: false, denyReason: "RATE_LIMITED" },
    ]);

    const rows = await db
      .select()
      .from(schema.usageEvents)
      .where(
        and(
          eq(schema.usageEvents.customerId, customer.id),
          eq(schema.usageEvents.action, "analyse"),
          eq(schema.usageEvents.allowed, true),
        ),
      );
    assert.equal(rows.length, 2);
  });
});
