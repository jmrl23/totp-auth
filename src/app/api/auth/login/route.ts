import { getDb } from "@/db";
import { errors } from "@/lib/server/errors";
import { noContent, route } from "@/lib/server/http";
import { verifyAuthKey, verifyDummy } from "@/lib/server/password";
import { attempt, failureLimits } from "@/lib/server/rate-limit";
import { createSession, destroySession, readSessionToken, sessionCookie, sessionIdFromToken } from "@/lib/server/sessions";
import { findUserByUsername } from "@/lib/server/users";
import { loginRequestSchema } from "@/lib/schemas";

export const POST = route({}, async ({ req, body, ip, userAgent, setCookie }) => {
  const { username, authKey } = await body(loginRequestSchema);
  // Failure buckets: (username, ip) tight, username global loose, ip. Same for unknown users.
  const { limits, userIpKey } = failureLimits("login", username, ip);
  const pending = await attempt(limits);
  const user = await findUserByUsername(username);
  // Unknown user: same argon2 work, same response as a wrong password.
  const ok = user ? await verifyAuthKey(user.authHash, authKey) : await verifyDummy(authKey);
  if (!ok || !user) throw errors.invalidCredentials();
  await pending.succeeded([userIpKey]);

  const db = getDb();
  const previous = readSessionToken(req);
  if (previous) await destroySession(db, sessionIdFromToken(previous));
  const { token } = await createSession(db, user.id, userAgent);
  setCookie(sessionCookie(token));
  return noContent();
});
