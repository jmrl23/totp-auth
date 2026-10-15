import { count, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { entries } from "@/db/schema";
import { errors } from "@/lib/server/errors";
import { BODY_LIMITS, json, route } from "@/lib/server/http";
import { assertSessionLive, lockUser } from "@/lib/server/users";
import { importRequestSchema, MAX_ENTRIES_PER_USER, type ImportResponse } from "@/lib/schemas";

/** 201 { created }. Ids that already exist are skipped. All or nothing on the entry limit. */
export const POST = route({ auth: "active", maxBody: BODY_LIMITS.import }, async ({ session, body }) => {
  const input = await body(importRequestSchema);
  const unique = [...new Map(input.entries.map((e) => [e.id, e])).values()];
  const created = await getDb().transaction(async (tx) => {
    await lockUser(tx, session.userId);
    await assertSessionLive(tx, session.id);
    const now = new Date();
    const inserted = await tx
      .insert(entries)
      .values(unique.map((e) => ({ id: e.id, userId: session.userId, ciphertext: e.ciphertext, iv: e.iv, createdAt: now, updatedAt: now })))
      .onConflictDoNothing({ target: entries.id })
      .returning({ id: entries.id });
    const [{ n }] = await tx.select({ n: count() }).from(entries).where(eq(entries.userId, session.userId));
    if (n > MAX_ENTRIES_PER_USER)
      throw errors.limitReached(
        `This import would go over the limit of ${MAX_ENTRIES_PER_USER} entries. Nothing was imported.`,
      );
    return inserted.length;
  });
  return json({ created } satisfies ImportResponse, 201);
});
