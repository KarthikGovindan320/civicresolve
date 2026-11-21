// Vitest configuration. Server tests (*.test.ts) run in Node against the real modules; component
// tests (*.test.tsx) opt in to jsdom with a `@vitest-environment jsdom` docblock and use
// Testing Library. Our own code is not mocked; "server-only" is replaced by an empty module
// because it is a Next.js build-time guard, not runtime logic.
import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
    env: { LOG_SILENT: "1" },
    // Coverage is measured on the server code (domain logic, services, API routes). Browser-only
    // helpers in src/lib/client are exercised through the UI instead. The thresholds sit just
    // below the current numbers so coverage can only go up.
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/app/api/**"],
      exclude: ["src/lib/client/**"],
      reporter: ["text-summary", "text"],
      thresholds: { statements: 85, branches: 79, functions: 88, lines: 89 },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/empty.ts"),
    },
  },
});
