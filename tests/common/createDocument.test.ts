/**
 * Tests for common/createDocument.ts — shared createDocument function.
 *
 * Verifies that the exported function:
 * - Creates a markdown file with YAML frontmatter
 * - Indexes it in SQLite
 * - Runs auto-linking
 * - Returns { path, title, linkCount, indexOk }
 */

import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock homedir so configureEnv looks for ~/.pi/agent/.env in a sandboxed temp
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: vi.fn(),
  };
});

describe("createDocument shared module", () => {
  let tmpDir: string;
  let fakeHome: string;
  let knowledgeDir: string;
  let projectDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync("/tmp/createDoc-common-test-");
    fakeHome = join(tmpDir, "fake-home");
    mkdirSync(fakeHome, { recursive: true });
    vi.mocked(homedir).mockReturnValue(fakeHome);

    knowledgeDir = join(tmpDir, "knowledge");
    projectDir = join(tmpDir, "project");
    mkdirSync(knowledgeDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });

    process.env.KNOWLEDGE_DIR = knowledgeDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.KNOWLEDGE_DIR;
  });

  it("should create a markdown file with frontmatter in KNOWLEDGE_DIR", async () => {
    const { createDocument } = await import("../../common/createDocument.js");

    const result = await createDocument(
      {
        title: "Test Doc",
        content: "Hello world body.",
        tags: ["test", "example"],
      },
      { cwd: projectDir },
    );

    expect(result).toHaveProperty("path");
    expect(result).toHaveProperty("title", "Test Doc");
    expect(result).toHaveProperty("linkCount");
    expect(result).toHaveProperty("indexOk", true);

    // File should be in KNOWLEDGE_DIR, not projectDir
    const knowledgePath = join(knowledgeDir, "Resources", "test-doc.md");
    const projectPath = join(projectDir, "Resources", "test-doc.md");

    expect(existsSync(knowledgePath)).toBe(true);
    expect(existsSync(projectPath)).toBe(false);
    expect(result.path).toContain("Resources/test-doc.md");
  });

  it("should place document in the specified area", async () => {
    const { createDocument } = await import("../../common/createDocument.js");

    await createDocument(
      {
        title: "Area Test",
        content: "Body",
        tags: ["test"],
        area: "Projects",
      },
      { cwd: projectDir },
    );

    const expectedPath = join(knowledgeDir, "Projects", "area-test.md");
    expect(existsSync(expectedPath)).toBe(true);
  });

  it("should include YAML frontmatter with title, tags, and source", async () => {
    const { createDocument } = await import("../../common/createDocument.js");

    await createDocument(
      {
        title: "Frontmatter Test",
        content: "Body content with some meaningful text for description.",
        tags: ["tag1", "tag2"],
        description: "Short description",
        source: "https://example.com/source",
      },
      { cwd: projectDir },
    );

    const filePath = join(knowledgeDir, "Resources", "frontmatter-test.md");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("title: Frontmatter Test");
    expect(content).toContain("tags:");
    expect(content).toContain("- tag1");
    expect(content).toContain("- tag2");
    expect(content).toContain("source: https://example.com/source");
    expect(content).toContain("Body content with some meaningful text for description.");
  });
});
