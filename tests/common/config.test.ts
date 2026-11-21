import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadParadocsConfig } from "../../common/config.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paradocs-config-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Write the given object as paradocs.json in the temp directory. */
function writeConfig(value: unknown): void {
  writeFileSync(join(dir, "paradocs.json"), JSON.stringify(value), "utf8");
}

describe("loadParadocsConfig", () => {
  it("returns built-in defaults when paradocs.json is missing", () => {
    const { config, issues } = loadParadocsConfig(dir);

    expect(issues).toEqual([]);
    expect(config.freshness.defaultWindowDays).toBe(365);
    expect(config.freshness.tagWindows).toEqual({});
    expect(config.recall.maxChars).toBe(2000);
    expect(config.recall.maxTerms).toBe(12);
    expect(config.recall.timeoutMs).toBe(150);
    expect(config.recall.maxHits).toBe(5);
    expect(config.recall.minMatchedTerms).toBe(2);
    expect(config.recall.skipPatterns).toEqual([]);
    expect(config.note.maxContentLines).toBe(60);
    expect(config.note.wrapWidth).toBe(80);
    expect(config.note.maxLinks).toBe(5);
  });

  it("deep-merges a partial file over the defaults", () => {
    writeConfig({
      freshness: { tagWindows: { rust: null, legacy: 30 } },
      recall: { maxHits: 9, skipPatterns: ["^scratch/"] },
      note: { wrapWidth: 100 },
    });

    const { config, issues } = loadParadocsConfig(dir);

    expect(issues).toEqual([]);
    expect(config.freshness.defaultWindowDays).toBe(365);
    expect(config.freshness.tagWindows.rust).toBeNull();
    expect(config.freshness.tagWindows.legacy).toBe(30);
    expect(config.recall.maxChars).toBe(2000);
    expect(config.recall.maxHits).toBe(9);
    expect(config.recall.skipPatterns).toEqual(["^scratch/"]);
    expect(config.note.wrapWidth).toBe(100);
    expect(config.note.maxContentLines).toBe(60);
    expect(config.note.maxLinks).toBe(5);
  });

  it("returns defaults plus an issue for invalid JSON", () => {
    writeFileSync(join(dir, "paradocs.json"), "{ not json", "utf8");

    const { config, issues } = loadParadocsConfig(dir);

    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(" ")).toContain("invalid JSON");
    expect(config.recall.maxChars).toBe(2000);
    expect(config.note.maxContentLines).toBe(60);
  });

  it("falls back to the default and reports an issue for wrongly typed values", () => {
    writeConfig({
      recall: { maxChars: "lots" },
      note: { wrapWidth: -5 },
      freshness: { tagWindows: { rust: "old" } },
    });

    const { config, issues } = loadParadocsConfig(dir);

    expect(config.recall.maxChars).toBe(2000);
    expect(config.note.wrapWidth).toBe(80);
    expect(config.freshness.tagWindows.rust).toBeUndefined();
    expect(issues).toHaveLength(3);
    expect(issues.join(" ")).toContain("recall.maxChars");
    expect(issues.join(" ")).toContain("note.wrapWidth");
    expect(issues.join(" ")).toContain("freshness.tagWindows");
  });
});
