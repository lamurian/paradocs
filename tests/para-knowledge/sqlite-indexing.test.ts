import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { SqliteDb, DocIndex } from "../../extensions/para-knowledge/sqlite-types.ts";

function makeDoc(overrides: Partial<DocIndex> = {}): DocIndex {
  return {
    path: "Projects/test.md",
    title: "Test Document",
    body: "This is the body of the test document.",
    tags: ["tag1", "tag2"],
    author: "Test Author",
    editor: "",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-02T00:00:00.000Z",
    file_mtime: "2026-01-02T00:00:00.000Z",
    source_url: null,
    ...overrides,
  };
}

describe("indexFile", () => {
  let db: SqliteDb;

  beforeEach(async () => {
    const { createDb, initDb } = await import("../../extensions/para-knowledge/sqlite-init.ts");
    db = createDb(":memory:");
    initDb(db);
  });

  afterEach(() => {
    db?.close();
  });

  it("should insert a document into files, tags, and FTS5 tables", async () => {
    const { indexFile } = await import("../../extensions/para-knowledge/sqlite-indexing.ts");
    const doc = makeDoc();
    indexFile(db, doc);

    const fileRow = db
      .prepare("SELECT path, title, author FROM files WHERE path = ?")
      .get<{ path: string; title: string; author: string }>(doc.path);
    expect(fileRow?.path).toBe(doc.path);
    expect(fileRow?.title).toBe(doc.title);
    expect(fileRow?.author).toBe(doc.author);

    const tagRows = db
      .prepare("SELECT tag FROM tags WHERE file_path = ? ORDER BY tag")
      .all<{ tag: string }>(doc.path);
    expect(tagRows.map((r) => r.tag)).toEqual(["tag1", "tag2"]);

    const ftsRows = db
      .prepare("SELECT path, title, body FROM docs_fts WHERE path = ?")
      .all<{ path: string; title: string; body: string }>(doc.path);
    expect(ftsRows).toHaveLength(1);
    expect(ftsRows[0].title).toBe(doc.title);
  });

  it("should update an existing document", async () => {
    const { indexFile } = await import("../../extensions/para-knowledge/sqlite-indexing.ts");
    const doc = makeDoc();
    indexFile(db, doc);

    const updated = makeDoc({
      title: "Updated Title",
      tags: ["tag1", "tag3"],
      body: "Updated body content.",
    });
    indexFile(db, updated);

    const fileRow = db
      .prepare("SELECT title FROM files WHERE path = ?")
      .get<{ title: string }>(updated.path);
    expect(fileRow?.title).toBe("Updated Title");

    const tagRows = db
      .prepare("SELECT tag FROM tags WHERE file_path = ? ORDER BY tag")
      .all<{ tag: string }>(updated.path);
    expect(tagRows.map((r) => r.tag)).toEqual(["tag1", "tag3"]);

    const ftsRow = db
      .prepare("SELECT body FROM docs_fts WHERE path = ?")
      .get<{ body: string }>(updated.path);
    expect(ftsRow?.body).toBe("Updated body content.");
  });

  it("should handle empty tags array", async () => {
    const { indexFile } = await import("../../extensions/para-knowledge/sqlite-indexing.ts");
    const doc = makeDoc({ tags: [] });
    indexFile(db, doc);

    const tagRows = db
      .prepare("SELECT tag FROM tags WHERE file_path = ?")
      .all<{ tag: string }>(doc.path);
    expect(tagRows).toHaveLength(0);
  });

  it("should handle empty body", async () => {
    const { indexFile } = await import("../../extensions/para-knowledge/sqlite-indexing.ts");
    const doc = makeDoc({ body: "" });
    expect(() => indexFile(db, doc)).not.toThrow();

    const ftsRow = db
      .prepare("SELECT body FROM docs_fts WHERE path = ?")
      .get<{ body: string }>(doc.path);
    expect(ftsRow?.body).toBe("");
  });

  it("should handle special characters in path and tags", async () => {
    const { indexFile } = await import("../../extensions/para-knowledge/sqlite-indexing.ts");
    const doc = makeDoc({
      path: "Projects/doc-with-hyphens_and_underscores.md",
      tags: ["c++", "c#", "tag:with:colons"],
    });
    expect(() => indexFile(db, doc)).not.toThrow();

    const tagRows = db
      .prepare("SELECT tag FROM tags WHERE file_path = ? ORDER BY tag")
      .all<{ tag: string }>(doc.path);
    expect(tagRows.map((r) => r.tag)).toEqual(["c#", "c++", "tag:with:colons"]);
  });

  it("should store description, reviewed and review_interval in files", async () => {
    const { indexFile } = await import("../../extensions/para-knowledge/sqlite-indexing.ts");
    const doc = makeDoc({
      description: "A short summary",
      reviewed: "2026-05-01",
      reviewInterval: 30,
    });
    indexFile(db, doc);

    const row = db
      .prepare("SELECT description, reviewed, review_interval FROM files WHERE path = ?")
      .get<{
        description: string | null;
        reviewed: string | null;
        review_interval: number | null;
      }>(doc.path);
    expect(row?.description).toBe("A short summary");
    expect(row?.reviewed).toBe("2026-05-01");
    expect(row?.review_interval).toBe(30);
  });

  it("should index citekeys from the body and ignore emails", async () => {
    const { indexFile } = await import("../../extensions/para-knowledge/sqlite-indexing.ts");
    const doc = makeDoc({
      body: "See @smith2020 and @jones2021. Contact a@b.com for details.",
    });
    indexFile(db, doc);

    const rows = db
      .prepare("SELECT citekey FROM note_citations WHERE file_path = ? ORDER BY citekey")
      .all<{ citekey: string }>(doc.path);
    expect(rows.map((r) => r.citekey)).toEqual(["jones2021", "smith2020"]);
  });

  it("should replace a note's note_citations rows on reindex", async () => {
    const { indexFile } = await import("../../extensions/para-knowledge/sqlite-indexing.ts");
    const doc = makeDoc({ body: "@oldkey" });
    indexFile(db, doc);
    indexFile(db, makeDoc({ body: "@newkey" }));

    const rows = db
      .prepare("SELECT citekey FROM note_citations WHERE file_path = ? ORDER BY citekey")
      .all<{ citekey: string }>(doc.path);
    expect(rows.map((r) => r.citekey)).toEqual(["newkey"]);
  });

  it("should use explicit citekeys when provided", async () => {
    const { indexFile } = await import("../../extensions/para-knowledge/sqlite-indexing.ts");
    const doc = makeDoc({ body: "@bodykey", citekeys: ["explicit1", "explicit2"] });
    indexFile(db, doc);

    const rows = db
      .prepare("SELECT citekey FROM note_citations WHERE file_path = ? ORDER BY citekey")
      .all<{ citekey: string }>(doc.path);
    expect(rows.map((r) => r.citekey)).toEqual(["explicit1", "explicit2"]);
  });
});

