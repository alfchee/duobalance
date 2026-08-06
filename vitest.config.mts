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
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
});
