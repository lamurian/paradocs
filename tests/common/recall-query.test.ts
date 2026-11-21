import { describe, it, expect, beforeEach, afterEach } from "vitest";

import type { SqliteDb } from "../../extensions/para-knowledge/sqlite-types.ts";

/** Insert a minimal file + FTS row for recall query tests. */
function insertDoc(db: SqliteDb, path: string, body: string, mtime: string | null): void {
  db.prepare("INSERT INTO files (path, title, file_mtime) VALUES (?, ?, ?)").run(path, path, mtime);
  db.prepare("INSERT INTO docs_fts (path, title, body, tags_csv) VALUES (?, ?, ?, ?)").run(
    path,
    path,
    body,
    "",
  );
}

describe("recall-query", () => {
  let db: SqliteDb;

  beforeEach(async () => {
    const { createDb, initDb } = await import("../../extensions/para-knowledge/sqlite-init.ts");
    db = createDb(":memory:");
    initDb(db);
    insertDoc(
      db,
      "Projects/alpha.md",
      "typescript database reasoning orchestration recall",
      "2026-01-01T00:00:00.000Z",
    );
    insertDoc(db, "Projects/beta.md", "database reasoning recall", "2026-01-02T00:00:00.000Z");
  });

  afterEach(() => {
    db?.close();
  });

  it("drops stopwords, URLs, paths, code identifiers and digit tokens", async () => {
    const { buildIdfMap, extractRecallTerms } = await import("../../common/recall-query.ts");
    const idf = buildIdfMap(db);

    const prompt = [
      "Please the and of",
      "https://example.com/typescript",
      "src/typescript/foo.ts",
      "./relative/path",
      "~/home/typescript",
      "camelCaseTerm",
      "snake_case_term",
      "console.log",
      "fn(typescript)",
      "const=1",
      "value<2>",
      "hex0x1f",
      "2026",
      "typescript",
      "database",
    ].join(" ");

    const terms = extractRecallTerms(prompt, idf);

    expect(terms).toContain("typescript");
    expect(terms).toContain("database");
    expect(terms).not.toContain("the");
    expect(terms).not.toContain("and");
    expect(terms).not.toContain("example");
    expect(terms).not.toContain("path");
    expect(terms).not.toContain("relative");
    expect(terms).not.toContain("home");
    expect(terms).not.toContain("camel");
    expect(terms).not.toContain("case");
    expect(terms).not.toContain("term");
    expect(terms).not.toContain("snake");
    expect(terms).not.toContain("console");
    expect(terms).not.toContain("const");
    expect(terms).not.toContain("value");
    expect(terms).not.toContain("hex");
    expect(terms).not.toContain("2026");
  });

  it("only reads the first maxChars characters of the prompt", async () => {
    const { buildIdfMap, extractRecallTerms } = await import("../../common/recall-query.ts");
    const idf = buildIdfMap(db);

    // "typescript" starts after the 9 character cut, "database" before it.
    const prompt = "database typescript";
    const terms = extractRecallTerms(prompt, idf, { maxChars: 9, maxTerms: 10 });

    expect(terms).toEqual(["database"]);
  });

  it("returns at most maxTerms terms known to the KB ordered by descending IDF", async () => {
    const { buildIdfMap, extractRecallTerms } = await import("../../common/recall-query.ts");
    const idf = buildIdfMap(db);

    // "typescript" appears in one doc (higher IDF) than "database"/"reasoning".
    const terms = extractRecallTerms("database reasoning typescript unknownword", idf, {
      maxChars: 2000,
      maxTerms: 2,
    });

    expect(terms).toEqual(["typescript", "database"]);

    const allTerms = extractRecallTerms("database reasoning typescript", idf, {
      maxChars: 2000,
      maxTerms: 12,
    });
    expect(allTerms).toHaveLength(3);
    expect(allTerms[0]).toBe("typescript");
  });

  it("caches the IDF map until the files signature changes", async () => {
    const { buildIdfMap } = await import("../../common/recall-query.ts");

    const first = buildIdfMap(db);
    const second = buildIdfMap(db);
    expect(second).toBe(first);
    expect(first.get("typescript")).toBeTypeOf("number");

    insertDoc(
      db,
      "Projects/gamma.md",
      "nondeterministiccapabilitylayer",
      "2026-01-03T00:00:00.000Z",
    );

    const third = buildIdfMap(db);
    expect(third).not.toBe(first);
    expect(third.has("nondeterministiccapabilitylayer")).toBe(true);
    expect(third.get("nondeterministiccapabilitylayer")).toBeGreaterThan(
      third.get("database") ?? 0,
    );
  });
});
