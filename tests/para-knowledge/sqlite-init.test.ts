import { describe, it, expect, afterEach } from "vitest";

import type { SqliteDb } from "../../extensions/para-knowledge/sqlite-types.js";

describe("createDb", () => {
  let db: SqliteDb | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it("should create an in-memory database", async () => {
    const { createDb } = await import("../../extensions/para-knowledge/sqlite-init.js");
    db = createDb(":memory:");
    expect(db).toBeDefined();
    expect(typeof db.exec).toBe("function");
    expect(typeof db.prepare).toBe("function");
    expect(typeof db.close).toBe("function");
  });

  it("should support basic SQL operations", async () => {
    const { createDb } = await import("../../extensions/para-knowledge/sqlite-init.js");
    db = createDb(":memory:");
    db.exec("CREATE TABLE t (x INTEGER)");
    db.prepare("INSERT INTO t VALUES (?)").run(42);
    const rows = db.prepare("SELECT x FROM t").all<{ x: number }>();
    expect(rows).toEqual([{ x: 42 }]);
  });

  it("should support run/get/all convenience methods", async () => {
    const { createDb } = await import("../../extensions/para-knowledge/sqlite-init.js");
    db = createDb(":memory:");
    db.exec("CREATE TABLE t (x INTEGER, y TEXT)");
    db.run("INSERT INTO t VALUES (?, ?)", 1, "hello");
    db.run("INSERT INTO t VALUES (?, ?)", 2, "world");

    const all = db.all<{ x: number; y: string }>("SELECT * FROM t ORDER BY x");
    expect(all).toHaveLength(2);
    expect(all[0].x).toBe(1);
    expect(all[1].y).toBe("world");

    const single = db.get<{ x: number }>("SELECT x FROM t WHERE x = ?", 1);
    expect(single?.x).toBe(1);

    const none = db.get<{ x: number }>("SELECT x FROM t WHERE x = ?", 99);
    expect(none).toBeUndefined();
  });
});

describe("initDb", () => {
  let db: SqliteDb;

  afterEach(() => {
    db?.close();
  });

  it("should create all tables and indexes", async () => {
    const { createDb, initDb } = await import("../../extensions/para-knowledge/sqlite-init.js");
    db = createDb(":memory:");
    initDb(db);

    // Check for real tables
    const tableRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'docs_fts%' ORDER BY name",
      )
      .all<{ name: string }>();
    const tableNames = tableRows.map((r) => r.name);
    expect(tableNames).toContain("citations");
    expect(tableNames).toContain("files");
    expect(tableNames).toContain("tags");

    // Check FTS5 virtual table and shadow tables
    const shadowRows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'docs_fts%'")
      .all<{ name: string }>();
    const shadowNames = shadowRows.map((r) => r.name);
    expect(shadowNames).toContain("docs_fts");

    // Check indexes
    const indexRows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all<{ name: string }>();
    const indexNames = indexRows.map((r) => r.name);
    expect(indexNames).toContain("idx_tags_tag");
    expect(indexNames).toContain("idx_tags_path");
    expect(indexNames).toContain("idx_citations_doi");
    expect(indexNames).toContain("idx_citations_url");
  });

  it("should be idempotent (safe to call twice)", async () => {
    const { createDb, initDb } = await import("../../extensions/para-knowledge/sqlite-init.js");
    db = createDb(":memory:");
    initDb(db);
    expect(() => initDb(db)).not.toThrow();

    // Still has exactly one 'files' table
    const count = db
      .prepare("SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name='files'")
      .get<{ cnt: number }>();
    expect(count?.cnt).toBe(1);
  });

  it("should accept a database created with createDb", async () => {
    const { createDb, initDb } = await import("../../extensions/para-knowledge/sqlite-init.js");
    db = createDb(":memory:");
    expect(() => initDb(db)).not.toThrow();
  });

  it("should set cache_size pragma", async () => {
    const { createDb, initDb } = await import("../../extensions/para-knowledge/sqlite-init.js");
    db = createDb(":memory:");
    initDb(db);
    const row = db.get<{ cache_size: number }>("PRAGMA cache_size");
    expect(row).toBeDefined();
  });
});
