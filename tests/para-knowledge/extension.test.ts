/**
 * Tests for the para-knowledge extension entry point and the retained
 * common/autoLink module used by the ingest path.
 *
 * Verifies the extension registers exactly the read-only knowledge tools:
 * search_para_docs, list_para_tags and resolve_citation.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, it, expect } from "vitest";

import type { SqliteDb, DocIndex } from "../../extensions/para-knowledge/sqlite-types.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

describe("para-knowledge extension registration", () => {
  it("registers exactly search_para_docs, list_para_tags and resolve_citation", async () => {
    const { default: paraKnowledge } = await import("../../extensions/para-knowledge/index.ts");

    const registered: string[] = [];
    const fakePi = {
      registerTool: (tool: { name: string }) => {
        registered.push(tool.name);
      },
    } as unknown as ExtensionAPI;

    paraKnowledge(fakePi);

    expect(registered).toEqual(["search_para_docs", "list_para_tags", "resolve_citation"]);
  });
});

/** Build a minimal DocIndex for autoLink tests. */
function makeDoc(path: string, title: string, body: string, tags: string[]): DocIndex {
  return {
    path,
    title,
    body,
    tags,
    author: "pi",
    editor: "lam",
    created: null,
    modified: null,
    file_mtime: null,
    source_url: null,
  };
}

describe("common/autoLink retained module", () => {
  let db: SqliteDb;
  let tmpDir: string;
  let indexFile: (db: SqliteDb, doc: DocIndex) => void;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "autoLink-"));
    const sqliteInit = await import("../../extensions/para-knowledge/sqlite-init.ts");
    db = sqliteInit.createDb(":memory:");
    sqliteInit.initDb(db);
    const indexing = await import("../../extensions/para-knowledge/sqlite-indexing.ts");
    indexFile = indexing.indexFile;
  });

  afterEach(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds related documents by matching tags and excludes the source", async () => {
    indexFile(db, makeDoc("Resources/main.md", "Main Doc", "Main content.", ["shared-tag"]));
    indexFile(
      db,
      makeDoc("Resources/related.md", "Related Doc", "Related content.", ["shared-tag"]),
    );
    indexFile(db, makeDoc("Resources/unrelated.md", "Cooking", "Pasta recipe.", ["cooking"]));

    const { findRelated } = await import("../../common/autoLink.ts");
    const results = findRelated(db, "Resources/main.md", "Main Doc", ["shared-tag"]);

    expect(results).toContain("Resources/related.md");
    expect(results).not.toContain("Resources/main.md");
    expect(results).not.toContain("Resources/unrelated.md");
  });

  it("returns an empty array when there is no query text", async () => {
    const { findRelated } = await import("../../common/autoLink.ts");
    expect(findRelated(db, "Resources/main.md", "", [])).toEqual([]);
  });

  it("respects maxResults", async () => {
    for (let i = 0; i < 6; i++) {
      indexFile(db, makeDoc(`Resources/doc-${i}.md`, `Doc ${i}`, `Content ${i}.`, ["shared-tag"]));
    }

    const { findRelated } = await import("../../common/autoLink.ts");
    const results = findRelated(db, "Resources/source.md", "Source", ["shared-tag"], 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("appends a Relevant notes section with titles from the DB", async () => {
    indexFile(db, makeDoc("Resources/related.md", "Related Title", "Body.", ["tag"]));
    const filePath = join(tmpDir, "doc.md");
    writeFileSync(filePath, "---\ntitle: My Doc\n---\n\nBody content.", "utf-8");

    const { appendLinks } = await import("../../common/autoLink.ts");
    await appendLinks(filePath, ["Resources/related.md"], db);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("## Relevant notes");
    expect(content).toContain("[Related Title](Resources/related.md)");
    expect(content).toContain("title: My Doc");
  });

  it("does not duplicate existing links and appends next to them", async () => {
    const filePath = join(tmpDir, "doc.md");
    writeFileSync(
      filePath,
      "---\ntitle: My Doc\n---\n\nBody.\n\n## Relevant notes\n\n- [Existing](Resources/existing.md)\n",
      "utf-8",
    );

    const { appendLinks } = await import("../../common/autoLink.ts");
    await appendLinks(filePath, ["Resources/existing.md", "Resources/new.md"], db);

    const content = readFileSync(filePath, "utf-8");
    expect(content.match(/\[Existing\]\(Resources\/existing\.md\)/g)).toHaveLength(1);
    expect(content).toContain("[new](Resources/new.md)");
  });

  it("does nothing when the links array is empty", async () => {
    const filePath = join(tmpDir, "doc.md");
    const original = "---\ntitle: My Doc\n---\n\nBody.";
    writeFileSync(filePath, original, "utf-8");

    const { appendLinks } = await import("../../common/autoLink.ts");
    await appendLinks(filePath, [], db);

    expect(readFileSync(filePath, "utf-8")).toBe(original);
  });

  it("handles a file with no frontmatter", async () => {
    const filePath = join(tmpDir, "plain.md");
    writeFileSync(filePath, "Just body.", "utf-8");

    const { appendLinks } = await import("../../common/autoLink.ts");
    await appendLinks(filePath, ["Projects/other.md"], db);

    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("## Relevant notes");
    expect(content).toContain("[other](Projects/other.md)");
  });

  it("autoLink finds related notes and appends links to the source file", async () => {
    indexFile(
      db,
      makeDoc("Resources/related.md", "Related Title", "Related body.", ["shared-tag"]),
    );
    const filePath = join(tmpDir, "source.md");
    writeFileSync(filePath, "---\ntitle: Source\n---\n\nSource body.", "utf-8");

    const { autoLink } = await import("../../common/autoLink.ts");
    const count = await autoLink("source.md", "Source", ["shared-tag"], tmpDir, db);

    expect(count).toBe(1);
    expect(readFileSync(filePath, "utf-8")).toContain("[Related Title](Resources/related.md)");
  });

  it("autoLink is a no-op when nothing related is found", async () => {
    const filePath = join(tmpDir, "source.md");
    const original = "---\ntitle: Source\n---\n\nSource body.";
    writeFileSync(filePath, original, "utf-8");

    const { autoLink } = await import("../../common/autoLink.ts");
    const count = await autoLink("source.md", "Source", ["unmatched-tag"], tmpDir, db);

    expect(count).toBe(0);
    expect(readFileSync(filePath, "utf-8")).toBe(original);
  });
});
