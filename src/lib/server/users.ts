import { and, count, eq, sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "@/db";
import { users, type User } from "@/db/schema";
import type { KdfParams } from "@/lib/schemas";
import type { Env } from "./env";
import { errors } from "./errors";

export async function findUserByUsername(username: string, conn: Db | Tx = getDb()): Promise<User | null> {
  const [u] = await conn.select().from(users).where(eq(users.username, username)).limit(1);
  return u ?? null;
}

export async function getUserById(id: string, conn: Db | Tx = getDb()): Promise<User | null> {
  const [u] = await conn.select().from(users).where(eq(users.id, id)).limit(1);
  return u ?? null;
}

export async function confirmedUserCount(conn: Db | Tx = getDb()): Promise<number> {
  const [row] = await conn.select({ n: count() }).from(users);
  return row?.n ?? 0;
}

export type RegistrationStatus =
  | { open: true }
  | { open: false; reason: "setup_token_missing" | "closed" };

/**
 * Open while no account exists, or always when ALLOW_REGISTRATION=true.
 * First-run guard: with no account yet on a non-loopback origin, registration is open only if
 * SETUP_TOKEN is configured (and then the token is required), so nobody can take over a fresh
 * public instance. Purely derived from env + Postgres, so every instance agrees.
 */
export async function registrationStatus(env: Env, conn: Db | Tx = getDb()): Promise<RegistrationStatus> {
  const confirmed = await confirmedUserCount(conn);
  if (confirmed > 0 && !env.ALLOW_REGISTRATION) return { open: false, reason: "closed" };
  if (confirmed === 0 && !env.isLoopback && env.SETUP_TOKEN === undefined) {
    return { open: false, reason: "setup_token_missing" };
  }
  return { open: true };
}

export async function isRegistrationOpen(env: Env, conn: Db | Tx = getDb()): Promise<boolean> {
  return (await registrationStatus(env, conn)).open;
}

/** Locks the user row so concurrent vault writes cannot race past the entry limit. */
export async function lockUser(tx: Tx, userId: string): Promise<void> {
  await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
}

/**
 * Inside a transaction that holds lockUser: confirms the session row still exists and has not expired,
 * so a session revoked by a concurrent password change cannot keep writing.
 */
export async function assertSessionLive(tx: Tx, sessionId: string): Promise<void> {
  const res = await tx.execute(sql`
    SELECT 1 FROM sessions WHERE id = ${sessionId} AND expires_at > now() FOR SHARE
  `);
  if (res.rows.length === 0) throw errors.unauthorized();
}

/**
 * Swaps the password-derived credentials only if the stored hash is still the one the caller
 * verified. Returns false when a concurrent change won.
 */
export async function swapCredentials(
  tx: Tx,
  input: { userId: string; expectedAuthHash: string; authHash: string; kdfSalt: string; kdfParams: KdfParams },
): Promise<boolean> {
  const res = await tx
    .update(users)
    .set({ authHash: input.authHash, kdfSalt: input.kdfSalt, kdfParams: input.kdfParams })
    .where(and(eq(users.id, input.userId), eq(users.authHash, input.expectedAuthHash)))
    .returning({ id: users.id });
  return res.length === 1;
}
