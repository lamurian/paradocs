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

describe("tool descriptions contain conventions", () => {
  it("web_search description should include tier/category details", () => {
    const content = readFileSync("extensions/web-search/index.ts", "utf-8");
    expect(content).toMatch(/tier|category|fallback/i);
  });
});
