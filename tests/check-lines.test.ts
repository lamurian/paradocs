import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("check-lines.mjs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "check-lines-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("checkFile", () => {
    it("should report files exceeding 300 lines as over limit", async () => {
      const lines = Array.from({ length: 301 }, (_, i) => `// line ${i + 1}`);
      const longFile = join(tmpDir, "long.ts");
      writeFileSync(longFile, lines.join("\n"));

      const { checkFile } = await import("../scripts/check-lines.mjs");

      const result = checkFile(longFile, 300);
      expect(result.overLimit).toBe(true);
      expect(result.lineCount).toBe(301);
      expect(result.file).toBe(longFile);
    });

    it("should report files within 300 lines as ok", async () => {
      const lines = Array.from({ length: 100 }, (_, i) => `// line ${i + 1}`);
      const shortFile = join(tmpDir, "short.ts");
      writeFileSync(shortFile, lines.join("\n"));

      const { checkFile } = await import("../scripts/check-lines.mjs");

      const result = checkFile(shortFile, 300);
      expect(result.overLimit).toBe(false);
      expect(result.lineCount).toBe(100);
      expect(result.file).toBe(shortFile);
    });

    it("should use custom maxLines parameter", async () => {
      const lines = Array.from({ length: 5 }, (_, i) => `// line ${i + 1}`);
      const file = join(tmpDir, "tiny.ts");
      writeFileSync(file, lines.join("\n"));

      const { checkFile } = await import("../scripts/check-lines.mjs");

      // With maxLines=3, this 5-line file should be over limit
      const result = checkFile(file, 3);
      expect(result.overLimit).toBe(true);
      expect(result.lineCount).toBe(5);
    });

    it("should handle empty files", async () => {
      const emptyFile = join(tmpDir, "empty.ts");
      writeFileSync(emptyFile, "");

      const { checkFile } = await import("../scripts/check-lines.mjs");

      const result = checkFile(emptyFile, 300);
      expect(result.overLimit).toBe(false);
      expect(result.lineCount).toBe(1); // empty string split by "\n" gives [""]
    });
  });

  describe("checkDirectory", () => {
    it("should return empty result array when directory has no .ts files", async () => {
      const emptyDir = join(tmpDir, "nofiles");
      const { checkDirectory } = await import("../scripts/check-lines.mjs");

      const results = checkDirectory(emptyDir);
      expect(results).toEqual([]);
    });

    it("should return results for all .ts files in a directory", async () => {
      writeFileSync(join(tmpDir, "a.ts"), "// a\n");
      writeFileSync(join(tmpDir, "b.ts"), "// b\n");

      const { checkDirectory } = await import("../scripts/check-lines.mjs");

      const results = checkDirectory(tmpDir, 300);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.overLimit === false)).toBe(true);
    });

    it("should discover .ts files in subdirectories", async () => {
      const subDir = join(tmpDir, "sub");
      mkdirSync(subDir, { recursive: true });
      writeFileSync(join(subDir, "deep.ts"), "// deep\n");

      const { checkDirectory } = await import("../scripts/check-lines.mjs");
      const results = checkDirectory(tmpDir, 300);
      expect(results).toHaveLength(1);
      expect(results[0].file).toContain("deep.ts");
    });
  });
});
