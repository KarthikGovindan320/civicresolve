// [TESTING] Vitest configuration. Tests run in Node against the real modules
// (no mocking of our own code); "server-only" is replaced by an empty module
// because it is a Next.js build-time guard, not runtime logic.
import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: { LOG_SILENT: "1" },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/empty.ts"),
    },
  },
});
