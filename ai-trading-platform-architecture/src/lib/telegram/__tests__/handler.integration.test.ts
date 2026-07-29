import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import * as schema from "@/db/schema";
import { handleUpdate, setTelegramClientForTest } from "../handler";
import type { TelegramUpdate, TelegramClient } from "../client";
import { eq } from "drizzle-orm";
import { db as globalDb } from "@/db";

let client: PGlite;
let localDb: ReturnType<typeof drizzle<typeof schema>>;

const MIGRATIONS_DIR = join(process.cwd(), "drizzle");

async function applyMigrations(pg: PGlite) {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    await pg.exec(sql);
  }
}

// Dirty but effective global DB patch for this integration run
const patchDb = () => { Object.assign(globalDb, localDb); };

class FakeTelegramClient {
  public sent: { chatId: bigint; text: string }[] = [];
  async sendMessage(chatId: bigint, text: string, options?: any) {
    this.sent.push({ chatId, text });
    return { ok: true, messageId: 1 };
  }
}
let fakeTg = new FakeTelegramClient();

before(async () => {
  client = new PGlite();
  await client.waitReady;
  localDb = drizzle(client, { schema });
  await applyMigrations(client);
  patchDb();

  // Create single test plan for the test subscriber
  try {
    await localDb.insert(schema.plans).values({
      id: "11111111-1111-1111-1111-111111111111",
      code: "pro_int",
      nameAr: "برو",
      nameEn: "Pro",
      currency: "USD",
      priceMonthly: "79",
      isActive: true,
      isPublic: true,
      features: { maxSymbols: 10, onDemandAnalysisPerDay: 10, dailyReports: true },
    });
  } catch (e) {
    console.error("plan insert err", e);
  }

  // Create a subscribed user
  try {
    await localDb.insert(schema.customers).values({
      id: "22222222-2222-2222-2222-222222222222",
      telegramId: 1001n,
      status: "active",
    });
  } catch (e) {
    console.error("cust insert err", e);
  }
  
  try {
    await localDb.insert(schema.subscriptions).values({
      id: "33333333-3333-3333-3333-333333333333",
      customerId: "22222222-2222-2222-2222-222222222222",
      planId: "11111111-1111-1111-1111-111111111111",
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 10000000),
    });
  } catch (e) {
    console.error("sub insert err", e);
  }
});

beforeEach(() => {
  fakeTg = new FakeTelegramClient();
  setTelegramClientForTest(fakeTg as unknown as TelegramClient);
});

after(async () => {
  await client.close();
});

function makeUpdate(text: string, userId: number): TelegramUpdate {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: userId, is_bot: false, first_name: "TestUser" },
      chat: { id: userId, type: "private" },
      date: Math.floor(Date.now() / 1000),
      text,
    },
  };
}

test("bot integration: /بدء from an unknown user responds with generic not-subscribed text", async () => {
  await handleUpdate(makeUpdate("/بدء", 9999));
  assert.equal(fakeTg.sent.length, 1);
  assert.ok(fakeTg.sent[0].text.includes("المشتركين"), `got: ${fakeTg.sent[0].text}`);
  
  // Verify it added them as pending
  const [row] = await localDb.select().from(schema.customers).where(eq(schema.customers.telegramId, 9999n));
  assert.ok(row, "should have inserted a pending customer row");
  assert.equal(row.status, "pending");
});

test("bot integration: /الخطط returns available plans to a subscriber", async () => {
  await handleUpdate(makeUpdate("/الخطط", 1001));
  assert.equal(fakeTg.sent.length, 1);
  assert.ok(fakeTg.sent[0].text.includes("برو"), `got: ${fakeTg.sent[0].text}`);
});

test("bot integration: non-subscriber attempting a gated command (/الإعدادات) gets denied", async () => {
  await handleUpdate(makeUpdate("/الإعدادات", 9999));
  assert.equal(fakeTg.sent.length, 1);
  assert.ok(fakeTg.sent[0].text.includes("المراجعة"), `got: ${fakeTg.sent[0].text}`);
});

test("bot integration: garbage command yields nudge", async () => {
  await handleUpdate(makeUpdate("hello world", 1001));
  assert.equal(fakeTg.sent.length, 1);
  assert.ok(fakeTg.sent[0].text.includes("لم أفهم طلبك"));
});
