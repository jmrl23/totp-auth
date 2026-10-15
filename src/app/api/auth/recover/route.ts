import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { entries, users } from "@/db/schema";
import { errors } from "@/lib/server/errors";
import { json, route } from "@/lib/server/http";
import { hashAuthKey } from "@/lib/server/password";
import { attempt, failureLimits } from "@/lib/server/rate-limit";
import { decoyRecoveryHash, generateRecoveryKey, hashRecoveryKey, recoveryKeyMatches } from "@/lib/server/recovery-key";
import { createSession, destroyAllSessions, sessionCookie } from "@/lib/server/sessions";
import { findUserByUsername, lockUser } from "@/lib/server/users";
import { recoverRequestSchema, type RecoverResponse } from "@/lib/schemas";

/**
 * Forgotten password. The recovery key proves ownership of the account; the old vault cannot be
 * decrypted without the old password, so every entry is deleted. All sessions are revoked, the
 * credentials are replaced, and a new recovery key is issued (the old one is single use).
 */
export const POST = route({}, async ({ body, ip, userAgent, setCookie }) => {
  const input = await body(recoverRequestSchema);
  const { limits, userIpKey } = failureLimits("recover", input.username, ip);
  const pending = await attempt(limits);
  const user = await findUserByUsername(input.username);
  // Unknown user: same HMAC and compare against a decoy hash, same response as a wrong key.
  const oldHash = user?.recoveryKeyHash ?? decoyRecoveryHash(input.username);
  const ok = recoveryKeyMatches(oldHash, input.recoveryKey);
  if (!ok || !user) throw errors.recoveryFailed();
  await pending.succeeded([userIpKey]);

  const newAuthHash = await hashAuthKey(input.newAuthKey);
  const recoveryKey = generateRecoveryKey();
  const token = await getDb().transaction(async (tx) => {
    await lockUser(tx, user.id);
    // Only the caller that still holds the current key wins; a concurrent recovery gets a miss.
    const swapped = await tx
      .update(users)
      .set({
        authHash: newAuthHash,
        kdfSalt: input.newKdfSalt,
        kdfParams: input.newKdfParams,
        recoveryKeyHash: hashRecoveryKey(recoveryKey),
        recoveryKeyCreatedAt: new Date(),
      })
      .where(and(eq(users.id, user.id), eq(users.recoveryKeyHash, oldHash)))
      .returning({ id: users.id });
    if (swapped.length !== 1) throw errors.recoveryFailed();
    await tx.delete(entries).where(eq(entries.userId, user.id));
    await destroyAllSessions(tx, user.id);
    return (await createSession(tx, user.id, userAgent)).token;
  });
  setCookie(sessionCookie(token));
  return json({ recoveryKey } satisfies RecoverResponse);
});
