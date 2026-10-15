import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";
import {
  ACTIVE_IDLE_MS,
  createSession,
  destroyAllSessions,
  destroyOtherSessions,
  rotateSession,
  serializeCookie,
  sessionCookie,
  sessionCookieName,
  sessionIdFromToken,
  validateSessionToken,
} from "./sessions";
import { configureTestEnv, fakeSalt, kdfParams, setupTestDb } from "./testing/helpers";

setupTestDb();

async function newUser(username = "alice"): Promise<string> {
  const [u] = await getDb()
    .insert(users)
    .values({ username, kdfSalt: fakeSalt(), kdfParams, authHash: "x", recoveryKeyHash: "x" })
    .returning();
  return u.id;
}

describe("sessions", () => {
  it("stores only the sha256 of the token", async () => {
    const userId = await newUser();
    const { token, session } = await createSession(getDb(), userId, "ua");
    expect(session.id).toBe(sessionIdFromToken(token));
    expect(session.id).not.toContain(token);
    const rows = await getDb().select().from(sessions);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("validates live tokens and rejects unknown ones", async () => {
    const userId = await newUser();
    const { token } = await createSession(getDb(), userId, null);
    expect((await validateSessionToken(token))?.userId).toBe(userId);
    expect(await validateSessionToken("nope")).toBeNull();
    expect(await validateSessionToken(undefined)).toBeNull();
  });

  it("expires at the absolute TTL and deletes the row", async () => {
    const userId = await newUser();
    const t0 = new Date("2026-01-01T00:00:00Z");
    const { token } = await createSession(getDb(), userId, null, t0);
    const day = 24 * 3600_000;
    expect(await validateSessionToken(token, new Date(t0.getTime() + 2 * day))).not.toBeNull();
    expect(await validateSessionToken(token, new Date(t0.getTime() + 14 * day + 1))).toBeNull();
    expect(await getDb().select().from(sessions)).toHaveLength(0);
  });

  it("slides the active idle window but caps at 14 days absolute", async () => {
    const userId = await newUser();
    const t0 = Date.now();
    const { token } = await createSession(getDb(), userId, null, new Date(t0));
    // Idle for just under 3 days, then used: stays alive and the idle window moves.
    let t = t0 + ACTIVE_IDLE_MS - 60_000;
    expect(await validateSessionToken(token, new Date(t))).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      t += 2 * 24 * 3600_000;
      expect(await validateSessionToken(token, new Date(t))).not.toBeNull();
    }
    // Past 14 days absolute, even with recent activity.
    t = t0 + 14 * 24 * 3600_000 + 1;
    expect(await validateSessionToken(token, new Date(t))).toBeNull();
  });

  it("expires active sessions after 3 idle days", async () => {
    const userId = await newUser();
    const t0 = Date.now();
    const { token } = await createSession(getDb(), userId, null, new Date(t0));
    expect(await validateSessionToken(token, new Date(t0 + ACTIVE_IDLE_MS + 1))).toBeNull();
  });

  it("rotates the token and kills the old one", async () => {
    const userId = await newUser();
    const first = await createSession(getDb(), userId, "ua");
    const next = await rotateSession(getDb(), first.session);
    expect(next.token).not.toBe(first.token);
    expect(next.session.userAgent).toBe("ua");
    expect(await validateSessionToken(first.token)).toBeNull();
    expect(await validateSessionToken(next.token)).not.toBeNull();
  });

  it("revokes other sessions only", async () => {
    const userId = await newUser();
    const other = await newUser("bob");
    const keep = await createSession(getDb(), userId, null);
    await createSession(getDb(), userId, null);
    await createSession(getDb(), other, null);
    await destroyOtherSessions(getDb(), userId, keep.session.id);
    expect(await getDb().select().from(sessions).where(eq(sessions.userId, userId))).toHaveLength(1);
    expect(await getDb().select().from(sessions).where(eq(sessions.userId, other))).toHaveLength(1);
  });

  it("revokes every session of a user with destroyAllSessions", async () => {
    const userId = await newUser();
    const other = await newUser("bob");
    await createSession(getDb(), userId, null);
    await createSession(getDb(), userId, null);
    await createSession(getDb(), other, null);
    await destroyAllSessions(getDb(), userId);
    expect(await getDb().select().from(sessions).where(eq(sessions.userId, userId))).toHaveLength(0);
    expect(await getDb().select().from(sessions).where(eq(sessions.userId, other))).toHaveLength(1);
  });

  it("uses sid over http and __Host-sid with Secure over https", () => {
    expect(sessionCookieName()).toBe("sid");
    const plain = serializeCookie(sessionCookie("tok"));
    expect(plain).toMatch(/^sid=tok; Path=\/; Max-Age=1209600; HttpOnly; SameSite=Strict$/);
    configureTestEnv({ APP_ORIGIN: "https://auth.example.com" });
    expect(sessionCookieName()).toBe("__Host-sid");
    const secure = serializeCookie(sessionCookie("tok"));
    expect(secure).toContain("__Host-sid=tok");
    expect(secure).toContain("Secure");
    expect(secure).toContain("Max-Age=1209600");
    expect(secure).not.toContain("Domain");
  });
});
