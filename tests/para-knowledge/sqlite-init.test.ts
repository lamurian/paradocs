import { describe, it, expect, afterEach } from "vitest";

import type { SqliteDb } from "../../extensions/para-knowledge/sqlite-types.ts";

describe("createDb", () => {
  let db: SqliteDb | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it("should create an in-memory database", async () => {
    const { createDb } = await import("../../extensions/para-knowledge/sqlite-init.ts");
    db = createDb(":memory:");
    expect(db).toBeDefined();
    expect(typeof db.exec).toBe("function");
    expect(typeof db.prepare).toBe("function");
    expect(typeof db.close).toBe("function");
  });

  it("should support basic SQL operations", async () => {
    const { createDb } = await import("../../extensions/para-knowledge/sqlite-init.ts");
    db = createDb(":memory:");
    db.exec("CREATE TABLE t (x INTEGER)");
    db.prepare("INSERT INTO t VALUES (?)").run(42);
    const rows = db.prepare("SELECT x FROM t").all<{ x: number }>();
    expect(rows).toEqual([{ x: 42 }]);
  });

  it("should support run/get/all convenience methods", async () => {
    const { createDb } = await import("../../extensions/para-knowledge/sqlite-init.ts");
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
    const { createDb, initDb } = await import("../../extensions/para-knowledge/sqlite-init.ts");
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
    const { createDb, initDb } = await import("../../extensions/para-knowledge/sqlite-init.ts");
    db = createDb(":memory:");
    initDb(db);
    expect(() => initDb(db)).not.toThrow();

    // Still has exactly one 'files' table
    const count = db
      .prepare("SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name='files'")
      .get<{ cnt: number }>();
    expect(count?.cnt).toBe(1);
  });

  it("should migrate a legacy schema and preserve existing rows", async () => {
    const { createDb, initDb } = await import("../../extensions/para-knowledge/sqlite-init.ts");
    db = createDb(":memory:");

    // Simulate an older database without the newer columns.
    db.exec(`CREATE TABLE files (
      path TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT '',
      editor TEXT NOT NULL DEFAULT '',
      created TEXT,
      modified TEXT,
      file_mtime TEXT,
      source_url TEXT
    )`);
    db.exec(`CREATE TABLE citations (
      citekey TEXT PRIMARY KEY,
      bibtex TEXT NOT NULL,
      doi TEXT,
      source_url TEXT,
      created TEXT,
      updated TEXT
    )`);
    db.run("INSERT INTO files (path, title) VALUES (?, ?)", "docs/legacy.md", "Legacy");
    db.run(
      "INSERT INTO citations (citekey, bibtex) VALUES (?, ?)",
      "legacy2020",
      "@article{legacy2020}",
    );

    initDb(db);

    const fileColumns = db
      .prepare("PRAGMA table_info(files)")
      .all<{ name: string }>()
      .map((r) => r.name);
    expect(fileColumns).toContain("description");
    expect(fileColumns).toContain("reviewed");
    expect(fileColumns).toContain("review_interval");

    const citationColumns = db
      .prepare("PRAGMA table_info(citations)")
      .all<{ name: string }>()
      .map((r) => r.name);
    expect(citationColumns).toContain("published");
    expect(citationColumns).toContain("verified_at");
    expect(citationColumns).toContain("trust_class");

    const file = db.get<{ path: string; title: string }>(
      "SELECT path, title FROM files WHERE path = ?",
      "docs/legacy.md",
    );
    expect(file).toEqual({ path: "docs/legacy.md", title: "Legacy" });

    const citation = db.get<{ citekey: string; bibtex: string }>(
      "SELECT citekey, bibtex FROM citations WHERE citekey = ?",
      "legacy2020",
    );
    expect(citation).toEqual({ citekey: "legacy2020", bibtex: "@article{legacy2020}" });
  });

  it("should not duplicate migrated columns when called twice", async () => {
    const { createDb, initDb } = await import("../../extensions/para-knowledge/sqlite-init.ts");
    db = createDb(":memory:");
    initDb(db);
    initDb(db);

    const fileColumns = db
      .prepare("PRAGMA table_info(files)")
      .all<{ name: string }>()
      .map((r) => r.name);
    expect(fileColumns.filter((name) => name === "description")).toHaveLength(1);
    expect(fileColumns.filter((name) => name === "reviewed")).toHaveLength(1);
    expect(fileColumns.filter((name) => name === "review_interval")).toHaveLength(1);

    const citationColumns = db
      .prepare("PRAGMA table_info(citations)")
      .all<{ name: string }>()
      .map((r) => r.name);
    expect(citationColumns.filter((name) => name === "published")).toHaveLength(1);
    expect(citationColumns.filter((name) => name === "verified_at")).toHaveLength(1);
    expect(citationColumns.filter((name) => name === "trust_class")).toHaveLength(1);
  });

  it("should create note_citations keyed by (file_path, citekey)", async () => {
    const { createDb, initDb } = await import("../../extensions/para-knowledge/sqlite-init.ts");
    db = createDb(":memory:");
    initDb(db);

    const table = db.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='note_citations'",
    );
    expect(table?.name).toBe("note_citations");

    const index = db.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_note_citations_citekey'",
    );
    expect(index?.name).toBe("idx_note_citations_citekey");

    db.run(
      "INSERT INTO note_citations (file_path, citekey) VALUES (?, ?)",
      "notes/a.md",
      "key2020",
    );
    expect(() =>
      db.run(
        "INSERT INTO note_citations (file_path, citekey) VALUES (?, ?)",
        "notes/a.md",
        "key2020",
      ),
    ).toThrow();
  });

  it("should accept a database created with createDb", async () => {
    const { createDb, initDb } = await import("../../extensions/para-knowledge/sqlite-init.ts");
    db = createDb(":memory:");
    expect(() => initDb(db)).not.toThrow();
  });

  it("should set cache_size pragma", async () => {
    const { createDb, initDb } = await import("../../extensions/para-knowledge/sqlite-init.ts");
    db = createDb(":memory:");
    initDb(db);
    const row = db.get<{ cache_size: number }>("PRAGMA cache_size");
    expect(row).toBeDefined();
  });
});
