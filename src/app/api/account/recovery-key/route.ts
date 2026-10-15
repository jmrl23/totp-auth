import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { errors } from "@/lib/server/errors";
import { json, route } from "@/lib/server/http";
import { verifyAuthKey } from "@/lib/server/password";
import { lim, LIMITS } from "@/lib/server/rate-limit";
import { generateRecoveryKey, hashRecoveryKey } from "@/lib/server/recovery-key";
import { getUserById } from "@/lib/server/users";
import { regenerateRecoveryKeyRequestSchema, type RegisterResponse } from "@/lib/schemas";

/** Replaces the recovery key after re-proving the password. The new key is returned once. */
export const POST = route(
  { auth: "active", limits: ({ session }) => [lim(`recovery-key:user:${session.userId}`, LIMITS.recoveryKey.user)] },
  async ({ session, body }) => {
    const { authKey } = await body(regenerateRecoveryKeyRequestSchema);
    const user = await getUserById(session.userId);
    if (!user) throw errors.unauthorized();
    if (!(await verifyAuthKey(user.authHash, authKey))) throw errors.wrongPassword();
    const recoveryKey = generateRecoveryKey();
    await getDb()
      .update(users)
      .set({ recoveryKeyHash: hashRecoveryKey(recoveryKey), recoveryKeyCreatedAt: new Date() })
      .where(eq(users.id, user.id));
    return json({ recoveryKey } satisfies RegisterResponse);
  },
);
