/**
 * Tests for common/citation.ts — preview-only citation resolution.
 *
 * Verifies that previewCitation:
 * - Returns the preview shape with date and urldate fields
 * - Deduplicates against the citations table
 * - Never writes ref.bib or notes.db
 */

import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { createDb, initDb } from "../../extensions/para-knowledge/sqlite-init.ts";

describe("previewCitation shared module", () => {
  let tmpDir: string;
  let knowledgeDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(homedir(), "citation-preview-test-"));
    knowledgeDir = join(tmpDir, "knowledge");
    mkdirSync(knowledgeDir, { recursive: true });

    process.env.KNOWLEDGE_DIR = knowledgeDir;
    process.env.KNOWLEDGE_DB = "notes.db";
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.KNOWLEDGE_DIR;
    delete process.env.KNOWLEDGE_DB;
  });

  it("previews a new fallback citation with date and urldate without writing files", async () => {
    const { previewCitation } = await import("../../common/citation.ts");

    const result = await previewCitation(
      {
        source: "https://example.com/test-paper",
        title: "Test Paper",
        authors: ["Smith, John"],
        year: 2024,
        accessed: "2024-06-01",
      },
      { cwd: tmpDir },
    );

    expect(result).toHaveProperty("citekey");
    expect(result).toHaveProperty("bibtex");
    expect(result.isNew).toBe(true);
    expect(result.doi).toBeNull();
    expect(result.source_url).toBe("https://example.com/test-paper");
    expect(result.published).toBe("2024");

    expect(result.citekey).toBe("smith2024");
    expect(result.bibtex).toContain("@misc{smith2024");
    expect(result.bibtex).toContain("Test Paper");
    expect(result.bibtex).toContain("date = {2024}");
    expect(result.bibtex).toContain("urldate = {2024-06-01}");

    expect(existsSync(resolve(knowledgeDir, "ref.bib"))).toBe(false);
    expect(existsSync(resolve(knowledgeDir, "notes.db"))).toBe(false);
  });

  it("returns the existing citekey with isNew false for a known DOI", async () => {
    const dbPath = resolve(knowledgeDir, "notes.db");
    const db = createDb(dbPath);
    initDb(db);
    db.prepare(
      "INSERT INTO citations (citekey, bibtex, doi, source_url, published, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "known2023",
      "@article{known2023,\n\ttitle = {Known},\n}",
      "10.1234/known",
      "https://example.com/known",
      "2023-04-02",
      "2024-01-01",
      "2024-01-01",
    );
    db.close();

    const { previewCitation } = await import("../../common/citation.ts");

    const result = await previewCitation(
      { source: "https://doi.org/10.1234/known", accessed: "2024-06-01" },
      { cwd: tmpDir },
    );

    expect(result.isNew).toBe(false);
    expect(result.citekey).toBe("known2023");
    expect(result.doi).toBe("10.1234/known");
    expect(result.published).toBe("2023-04-02");
    expect(existsSync(resolve(knowledgeDir, "ref.bib"))).toBe(false);

    const reopened = createDb(dbPath, { readOnly: true });
    const count = reopened.get<{ n: number }>("SELECT COUNT(*) AS n FROM citations");
    reopened.close();
    expect(count?.n).toBe(1);
  });

  it("returns the existing citekey with isNew false for a known source URL", async () => {
    const db = createDb(resolve(knowledgeDir, "notes.db"));
    initDb(db);
    db.prepare(
      "INSERT INTO citations (citekey, bibtex, doi, source_url, created, updated) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      "knownUrl2022",
      "@misc{knownUrl2022,\n\ttitle = {Known URL},\n}",
      null,
      "https://example.com/known-url",
      "2024-01-01",
      "2024-01-01",
    );
    db.close();

    const { previewCitation } = await import("../../common/citation.ts");

    const result = await previewCitation(
      { source: "https://example.com/known-url" },
      { cwd: tmpDir },
    );

    expect(result.isNew).toBe(false);
    expect(result.citekey).toBe("knownUrl2022");
    expect(result.source_url).toBe("https://example.com/known-url");
  });

  it("fails gracefully when no metadata and citation.js cannot parse", async () => {
    const { previewCitation } = await import("../../common/citation.ts");

    const result = await previewCitation(
      { source: "https://example.com/no-metadata" },
      { cwd: tmpDir },
    );

    expect(result.citekey).toBeNull();
    expect(result.bibtex).toBeNull();
    expect(result.isNew).toBe(false);
    expect(result.error).toContain("Could not parse");
  });

  it("falls back with title+year alone and defaults the author to unknown", async () => {
    const { previewCitation } = await import("../../common/citation.ts");

    const result = await previewCitation(
      { source: "https://promptessor.com/blog/llm-guardrails-guide", title: "T", year: 2026 },
      { cwd: tmpDir },
    );

    expect(result.error).toBeUndefined();
    expect(result.isNew).toBe(true);
    expect(result.citekey).toBe("unknown2026");
    expect(result.bibtex).toContain("@misc{unknown2026");
    expect(result.bibtex).toContain("author = {unknown}");
    expect(result.bibtex).toContain("date = {2026}");
  });

  it("still fails without a title even when year is present", async () => {
    const { previewCitation } = await import("../../common/citation.ts");

    const result = await previewCitation(
      { source: "https://genai.owasp.org/", year: 2026 },
      { cwd: tmpDir },
    );

    expect(result.citekey).toBeNull();
    expect(result.error).toContain("Could not parse");
  });

  it("never modifies an existing ref.bib", async () => {
    const { writeFileSync } = await import("node:fs");
    const refBibPath = resolve(knowledgeDir, "ref.bib");
    const original = "@misc{smith2024,\n\ttitle = {Existing},\n}\n";
    writeFileSync(refBibPath, original, "utf-8");

    const { previewCitation } = await import("../../common/citation.ts");

    const result = await previewCitation(
      {
        source: "https://example.com/another-paper",
        title: "Another Paper",
        authors: ["Smith, John"],
        year: 2024,
        accessed: "2024-06-01",
      },
      { cwd: tmpDir },
    );

    expect(result.isNew).toBe(true);
    expect(result.citekey).toBe("smith2024a");
    expect(readFileSync(refBibPath, "utf-8")).toBe(original);
  });
});
