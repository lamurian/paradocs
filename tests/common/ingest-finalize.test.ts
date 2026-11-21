/**
 * Tests for common/ingest-finalize.ts and its wiring into common/ingest.ts.
 *
 * Covers citation-before-note ordering, capped auto-links, the single
 * knowledge-base commit per run and the human-readable report.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatIngestReport, type IngestReport } from "../../common/ingest-finalize.ts";
import { ingestOutbox } from "../../common/ingest.ts";
import { writeOutboxBatch } from "../../common/outbox.ts";
import { indexFile } from "../../extensions/para-knowledge/sqlite-indexing.ts";
import { createDb, initDb } from "../../extensions/para-knowledge/sqlite-init.ts";

import type { DocIndex, SqliteDb } from "../../extensions/para-knowledge/sqlite-types.ts";

const mocks = vi.hoisted(() => ({
  commitCitations: vi.fn(),
  commitKnowledgeBase: vi.fn(),
}));

vi.mock("../../common/citation-commit.ts", () => ({
  commitCitations: mocks.commitCitations,
}));

vi.mock("../../common/gitCommit.ts", () => ({
  commitKnowledgeBase: mocks.commitKnowledgeBase,
}));

const NOW = new Date("2024-05-01T12:00:00.000Z");

/** Build a minimal indexed document. */
function makeDoc(path: string, title: string, body: string, tags: string[]): DocIndex {
  return {
    path,
    title,
    body,
    tags,
    author: "pi",
    editor: "lam",
    created: null,
    modified: null,
    file_mtime: null,
    source_url: null,
  };
}

