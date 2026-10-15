import { and, eq, ne, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db";
import { sessions, type Session } from "@/db/schema";
import { randomToken, sha256Hex } from "./crypto";
import { getEnv } from "./env";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export const SESSION_TTL_MS = 14 * DAY;
export const ACTIVE_IDLE_MS = 3 * DAY;
/** last_seen_at is only rewritten when older than this, to avoid a write per request. */
const TOUCH_INTERVAL_MS = MINUTE;

export type IssuedSession = { token: string; session: Session };

type Conn = Db | Tx;

export function sessionIdFromToken(token: string): string {
  return sha256Hex(token);
}

/** Absolute or idle expiry, whichever comes first. */
export function effectiveExpiry(s: Pick<Session, "expiresAt" | "lastSeenAt">): Date {
  const idle = s.lastSeenAt.getTime() + ACTIVE_IDLE_MS;
  return new Date(Math.min(s.expiresAt.getTime(), idle));
}

export async function createSession(
  conn: Conn,
  userId: string,
  userAgent: string | null,
  now = new Date(),
): Promise<IssuedSession> {
  await pruneExpiredSessions(conn, now);
  const token = randomToken();
  const [session] = await conn
    .insert(sessions)
    .values({
      id: sessionIdFromToken(token),
      userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      userAgent: userAgent?.slice(0, 256) ?? null,
    })
    .returning();
  return { token, session };
}

/** Replaces the session row with a fresh token. Old token stops working. */
export async function rotateSession(conn: Conn, old: Session, now = new Date()): Promise<IssuedSession> {
  await conn.delete(sessions).where(eq(sessions.id, old.id));
  return createSession(conn, old.userId, old.userAgent, now);
}

export async function destroySession(conn: Conn, id: string): Promise<void> {
  await conn.delete(sessions).where(eq(sessions.id, id));
}

export async function destroyAllSessions(conn: Conn, userId: string): Promise<void> {
  await conn.delete(sessions).where(eq(sessions.userId, userId));
}

export async function destroyOtherSessions(conn: Conn, userId: string, keepId: string): Promise<void> {
  await conn.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, keepId)));
}

/**
 * Bounded, idempotent cleanup of dead sessions. Safe when several instances run it at once
 * (SKIP LOCKED, small batch); leftovers are rejected by validateSessionToken anyway.
 */
export async function pruneExpiredSessions(conn: Conn, now = new Date(), batch = 200): Promise<void> {
  const idleCutoff = new Date(now.getTime() - ACTIVE_IDLE_MS);
  await conn.execute(sql`
    DELETE FROM sessions WHERE ctid IN (
      SELECT ctid FROM sessions
      WHERE expires_at < ${now} OR last_seen_at < ${idleCutoff}
      LIMIT ${batch} FOR UPDATE SKIP LOCKED
    )
  `);
}

/** Returns the live session for a token, sliding the idle window. Expired rows are deleted. */
export async function validateSessionToken(token: string | undefined | null, now = new Date()): Promise<Session | null> {
  if (!token || token.length > 128) return null;
  const db = getDb();
  const id = sessionIdFromToken(token);
  const [s] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  if (!s) return null;
  if (effectiveExpiry(s).getTime() <= now.getTime()) {
    await destroySession(db, s.id);
    return null;
  }
  if (now.getTime() - s.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, s.id));
    return { ...s, lastSeenAt: now };
  }
  return s;
}

/* ---------- cookies ---------- */

export function sessionCookieName(): string {
  return getEnv().isHttps ? "__Host-sid" : "sid";
}

export function sessionCookieMaxAge(): number {
  return Math.floor(SESSION_TTL_MS / 1000);
}

export type CookieSpec = { name: string; value: string; maxAge: number };

export function serializeCookie({ name, value, maxAge }: CookieSpec): string {
  const parts = [`${name}=${value}`, "Path=/", `Max-Age=${maxAge}`, "HttpOnly", "SameSite=Strict"];
  if (getEnv().isHttps) parts.push("Secure");
  if (maxAge === 0) parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  return parts.join("; ");
}

export function sessionCookie(token: string): CookieSpec {
  return { name: sessionCookieName(), value: token, maxAge: sessionCookieMaxAge() };
}

export function clearedSessionCookie(): CookieSpec {
  return { name: sessionCookieName(), value: "", maxAge: 0 };
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

export function readSessionToken(req: Request): string | undefined {
  return readCookie(req.headers.get("cookie"), sessionCookieName());
}

/**
 * For Server Components and layouts (for example the /vault guard): the current session
 * from the request cookies, or null. Read-only apart from sliding the idle window.
 */
export async function getCurrentSession(): Promise<Session | null> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  return validateSessionToken(store.get(sessionCookieName())?.value);
}
