import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
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
