import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { entries } from "@/db/schema";
import { errors } from "@/lib/server/errors";
import { BODY_LIMITS, noContent, route } from "@/lib/server/http";
import { hashAuthKey, verifyAuthKey } from "@/lib/server/password";
import { lim, LIMITS } from "@/lib/server/rate-limit";
import { destroyOtherSessions, rotateSession, sessionCookie } from "@/lib/server/sessions";
import { assertSessionLive, getUserById, lockUser, swapCredentials } from "@/lib/server/users";
import { changePasswordRequestSchema } from "@/lib/schemas";

const STALE = "Your vault changed while it was being re-encrypted. Reload and try again.";
const RACED = "Your password was changed somewhere else at the same time. Reload and try again.";

/**
 * 204. Swaps auth hash, KDF salt/params and every ciphertext atomically, signs out other sessions
 * and rotates the current session token.
 */
export const POST = route(
  {
    auth: "active",
    maxBody: BODY_LIMITS.password,
    limits: ({ session }) => [lim(`password:user:${session.userId}`, LIMITS.password.user)],
  },
  async ({ session, body, setCookie }) => {
    const input = await body(changePasswordRequestSchema);
    const user = await getUserById(session.userId);
    if (!user) throw errors.unauthorized();
    if (!(await verifyAuthKey(user.authHash, input.currentAuthKey))) throw errors.wrongPassword();

    const ids = input.entries.map((e) => e.id);
    if (new Set(ids).size !== ids.length) throw errors.invalidRequest("Each entry may appear only once.");
    const newHash = await hashAuthKey(input.newAuthKey);

    const token = await getDb().transaction(async (tx) => {
      await lockUser(tx, user.id);
      await assertSessionLive(tx, session.id);
      const current = await tx.select({ id: entries.id }).from(entries).where(eq(entries.userId, user.id));
      const want = new Set(ids);
      if (current.length !== want.size || current.some((r) => !want.has(r.id))) throw errors.conflict(STALE);

      const swapped = await swapCredentials(tx, {
        userId: user.id,
        expectedAuthHash: user.authHash,
        authHash: newHash,
        kdfSalt: input.newKdfSalt,
        kdfParams: input.newKdfParams,
      });
      if (!swapped) throw errors.conflict(RACED);

      const now = new Date();
      for (const e of input.entries) {
        await tx
          .update(entries)
          .set({ ciphertext: e.ciphertext, iv: e.iv, updatedAt: now })
          .where(and(eq(entries.id, e.id), eq(entries.userId, user.id)));
      }
      await destroyOtherSessions(tx, user.id, session.id);
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(entries)
        .where(eq(entries.userId, user.id));
      if (n !== want.size) throw errors.conflict(STALE);
      return (await rotateSession(tx, session)).token;
    });
    setCookie(sessionCookie(token));
    return noContent();
  },
);
