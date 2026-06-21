/**
 * Tests for common/citation.ts — shared resolveCitation function.
 *
 * Verifies that the exported function:
 * - Detects existing citations (by DOI/source_url)
 * - Creates new citations with proper citekeys
 * - Writes ref.bib to KNOWLEDGE_DIR
 * - Returns the expected shape
 */

import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("resolveCitation shared module", () => {
  let tmpDir: string;
  let knowledgeDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(homedir(), "citation-common-test-"));
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

  it("should create a new citation with fallback metadata and write ref.bib", async () => {
    const { resolveCitation } = await import("../../common/citation.js");

    const result = await resolveCitation(
      {
        source: "https://example.com/test-paper",
        title: "Test Paper",
        authors: ["Smith, John"],
        year: 2024,
      },
      { cwd: tmpDir },
    );

    // Returns expected shape
    expect(result).toHaveProperty("citekey");
    expect(result).toHaveProperty("bibtex");
    expect(result).toHaveProperty("isNew", true);
    expect(result).toHaveProperty("doi", null);
    expect(result).toHaveProperty("source_url", "https://example.com/test-paper");

    expect(result.citekey).toBe("smith2024");
    expect(result.bibtex).toContain("@misc{smith2024");
    expect(result.bibtex).toContain("Test Paper");

    // ref.bib written to KNOWLEDGE_DIR
    const refBibPath = resolve(knowledgeDir, "ref.bib");
    expect(existsSync(refBibPath)).toBe(true);
    const bibContent = readFileSync(refBibPath, "utf-8");
    expect(bibContent).toContain("@misc{smith2024");
  });

  it("should detect an existing citation and return isNew=false", async () => {
    const { resolveCitation } = await import("../../common/citation.js");

    // First call creates the citation
    const first = await resolveCitation(
      {
        source: "https://example.com/dup-test",
        title: "Duplicate Test",
        authors: ["Jones, Alice"],
        year: 2023,
      },
      { cwd: tmpDir },
    );

    expect(first.isNew).toBe(true);

    // Second call with the same URL should detect existing
    const second = await resolveCitation(
      {
        source: "https://example.com/dup-test",
        title: "Duplicate Test",
        authors: ["Jones, Alice"],
        year: 2023,
      },
      { cwd: tmpDir },
    );

    expect(second.isNew).toBe(false);
    expect(second.citekey).toBe(first.citekey);
    expect(second.bibtex).toBe(first.bibtex);
    expect(second.source_url).toBe("https://example.com/dup-test");
  });

  it("should fail gracefully when no metadata and citation.js cannot parse", async () => {
    const { resolveCitation } = await import("../../common/citation.js");

    const result = await resolveCitation(
      { source: "https://example.com/no-metadata" },
      { cwd: tmpDir },
    );

    expect(result.citekey).toBeNull();
    expect(result.bibtex).toBeNull();
    expect(result.isNew).toBe(false);
    expect(result.error).toContain("Could not parse");
  });
});
