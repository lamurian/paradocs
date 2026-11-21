/**
 * Tests for ref.bib-aware citation previews.
 *
 * A preview citekey must be unique against both the citations table and
 * ref.bib, and the preview must never write either.
 *
 * @module tests/common/citation-bib.test
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("previewCitation against ref.bib", () => {
  let tmpDir: string;
  let knowledgeDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(homedir(), "citation-bib-test-"));
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

  it("parses citekeys from ref.bib entries", async () => {
    const { loadRefBibCitekeys } = await import("../../common/citation-validation.ts");

    writeFileSync(
      resolve(knowledgeDir, "ref.bib"),
      ["@misc{alpha2024,", "  title = {A},", "}", "@article{beta2023,", "  title = {B},", "}"].join(
        "\n",
      ),
      "utf-8",
    );

    const keys = loadRefBibCitekeys(knowledgeDir);
    expect(keys.has("alpha2024")).toBe(true);
    expect(keys.has("beta2023")).toBe(true);
  });

  it("returns an empty set when ref.bib is missing", async () => {
    const { loadRefBibCitekeys } = await import("../../common/citation-validation.ts");

    const keys = loadRefBibCitekeys(join(tmpDir, "no-such-dir"));
    expect(keys.size).toBe(0);
  });

  it("picks a citekey not already used in ref.bib and leaves the file untouched", async () => {
    const refBibPath = resolve(knowledgeDir, "ref.bib");
    const original = "@misc{smith2024,\n\ttitle = {Already there},\n}\n";
    writeFileSync(refBibPath, original, "utf-8");

    const { previewCitation } = await import("../../common/citation.ts");

    const result = await previewCitation(
      {
        source: "https://example.com/ref-bib-test",
        title: "Ref Bib Test",
        authors: ["Smith, Jane"],
        year: 2024,
        accessed: "2024-07-01",
      },
      { cwd: tmpDir },
    );

    expect(result.isNew).toBe(true);
    expect(result.citekey).toBe("smith2024a");
    expect(result.bibtex).toContain("@misc{smith2024a");
    expect(result.bibtex).toContain("urldate = {2024-07-01}");
    expect(readFileSync(refBibPath, "utf-8")).toBe(original);
  });
});
