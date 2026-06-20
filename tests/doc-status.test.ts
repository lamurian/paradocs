import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

/** Extract frontmatter value by key from a markdown file. */
function getFrontmatterValue(filePath: string, key: string): string | null {
  const content = readFileSync(filePath, "utf-8");
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return match ? match[1].trim() : null;
}

describe("ADR 006 documentation status", () => {
  it("should have status: implemented", () => {
    const status = getFrontmatterValue("docs/ADR/006-remove-roadmap-skill.md", "status");
    expect(status).toBe("implemented");
  });

  it("should have remaining: 0", () => {
    const remaining = getFrontmatterValue("docs/ADR/006-remove-roadmap-skill.md", "remaining");
    expect(remaining).toBe("0");
  });
});

describe("Spec 016 documentation status", () => {
  it("should have status: implemented", () => {
    const status = getFrontmatterValue("docs/specs/016-remove-roadmap-skill.md", "status");
    expect(status).toBe("implemented");
  });

  it("should have remaining: 0", () => {
    const remaining = getFrontmatterValue("docs/specs/016-remove-roadmap-skill.md", "remaining");
    expect(remaining).toBe("0");
  });
});

describe("ARCHITECTURE.md status tracking", () => {
  it("should show ADRs (10/10)", () => {
    const content = readFileSync("ARCHITECTURE.md", "utf-8");
    expect(content).toContain("## ADRs (10/10)");
  });

  it("should list ADR 010 as implemented", () => {
    const content = readFileSync("ARCHITECTURE.md", "utf-8");
    expect(content).toContain("[x] ADR 010");
  });

  it("should show Specs (26/26)", () => {
    const content = readFileSync("ARCHITECTURE.md", "utf-8");
    expect(content).toContain("## Specs (26/26)");
  });

  it("should list Spec 026 as implemented", () => {
    const content = readFileSync("ARCHITECTURE.md", "utf-8");
    expect(content).toContain("[x] Spec 026");
  });

  it("should NOT have ADR 006 as [D]raft in quick reference", () => {
    const content = readFileSync("ARCHITECTURE.md", "utf-8");
    expect(content).not.toContain("[D] @docs/ADR/006-remove-roadmap-skill.md");
  });
});
