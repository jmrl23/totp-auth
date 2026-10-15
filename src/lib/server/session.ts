import { getCurrentSession } from "./sessions";
import { getUserById } from "./users";

export type SessionUser = { id: string; username: string };

/**
 * For Server Components (page guards): the signed-in user, else null.
 * Reads the session cookie through next/headers, which also makes the page render dynamically
 * (required for the CSP nonce).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getCurrentSession();
  if (!session) return null;
  const user = await getUserById(session.userId);
  return user ? { id: user.id, username: user.username } : null;
}
