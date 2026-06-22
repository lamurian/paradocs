/**
 * Tests for common/citation.ts — validateCitations function.
 *
 * Verifies that the exported function:
 * - Returns valid=true when all @citekey references exist in DB
 * - Rejects @? (unresolved placeholder)
 * - Rejects non-existent citekeys with a list of missing keys
 * - Ignores code blocks and inline code containing @citekey patterns
 * - Ignores markdown link syntax like [text](@citekey)
 * - Ignores email-like patterns (@ not preceded by word boundary)
 * - Handles edge cases: @citekey at end of sentence, inside parens
 */

import { mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { createDb, initDb } from "../../extensions/para-knowledge/sqlite-init.js";

import type { SqliteDb } from "../../extensions/para-knowledge/sqlite-types.js";

describe("validateCitations", () => {
  let tmpDir: string;
  let dbPath: string;
  let db: SqliteDb;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(homedir(), "citation-val-test-"));
    dbPath = join(tmpDir, "test.db");

    // Create fresh DB with schema for each test
    db = createDb(dbPath);
    initDb(db);

    // Seed with test citations
    const insert = db.prepare(
      "INSERT INTO citations (citekey, bibtex, doi, source_url, created, updated) VALUES (?, ?, ?, ?, ?, ?)",
    );
    insert.run("smith2024", "@misc{smith2024,…}", null, null, "2024-01-01", "2024-01-01");
    insert.run("jones2023", "@misc{jones2023,…}", null, null, "2023-01-01", "2023-01-01");
    insert.run(
      "lee2022a",
      "@article{lee2022a,…}",
      "10.1234/example",
      null,
      "2022-01-01",
      "2022-01-01",
    );
    insert.run(
      "doe2021",
      "@book{doe2021,…}",
      null,
      "https://example.com/doe2021",
      "2021-01-01",
      "2021-01-01",
    );
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should return valid when content has no citations", async () => {
    const { validateCitations } = await import("../../common/citation-validation.js");

    const result = validateCitations("Just some plain text without any citekey references.", db);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("should return valid when all citekeys exist in DB", async () => {
    const { validateCitations } = await import("../../common/citation-validation.js");

    const content = "This references [@smith2024] and also @jones2023 in narrative form.";
    const result = validateCitations(content, db);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("should return valid for multiple existing citekeys", async () => {
    const { validateCitations } = await import("../../common/citation-validation.js");

    const content = "Multiple: [@smith2024; @jones2023; @lee2022a] and @doe2021 too.";
    const result = validateCitations(content, db);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("should reject @? (unresolved placeholder) citekey", async () => {
    const { validateCitations } = await import("../../common/citation-validation.js");

    const content = "This has an unresolved citation @?.";
    const result = validateCitations(content, db);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("?");
  });

  it("should reject non-existent citekeys with clear error listing missing keys", async () => {
    const { validateCitations } = await import("../../common/citation-validation.js");

    const content = "Referencing @nonexistentKey in text.";
    const result = validateCitations(content, db);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("nonexistentKey");
  });

  it("should list all missing citekeys in one call", async () => {
    const { validateCitations } = await import("../../common/citation-validation.js");

    const content = "Missing @keyA and @keyB but valid @smith2024.";
    const result = validateCitations(content, db);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("keyA");
    expect(result.missing).toContain("keyB");
    expect(result.missing).not.toContain("smith2024");
  });

  it("should reject content with both @? and non-existent keys together", async () => {
    const { validateCitations } = await import("../../common/citation-validation.js");

    const content = "Mixed: @? and @badkey.";
    const result = validateCitations(content, db);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("?");
    expect(result.missing).toContain("badkey");
  });

  it("should NOT match citekeys inside fenced code blocks", async () => {
    const { validateCitations } = await import("../../common/citation-validation.js");

    const content = [
      "Some text with @smith2024.",
      "```",
      "@nonexistent in code block",
      "```",
      "More text @jones2023.",
    ].join("\n");

    const result = validateCitations(content, db);
    // only smith2024 and jones2023 should be checked — both exist
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("should NOT match citekeys inside inline code (backticks)", async () => {
    const { validateCitations } = await import("../../common/citation-validation.js");

    const content = "Valid @smith2024 and `@nonexistent` inline code reference.";
    const result = validateCitations(content, db);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("should NOT match markdown link syntax like [text](@citekey)", async () => {
    const { validateCitations } = await import("../../common/citation-validation.js");

    const content = "See [this link](@nonexistent) for details with @smith2024.";
    const result = validateCitations(content, db);
    // @nonexistent inside markdown link should be ignored
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("should NOT match email-like patterns (word-chars before @)", async () => {
    const { validateCitations } = await import("../../common/citation-validation.js");

    const content = "Contact user@example.com and see @smith2024.";
    const result = validateCitations(content, db);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("should handle @citekey at end of sentence before period", async () => {
    const { validateCitations } = await import("../../common/citation-validation.js");

    const content = "This concept is well established @smith2024.";
    const result = validateCitations(content, db);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("should handle @citekey inside parentheses", async () => {
    const { validateCitations } = await import("../../common/citation-validation.js");

    const content = "Some research (@jones2023) shows this.";
    const result = validateCitations(content, db);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("should handle @citekey after punctuation like commas", async () => {
    const { validateCitations } = await import("../../common/citation-validation.js");

    const content = "Multiple sources: @smith2024, @jones2023, and @lee2022a.";
    const result = validateCitations(content, db);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("should return missing count >0 when violations found", async () => {
    const { validateCitations } = await import("../../common/citation-validation.js");

    const content = "Bad @missing1 and @missing2.";
    const result = validateCitations(content, db);
    expect(result.valid).toBe(false);
    expect(result.missing.length).toBe(2);
    expect(result.missing).toEqual(["missing1", "missing2"]);
  });

  it("should match @citekey-like patterns in paths as potential citekeys", async () => {
    const { validateCitations } = await import("../../common/citation-validation.js");

    const content = "File at /path/to/@something and @smith2024.";
    const result = validateCitations(content, db);
    // @something looks like a valid citekey pattern — it's matched and flagged
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("something");
    // On the other hand, input like user@example.com would NOT match because
    // the @ is preceded by a word character (r).
  });

  it("should return valid for empty content", async () => {
    const { validateCitations } = await import("../../common/citation-validation.js");

    const result = validateCitations("", db);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });
});
