/**
 * Tests for rebuildDb — scans PARA directories, indexes all .md files.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("rebuildDb", () => {
  let tmpDir: string;
  let knowledgeDir: string;

  function writeDoc(area: string, slug: string, extra = ""): string {
    const content = `---
title: "${slug}"
author: pi
editor: lam
date: 2026-01-01T00:00:00.000Z
tags: [test]${extra}
---

Body of ${slug}.`;
    const areaDir = join(knowledgeDir, area);
    mkdirSync(areaDir, { recursive: true });
    const filePath = join(areaDir, `${slug}.md`);
    writeFileSync(filePath, content, "utf-8");
    return `${area}/${slug}.md`;
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(homedir(), "rebuild-test-"));
    knowledgeDir = join(tmpDir, "knowledge");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should index all .md files across Areas, Projects, Resources", async () => {
    writeDoc("Areas", "area-specific-name");
    writeDoc("Projects", "project-unique");
    writeDoc("Resources", "resource-alpha");
    writeDoc("Resources", "resource-beta");

    const { rebuildDb } = await import("../../extensions/para-knowledge/rebuild.js");

    const count = await rebuildDb(knowledgeDir);

    expect(count).toBe(4);

    // Verify the DB was created
    const dbPath = resolve(knowledgeDir, "notes.db");
    expect(existsSync(dbPath)).toBe(true);

    // Verify contents
    const { createDb, initDb, searchDocs } =
      await import("../../extensions/para-knowledge/db-sqlite.js");
    const db = createDb(dbPath);
    initDb(db);

    // Search for a unique term that appears in only one doc
    const results = searchDocs(db, "area-specific");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("area-specific-name");
    expect(results[0].path).toBe("Areas/area-specific-name.md");

    // Search for a term appearing in all docs to verify total count
    // Each doc body contains "Body of <slug>." — "body" appears in all
    const allResults = searchDocs(db, "body");
    expect(allResults).toHaveLength(4);

    db.close();
  });

  it("should handle empty knowledge directory (no .md files)", async () => {
    // Create knowledgeDir but no files in it
    mkdirSync(knowledgeDir, { recursive: true });

    const { rebuildDb } = await import("../../extensions/para-knowledge/rebuild.js");

    const count = await rebuildDb(knowledgeDir);
    expect(count).toBe(0);

    // DB should exist (empty but initialized)
    const dbPath = resolve(knowledgeDir, "notes.db");
    expect(existsSync(dbPath)).toBe(true);
  });

  it("should rebuild and overwrite an existing notes.db", async () => {
    // First write a doc
    writeDoc("Resources", "original-doc");

    const { rebuildDb } = await import("../../extensions/para-knowledge/rebuild.js");

    // Rebuild — should index the one doc
    const count1 = await rebuildDb(knowledgeDir);
    expect(count1).toBe(1);

    // Add another doc
    writeDoc("Projects", "new-doc");

    // Rebuild again — should now have 2
    const count2 = await rebuildDb(knowledgeDir);
    expect(count2).toBe(2);

    const dbPath = resolve(knowledgeDir, "notes.db");
    const { createDb, initDb, searchDocs } =
      await import("../../extensions/para-knowledge/db-sqlite.js");
    const db = createDb(dbPath);
    initDb(db);
    const results = searchDocs(db, "original");
    expect(results).toHaveLength(1);
    const results2 = searchDocs(db, "new");
    expect(results2).toHaveLength(1);
    db.close();
  });

  it("should handle files with missing frontmatter gracefully", async () => {
    // Write a file with no frontmatter
    const areaDir = join(knowledgeDir, "Resources");
    mkdirSync(areaDir, { recursive: true });
    writeFileSync(join(areaDir, "bare.md"), "Just plain text without frontmatter.", "utf-8");
    // Write a normal doc
    writeDoc("Resources", "normal-doc");

    const { rebuildDb } = await import("../../extensions/para-knowledge/rebuild.js");

    const count = await rebuildDb(knowledgeDir);
    expect(count).toBe(2);

    const dbPath = resolve(knowledgeDir, "notes.db");
    const { createDb, initDb, searchDocs } =
      await import("../../extensions/para-knowledge/db-sqlite.js");
    const db = createDb(dbPath);
    initDb(db);

    // Both files should be findable
    const bareResults = searchDocs(db, "plain text");
    expect(bareResults).toHaveLength(1);
    expect(bareResults[0].title).toBe("bare"); // slug from filename

    db.close();
  });
});
