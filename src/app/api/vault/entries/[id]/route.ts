import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { entries } from "@/db/schema";
import { errors } from "@/lib/server/errors";
import { BODY_LIMITS, json, noContent, route } from "@/lib/server/http";
import { assertSessionLive, lockUser } from "@/lib/server/users";
import { updateEntryRequestSchema, uuidSchema, type EntryResponse } from "@/lib/schemas";

type Params = { id: string };

function entryId(params: Params): string {
  const parsed = uuidSchema.safeParse(params.id);
  if (!parsed.success) throw errors.notFound("That entry does not exist.");
  return parsed.data;
}

/** 200 { entry }; 404 when the id is unknown or belongs to someone else. */
export const PUT = route<Params, "active">({ auth: "active", maxBody: BODY_LIMITS.entry }, async ({ session, params, body }) => {
  const id = entryId(params);
  const input = await body(updateEntryRequestSchema);
  const row = await getDb().transaction(async (tx) => {
    // Serializes with password change (which also locks the user) and re-checks the session.
    await lockUser(tx, session.userId);
    await assertSessionLive(tx, session.id);
    const [updated] = await tx
      .update(entries)
      .set({ ciphertext: input.ciphertext, iv: input.iv, updatedAt: new Date() })
      .where(and(eq(entries.id, id), eq(entries.userId, session.userId)))
      .returning();
    return updated;
  });
  if (!row) throw errors.notFound("That entry does not exist.");
  return json({
    entry: { id: row.id, ciphertext: row.ciphertext, iv: row.iv, updatedAt: row.updatedAt.toISOString() },
  } satisfies EntryResponse);
});

/** 204; 404 when the id is unknown or belongs to someone else. */
export const DELETE = route<Params, "active">({ auth: "active" }, async ({ session, params }) => {
  const id = entryId(params);
  const deleted = await getDb().transaction(async (tx) => {
    await lockUser(tx, session.userId);
    await assertSessionLive(tx, session.id);
    const res = await tx
      .delete(entries)
      .where(and(eq(entries.id, id), eq(entries.userId, session.userId)))
      .returning({ id: entries.id });
    return res.length;
  });
  if (deleted === 0) throw errors.notFound("That entry does not exist.");
  return noContent();
});
