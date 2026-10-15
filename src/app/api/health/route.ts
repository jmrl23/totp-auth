import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { NO_STORE_HEADERS } from "@/lib/server/errors";
import { isDraining } from "@/lib/server/lifecycle";

export const dynamic = "force-dynamic";

const HEALTH_TIMEOUT_MS = 2_000;

/** Liveness + database check for load balancers and the Docker HEALTHCHECK. No details exposed. */
export async function GET(): Promise<Response> {
  let ok = !isDraining();
  if (ok) {
    try {
      await Promise.race([
        getDb().execute(sql`SELECT 1`),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), HEALTH_TIMEOUT_MS).unref()),
      ]);
    } catch {
      ok = false;
    }
  }
  return Response.json({ ok }, { status: ok ? 200 : 503, headers: NO_STORE_HEADERS });
}
