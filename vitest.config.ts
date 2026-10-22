import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` throws outside a React Server Components build; tests run server code directly.
      "server-only": path.resolve(import.meta.dirname, "test/unit/helpers/server-only-stub.ts"),
    },
  },
  test: {
    include: ["test/unit/**/*.test.ts"],
    environment: "node",
    globalSetup: ["test/unit/helpers/global-setup.ts"],
    setupFiles: ["test/unit/helpers/env-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    pool: "forks",
  },
});
