/**
 * Tests for ref.bib citation validation (T9) and loadRefBibCitekeys.
 *
 * A citekey passes validation when present in the notes.db citations
 * table OR in the ref.bib citekey set parsed from KNOWLEDGE_DIR.
 *
 * @module tests/common/citation-bib.test
 */

import { mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { createDb, initDb } from "../../extensions/para-knowledge/sqlite-init.js";

import type { SqliteDb } from "../../extensions/para-knowledge/sqlite-types.js";
describe("validateCitations with ref.bib citekeys (T9)", () => {
  let tmpDir: string;
  let dbPath: string;
  let db: SqliteDb;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(homedir(), "citation-bib-test-"));
    dbPath = join(tmpDir, "test.db");
    db = createDb(dbPath);
    initDb(db);
    const insert = db.prepare(
      "INSERT INTO citations (citekey, bibtex, doi, source_url, created, updated) VALUES (?, ?, ?, ?, ?, ?)",
    );
    insert.run("inBoth2024", "@misc{inBoth2024,…}", null, null, "2024-01-01", "2024-01-01");
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("accepts a citekey present only in the bib set", async () => {
    const { validateCitations } = await import("../../common/citation-validation.js");

    const result = validateCitations("Cites @onlyInBib here.", db, new Set(["onlyInBib"]));
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("rejects a citekey in neither the table nor the bib set", async () => {
    const { validateCitations } = await import("../../common/citation-validation.js");

    const result = validateCitations("Cites @nowhere here.", db, new Set(["onlyInBib"]));
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(["nowhere"]);
  });

  it("still rejects @? even when a bib set is provided", async () => {
    const { validateCitations } = await import("../../common/citation-validation.js");

    const result = validateCitations("Unresolved @?.", db, new Set(["onlyInBib"]));
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(["?"]);
  });

  it("accepts a citekey present in both the table and the bib set", async () => {
    const { validateCitations } = await import("../../common/citation-validation.js");

    const result = validateCitations("Cites @inBoth2024.", db, new Set(["inBoth2024"]));
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("checks duplicate citations in content only once", async () => {
    const { validateCitations } = await import("../../common/citation-validation.js");

    const result = validateCitations("@dup2023 appears twice: @dup2023.", db, new Set<string>());
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(["dup2023"]);
  });
});

describe("loadRefBibCitekeys", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(homedir(), "citation-bibload-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses citekeys from ref.bib entries", async () => {
    const { writeFileSync } = await import("node:fs");
    const { loadRefBibCitekeys } = await import("../../common/citation-validation.js");

    writeFileSync(
      join(tmpDir, "ref.bib"),
      ["@misc{alpha2024,", "  title = {A},", "}", "@article{beta2023,", "  title = {B},", "}"].join(
        "\n",
      ),
      "utf-8",
    );

    const keys = loadRefBibCitekeys(tmpDir);
    expect(keys.has("alpha2024")).toBe(true);
    expect(keys.has("beta2023")).toBe(true);
  });

  it("returns an empty set when ref.bib is missing", async () => {
    const { loadRefBibCitekeys } = await import("../../common/citation-validation.js");

    const keys = loadRefBibCitekeys(join(tmpDir, "no-such-dir"));
    expect(keys.size).toBe(0);
  });
});
