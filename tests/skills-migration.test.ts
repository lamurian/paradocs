import { existsSync, readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

const REMOVED_SKILLS = [
  "knowledge",
  "create-doc",
  "web-search",
  "summarize-link",
  "brainstorm",
  "auto-link",
  "research",
] as const;

const COMMAND_FILES = ["ask.ts", "research.ts", "summarize.ts", "index.ts"] as const;

describe("skills removed", () => {
  for (const skill of REMOVED_SKILLS) {
    const skillDir = `skills/${skill}`;
    const skillFile = `${skillDir}/SKILL.md`;

    describe(skill, () => {
      it(`${skillDir} should no longer exist — replaced by commands/tool descriptions`, () => {
        expect(existsSync(skillDir)).toBe(false);
      });

      it(`${skillFile} should no longer exist`, () => {
        expect(existsSync(skillFile)).toBe(false);
      });
    });
  }
});

describe("commands exist", () => {
  for (const file of COMMAND_FILES) {
    it(`extensions/commands/${file} should exist`, () => {
      expect(existsSync(`extensions/commands/${file}`)).toBe(true);
    });
  }
});

describe("tool descriptions contain conventions", () => {
  it("web_search description should include tier/category details", () => {
    const content = readFileSync("extensions/web-search/index.ts", "utf-8");
    expect(content).toMatch(/tier|category|fallback/i);
  });

  it("create_para_doc description should include citation format", () => {
    const content = readFileSync("extensions/para-knowledge/tools/createDoc.ts", "utf-8");
    expect(content).toContain("@citekey");
    expect(content).toContain("PARA classification");
    expect(content).toContain("Atomic principle");
  });

  it("batch_create_para_docs description should include conventions", () => {
    const content = readFileSync("extensions/batch-create/index.ts", "utf-8");
    expect(content).toContain("@citekey");
    expect(content).toContain("PARA classification");
    expect(content).toContain("Atomic principle");
  });
});
