import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

type Holder = { pool?: Pool; db?: Db };
// Survives Next dev hot reloads so we do not leak pools.
const holder = globalThis as unknown as { __totpAuthDb?: Holder };
const state: Holder = (holder.__totpAuthDb ??= {});

export function getPool(): Pool {
  if (!state.pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set.");
    state.pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
    state.pool.on("error", (err) => {
      console.error(JSON.stringify({ level: "error", msg: "pg pool error", code: (err as { code?: string }).code ?? null }));
    });
  }
  return state.pool;
}

export function getDb(): Db {
  if (!state.db) state.db = drizzle({ client: getPool(), schema });
  return state.db;
}

/** Closes the pool (tests and graceful shutdown). */
export async function closeDb(): Promise<void> {
  const pool = state.pool;
  state.pool = undefined;
  state.db = undefined;
  if (pool) await pool.end();
}

export { schema };
