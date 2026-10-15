import pg from "pg";
import { e2eDatabaseUrl } from "./env";

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: e2eDatabaseUrl(), max: 2 });
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = []) {
  return (await getPool().query<T>(sql, params)).rows;
}

const TABLES = ["entries", "sessions", "users", "rate_limits"];

/** Empties every app table. Safe when the tables do not exist yet. */
export async function resetDatabase(): Promise<void> {
  const rows = await query<{ name: string }>(
    `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1)`,
    [TABLES],
  );
  if (rows.length === 0) return;
  await query(`TRUNCATE ${rows.map((r) => `"${r.name}"`).join(", ")} CASCADE`);
}

/** The suite shares one rate-limit bucket (TRUST_PROXY=false), so tests clear it between steps. */
export async function clearRateLimits(): Promise<void> {
  await query(`DELETE FROM rate_limits`);
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
}
