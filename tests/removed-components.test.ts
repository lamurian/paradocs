import { existsSync, readFileSync, readdirSync, rmdirSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, it, expect } from "vitest";

import type { Dirent } from "node:fs";

const REMOVED_COMPONENTS = [
  "extensions/set-temperature.ts",
  "extensions/scope-gate.ts",
  "extensions/roadmap-scratchpad",
  "extensions/research-engine",
  "extensions/commands",
  "common/subagent.ts",
  "common/subagent-args.ts",
  "common/extractJson.ts",
  "common/atomicity.ts",
  "common/atomicity-parse.ts",
  "common/atomicity-prompts.ts",
  "common/createDocument.ts",
  "extensions/batch-create",
  "extensions/expand-bullets",
  "extensions/skill-gate.ts",
  "extensions/para-knowledge/tools/createDoc.ts",
  "extensions/para-knowledge/tools/updateDoc.ts",
  "extensions/para-knowledge/tools/findExistingSummary.ts",
];

const SEARCH_PATTERNS = ["roadmap-scratchpad", "set-temperature", "scope-gate"];

const CHECK_DIRS = ["extensions", "common", "skills"];

/**
 * Remove empty directory trees left behind by deleted files.
 *
 * Only empty directories are removed; a directory containing any file is
 * left untouched, so the existence assertions below still catch regressions.
 *
 * @param dir - Directory path to prune.
 * @returns True when the directory was empty (and removed).
 */
function pruneEmptyDirs(dir: string): boolean {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  let empty = true;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!pruneEmptyDirs(join(dir, entry.name))) empty = false;
    } else {
      empty = false;
    }
  }
  if (!empty) return false;
  try {
    rmdirSync(dir);
    return true;
  } catch {
    return false;
  }
}

/** Recursively collect all non-binary files in a directory (including .md). */
function getAllFiles(dir: string): string[] {
  const result: string[] = [];
  const walk = (d: string) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        result.push(full);
      }
    }
  };
  walk(dir);
  return result;
}

describe("removed components do not exist", () => {
  beforeAll(() => {
    for (const path of REMOVED_COMPONENTS) pruneEmptyDirs(path);
  });

  for (const path of REMOVED_COMPONENTS) {
    it(`${path} should not exist`, () => {
      expect(existsSync(path)).toBe(false);
    });
  }
});

describe("no remaining references to removed components", () => {
  // Collect all files across all check directories
  const allFiles: string[] = [];
  for (const dir of CHECK_DIRS) {
    allFiles.push(...getAllFiles(dir));
  }

  for (const pattern of SEARCH_PATTERNS) {
    it(`should have no mention of "${pattern}" in extensions/, common/, or skills/`, () => {
      const offenders: string[] = [];

      for (const file of allFiles) {
        // Skip binary/generated files
        if (
          file.endsWith(".png") ||
          file.endsWith(".jpg") ||
          file.endsWith(".gif") ||
          file.endsWith(".svg") ||
          file.endsWith(".ico") ||
          file.endsWith(".woff2") ||
          file.endsWith(".lockb")
        ) {
          continue;
        }

        const content = readFileSync(file, { encoding: "utf-8", flag: "r" });
        if (content.includes(pattern)) {
          offenders.push(file);
        }
      }

      expect(offenders).toEqual([]);
    });
  }
});

describe("global extensions are active", () => {
  const GLOBAL_EXT_DIR = "/home/lam/.pi/agent/extensions";

  const globalExtensions: Record<string, string[]> = {
    "model-temperature": ["src/index.ts", "temperature.json"],
    sandbox: ["index.ts", "guardrail.ts"],
  };

  for (const [extName, files] of Object.entries(globalExtensions)) {
    describe(extName, () => {
      for (const file of files) {
        const filePath = join(GLOBAL_EXT_DIR, extName, file);
        it(`${filePath} should exist`, () => {
          expect(existsSync(filePath)).toBe(true);
        });
      }
    });
  }
});
