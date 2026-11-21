/**
 * Tests for common/ingest.ts — outbox ingest into the knowledge base.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ingestOutbox } from "../../common/ingest.ts";
import { writeOutboxBatch } from "../../common/outbox.ts";
import { createDb, initDb } from "../../extensions/para-knowledge/sqlite-init.ts";

import type { SqliteDb } from "../../extensions/para-knowledge/sqlite-types.ts";

const NOW = new Date("2024-05-01T12:00:00.000Z");

describe("ingestOutbox", () => {
  let tmpDir: string;
  let cwd: string;
  let knowledgeDir: string;
  let db: SqliteDb;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ingest-test-"));
    cwd = join(tmpDir, "project");
    knowledgeDir = join(tmpDir, "knowledge");
    mkdirSync(knowledgeDir, { recursive: true });
    db = createDb(":memory:");
    initDb(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes created notes and indexes their note_citations", async () => {
    writeOutboxBatch(cwd, {
      notes: [
        {
          input: {
            mode: "create",
            title: "Alpha Note",
            description: "A staged note",
            tags: ["testing"],
            area: "Resources",
            summary: ["A summary."],
            keyPoints: ["A key point."],
          },
          rendered: {
            markdown: "# Alpha Note\n\nSee @smith2024 for details.\n",
            contentLines: 2,
            citekeys: ["smith2024"],
          },
          baseHash: null,
        },
      ],
      citations: [],
    });

    const report = await ingestOutbox(cwd, { knowledgeDir, db, now: NOW });

    const target = join(knowledgeDir, "Resources", "alpha-note.md");
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf8")).toContain("@smith2024");
    expect(report.created).toContain("Resources/alpha-note.md");

    const citekeys = db
      .all<{
        citekey: string;
      }>("SELECT citekey FROM note_citations WHERE file_path = ? ORDER BY citekey", "Resources/alpha-note.md")
      .map((row) => row.citekey);
    expect(citekeys).toEqual(["smith2024"]);
  });

  it("parks an update with a stale baseHash as a conflict", async () => {
    const targetPath = "Resources/existing.md";
    const target = join(knowledgeDir, targetPath);
    mkdirSync(join(knowledgeDir, "Resources"), { recursive: true });
    writeFileSync(target, "user edited body\n");

    const staged = writeOutboxBatch(cwd, {
      notes: [
        {
          input: {
            mode: "update",
            targetPath,
            title: "Existing Note",
            description: "An update",
            tags: ["testing"],
            area: "Resources",
            summary: ["Updated summary."],
            keyPoints: ["Updated point."],
          },
          rendered: {
            markdown: "staged draft body\n",
            contentLines: 1,
            citekeys: [],
          },
          baseHash: "0".repeat(64),
        },
      ],
      citations: [],
    });

    const report = await ingestOutbox(cwd, { knowledgeDir, db, now: NOW });

    expect(readFileSync(target, "utf8")).toBe("user edited body\n");
    expect(report.conflicts).toContain(targetPath);
    expect(report.updated).not.toContain(targetPath);

    const parked = join(
      cwd,
      ".pi",
      "paradocs",
      "outbox",
      ".conflicts",
      staged.batchId,
      basename("notes/existing-note.md"),
    );
    expect(existsSync(parked)).toBe(true);
    expect(readFileSync(parked, "utf8")).toBe("staged draft body\n");
  });

  it("moves processed batches to .ingested so a second run is a no-op", async () => {
    const staged = writeOutboxBatch(cwd, {
      notes: [
        {
          input: {
            mode: "create",
            title: "Second Note",
            description: "A staged note",
            tags: ["testing"],
            area: "Projects",
            summary: ["A summary."],
            keyPoints: ["A key point."],
          },
          rendered: {
            markdown: "# Second Note\n\nBody without citations.\n",
            contentLines: 2,
            citekeys: [],
          },
          baseHash: null,
        },
      ],
      citations: [],
    });

    await ingestOutbox(cwd, { knowledgeDir, db, now: NOW });

    expect(existsSync(join(cwd, ".pi", "paradocs", "outbox", ".ingested", staged.batchId))).toBe(
      true,
    );
    expect(existsSync(join(cwd, ".pi", "paradocs", "outbox", staged.batchId))).toBe(false);

    const second = await ingestOutbox(cwd, { knowledgeDir, db, now: NOW });
    expect(second.batches).toEqual([]);
    expect(second.created).toEqual([]);
    expect(second.updated).toEqual([]);
    expect(second.citationsAdded).toEqual([]);
  });
});
