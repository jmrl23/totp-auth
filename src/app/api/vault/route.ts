import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { entries } from "@/db/schema";
import { json, route } from "@/lib/server/http";
import type { VaultResponse } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "active" }, async ({ session }) => {
  const rows = await getDb()
    .select({ id: entries.id, ciphertext: entries.ciphertext, iv: entries.iv, updatedAt: entries.updatedAt })
    .from(entries)
    .where(eq(entries.userId, session.userId))
    .orderBy(asc(entries.createdAt), asc(entries.id));
  return json({
    entries: rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })),
  } satisfies VaultResponse);
});
