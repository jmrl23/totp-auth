import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { errors } from "./errors";

export type Limit = { key: string; limit: number; windowSec: number };
type Rule = { limit: number; windowSec: number };

const MIN = 60;
const HOUR = 60 * MIN;

/**
 * Central table of limits.
 * - `*Fail` rules count FAILED attempts only (a success refunds or resets them), so other people's
 *   failures from other IPs cannot lock the owner out. `userIp` is the tight per-(user, ip) bucket,
 *   `user` a looser global cap so distributed guessing stays bounded.
 * - prelogin and register keep plain per-IP request caps (no username bucket to abuse).
 * - recoveryKey and password are per signed-in account.
 * With TRUST_PROXY=false every client shares the single "unknown" IP bucket (documented trade-off).
 */
export const LIMITS = {
  prelogin: { ip: { limit: 60, windowSec: 15 * MIN } },
  register: { ip: { limit: 10, windowSec: HOUR } },
  loginFail: { userIp: { limit: 5, windowSec: 15 * MIN }, user: { limit: 30, windowSec: HOUR }, ip: { limit: 30, windowSec: 15 * MIN } },
  recoverFail: { userIp: { limit: 5, windowSec: 15 * MIN }, user: { limit: 10, windowSec: HOUR }, ip: { limit: 30, windowSec: 15 * MIN } },
  unlockFail: { userIp: { limit: 5, windowSec: 15 * MIN }, user: { limit: 30, windowSec: HOUR }, ip: { limit: 30, windowSec: 15 * MIN } },
  recoveryKey: { user: { limit: 5, windowSec: HOUR } },
  password: { user: { limit: 5, windowSec: HOUR } },
} satisfies Record<string, Record<string, Rule>>;

export const lim = (key: string, rule: Rule): Limit => ({ key, ...rule });

/** Standard failure-counting buckets for a credential check keyed by account name and client IP. */
export function failureLimits(
  scope: "login" | "recover" | "unlock",
  account: string,
  ip: string,
): { limits: Limit[]; userIpKey: string } {
  const rules = LIMITS[`${scope}Fail`];
  const userIpKey = `${scope}:fail:user-ip:${account}:${ip}`;
  return {
    userIpKey,
    limits: [lim(userIpKey, rules.userIp), lim(`${scope}:fail:user:${account}`, rules.user), lim(`${scope}:fail:ip:${ip}`, rules.ip)],
  };
}

export type HitResult = { count: number; allowed: boolean; retryAfter: number };

/**
 * Atomic fixed-window reservation. Increments only while the window is below its limit (or has
 * expired), so blocked requests never inflate the counter. Returns allowed=false when full.
 */
export async function hit({ key, limit, windowSec }: Limit): Promise<HitResult> {
  const db = getDb();
  const res = await db.execute<{ count: number; retry_after: number }>(sql`
    INSERT INTO rate_limits (key, count, reset_at)
    VALUES (${key}, 1, now() + make_interval(secs => ${windowSec}))
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.count + 1 END,
      reset_at = CASE WHEN rate_limits.reset_at <= now() THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END
    WHERE rate_limits.reset_at <= now() OR rate_limits.count < ${limit}
    RETURNING count, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (reset_at - now()))))::int AS retry_after
  `);
  const row = res.rows[0];
  if (row) return { count: row.count, allowed: true, retryAfter: row.retry_after };
  const cur = await db.execute<{ count: number; retry_after: number }>(sql`
    SELECT count, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (reset_at - now()))))::int AS retry_after
    FROM rate_limits WHERE key = ${key}
  `);
  return { count: cur.rows[0]?.count ?? limit, allowed: false, retryAfter: cur.rows[0]?.retry_after ?? windowSec };
}

async function refund(key: string): Promise<void> {
  await getDb().execute(sql`UPDATE rate_limits SET count = GREATEST(count - 1, 0) WHERE key = ${key} AND reset_at > now()`);
}

async function reset(key: string): Promise<void> {
  await getDb().execute(sql`DELETE FROM rate_limits WHERE key = ${key}`);
}

export type Attempt = {
  /** Call on success: listed keys are cleared, all other reserved keys get their hit refunded. */
  succeeded: (resetKeys?: string[]) => Promise<void>;
};

/**
 * Reserves one hit on every key. If any key is full, refunds the ones already taken and throws 429
 * with the longest wait. On failure, do nothing: the reservation stands as the failure count.
 */
export async function attempt(limits: Limit[]): Promise<Attempt> {
  const taken: string[] = [];
  let retryAfter = 0;
  for (const l of limits) {
    const r = await hit(l);
    if (r.allowed) taken.push(l.key);
    else retryAfter = Math.max(retryAfter, r.retryAfter);
  }
  maybePrune();
  if (retryAfter > 0) {
    await Promise.all(taken.map(refund));
    throw errors.rateLimited(retryAfter);
  }
  return {
    succeeded: async (resetKeys = []) => {
      await Promise.all(taken.map((k) => (resetKeys.includes(k) ? reset(k) : refund(k))));
    },
  };
}

/** Plain request cap: every request counts. Throws 429 when any key is full. */
export async function enforce(limits: Limit[]): Promise<void> {
  await attempt(limits);
}

/**
 * Opportunistic, bounded and idempotent cleanup. The timestamp below is only a per-process
 * throttle; several instances pruning concurrently is harmless (SKIP LOCKED, small batches).
 */
let lastPrune = 0;
function maybePrune(): void {
  const now = Date.now();
  if (now - lastPrune < 10 * MIN * 1000) return;
  lastPrune = now;
  pruneRateLimits().catch(() => undefined);
}

export async function pruneRateLimits(batch = 1000): Promise<number> {
  const res = await getDb().execute(sql`
    DELETE FROM rate_limits WHERE ctid IN (
      SELECT ctid FROM rate_limits WHERE reset_at < now() - interval '1 hour' LIMIT ${batch} FOR UPDATE SKIP LOCKED
    )
  `);
  return res.rowCount ?? 0;
}

/**
 * Client IP for rate limiting. Only trusts X-Forwarded-For when TRUST_PROXY=true; the reverse
 * proxy must overwrite (not append to) that header, and we take the right-most hop.
 */
export function clientIp(req: Request, trustProxy: boolean): string {
  if (!trustProxy) return "unknown";
  const xff = req.headers.get("x-forwarded-for");
  const last = xff?.split(",").map((s) => s.trim()).filter(Boolean).pop();
  return last && last.length <= 64 ? last : "unknown";
}
