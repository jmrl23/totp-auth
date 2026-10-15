import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { migrationsFolder, runMigrations } from "@/db/migrate";
import { setupTestDb } from "./testing/helpers";

setupTestDb();

describe("migrations", () => {
  it("are safe to run from several instances at once (advisory lock, then no-op)", async () => {
    await Promise.all([runMigrations(), runMigrations(), runMigrations()]);
    const journal = JSON.parse(readFileSync(path.join(migrationsFolder(), "meta", "_journal.json"), "utf8")) as {
      entries: unknown[];
    };
    const rows = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
    expect(rows.rows[0].n).toBe(journal.entries.length);
  });
});
