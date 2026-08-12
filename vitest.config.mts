import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Next's tsconfig sets `jsx: preserve`, which makes Vite's transform leave
  // JSX untransformed. plugin-react compiles it for the test run.
  plugins: [react()],
  test: {
    // jsdom for hooks/component tests; pure logic tests don't care.
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: [
        "src/lib/accounts.ts",
        "src/lib/balances.ts",
        "src/lib/balance-screen.ts",
        "src/store/balances.ts",
        "src/lib/transactions/activity-filters.ts",
        "src/lib/transactions/activity-model.ts",
        "src/lib/transactions/activity-query.ts",
        "src/lib/bills/commands.ts",
        "src/lib/bills/model.ts",
        "src/lib/bills/recurrence.ts",
        "src/store/bills.ts",
      ],
      thresholds: {
        functions: 95,
        lines: 95,
        statements: 95,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
});
