/**
 * Tests that createDocument auto-rebuilds notes.db from existing files
 * when the database is missing.
 *
 * Without this fix, creating a doc with no notes.db present would create
 * an empty DB and only index the new doc — making all previously existing
 * documents unsearchable until search_para_docs triggers a rebuild.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: vi.fn(),
  };
});

describe("createDocument auto-rebuild on missing DB", () => {
  let tmpDir: string;
  let fakeHome: string;
  let knowledgeDir: string;
  let projectDir: string;

  function writeExistingDoc(area: string, slug: string, title?: string): string {
    const content = `---
title: "${title ?? slug}"
author: pi
editor: lam
date: 2026-01-01T00:00:00.000Z
tags: [test]
---

Body of ${slug}. UNIQUE_TERM_${slug}.;`;
    const areaDir = join(knowledgeDir, area);
    mkdirSync(areaDir, { recursive: true });
    const filePath = join(areaDir, `${slug}.md`);
    writeFileSync(filePath, content, "utf-8");
    return `${area}/${slug}.md`;
  }

  beforeEach(() => {
    tmpDir = mkdtempSync("/tmp/createDoc-autoRebuild-test-");
    fakeHome = join(tmpDir, "fake-home");
    mkdirSync(fakeHome, { recursive: true });
    vi.mocked(homedir).mockReturnValue(fakeHome);

    knowledgeDir = join(tmpDir, "knowledge");
    projectDir = join(tmpDir, "project");
    mkdirSync(projectDir, { recursive: true });

    process.env.KNOWLEDGE_DIR = knowledgeDir;
    process.env.KNOWLEDGE_DB = "notes.db";
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.KNOWLEDGE_DIR;
    delete process.env.KNOWLEDGE_DB;
  });

  it("should rebuild notes.db from existing files when creating a new doc", async () => {
    // Write existing docs before notes.db exists
    writeExistingDoc("Resources", "pre-existing-one", "Pre-existing One");
    writeExistingDoc("Projects", "pre-existing-two", "Pre-existing Two");

    // notes.db should not exist yet
    expect(existsSync(resolve(knowledgeDir, "notes.db"))).toBe(false);

    vi.resetModules();

    // Create a new document — this should trigger a rebuild first
    const { createDocument } = await import("../../common/createDocument.js");

    const result = await createDocument(
      {
        title: "New Doc",
        content: "Body of new doc with UNIQUE_TERM_new_doc.",
        tags: ["test"],
      },
      { cwd: projectDir },
    );

    expect(result.indexOk).toBe(true);

    // notes.db should now exist
    expect(existsSync(resolve(knowledgeDir, "notes.db"))).toBe(true);

    // Verify all docs are searchable
    const { createDb, initDb, searchDocs } =
      await import("../../extensions/para-knowledge/db-sqlite.js");
    const db = createDb(resolve(knowledgeDir, "notes.db"));
    initDb(db);

    try {
      // Search for the new doc's unique term
      const newResults = searchDocs(db, "UNIQUE_TERM_new_doc");
      expect(newResults).toHaveLength(1);
      expect(newResults[0].title).toBe("New Doc");

      // Search for the first existing doc's unique term
      const existing1Results = searchDocs(db, "UNIQUE_TERM_pre_existing_one");
      expect(existing1Results).toHaveLength(1);
      expect(existing1Results[0].title).toBe("Pre-existing One");

      // Search for the second existing doc's unique term
      const existing2Results = searchDocs(db, "UNIQUE_TERM_pre_existing_two");
      expect(existing2Results).toHaveLength(1);
      expect(existing2Results[0].title).toBe("Pre-existing Two");
    } finally {
      db.close();
    }
  });

  it("should still work when no existing docs are on disk", async () => {
    // knowledgeDir exists but has no docs

    vi.resetModules();

    const { createDocument } = await import("../../common/createDocument.js");

    const result = await createDocument(
      {
        title: "First Doc",
        content: "Body of first doc.",
        tags: ["test"],
      },
      { cwd: projectDir },
    );

    expect(result.indexOk).toBe(true);

    // DB should exist
    expect(existsSync(resolve(knowledgeDir, "notes.db"))).toBe(true);

    // Should find the new doc
    const { createDb, initDb, searchDocs } =
      await import("../../extensions/para-knowledge/db-sqlite.js");
    const db = createDb(resolve(knowledgeDir, "notes.db"));
    initDb(db);

    try {
      const results = searchDocs(db, "first");
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("First Doc");
    } finally {
      db.close();
    }
  });

  it("should not interfere when notes.db already exists", async () => {
    // Write an existing doc, then create a doc to seed the DB
    writeExistingDoc("Resources", "existing-doc", "Existing Doc");

    vi.resetModules();
    const { createDocument } = await import("../../common/createDocument.js");

    await createDocument(
      {
        title: "Existing Doc",
        content: "Body of existing doc. UNIQUE_TERM_existing.",
        tags: ["test"],
      },
      { cwd: projectDir },
    );

    // DB should exist now (created by the first createDocument)
    expect(existsSync(resolve(knowledgeDir, "notes.db"))).toBe(true);

    // Now create another doc — DB already exists, so no rebuild needed
    const result2 = await createDocument(
      {
        title: "Another Doc",
        content: "Body of another doc. UNIQUE_TERM_another.",
        tags: ["test"],
      },
      { cwd: projectDir },
    );

    expect(result2.indexOk).toBe(true);

    // Both docs should be findable
    const { createDb, initDb, searchDocs } =
      await import("../../extensions/para-knowledge/db-sqlite.js");
    const db = createDb(resolve(knowledgeDir, "notes.db"));
    initDb(db);

    try {
      const allResults = searchDocs(db, "UNIQUE_TERM");
      expect(allResults).toHaveLength(2);
    } finally {
      db.close();
    }
  });
});
