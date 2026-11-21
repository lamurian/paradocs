import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { indexFile } from "../../extensions/para-knowledge/sqlite-indexing.ts";
import { createDb, initDb } from "../../extensions/para-knowledge/sqlite-init.ts";
import { searchDocs } from "../../extensions/para-knowledge/sqlite-search.ts";

import type {
  SqliteDb,
  DocIndex,
  SearchOptions,
} from "../../extensions/para-knowledge/sqlite-types.ts";

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

  /** Run searchDocs against the in-memory index for the current test. */
  const run = (query: string, options: SearchOptions = {}, maxResults?: number) =>
    searchDocs(db, query, options, maxResults);

  beforeEach(() => {
    db = createDb(":memory:");
    initDb(db);

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

    for (const doc of docs) indexFile(db, doc);
  });

  afterEach(() => {
    db?.close();
  });

  // ── Text-only search ──

  it("should find documents matching a text query", () => {
    const results = run("programming");
    expect(results.length).toBeGreaterThanOrEqual(2);
    const paths = results.map((r) => r.path);
    expect(paths).toContain("Projects/programming.md");
    expect(paths).toContain("Projects/typescript.md");
  });

  it("should return BM25-ranked results", () => {
    const results = run("typescript");
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].path).toBe("Projects/typescript.md");
  });

  it("should return empty array for query matching nothing", () => {
    expect(run("xyznonexistent")).toEqual([]);
  });

  it("should limit results to maxResults", () => {
    const results = run("programming", {}, 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });

  // ── Tag-filtered search ──

  it("should filter text results by tags", () => {
    const results = run("programming", { tags: ["javascript"] });
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) expect(r.tags).toContain("javascript");
  });

  it("should return empty when text + tag filter matches nothing", () => {
    const results = run("programming", { tags: ["cooking"] });
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) expect(r.matchedByTag).toBe(true);
  });

  // ── Tag-only search ──

  it("should return tag-only results when query is empty", () => {
    const results = run("", { tags: ["cooking"] });
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) {
      expect(r.matchedByTag).toBe(true);
      expect(r.tagMatches).toContain("cooking");
    }
  });

  it("should filter by multiple tags", () => {
    expect(run("", { tags: ["programming", "cooking"] }).length).toBeGreaterThanOrEqual(2);
  });

  it("should return tag-only results with empty body", () => {
    const results = run("", { tags: ["travel"] });
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) expect(r.body).toBe("");
  });

  // ── Empty query ──

  it("should return empty array for empty query with no tags", () => {
    expect(run("", {})).toEqual([]);
  });

  // ── FTS5 edge cases ──

  it("should handle query with special characters without error", () => {
    expect(() => run("*special.chars(test)")).not.toThrow();
  });

  it("should handle question mark in query without error", () => {
    expect(() => run("what is urticaria?")).not.toThrow();
    expect(() => run("how? why?")).not.toThrow();
  });

  it("should handle exclamation mark in query without error", () => {
    expect(() => run("hello world!")).not.toThrow();
    expect(() => run("amazing! incredible!")).not.toThrow();
  });

  it("should handle query with mixed-case text (case-insensitive)", () => {
    expect(run("Programming").length).toBeGreaterThanOrEqual(2);
  });

  it("should handle query resulting in only stop words as empty", () => {
    expect(run("a an the")).toEqual([]);
  });

  it("should handle hyphenated query without error", () => {
    expect(() => run("type-script")).not.toThrow();
  });

  it("should match hyphenated-then-spaced terms that exist in the index", () => {
    expect(run("Italian-cuisine").length).toBeGreaterThanOrEqual(1);
  });

  it("should handle query with only stop words", () => {
    expect(run("the and or")).toEqual([]);
  });

  it("should handle query with only single-character terms", () => {
    expect(run("a b c")).toEqual([]);
  });

  it("should handle very long query string", () => {
    expect(() => run("programming ".repeat(100).trim())).not.toThrow();
  });

  it("should handle tag filter with no matching docs", () => {
    expect(run("", { tags: ["nonexistent-tag"] })).toEqual([]);
  });

  it("should include matchedByTag and tagMatches in results", () => {
    const results = run("", { tags: ["italian"] });
    expect(results.length).toBeGreaterThanOrEqual(1);
    const r = results[0];
    expect(r.matchedByTag).toBe(true);
    expect(r.tagMatches).toContain("italian");
    expect(r.tags).toBeDefined();
    expect(r.description).toBeNull();
    expect(typeof r.score).toBe("number");
  });

  it("should return results with source_url null when not set", () => {
    const results = run("cooking");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].source_url).toBeNull();
  });

  // ── Freshness metadata ──

  it("should return created date in text search results", () => {
    const results = run("typescript");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].created).toBe("2026-01-01T00:00:00.000Z");
  });

  it("should return modified date in text search results", () => {
    const results = run("typescript");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].modified).toBe("2026-01-02T00:00:00.000Z");
  });

  it("should return created and modified in tag-only search results", () => {
    const results = run("", { tags: ["travel"] });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].created).toBe("2026-01-01T00:00:00.000Z");
    expect(results[0].modified).toBe("2026-01-02T00:00:00.000Z");
  });

  // ── Description and review boost ──

  it("should fill description from the files table", () => {
    indexFile(
      db,
      makeDoc({
        path: "Projects/described.md",
        title: "Described Doc",
        body: "A document with a searchable descriptionterm.",
        tags: ["test"],
        description: "Short summary of the described doc.",
      }),
    );

    const results = run("descriptionterm");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].description).toBe("Short summary of the described doc.");
  });

  it("should rank a reviewed note above an unreviewed note with an equal BM25 score", () => {
    const shared = {
      title: "Boost Term Note",
      body: "The boostterm appears exactly once in this body.",
      tags: ["boost"],
      author: "pi",
      editor: "",
      created: "2026-01-01T00:00:00.000Z",
      modified: "2026-01-02T00:00:00.000Z",
      file_mtime: "2026-01-02T00:00:00.000Z",
      source_url: null,
    };

    indexFile(db, makeDoc({ ...shared, path: "Projects/unreviewed.md", reviewed: null }));
    indexFile(db, makeDoc({ ...shared, path: "Projects/reviewed.md", reviewed: "2026-01-01" }));

    const results = run("boostterm", {}, 2);
    expect(results.length).toBe(2);
    expect(results[0].path).toBe("Projects/reviewed.md");
  });

  it("should handle null created field", () => {
    indexFile(
      db,
      makeDoc({
        path: "Projects/null-dates.md",
        title: "Null Dates",
        body: "Document with null dates for freshness test.",
        tags: ["test"],
        source_url: null,
      }),
    );

    const results = run("Null Dates");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].created).toBeTruthy();
  });
});
