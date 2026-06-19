import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface PiManifest {
  extensions?: string[];
  skills?: string[];
  prompts?: string[];
  themes?: string[];
}

function loadPackageJson(): { pi: PiManifest | undefined } {
  return JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf-8")) as {
    pi: PiManifest | undefined;
  };
}

describe("package pi manifest", () => {
  const manifest = loadPackageJson().pi;

  it("should have a pi manifest that declares resource directories", () => {
    expect(manifest).toBeDefined();
  });

  it("should declare extensions directory", () => {
    expect(manifest!.extensions).toContain("./extensions");
  });

  it("should declare skills directory", () => {
    expect(manifest!.skills).toContain("./skills");
    expect(manifest!.skills).not.toContain("!./skills/AGENTS.md");
  });

  it("should not have AGENTS.md in skills directory to avoid skill conflicts", () => {
    expect(existsSync(resolve(__dirname, "../skills/AGENTS.md"))).toBe(false);
  });

  it("should not declare prompts or themes directories", () => {
    expect(manifest!.prompts).toBeUndefined();
    expect(manifest!.themes).toBeUndefined();
  });
});
