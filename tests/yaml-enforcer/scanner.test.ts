import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

function createTempDir(): string {
  const tmp = mkdtempSync(join(homedir(), "scanner-test-"));
  mkdirSync(join(tmp, "Areas"), { recursive: true });
  mkdirSync(join(tmp, "Projects"), { recursive: true });
  mkdirSync(join(tmp, "Resources"), { recursive: true });
  return tmp;
}

describe("findParaMdFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should find .md files in all PARA directories", async () => {
    const { findParaMdFiles } = await import("../../extensions/yaml-enforcer/scanner.js");

    writeFileSync(join(tmpDir, "Areas", "area-doc.md"), "---\ntitle: Area Doc\n---\nBody", "utf-8");
    writeFileSync(
      join(tmpDir, "Projects", "proj-doc.md"),
      "---\ntitle: Proj Doc\n---\nBody",
      "utf-8",
    );
    writeFileSync(
      join(tmpDir, "Resources", "res-doc.md"),
      "---\ntitle: Res Doc\n---\nBody",
      "utf-8",
    );

    const files = await findParaMdFiles(tmpDir);
    expect(files).toHaveLength(3);

    // All returned files should end with .md
    for (const f of files) {
      expect(f).toMatch(/\.md$/);
    }
  });

  it("should skip non-.md files", async () => {
    const { findParaMdFiles } = await import("../../extensions/yaml-enforcer/scanner.js");

    writeFileSync(join(tmpDir, "Areas", "notes.md"), "# Notes", "utf-8");
    writeFileSync(join(tmpDir, "Areas", "data.json"), "{}", "utf-8");
    writeFileSync(join(tmpDir, "Areas", "image.png"), "fake-png", "utf-8");

    const files = await findParaMdFiles(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/notes\.md$/);
  });

  it("should return empty array when no PARA dirs have files", async () => {
    const { findParaMdFiles } = await import("../../extensions/yaml-enforcer/scanner.js");
    const files = await findParaMdFiles(tmpDir);
    expect(files).toEqual([]);
  });

  it("should return files sorted alphabetically", async () => {
    const { findParaMdFiles } = await import("../../extensions/yaml-enforcer/scanner.js");

    writeFileSync(join(tmpDir, "Areas", "zeta.md"), "# Z", "utf-8");
    writeFileSync(join(tmpDir, "Areas", "alpha.md"), "# A", "utf-8");
    writeFileSync(join(tmpDir, "Areas", "beta.md"), "# B", "utf-8");

    const files = await findParaMdFiles(tmpDir);
    const basenames = files.map((f) => f.split("/").pop() ?? "");
    // Should be sorted: alpha.md, beta.md, zeta.md
    expect(basenames).toEqual(["alpha.md", "beta.md", "zeta.md"]);
  });

  it("should handle missing PARA directories gracefully", async () => {
    const { findParaMdFiles } = await import("../../extensions/yaml-enforcer/scanner.js");
    // tmpDir has all PARA dirs, but let's test with an empty base dir
    const emptyDir = mkdtempSync(join(homedir(), "scanner-empty-"));
    try {
      // Don't create any PARA subdirs
      const files = await findParaMdFiles(emptyDir);
      expect(files).toEqual([]);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("should handle some missing PARA directories", async () => {
    const { findParaMdFiles } = await import("../../extensions/yaml-enforcer/scanner.js");
    // Only create Areas, skip Projects and Resources
    mkdirSync(join(tmpDir, "Areas"), { recursive: true });
    writeFileSync(join(tmpDir, "Areas", "doc.md"), "# Doc", "utf-8");

    // Remove Projects and Resources
    rmSync(join(tmpDir, "Projects"), { recursive: true, force: true });
    rmSync(join(tmpDir, "Resources"), { recursive: true, force: true });

    const files = await findParaMdFiles(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/doc\.md$/);
  });

  it("should return absolute paths", async () => {
    const { findParaMdFiles } = await import("../../extensions/yaml-enforcer/scanner.js");

    writeFileSync(join(tmpDir, "Areas", "abs-test.md"), "# Test", "utf-8");

    const files = await findParaMdFiles(tmpDir);
    expect(files.length).toBeGreaterThanOrEqual(1);
    // Paths should be absolute (starting with /)
    for (const f of files) {
      expect(f.startsWith("/")).toBe(true);
    }
  });
});
