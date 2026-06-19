import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { SqliteDb, DocIndex } from "../../extensions/para-knowledge/sqlite-types.js";

// ── Helpers ──

function createTempDir(): string {
  const tmp = mkdtempSync(join(homedir(), "batch-search-test-"));
  return tmp;
}

describe("findRelated (batch-create)", () => {
  let db: SqliteDb;
  let tmpDir: string;

  // Use dynamic import helper for ESM compatibility
  async function setupDb(): Promise<void> {
    const { createDb, initDb } = await import("../../extensions/para-knowledge/sqlite-init.js");
    db = createDb(":memory:");
    initDb(db);
  }

  beforeEach(async () => {
    tmpDir = createTempDir();
    await setupDb();
  });

  afterEach(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should find related documents by matching tags", async () => {
    const { indexFile } = await import("../../extensions/para-knowledge/sqlite-indexing.js");
    const docs: DocIndex[] = [
      {
        path: "Projects/main.md",
        title: "Main Doc",
        body: "Main document content.",
        tags: ["ai", "machine-learning"],
        author: "",
        editor: "",
        created: null,
        modified: null,
        file_mtime: null,
        source_url: null,
      },
      {
        path: "Projects/related.md",
        title: "Related Doc",
        body: "Related document about AI and ML.",
        tags: ["ai", "deep-learning"],
        author: "",
        editor: "",
        created: null,
        modified: null,
        file_mtime: null,
        source_url: null,
      },
      {
        path: "Projects/unrelated.md",
        title: "Cooking Recipes",
        body: "Pasta carbonara ingredients and instructions.",
        tags: ["cooking", "recipes"],
        author: "",
        editor: "",
        created: null,
        modified: null,
        file_mtime: null,
        source_url: null,
      },
    ];

    for (const doc of docs) indexFile(db, doc);

    const { findRelated } = await import("../../extensions/batch-create/search.js");
    const results = findRelated(db, "Projects/main.md", "Main Doc", ["ai", "machine-learning"], 5);

    expect(results).toContain("Projects/related.md");
    expect(results).not.toContain("Projects/main.md"); // self excluded
    expect(results).not.toContain("Projects/unrelated.md");
  });

  it("should return related documents ordered by relevance", async () => {
    const { indexFile } = await import("../../extensions/para-knowledge/sqlite-indexing.js");
    const docs: DocIndex[] = [
      {
        path: "Projects/main.md",
        title: "Main Doc",
        body: "Main document.",
        tags: ["javascript", "typescript", "nodejs"],
        author: "",
        editor: "",
        created: null,
        modified: null,
        file_mtime: null,
        source_url: null,
      },
      {
        path: "Projects/high-match.md",
        title: "JavaScript TypeScript NodeJS",
        body: "JS TS Node content.",
        tags: ["javascript", "typescript", "nodejs"],
        author: "",
        editor: "",
        created: null,
        modified: null,
        file_mtime: null,
        source_url: null,
      },
      {
        path: "Projects/partial-match.md",
        title: "TypeScript Only",
        body: "Just TypeScript.",
        tags: ["typescript"],
        author: "",
        editor: "",
        created: null,
        modified: null,
        file_mtime: null,
        source_url: null,
      },
    ];

    for (const doc of docs) indexFile(db, doc);

    const { findRelated } = await import("../../extensions/batch-create/search.js");
    const results = findRelated(
      db,
      "Projects/main.md",
      "Main Doc",
      ["javascript", "typescript", "nodejs"],
      5,
    );

    // high-match should appear before partial-match (more overlapping tags)
    const highIdx = results.indexOf("Projects/high-match.md");
    const partialIdx = results.indexOf("Projects/partial-match.md");
    expect(highIdx).toBeGreaterThanOrEqual(0);
    expect(partialIdx).toBeGreaterThan(highIdx);
  });

  it("should return empty array when db has no docs", async () => {
    const { findRelated } = await import("../../extensions/batch-create/search.js");
    const results = findRelated(db, "Projects/main.md", "Main", ["tag"], 5);
    expect(results).toEqual([]);
  });

  it("should respect maxResults", async () => {
    const { indexFile } = await import("../../extensions/para-knowledge/sqlite-indexing.js");
    for (let i = 0; i < 10; i++) {
      indexFile(db, {
        path: `Projects/doc${i}.md`,
        title: `Doc ${i}`,
        body: `Content for doc ${i}.`,
        tags: ["shared-tag"],
        author: "",
        editor: "",
        created: null,
        modified: null,
        file_mtime: null,
        source_url: null,
      });
    }

    const { findRelated } = await import("../../extensions/batch-create/search.js");
    const results = findRelated(db, "Projects/doc0.md", "Doc 0", ["shared-tag"], 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("should return empty array when tags and title are empty", async () => {
    const { findRelated } = await import("../../extensions/batch-create/search.js");
    const results = findRelated(db, "Projects/main.md", "", [], 5);
    expect(results).toEqual([]);
  });

  it("should exclude the source document from results", async () => {
    const { indexFile } = await import("../../extensions/para-knowledge/sqlite-indexing.js");
    indexFile(db, {
      path: "Projects/self.md",
      title: "Self Doc",
      body: "Self document content.",
      tags: ["same-tag"],
      author: "",
      editor: "",
      created: null,
      modified: null,
      file_mtime: null,
      source_url: null,
    });

    const { findRelated } = await import("../../extensions/batch-create/search.js");
    const results = findRelated(db, "Projects/self.md", "Self Doc", ["same-tag"], 5);
    expect(results).not.toContain("Projects/self.md");
  });
});

describe("appendLinks (batch-create)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should append new links under ## Relevant notes section", async () => {
    const { appendLinks } = await import("../../extensions/batch-create/search.js");
    const filePath = join(tmpDir, "doc.md");
    writeFileSync(filePath, "---\ntitle: My Doc\n---\n\nBody content.", "utf-8");

    await appendLinks(filePath, ["Projects/related.md"]);

    const content = await import("node:fs/promises").then((fs) => fs.readFile(filePath, "utf-8"));
    expect(content).toContain("## Relevant notes");
    expect(content).toContain("[[related]]");
  });

  it("should not duplicate existing links", async () => {
    const { appendLinks } = await import("../../extensions/batch-create/search.js");
    const filePath = join(tmpDir, "doc.md");
    writeFileSync(
      filePath,
      "---\ntitle: My Doc\n---\n\nBody content.\n\n## Relevant notes\n\n- [[related]]\n",
      "utf-8",
    );

    await appendLinks(filePath, ["Projects/related.md"]);

    const content = await import("node:fs/promises").then((fs) => fs.readFile(filePath, "utf-8"));
    // Count occurrences of [[related]]
    const matches = content.match(/\[\[related\]\]/g);
    expect(matches?.length).toBe(1);
  });

  it("should add to existing ## Relevant notes section", async () => {
    const { appendLinks } = await import("../../extensions/batch-create/search.js");
    const filePath = join(tmpDir, "doc.md");
    writeFileSync(
      filePath,
      "---\ntitle: My Doc\n---\n\nBody.\n\n## Relevant notes\n\n- [[existing]]\n",
      "utf-8",
    );

    await appendLinks(filePath, ["Projects/new-link.md"]);

    const content = await import("node:fs/promises").then((fs) => fs.readFile(filePath, "utf-8"));
    expect(content).toContain("[[existing]]");
    expect(content).toContain("[[new-link]]");
  });

  it("should do nothing when links array is empty", async () => {
    const { appendLinks } = await import("../../extensions/batch-create/search.js");
    const filePath = join(tmpDir, "doc.md");
    const original = "---\ntitle: My Doc\n---\n\nBody.";
    writeFileSync(filePath, original, "utf-8");

    await appendLinks(filePath, []);

    const content = await import("node:fs/promises").then((fs) => fs.readFile(filePath, "utf-8"));
    expect(content).toBe(original);
  });

  it("should handle file with no frontmatter", async () => {
    const { appendLinks } = await import("../../extensions/batch-create/search.js");
    const filePath = join(tmpDir, "plain.md");
    writeFileSync(filePath, "Just body.", "utf-8");

    await appendLinks(filePath, ["Projects/other.md"]);

    const content = await import("node:fs/promises").then((fs) => fs.readFile(filePath, "utf-8"));
    expect(content).toContain("## Relevant notes");
    expect(content).toContain("[[other]]");
  });

  it("should preserve frontmatter when appending", async () => {
    const { appendLinks } = await import("../../extensions/batch-create/search.js");
    const filePath = join(tmpDir, "doc.md");
    writeFileSync(filePath, "---\ntitle: Preserved\ntags:\n  - test\n---\n\nBody.", "utf-8");

    await appendLinks(filePath, ["Projects/link1.md"]);

    const content = await import("node:fs/promises").then((fs) => fs.readFile(filePath, "utf-8"));
    expect(content).toContain("title: Preserved");
    expect(content).toContain("tags:");
    expect(content).toContain("- test");
  });
});
