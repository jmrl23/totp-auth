import { runMigrations } from "@/db/migrate";
import { EnvError, getEnv } from "./env";
import { installShutdownHandlers } from "./lifecycle";

const PLACEHOLDER_PASSWORD = "change-me";

/** Refuses to run in production with the example database password. Names keys, never values. */
export function placeholderPasswordProblems(source: Record<string, string | undefined>): string[] {
  if (source.NODE_ENV !== "production") return [];
  const problems: string[] = [];
  if (source.POSTGRES_PASSWORD === PLACEHOLDER_PASSWORD) problems.push("POSTGRES_PASSWORD");
  try {
    if (source.DATABASE_URL && decodeURIComponent(new URL(source.DATABASE_URL).password) === PLACEHOLDER_PASSWORD) {
      problems.push("DATABASE_URL");
    }
  } catch {
    // Malformed URLs are reported by env validation.
  }
  return problems;
}

/**
 * Called once per server process from instrumentation.ts: validate config, then migrate.
 * Safe on N instances at once: migrations take a Postgres advisory lock, so later instances wait
 * and then find nothing to apply. No files are written; nothing else is process-global.
 */
export async function startServer(): Promise<void> {
  try {
    getEnv();
  } catch (err) {
    if (err instanceof EnvError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
  const placeholders = placeholderPasswordProblems(process.env);
  if (placeholders.length > 0) {
    console.error(
      `Refusing to start: ${placeholders.join(" and ")} still use the example password "change-me". Set a real database password.`,
    );
    process.exit(1);
  }
  installShutdownHandlers();
  try {
    await runMigrations();
  } catch (err) {
    const e = err as { name?: string; code?: string };
    console.error(JSON.stringify({ level: "error", msg: "database migration failed", err: e?.name, code: e?.code }));
    process.exit(1);
  }
}
