import path from "node:path";
import { defineConfig } from "vitest/config";
import "dotenv/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Integration tests use a separate database so the dev data is never touched.
    env: {
      DATABASE_URL: process.env.DATABASE_URL_TEST ?? "postgres://totp:test@localhost:5433/totp_test",
      NODE_ENV: "test",
    },
    pool: "forks",
    fileParallelism: false,
  },
});
