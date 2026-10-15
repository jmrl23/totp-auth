import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { timingSafeEqualStr } from "@/lib/server/crypto";
import { errors } from "@/lib/server/errors";
import { json, route } from "@/lib/server/http";
import { hashAuthKey } from "@/lib/server/password";
import { lim, LIMITS } from "@/lib/server/rate-limit";
import { generateRecoveryKey, hashRecoveryKey } from "@/lib/server/recovery-key";
import { createSession, sessionCookie } from "@/lib/server/sessions";
import { findUserByUsername, registrationStatus } from "@/lib/server/users";
import { registerRequestSchema, type RegisterResponse } from "@/lib/schemas";

const TAKEN = "That username is taken.";

/** Serializes account creation across all instances so "first account wins" holds. */
const REGISTER_LOCK_KEY = 727_011_338;

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export const POST = route(
  { limits: ({ ip }) => [lim(`register:ip:${ip}`, LIMITS.register.ip)] },
  async ({ body, env, userAgent, setCookie }) => {
    const input = await body(registerRequestSchema);
    const status = await registrationStatus(env);
    if (!status.open) throw errors.registrationClosed();
    if (env.SETUP_TOKEN !== undefined && !timingSafeEqualStr(input.setupToken ?? "", env.SETUP_TOKEN)) {
      throw errors.forbidden("The setup token is not right.");
    }
    if (await findUserByUsername(input.username)) throw errors.conflict(TAKEN);

    const id = randomUUID();
    const recoveryKey = generateRecoveryKey();
    const authHash = await hashAuthKey(input.authKey);
    let token: string;
    try {
      token = await getDb().transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${REGISTER_LOCK_KEY})`);
        // Re-check under the lock: another sign-up may have finished a moment ago.
        if (!(await registrationStatus(env, tx)).open) throw errors.registrationClosed();
        await tx.insert(users).values({
          id,
          username: input.username,
          kdfSalt: input.kdfSalt,
          kdfParams: input.kdfParams,
          authHash,
          recoveryKeyHash: hashRecoveryKey(recoveryKey),
        });
        return (await createSession(tx, id, userAgent)).token;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw errors.conflict(TAKEN);
      throw err;
    }
    setCookie(sessionCookie(token));
    return json({ recoveryKey } satisfies RegisterResponse, 201);
  },
);
