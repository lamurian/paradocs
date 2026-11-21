#!/usr/bin/env node

/**
 * check-lines.mjs
 *
 * Verifies that all .ts files under key source directories stay within
 * a configurable line limit (default 300).
 *
 * Exports:
 *   SOURCE_DIRS                    — directories covered by the line check
 *   checkFile(filePath, maxLines)  — check a single file
 *   checkDirectory(dirPath)        — find all .ts files recursively in a dir
 *   filterStagedFiles(files, dirs) — keep staged .ts files under SOURCE_DIRS
 *   main()                         — CLI entry point
 *
 * Usage: node scripts/check-lines.mjs [--staged] [--max-lines <n>]
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, extname } from "node:path";

const DEFAULT_MAX_LINES = 300;

/**
 * Directories scanned by the full check. Staged mode uses the same list so
 * artifacts generated elsewhere (e.g. .pi/) never trip the hook.
 * @type {string[]}
 */
export const SOURCE_DIRS = [
  "extensions",
  "common",
  "types",
  "scripts",
  "skills",
  "tests",
];

/**
 * Check a single file's line count against a limit.
 * @param {string} filePath - Absolute or relative path to the file.
 * @param {number} maxLines - Maximum allowed lines.
 * @returns {{ file: string, lineCount: number, overLimit: boolean }}
 */
export function checkFile(filePath, maxLines = DEFAULT_MAX_LINES) {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const lineCount = lines.length;

  return {
    file: filePath,
    lineCount,
    overLimit: lineCount > maxLines,
  };
}

/**
 * Recursively find all .ts files under a directory.
 * @param {string} dir - Directory to search.
 * @returns {string[]} List of matching file paths.
 */
function findTsFiles(dir) {
  const files = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        files.push(...findTsFiles(fullPath));
      } else if (extname(fullPath) === ".ts") {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist — skip
  }
  return files;
}

/**
 * Check all .ts files under a directory. Returns results for all found files.
 * @param {string} dir - Directory to scan.
 * @param {number} [maxLines] - Maximum allowed lines.
 * @returns {Array<{ file: string, lineCount: number, overLimit: boolean }>}
 */
export function checkDirectory(dir, maxLines = DEFAULT_MAX_LINES) {
  const files = findTsFiles(dir);
  return files.map((f) => checkFile(f, maxLines));
}

/**
 * Filter a list of staged paths to checkable .ts files under the source dirs.
 * A leading './' is stripped before matching, and only .ts files whose first
 * path segment appears in `dirs` are kept. Returned paths are normalized.
 * @param {string[]} files - Candidate file paths, typically staged paths.
 * @param {string[]} [dirs] - Directories to keep; defaults to SOURCE_DIRS.
 * @returns {string[]} Normalized paths ending in .ts under one of `dirs`.
 */
export function filterStagedFiles(files, dirs = SOURCE_DIRS) {
  const result = [];
  for (const file of files) {
    const normalized = file.startsWith("./") ? file.slice(2) : file;
    if (!normalized.endsWith(".ts")) continue;
    const firstSegment = normalized.split("/")[0];
    if (dirs.includes(firstSegment)) result.push(normalized);
  }
  return result;
}

/**
 * Find source directories to check based on CLI flags.
 * @returns {string[]}
 */
function getDirectories() {
  const isStaged = process.argv.includes("--staged");

  if (isStaged) {
    const output = execSync(
      "git diff --cached --name-only --diff-filter=ACM",
      { encoding: "utf-8" },
    );
    const staged = output.trim().split("\n").filter(Boolean);
    return filterStagedFiles(staged);
  }

  return SOURCE_DIRS;
}

/** CLI entry point. */
export function main() {
  const maxLinesIdx = process.argv.indexOf("--max-lines");
  const maxLines =
    maxLinesIdx !== -1
      ? Number.parseInt(process.argv[maxLinesIdx + 1], 10) || DEFAULT_MAX_LINES
      : DEFAULT_MAX_LINES;

  const targets = getDirectories();

  if (targets.length === 0) {
    console.log("✅ No .ts files to check.");
    process.exit(0);
  }

  let hasError = false;
  let totalChecked = 0;

  for (const target of targets) {
    let results;
    if (target.endsWith(".ts")) {
      results = [checkFile(target, maxLines)];
    } else {
      results = checkDirectory(target, maxLines);
    }

    for (const result of results) {
      totalChecked++;
      if (result.overLimit) {
        console.error(
          `❌ ${result.file}: ${result.lineCount} lines (max ${maxLines})`,
        );
        hasError = true;
      } else {
        console.log(`✅ ${result.file}: ${result.lineCount} lines`);
      }
    }
  }

  if (hasError) {
    console.error(
      `\n❌ Some files exceed the ${maxLines}-line limit. Refactor into smaller modules.`,
    );
    process.exit(1);
  }

  console.log(
    `\n✅ All ${totalChecked} file(s) within ${maxLines}-line limit.`,
  );
}

// CLI entry
if (process.argv[1] && (process.argv[1].endsWith("check-lines.mjs") || process.argv[1].endsWith("/check-lines.mjs"))) {
  main();
}
