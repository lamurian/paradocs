/**
 * Tests for reindexChanged — incremental mtime-based reindexing.
 */

import { mkdtempSync, mkdirSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { reindexChanged } from "../../extensions/para-knowledge/reindex.ts";
import { createDb, initDb } from "../../extensions/para-knowledge/sqlite-init.ts";

import type { SqliteDb } from "../../extensions/para-knowledge/sqlite-types.ts";

describe("reindexChanged", () => {
  let tmpDir: string;
  let knowledgeDir: string;
  let db: SqliteDb;

  /** Write a markdown document and return its path. */
  function writeDoc(area: string, slug: string, body: string): string {
    const content = `---
title: "${slug}"
author: pi
editor: lam
date: 2026-01-01T00:00:00.000Z
tags: [test]
---

${body}`;
    const dir = join(knowledgeDir, area);
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `${slug}.md`);
    writeFileSync(filePath, content, "utf-8");
    return `${area}/${slug}.md`;
  }

  /** Set an explicit mtime on a document so change detection is deterministic. */
  function setMtime(relPath: string, iso: string): void {
    const filePath = join(knowledgeDir, relPath);
    const date = new Date(iso);
    utimesSync(filePath, date, date);
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "reindex-test-"));
    knowledgeDir = join(tmpDir, "knowledge");
    mkdirSync(knowledgeDir, { recursive: true });
    db = createDb(":memory:");
    initDb(db);
  });

  afterEach(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("indexes new files and reports the counts", async () => {
    const alpha = writeDoc("Resources", "alpha", "Alpha body.");
    setMtime(alpha, "2032-02-03T04:05:06.000Z");
    writeDoc("Projects", "beta", "Beta body.");

    const result = await reindexChanged(db, knowledgeDir);

    expect(result).toEqual({ indexed: 2, removed: 0, unchanged: 0 });

    const row = db
      .prepare("SELECT file_mtime FROM files WHERE path = ?")
      .get<{ file_mtime: string }>(alpha);
    expect(row?.file_mtime).toBe("2032-02-03T04:05:06.000Z");
  });

  it("indexes modified files and leaves unchanged files untouched", async () => {
    const alpha = writeDoc("Resources", "alpha", "Original alpha.");
    const beta = writeDoc("Resources", "beta", "Original beta.");
    setMtime(alpha, "2031-01-01T00:00:00.000Z");
    setMtime(beta, "2031-01-02T00:00:00.000Z");
    await reindexChanged(db, knowledgeDir);

    writeDoc("Resources", "alpha", "Modified alpha content.");
    setMtime(alpha, "2030-01-01T00:00:00.000Z");

    const result = await reindexChanged(db, knowledgeDir);

    expect(result).toEqual({ indexed: 1, removed: 0, unchanged: 1 });

    const rows = db
      .prepare("SELECT path, file_mtime FROM files ORDER BY path")
      .all<{ path: string; file_mtime: string }>();
    expect(rows).toEqual([
      { path: alpha, file_mtime: "2030-01-01T00:00:00.000Z" },
      { path: beta, file_mtime: "2031-01-02T00:00:00.000Z" },
    ]);

    const hits = db
      .prepare("SELECT path FROM docs_fts WHERE docs_fts MATCH ?")
      .all<{ path: string }>("modified");
    expect(hits).toEqual([{ path: alpha }]);
  });

  it("removes entries for deleted files", async () => {
    const alpha = writeDoc("Resources", "alpha", "Alpha body.");
    writeDoc("Resources", "beta", "Beta body.");
    await reindexChanged(db, knowledgeDir);

    unlinkSync(join(knowledgeDir, alpha));

    const result = await reindexChanged(db, knowledgeDir);

    expect(result).toEqual({ indexed: 0, removed: 1, unchanged: 1 });
    const row = db.prepare("SELECT path FROM files WHERE path = ?").get<{ path: string }>(alpha);
    expect(row).toBeUndefined();
  });

  it("reports everything unchanged on a second identical run", async () => {
    writeDoc("Areas", "alpha", "Alpha body.");
    await reindexChanged(db, knowledgeDir);

    const result = await reindexChanged(db, knowledgeDir);

    expect(result).toEqual({ indexed: 0, removed: 0, unchanged: 1 });
  });
});
