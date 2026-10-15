import { describe, expect, it } from "vitest";
import { placeholderPasswordProblems } from "./startup";

describe("startup placeholder password guard", () => {
  it("flags change-me in production only, naming keys not values", () => {
    const env = { NODE_ENV: "production", POSTGRES_PASSWORD: "change-me", DATABASE_URL: "postgres://totp:change-me@db:5432/totp" };
    expect(placeholderPasswordProblems(env)).toEqual(["POSTGRES_PASSWORD", "DATABASE_URL"]);
    expect(placeholderPasswordProblems({ ...env, NODE_ENV: "development" })).toEqual([]);
    expect(
      placeholderPasswordProblems({ NODE_ENV: "production", POSTGRES_PASSWORD: "x9", DATABASE_URL: "postgres://totp:x9@db/totp" }),
    ).toEqual([]);
  });
});