describe("ingest finalization", () => {
  let tmpDir: string;
  let cwd: string;
  let knowledgeDir: string;
  let db: SqliteDb;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ingest-finalize-"));
    cwd = join(tmpDir, "project");
    knowledgeDir = join(tmpDir, "knowledge");
    mkdirSync(knowledgeDir, { recursive: true });
    db = createDb(":memory:");
    initDb(db);

    mocks.commitCitations.mockReset();
    mocks.commitKnowledgeBase.mockReset();
    mocks.commitCitations.mockResolvedValue({ added: [], skipped: [] });
    mocks.commitKnowledgeBase.mockResolvedValue({ ok: true, hash: "abc123" });
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("commits a batch's citations before writing its notes", async () => {
    const targetPath = "Resources/cited-note.md";
    const target = join(knowledgeDir, targetPath);

    mocks.commitCitations.mockImplementation(
      (
        _db: SqliteDb,
        _knowledgeDir: string,
        entries: Array<{ citekey: string }>,
      ): { added: string[]; skipped: string[] } => {
        expect(existsSync(target)).toBe(false);
        return { added: entries.map((entry) => entry.citekey), skipped: [] };
      },
    );

    writeOutboxBatch(cwd, {
      notes: [
        {
          input: {
            mode: "create",
            title: "Cited Note",
            description: "A cited note",
            tags: ["testing"],
            area: "Resources",
            summary: ["See @smith2024."],
            keyPoints: ["A point."],
          },
          rendered: {
            markdown: "# Cited Note\n\nSee @smith2024.\n",
            contentLines: 2,
            citekeys: ["smith2024"],
          },
          baseHash: null,
        },
      ],
      citations: [
        {
          citekey: "smith2024",
          bibtex: "@misc{smith2024,\n\ttitle = {A source},\n}",
        },
      ],
    });

    const report = await ingestOutbox(cwd, { knowledgeDir, db, now: NOW });

    expect(mocks.commitCitations).toHaveBeenCalledTimes(1);
    expect(report.citationsAdded).toEqual(["smith2024"]);
    expect(existsSync(target)).toBe(true);
  });

  it("appends at most note.maxLinks Relevant notes links", async () => {
    writeFileSync(
      join(knowledgeDir, "paradocs.json"),
      `${JSON.stringify({ note: { maxLinks: 2 } }, null, 2)}\n`,
      "utf8",
    );

    for (let index = 0; index < 4; index++) {
      indexFile(
        db,
        makeDoc(`Resources/related-${index}.md`, `Related ${index}`, `Shared content ${index}.`, [
          "shared",
        ]),
      );
    }

    writeOutboxBatch(cwd, {
      notes: [
        {
          input: {
            mode: "create",
            title: "Linked Note",
            description: "A note to link",
            tags: ["shared"],
            area: "Resources",
            summary: ["Shared content."],
            keyPoints: ["A point."],
          },
          rendered: {
            markdown: "# Linked Note\n\nShared content.\n",
            contentLines: 2,
            citekeys: [],
          },
          baseHash: null,
        },
      ],
      citations: [],
    });

    await ingestOutbox(cwd, { knowledgeDir, db, now: NOW });

    const content = readFileSync(join(knowledgeDir, "Resources", "linked-note.md"), "utf8");
    const links = content.match(/^- \[[^\]]+\]\([^)]+\.md\)$/gm) ?? [];
    expect(content).toContain("## Relevant notes");
    expect(links).toHaveLength(2);
  });

  it("makes exactly one KB commit per run with changes", async () => {
    for (const title of ["First Note", "Second Note"]) {
      writeOutboxBatch(cwd, {
        notes: [
          {
            input: {
              mode: "create",
              title,
              description: "A staged note",
              tags: ["testing"],
              area: "Projects",
              summary: ["A summary."],
              keyPoints: ["A key point."],
            },
            rendered: {
              markdown: `# ${title}\n\nBody.\n`,
              contentLines: 2,
              citekeys: [],
            },
            baseHash: null,
          },
        ],
        citations: [],
      });
    }

    const report = await ingestOutbox(cwd, { knowledgeDir, db, now: NOW });

    expect(mocks.commitKnowledgeBase).toHaveBeenCalledTimes(1);
    expect(mocks.commitKnowledgeBase).toHaveBeenCalledWith("paradocs: ingest 2+0 notes", cwd);
    expect(report.commit).toBe("abc123");
  });

  it("does not commit when a run has no changes", async () => {
    const report = await ingestOutbox(cwd, { knowledgeDir, db, now: NOW });

    expect(mocks.commitKnowledgeBase).not.toHaveBeenCalled();
    expect(report.commit).toBeNull();
  });

  it("records parked conflict paths for the report", async () => {
    const targetPath = "Resources/existing.md";
    mkdirSync(join(knowledgeDir, "Resources"), { recursive: true });
    writeFileSync(join(knowledgeDir, targetPath), "user edited body\n");

    writeOutboxBatch(cwd, {
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
            markdown: "# Existing Note\n\nStaged body.\n",
            contentLines: 2,
            citekeys: [],
          },
          baseHash: "0".repeat(64),
        },
      ],
      citations: [],
    });

    const report = await ingestOutbox(cwd, { knowledgeDir, db, now: NOW });
    const text = formatIngestReport(report);

    expect(report.conflicts).toEqual([targetPath]);
    expect(report.conflictPaths?.[0]).toContain(join(".pi", "paradocs", "outbox", ".conflicts"));
    expect(text).toContain(targetPath);
    expect(text).toContain(".conflicts");
  });

  it("formats created, updated, skipped, conflicts and citations", () => {
    const report: IngestReport = {
      batches: ["b-1"],
      created: ["Projects/new.md"],
      updated: ["Areas/updated.md"],
      skipped: [{ path: "Resources/skip.md", reason: "target exists" }],
      conflicts: ["Resources/conflict.md", "Resources/other.md"],
      conflictPaths: ["/project/.pi/paradocs/outbox/.conflicts/b-1/conflict.md"],
      citationsAdded: ["smith2024"],
      commit: "abc123",
    };

    const text = formatIngestReport(report);

    expect(text).toContain("Projects/new.md");
    expect(text).toContain("Areas/updated.md");
    expect(text).toContain("Resources/skip.md (target exists)");
    expect(text).toContain("/project/.pi/paradocs/outbox/.conflicts/b-1/conflict.md");
    expect(text).toContain("outbox/.conflicts/other.md");
    expect(text).toContain("smith2024");
    expect(text).toContain("Commit: abc123");
  });

  it("formats an empty report with explicit empty sections", () => {
    const text = formatIngestReport({
      batches: [],
      created: [],
      updated: [],
      skipped: [],
      conflicts: [],
      citationsAdded: [],
      commit: null,
    });

    expect(text).toContain("Ingest report: 0 batch(es)");
    expect(text).toContain("Created:\n  (none)");
    expect(text).toContain("Updated:\n  (none)");
    expect(text).toContain("Skipped:\n  (none)");
    expect(text).toContain("Conflicts:\n  (none)");
    expect(text).toContain("Citations added:\n  (none)");
    expect(text).toContain("Commit: none");
  });
});
