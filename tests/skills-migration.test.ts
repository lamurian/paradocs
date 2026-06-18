import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync, readdirSync } from "node:fs";

const SKILLS = [
  "knowledge",
  "create-doc",
  "web-search",
  "summarize-link",
  "brainstorm",
  "auto-link",
  "research",
  "roadmap",
] as const;

const REGISTERED_TOOLS = [
  "search_para_docs",
  "create_para_doc",
  "update_para_doc",
  "list_para_tags",
  "find_existing_summary",
  "resolve_citation",
  "web_search",
  "fetch_url",
  "batch_create_para_docs",
] as const;

describe("skills migration", () => {
  for (const skill of SKILLS) {
    const skillDir = `skills/${skill}`;
    const skillFile = `${skillDir}/SKILL.md`;

    describe(skill, () => {
      it(`${skillFile} should exist`, () => {
        expect(existsSync(skillFile)).toBe(true);
      });

      it(`${skillFile} should have valid frontmatter (starts with ---)`, () => {
        const content = readFileSync(skillFile, "utf-8");
        const lines = content.split("\n");
        expect(lines[0].trim()).toBe("---");
        // Find closing --- (second delimiter)
        const endIndex = lines.indexOf("---", 1);
        expect(endIndex).toBeGreaterThan(1);
        // Frontmatter should contain a name and description
        const frontmatter = lines.slice(1, endIndex).join("\n");
        expect(frontmatter).toMatch(/^name:/m);
        expect(frontmatter).toMatch(/^description:/m);
      });

      it(`${skillDir} should be a directory`, () => {
        const stats = statSync(skillDir);
        expect(stats.isDirectory()).toBe(true);
      });
    });
  }
});

describe("skill count", () => {
  it("should have exactly 8 skill directories", () => {
    const entries = readdirSync("skills", { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory() && e.name !== "node_modules");
    expect(dirs).toHaveLength(8);
  });
});

describe("tool name references", () => {
  for (const tool of REGISTERED_TOOLS) {
    it(`should reference ${tool} in at least one SKILL.md`, () => {
      const found = SKILLS.some((skill) => {
        const content = readFileSync(`skills/${skill}/SKILL.md`, "utf-8");
        return content.includes(tool);
      });
      expect(found).toBe(true);
    });
  }
});
