import { readFile } from "node:fs/promises";

import { describe, it, expect } from "vitest";

describe("coverage hard gate", () => {
  it("should set global coverage thresholds to 80/70/80/80 in vitest.config.ts", async () => {
    const config = await readFile("vitest.config.ts", "utf-8");
    expect(config).toContain("statements: 80");
    expect(config).toContain("branches: 70");
    expect(config).toContain("functions: 80");
    expect(config).toContain("lines: 80");
  });

  it("should include --coverage in the npm test script", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf-8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.test).toContain("--coverage");
  });
});
