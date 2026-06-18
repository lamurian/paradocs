import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const EXTENSIONS: Record<string, string[]> = {
  "para-knowledge": [
    "index.ts",
    "types.ts",
    "db-sqlite.ts",
    "files.ts",
    "frontmatter.ts",
    "similarity.ts",
    "sqlite-init.ts",
    "sqlite-indexing.ts",
    "sqlite-search.ts",
    "sqlite-types.ts",
    "tools/searchDocs.ts",
    "tools/createDoc.ts",
    "tools/updateDoc.ts",
    "tools/listTags.ts",
    "tools/findExistingSummary.ts",
    "tools/resolveCitation.ts",
  ],
  "web-search": ["index.ts", "AGENTS.md", "native.ts", "searxng.ts", "tavily.ts"],
  "link-summarizer": ["index.ts", "cdp.ts", "http.ts", "pdf.ts", "tavily-extract.ts"],
  "batch-create": ["index.ts", "search.ts", "yaml.ts"],
  "expand-bullets": ["index.ts", "parser.ts", "search.ts", "synthesis.ts"],
  "yaml-enforcer": ["index.ts", "analyzer.ts", "scanner.ts", "check-tool.ts", "standardize-tool.ts"],
};

describe("extension file existence", () => {
  for (const [extName, files] of Object.entries(EXTENSIONS)) {
    describe(extName, () => {
      for (const file of files) {
        const filePath = `extensions/${extName}/${file}`;
        it(`should have ${filePath}`, () => {
          expect(existsSync(filePath)).toBe(true);
        });
      }
    });
  }
});

describe("skill-gate.ts", () => {
  it("should exist as a single file in extensions/", () => {
    expect(existsSync("extensions/skill-gate.ts")).toBe(true);
  });
});

const EXT_TS_FILES = getAllExtensionTsFiles();

function getAllExtensionTsFiles(): string[] {
  const result: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) {
        result.push(full);
      }
    }
  };
  walk("extensions");
  return result;
}

describe("import path cleanup", () => {
  it("should have no imports from _common anywhere in extensions/", () => {
    for (const file of EXT_TS_FILES) {
      const content = readFileSync(file, "utf-8");
      expect(content).not.toContain("_common");
    }
  });

  it("should have no imports from @types/ anywhere in extensions/", () => {
    for (const file of EXT_TS_FILES) {
      const content = readFileSync(file, "utf-8");
      // Only check import lines, not eslint-disable comments
      const importLines = content.split("\n").filter(l => /from\s+["']/.test(l));
      for (const line of importLines) {
        expect(line).not.toMatch(/from\s+["'][^"']*@types\//);
      }
    }
  });
});

describe("TypeScript compilation", () => {
  it("should pass typecheck (npx tsc --noEmit)", async () => {
    const { execSync } = await import("node:child_process");
    const result = execSync("npx tsc --noEmit", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    // tsc --noEmit outputs nothing on success
    expect(result.trim()).toBe("");
  });
});

describe("file line limits", () => {
  for (const file of EXT_TS_FILES) {
    const relPath = relative(process.cwd(), file);
    it(`${relPath} should be ≤ 300 lines`, () => {
      const lines = readFileSync(file, "utf-8").split("\n");
      expect(lines.length).toBeLessThanOrEqual(300);
    });
  }
});
