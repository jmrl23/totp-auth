import { count, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { entries } from "@/db/schema";
import { errors } from "@/lib/server/errors";
import { BODY_LIMITS, json, route } from "@/lib/server/http";
import { assertSessionLive, lockUser } from "@/lib/server/users";
import { createEntryRequestSchema, MAX_ENTRIES_PER_USER, type EntryResponse } from "@/lib/schemas";

/** 201 { entry }. 409 conflict if the id exists, 409 limit_reached at MAX_ENTRIES_PER_USER. */
export const POST = route({ auth: "active", maxBody: BODY_LIMITS.entry }, async ({ session, body }) => {
  const input = await body(createEntryRequestSchema);
  const row = await getDb().transaction(async (tx) => {
    await lockUser(tx, session.userId);
    await assertSessionLive(tx, session.id);
    const [{ n }] = await tx.select({ n: count() }).from(entries).where(eq(entries.userId, session.userId));
    if (n >= MAX_ENTRIES_PER_USER)
      throw errors.limitReached(`You can store at most ${MAX_ENTRIES_PER_USER} entries.`);
    const now = new Date();
    const [created] = await tx
      .insert(entries)
      .values({ id: input.id, userId: session.userId, ciphertext: input.ciphertext, iv: input.iv, createdAt: now, updatedAt: now })
      .onConflictDoNothing({ target: entries.id })
      .returning();
    if (!created) throw errors.conflict("An entry with this id already exists.");
    return created;
  });
  return json(
    { entry: { id: row.id, ciphertext: row.ciphertext, iv: row.iv, updatedAt: row.updatedAt.toISOString() } } satisfies EntryResponse,
    201,
  );
});
