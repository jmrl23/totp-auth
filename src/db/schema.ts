import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { KdfParams } from "@/lib/schemas";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  /** Always stored lowercased (usernameSchema lowercases). */
  username: text("username").notNull().unique(),
  kdfSalt: text("kdf_salt").notNull(),
  kdfParams: jsonb("kdf_params").$type<KdfParams>().notNull(),
  authHash: text("auth_hash").notNull(),
  /** HMAC-SHA256(SERVER_PEPPER, normalized recovery key), hex. The key itself is never stored. */
  recoveryKeyHash: text("recovery_key_hash").notNull(),
  recoveryKeyCreatedAt: tz("recovery_key_created_at").notNull().defaultNow(),
  createdAt: tz("created_at").notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    /** sha256 hex of the cookie token. The token itself is never stored. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: tz("created_at").notNull().defaultNow(),
    lastSeenAt: tz("last_seen_at").notNull().defaultNow(),
    expiresAt: tz("expires_at").notNull(),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId), index("sessions_expires_at_idx").on(t.expiresAt)],
);

export const entries = pgTable(
  "entries",
  {
    /** Client-generated UUID; also bound into the AES-GCM AAD. */
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [index("entries_user_id_idx").on(t.userId)],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetAt: tz("reset_at").notNull(),
});

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Entry = typeof entries.$inferSelect;
