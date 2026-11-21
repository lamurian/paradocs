/**
 * Tests for common/citation-commit.ts — the ingest citation writer.
 *
 * commitCitations appends only unknown citekeys to ref.bib, injects the
 * verified field when available, and records freshness metadata in the
 * citations table.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { createDb, initDb } from "../../extensions/para-knowledge/sqlite-init.ts";

import type { SqliteDb } from "../../extensions/para-knowledge/sqlite-types.ts";

describe("commitCitations", () => {
  let tmpDir: string;
  let knowledgeDir: string;
  let db: SqliteDb;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(homedir(), "citation-commit-test-"));
    knowledgeDir = join(tmpDir, "knowledge");
    mkdirSync(knowledgeDir, { recursive: true });

    db = createDb(resolve(knowledgeDir, "notes.db"));
    initDb(db);
    db.prepare("INSERT INTO citations (citekey, bibtex, created, updated) VALUES (?, ?, ?, ?)").run(
      "tableOnly2021",
      "@misc{tableOnly2021,\n\ttitle = {Table},\n}",
      "2024-01-01",
      "2024-01-01",
    );

    writeFileSync(
      resolve(knowledgeDir, "ref.bib"),
      "@misc{bibOnly2020,\n\ttitle = {Bib only},\n}\n",
      "utf-8",
    );
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("adds new citekeys and skips ones already in the table or ref.bib", async () => {
    const { commitCitations } = await import("../../common/citation-commit.ts");

    const result = await commitCitations(db, knowledgeDir, [
      {
        citekey: "new2024",
        bibtex: "@misc{new2024,\n\ttitle = {New source},\n}",
        published: "2024-05-01",
        verified_at: "2024-06-01",
        trust_class: "tier1",
      },
      {
        citekey: "bibOnly2020",
        bibtex: "@misc{bibOnly2020,\n\ttitle = {Bib only},\n}",
      },
      {
        citekey: "tableOnly2021",
        bibtex: "@misc{tableOnly2021,\n\ttitle = {Table},\n}",
      },
    ]);

    expect(result.added).toEqual(["new2024"]);
    expect(result.skipped).toEqual(["bibOnly2020", "tableOnly2021"]);

    const bibContent = readFileSync(resolve(knowledgeDir, "ref.bib"), "utf-8");
    expect(bibContent).toContain("@misc{new2024");
    expect(bibContent).toContain("verified = {2024-06-01}");
    expect(bibContent.match(/@misc\{bibOnly2020/g)).toHaveLength(1);
    expect(bibContent.match(/@misc\{tableOnly2021/g)).toBeNull();

    const row = db.get<{
      published: string | null;
      verified_at: string | null;
      trust_class: string | null;
    }>("SELECT published, verified_at, trust_class FROM citations WHERE citekey = ?", "new2024");

    expect(row?.published).toBe("2024-05-01");
    expect(row?.verified_at).toBe("2024-06-01");
    expect(row?.trust_class).toBe("tier1");
  });

  it("does not overwrite an existing verified field", async () => {
    const { commitCitations } = await import("../../common/citation-commit.ts");

    await commitCitations(db, knowledgeDir, [
      {
        citekey: "alreadyVerified2024",
        bibtex: "@misc{alreadyVerified2024,\n\tverified = {2020-01-01},\n}",
        verified_at: "2024-06-01",
      },
    ]);

    const bibContent = readFileSync(resolve(knowledgeDir, "ref.bib"), "utf-8");
    expect(bibContent).toContain("verified = {2020-01-01}");
    expect(bibContent).not.toContain("verified = {2024-06-01}");
  });

  it("skips duplicate citekeys within the same batch", async () => {
    const { commitCitations } = await import("../../common/citation-commit.ts");

    const result = await commitCitations(db, knowledgeDir, [
      { citekey: "same2024", bibtex: "@misc{same2024,\n\ttitle = {A},\n}" },
      { citekey: "same2024", bibtex: "@misc{same2024,\n\ttitle = {B},\n}" },
    ]);

    expect(result.added).toEqual(["same2024"]);
    expect(result.skipped).toEqual(["same2024"]);
  });
});
