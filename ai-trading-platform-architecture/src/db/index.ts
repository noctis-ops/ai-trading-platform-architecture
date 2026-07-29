import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const DATABASE_URL = process.env.DATABASE_URL;

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __arenaNextJsPostgresqlDb?: NodePgDatabase<typeof schema>;
};

// Create the pool eagerly. `new Pool()` does NOT connect until the first
// query, so this is safe even during Next.js build where DATABASE_URL may
// be unset. Queries will fail at runtime with a clear error if unset.
const url = DATABASE_URL ?? "postgresql://localhost:5432/placeholder";
const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({ connectionString: url, connectionTimeoutMillis: 5000 });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

function createDb(): NodePgDatabase<typeof schema> {
  if (globalForDb.__arenaNextJsPostgresqlDb) return globalForDb.__arenaNextJsPostgresqlDb;
  const d = drizzle(pool, { schema });
  if (process.env.NODE_ENV !== "production") globalForDb.__arenaNextJsPostgresqlDb = d;
  return d;
}

export const db = createDb();
export { pool };

