import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // v8 coverage with isolate=true mis-attributes per-file coverage in
    // full-suite merges (mocked modules report 0 percent and overwrite real
    // executions). Shared registry keeps one instance per module; affected
    // test files re-import via vi.resetModules in their importFresh helpers.
    isolate: false,
    coverage: {
      provider: "v8",
      include: ["extensions/**/*.ts", "common/**/*.ts"],
      exclude: ["**/node_modules/**", "**/*.d.ts", "**/index.ts"],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
    testTimeout: 60_000,
  },
  resolve: {
    extensions: [".ts", ".js", ".json"],
  },
});
