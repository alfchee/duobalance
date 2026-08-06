import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
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
  esbuild: {
    // Next's tsconfig sets `jsx: preserve`, which makes esbuild leave JSX
    // untransformed. Test files need it compiled, so override here.
    jsx: "automatic",
  },
});
