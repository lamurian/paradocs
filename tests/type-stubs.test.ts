import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

import { describe, it, expect } from "vitest";

const TYPES_DIR = new URL("../types/", import.meta.url).pathname;
const STUB_FILE = `${TYPES_DIR}citation-js.d.ts`;

describe("type stubs migration", () => {
  it("should have citation-js.d.ts in types/", () => {
    expect(existsSync(STUB_FILE)).toBe(true);
  });

  it("should declare all four citation-js modules", () => {
    const content = readFileSync(STUB_FILE, "utf-8");

    expect(content).toContain('declare module "@citation-js/core"');
    expect(content).toContain('declare module "@citation-js/plugin-doi"');
    expect(content).toContain('declare module "@citation-js/plugin-bibtex"');
    expect(content).toContain('declare module "@citation-js/plugin-url"');
  });

  it("should declare Cite class with async and format", () => {
    const content = readFileSync(STUB_FILE, "utf-8");

    expect(content).toContain("static async");
    expect(content).toContain("format:");
    expect(content).toContain("CSLData[]");
  });

  it("should have no eslint-disable comment in production file", () => {
    const content = readFileSync(STUB_FILE, "utf-8");

    // The source has /* eslint-disable */ — that was for Cognoscere's config.
    // In paradocs we don't lint .d.ts files, so we should strip it.
    expect(content).not.toContain("eslint-disable");
  });
});

describe("tsconfig type coverage", () => {
  it("should include types/**/*.d.ts in tsconfig", () => {
    const tsconfig = readFileSync("tsconfig.json", "utf-8");

    expect(tsconfig).toContain("types/**/*.d.ts");
  });
});

describe("TypeScript compilation", () => {
  it("should pass typecheck with type stubs installed", () => {
    const result = execSync("npx tsc --noEmit", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });

    // tsc --noEmit outputs nothing on success
    expect(result.trim()).toBe("");
  });
});
