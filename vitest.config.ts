import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["extensions/**/*.ts", "common/**/*.ts"],
      exclude: ["**/node_modules/**", "**/*.d.ts"],
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 70,
        lines: 70,
      },
    },
    testTimeout: 30_000,
  },
  resolve: {
    extensions: [".ts", ".js", ".json"],
  },
});
