import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { HttpError } from "./errors";
import { attempt, clientIp, enforce, hit, pruneRateLimits } from "./rate-limit";
import { setupTestDb } from "./testing/helpers";

setupTestDb();

describe("rate limiter", () => {
  it("allows up to the limit then blocks with a retry time", async () => {
    const l = { key: "t:a", limit: 3, windowSec: 60 };
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await hit(l));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3].retryAfter).toBeGreaterThan(0);
    expect(results[3].retryAfter).toBeLessThanOrEqual(60);
  });

  it("is atomic under concurrency and blocked hits do not inflate the counter", async () => {
    const l = { key: "t:c", limit: 10, windowSec: 60 };
    const results = await Promise.all(Array.from({ length: 25 }, () => hit(l)));
    const allowed = results.filter((r) => r.allowed);
    expect(allowed).toHaveLength(10);
    expect(allowed.map((r) => r.count).sort((a, b) => a - b)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
    const row = await getDb().execute<{ count: number }>(sql`SELECT count FROM rate_limits WHERE key = 't:c'`);
    expect(row.rows[0].count).toBe(10);
  });

  it("attempt() refunds on success, resets listed keys, and refunds partial reservations when blocked", async () => {
    const a = { key: "t:a1", limit: 2, windowSec: 60 };
    const b = { key: "t:b1", limit: 5, windowSec: 60 };
    const count = async (k: string) =>
      (await getDb().execute<{ count: number }>(sql`SELECT count FROM rate_limits WHERE key = ${k}`)).rows[0]?.count;
    const first = await attempt([a, b]);
    await first.succeeded([a.key]);
    expect(await count(a.key)).toBeUndefined();
    expect(await count(b.key)).toBe(0);
    await attempt([a, b]);
    await attempt([a, b]); // a is now full
    expect(await count(b.key)).toBe(2);
    await expect(attempt([b, a])).rejects.toMatchObject({ status: 429 });
    expect(await count(b.key)).toBe(2); // b's reservation was refunded
  });

  it("prunes expired rows in bounded batches", async () => {
    await getDb().execute(sql`
      INSERT INTO rate_limits (key, count, reset_at)
      SELECT 'old:' || g, 1, now() - interval '2 hours' FROM generate_series(1, 25) g
    `);
    await hit({ key: "fresh", limit: 1, windowSec: 60 });
    expect(await pruneRateLimits(10)).toBe(10);
    expect(await pruneRateLimits(100)).toBe(15);
    expect(await pruneRateLimits(100)).toBe(0);
    const left = await getDb().execute(sql`SELECT key FROM rate_limits`);
    expect(left.rows).toEqual([{ key: "fresh" }]);
  });

  it("starts a new window after reset_at", async () => {
    const l = { key: "t:w", limit: 1, windowSec: 60 };
    await hit(l);
    expect((await hit(l)).allowed).toBe(false);
    await getDb().execute(sql`UPDATE rate_limits SET reset_at = now() - interval '1 second' WHERE key = 't:w'`);
    const r = await hit(l);
    expect(r.allowed).toBe(true);
    expect(r.count).toBe(1);
  });

  it("enforce throws 429 with retryAfter when any key is over", async () => {
    const a = { key: "t:e1", limit: 5, windowSec: 60 };
    const b = { key: "t:e2", limit: 1, windowSec: 120 };
    await enforce([a, b]);
    const err = await enforce([a, b]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(429);
    expect((err as HttpError).retryAfter).toBeGreaterThan(60);
  });

  it("only trusts X-Forwarded-For when TRUST_PROXY is on, using the right-most hop", () => {
    const req = new Request("http://x/", { headers: { "x-forwarded-for": "6.6.6.6, 10.0.0.7" } });
    expect(clientIp(req, false)).toBe("unknown");
    expect(clientIp(req, true)).toBe("10.0.0.7");
    expect(clientIp(new Request("http://x/"), true)).toBe("unknown");
  });
});
