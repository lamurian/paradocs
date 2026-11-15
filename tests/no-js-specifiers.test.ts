import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Why this guard exists: pi loads each extension entry through jiti. A relative
 * specifier ending in ".js" that points at a ".ts" file forces jiti through
 * several failed resolution attempts (about 12ms per import versus about 0.4ms
 * for ".ts"). Relative imports must use ".ts" specifiers.
 */

const ROOT = resolve(__dirname, "..");
const SCAN_DIRS = ["extensions", "common", "tests"];
const SELF = resolve(__filename);

/**
 * Matches a relative specifier ending in .js in any of:
 * - `import ... from "./x.js"` / `export ... from "./x.js"` (incl. multi-line)
 * - side-effect `import "./x.js"`
 * - dynamic `import("./x.js")`
 * - `require("./x.js")`
 * - `vi.mock/doMock/importActual/importMock/unmock("./x.js")`
 */
const JS_SPECIFIER =
  /(?:\bfrom|\bimport\s*\(?|\brequire\s*\(|\bvi\s*\.\s*(?:mock|doMock|importActual|importMock|unmock)\s*\()\s*(["'`])(\.{1,2}\/[^"'`\n]*\.js)\1/g;

/**
 * Find relative `.js` specifiers in a source string.
 * @param source - File contents to scan.
 * @returns The offending specifiers (for example `./foo.js`), in order of appearance.
 */
function findJsSpecifiers(source: string): string[] {
  return [...source.matchAll(JS_SPECIFIER)].map((match) => match[2]);
}

/**
 * Recursively list `.ts` files under a directory, skipping node_modules.
 * @param dir - Absolute directory path.
 * @returns Absolute file paths.
 */
function listTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...listTsFiles(full));
    else if (name.endsWith(".ts")) files.push(full);
  }
  return files;
}

describe("relative .js specifier guard", () => {
  it("finds zero relative .js specifiers in extensions/, common/ and tests/", () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of listTsFiles(join(ROOT, dir))) {
        if (resolve(file) === SELF) continue;
        for (const spec of findJsSpecifiers(readFileSync(file, "utf-8"))) {
          offenders.push(`${relative(ROOT, file)}: ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  describe("scanner", () => {
    it("flags a .js specifier in each import form", () => {
      const cases: Record<string, string> = {
        "static import": 'import { a } from "./a.js";',
        "static import (single quotes, parent path)": "import b from '../b.js';",
        "side-effect import": 'import "./side.js";',
        "export from": 'export { c } from "./c.js";',
        "export star": 'export * from "./d.js";',
        "multi-line export from": 'export {\n  e,\n  f,\n} from "./e.js";',
        "dynamic import": 'const m = await import("./g.js");',
        "vi.mock": 'vi.mock("../h.js", () => ({}));',
        "vi.importActual": 'await vi.importActual("./i.js");',
        "vi.doMock": 'vi.doMock("./j.js", () => ({}));',
      };
      for (const [label, source] of Object.entries(cases)) {
        expect(findJsSpecifiers(source), label).toHaveLength(1);
      }
    });

    it("returns the offending specifier text", () => {
      expect(findJsSpecifiers('import { a } from "./deep/a.js";')).toEqual(["./deep/a.js"]);
    });

    it("ignores bare package specifiers, .ts specifiers and non-specifier strings", () => {
      const clean = [
        'import { x } from "vitest";',
        'import pkg from "some-pkg/index.js";',
        'import { y } from "node:fs";',
        'import { a } from "./a.ts";',
        'vi.mock("../b.ts", () => ({}));',
        'const m = await import("./c.ts");',
        'setArgv1("/x/script.js");',
        'const p = "./not-an-import.js";',
        'expect(path).toBe("/definitely/not/a/real/script.js");',
        'import { z } from "../scripts/check-lines.mjs";',
      ];
      for (const source of clean) {
        expect(findJsSpecifiers(source), source).toEqual([]);
      }
    });
  });
});
