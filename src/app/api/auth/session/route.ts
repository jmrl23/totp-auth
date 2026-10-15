import { getDb } from "@/db";
import { errors } from "@/lib/server/errors";
import { json, route } from "@/lib/server/http";
import { clearedSessionCookie, destroySession, effectiveExpiry } from "@/lib/server/sessions";
import { getUserById } from "@/lib/server/users";
import type { SessionResponse } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export const GET = route({ auth: "active" }, async ({ session, setCookie }) => {
  const user = await getUserById(session.userId);
  if (!user) {
    await destroySession(getDb(), session.id);
    setCookie(clearedSessionCookie());
    throw errors.unauthorized();
  }
  return json({
    user: { id: user.id, username: user.username, kdfSalt: user.kdfSalt, kdfParams: user.kdfParams },
    recoveryKeyCreatedAt: user.recoveryKeyCreatedAt.toISOString(),
    expiresAt: effectiveExpiry(session).toISOString(),
  } satisfies SessionResponse);
});
