import { getDb } from "@/db";
import { noContent, route } from "@/lib/server/http";
import { clearedSessionCookie, destroySession } from "@/lib/server/sessions";

/** Deletes the current session and clears the cookie. Idempotent: always 204. */
export const POST = route({ auth: "optional" }, async ({ session, setCookie }) => {
  if (session) await destroySession(getDb(), session.id);
  setCookie(clearedSessionCookie());
  return noContent();
});
