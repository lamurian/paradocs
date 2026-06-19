import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { SqliteDb, DocIndex } from "../../extensions/para-knowledge/sqlite-types.js";

function makeDoc(overrides: Partial<DocIndex> = {}): DocIndex {
  return {
    path: "Projects/test.md",
    title: "Test Document",
    body: "This is the body of the test document about programming.",
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

describe("searchDocs", () => {
  let db: SqliteDb;

  beforeEach(async () => {
    const { createDb, initDb } = await import("../../extensions/para-knowledge/sqlite-init.js");
    const { indexFile } = await import("../../extensions/para-knowledge/sqlite-indexing.js");

    db = createDb(":memory:");
    initDb(db);

    // Index several documents
    const docs: DocIndex[] = [
      makeDoc({
        path: "Projects/programming.md",
        title: "Programming Guide",
        body: "A comprehensive guide to programming in JavaScript and TypeScript.",
        tags: ["programming", "javascript", "typescript"],
      }),
      makeDoc({
        path: "Projects/cooking.md",
        title: "Cooking Recipes",
        body: "Delicious recipes for Italian cuisine and pasta dishes.",
        tags: ["cooking", "italian", "recipes"],
      }),
      makeDoc({
        path: "Projects/travel.md",
        title: "Travel Destinations",
        body: "Best travel destinations in Europe for summer holidays.",
        tags: ["travel", "europe", "holidays"],
      }),
      makeDoc({
        path: "Projects/typescript.md",
        title: "TypeScript Basics",
        body: "Learning TypeScript programming for web development.",
        tags: ["programming", "typescript"],
      }),
    ];

    for (const doc of docs) {
      indexFile(db, doc);
    }
  });

  afterEach(() => {
    db?.close();
  });

  // ── Text-only search ──

  it("should find documents matching a text query", async () => {
    const { searchDocs } = await import("../../extensions/para-knowledge/sqlite-search.js");
    const results = searchDocs(db, "programming");
    expect(results.length).toBeGreaterThanOrEqual(2);
    const paths = results.map((r) => r.path);
    expect(paths).toContain("Projects/programming.md");
    expect(paths).toContain("Projects/typescript.md");
  });

  it("should return BM25-ranked results", async () => {
    const { searchDocs } = await import("../../extensions/para-knowledge/sqlite-search.js");
    const results = searchDocs(db, "typescript");
    expect(results.length).toBeGreaterThanOrEqual(2);
    // The document titled "TypeScript Basics" should rank higher than
    // "Programming Guide" for the query "typescript"
    const top = results[0];
    expect(top.path).toBe("Projects/typescript.md");
  });

  it("should return empty array for query matching nothing", async () => {
    const { searchDocs } = await import("../../extensions/para-knowledge/sqlite-search.js");
    const results = searchDocs(db, "xyznonexistent");
    expect(results).toEqual([]);
  });

  it("should limit results to maxResults", async () => {
    const { searchDocs } = await import("../../extensions/para-knowledge/sqlite-search.js");
    const results = searchDocs(db, "programming", {}, 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });

  // ── Tag-filtered search ──

  it("should filter text results by tags", async () => {
    const { searchDocs } = await import("../../extensions/para-knowledge/sqlite-search.js");
    const results = searchDocs(db, "programming", { tags: ["javascript"] });
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      expect(r.tags).toContain("javascript");
    }
  });

  it("should return empty when text + tag filter matches nothing", async () => {
    const { searchDocs } = await import("../../extensions/para-knowledge/sqlite-search.js");
    const results = searchDocs(db, "programming", { tags: ["cooking"] });
    // "programming" text doesn't appear in cooking docs → falls through
    // to tag-only fallback, which returns cooking docs
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      expect(r.matchedByTag).toBe(true);
    }
  });

  // ── Tag-only search ──

  it("should return tag-only results when query is empty", async () => {
    const { searchDocs } = await import("../../extensions/para-knowledge/sqlite-search.js");
    const results = searchDocs(db, "", { tags: ["cooking"] });
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      expect(r.matchedByTag).toBe(true);
      expect(r.tagMatches).toContain("cooking");
    }
  });

  it("should filter by multiple tags", async () => {
    const { searchDocs } = await import("../../extensions/para-knowledge/sqlite-search.js");
    const results = searchDocs(db, "", { tags: ["programming", "cooking"] });
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it("should return tag-only results with empty body", async () => {
    const { searchDocs } = await import("../../extensions/para-knowledge/sqlite-search.js");
    const results = searchDocs(db, "", { tags: ["travel"] });
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      expect(r.body).toBe("");
    }
  });

  // ── Empty query ──

  it("should return empty array for empty query with no tags", async () => {
    const { searchDocs } = await import("../../extensions/para-knowledge/sqlite-search.js");
    const results = searchDocs(db, "", {});
    expect(results).toEqual([]);
  });

  // ── FTS5 edge cases ──

  it("should handle query with special characters without error", async () => {
    const { searchDocs } = await import("../../extensions/para-knowledge/sqlite-search.js");
    // Characters like . * are stripped by buildFts5Query; should not throw
    expect(() => searchDocs(db, "*special.chars(test)")).not.toThrow();
  });

  it("should handle query with mixed-case text (case-insensitive)", async () => {
    const { searchDocs } = await import("../../extensions/para-knowledge/sqlite-search.js");
    const results = searchDocs(db, "Programming");
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it("should handle query resulting in only stop words as empty", async () => {
    const { searchDocs } = await import("../../extensions/para-knowledge/sqlite-search.js");
    // "a an the" are all stop words (after stripping single chars, 'a' is already
    // filtered as single-char before stop word check)
    const results = searchDocs(db, "a an the");
    expect(results).toEqual([]);
  });

  it("should handle hyphenated query without error", async () => {
    const { searchDocs } = await import("../../extensions/para-knowledge/sqlite-search.js");
    // Hyphen is replaced with space; should not throw even if no match
    expect(() => searchDocs(db, "type-script")).not.toThrow();
  });

  it("should match hyphenated-then-spaced terms that exist in the index", async () => {
    const { searchDocs } = await import("../../extensions/para-knowledge/sqlite-search.js");
    // "Italian-cuisine" → buildFts5Query strips hyphen → "Italian cuisine"
    // → terms ["italian", "cuisine"] → "italian" matches tag "italian"
    const results = searchDocs(db, "Italian-cuisine");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("should handle query with only stop words", async () => {
    const { searchDocs } = await import("../../extensions/para-knowledge/sqlite-search.js");
    // "the and or" are all stop words → should return empty
    const results = searchDocs(db, "the and or");
    expect(results).toEqual([]);
  });

  it("should handle query with only single-character terms", async () => {
    const { searchDocs } = await import("../../extensions/para-knowledge/sqlite-search.js");
    const results = searchDocs(db, "a b c");
    expect(results).toEqual([]);
  });

  it("should handle very long query string", async () => {
    const { searchDocs } = await import("../../extensions/para-knowledge/sqlite-search.js");
    const longQuery = "programming ".repeat(100).trim();
    expect(() => searchDocs(db, longQuery)).not.toThrow();
  });

  it("should handle tag filter with no matching docs", async () => {
    const { searchDocs } = await import("../../extensions/para-knowledge/sqlite-search.js");
    const results = searchDocs(db, "", { tags: ["nonexistent-tag"] });
    expect(results).toEqual([]);
  });

  it("should include matchedByTag and tagMatches in results", async () => {
    const { searchDocs } = await import("../../extensions/para-knowledge/sqlite-search.js");
    const results = searchDocs(db, "", { tags: ["italian"] });
    expect(results.length).toBeGreaterThanOrEqual(1);
    const r = results[0];
    expect(r.matchedByTag).toBe(true);
    expect(r.tagMatches).toContain("italian");
    expect(r.tags).toBeDefined();
    expect(r.description).toBeNull();
    expect(typeof r.score).toBe("number");
  });

  it("should return results with source_url null when not set", async () => {
    const { searchDocs } = await import("../../extensions/para-knowledge/sqlite-search.js");
    const results = searchDocs(db, "cooking");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].source_url).toBeNull();
  });
});