describe("getFileTags", () => {
  let db: SqliteDb;

  beforeEach(async () => {
    const { createDb, initDb } = await import("../../extensions/para-knowledge/sqlite-init.ts");
    db = createDb(":memory:");
    initDb(db);
  });

  afterEach(() => {
    db?.close();
  });

  it("should return tags for an indexed file", async () => {
    const { indexFile, getFileTags } =
      await import("../../extensions/para-knowledge/sqlite-indexing.ts");
    const doc = makeDoc({ tags: ["alpha", "beta", "gamma"] });
    indexFile(db, doc);

    const tags = getFileTags(db, doc.path);
    expect(tags).toEqual(["alpha", "beta", "gamma"]);
  });

  it("should return empty array for a non-existent file", async () => {
    const { getFileTags } = await import("../../extensions/para-knowledge/sqlite-indexing.ts");
    const tags = getFileTags(db, "nonexistent.md");
    expect(tags).toEqual([]);
  });

  it("should return tags in alphabetical order", async () => {
    const { indexFile, getFileTags } =
      await import("../../extensions/para-knowledge/sqlite-indexing.ts");
    const doc = makeDoc({ tags: ["zebra", "apple", "banana"] });
    indexFile(db, doc);

    const tags = getFileTags(db, doc.path);
    expect(tags).toEqual(["apple", "banana", "zebra"]);
  });
});

describe("removeFile", () => {
  let db: SqliteDb;

  beforeEach(async () => {
    const { createDb, initDb } = await import("../../extensions/para-knowledge/sqlite-init.ts");
    db = createDb(":memory:");
    initDb(db);
  });

  afterEach(() => {
    db?.close();
  });

  it("should remove a document from all tables", async () => {
    const { indexFile, removeFile, getFileTags } =
      await import("../../extensions/para-knowledge/sqlite-indexing.ts");
    const doc = makeDoc({ body: "See @doomed2020" });
    indexFile(db, doc);
    removeFile(db, doc.path);

    // Verify files table is empty
    const fileRow = db
      .prepare("SELECT COUNT(*) AS cnt FROM files WHERE path = ?")
      .get<{ cnt: number }>(doc.path);
    expect(fileRow?.cnt).toBe(0);

    // Verify tags are gone
    const tags = getFileTags(db, doc.path);
    expect(tags).toEqual([]);

    // Verify FTS5 entry is gone
    const ftsRow = db
      .prepare("SELECT COUNT(*) AS cnt FROM docs_fts WHERE path = ?")
      .get<{ cnt: number }>(doc.path);
    expect(ftsRow?.cnt).toBe(0);

    // Verify note_citations are gone
    const citationRow = db
      .prepare("SELECT COUNT(*) AS cnt FROM note_citations WHERE file_path = ?")
      .get<{ cnt: number }>(doc.path);
    expect(citationRow?.cnt).toBe(0);
  });

  it("should not throw when removing a non-existent file", async () => {
    const { removeFile } = await import("../../extensions/para-knowledge/sqlite-indexing.ts");
    expect(() => removeFile(db, "nonexistent.md")).not.toThrow();
  });

  it("should remove only the specified file", async () => {
    const { indexFile, removeFile, getFileTags } =
      await import("../../extensions/para-knowledge/sqlite-indexing.ts");
    const doc1 = makeDoc({ path: "Projects/doc1.md", tags: ["shared"] });
    const doc2 = makeDoc({ path: "Projects/doc2.md", tags: ["shared"] });
    indexFile(db, doc1);
    indexFile(db, doc2);

    removeFile(db, doc1.path);

    // doc2 should remain
    const tags2 = getFileTags(db, doc2.path);
    expect(tags2).toEqual(["shared"]);

    const ftsRow = db
      .prepare("SELECT COUNT(*) AS cnt FROM docs_fts WHERE path = ?")
      .get<{ cnt: number }>(doc2.path);
    expect(ftsRow?.cnt).toBe(1);
  });
});

describe("recomputeStats", () => {
  it("should not throw (no-op for FTS5)", async () => {
    const { recomputeStats } = await import("../../extensions/para-knowledge/sqlite-indexing.ts");
    // Pass null since it's a no-op and doesn't use the db parameter
    expect(() => recomputeStats(null as unknown as SqliteDb)).not.toThrow();
  });
});
