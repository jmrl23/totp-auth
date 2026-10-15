import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["@node-rs/argon2", "pg"],
  // Tailwind v4 runs through the turbopack loader that is installed (@tailwindcss/turbopack);
  // @tailwindcss/postcss is not a dependency of this project.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Migrations are read at runtime from ./drizzle by instrumentation.ts.
  outputFileTracingIncludes: {
    "/*": ["./drizzle/**/*"],
  },
};

export default nextConfig;
