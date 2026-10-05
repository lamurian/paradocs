/**
 * Tests for write-back error surfacing, retry, and the T6 draft-note
 * fallback: grouping failures embed the real error, retry once, then
 * dump sources+citekeys+synthesis to a draft note.
 *
 * Mocked deps and the subject are imported dynamically in importFresh()
 * after vi.resetModules(): with test.isolate=false the shared module cache
 * can hold a writeback.js instance bound to an earlier file's mock
 * instances, silently disconnecting these spies from the code under test.
 *
 * @module tests/research-engine/writeback-errors
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.mock factories are hoisted above imports; each specifier below is
// mocked for this file and re-resolved on every importFresh() reset.
vi.mock("../../common/citation.js", () => ({ resolveCitation: vi.fn() }));
vi.mock("../../common/citation-validation.js", () => ({
  validateCitations: vi.fn(),
  loadRefBibCitekeys: vi.fn().mockReturnValue(new Set()),
}));
vi.mock("../../common/notesDb.js", () => ({ ensureNotesDb: vi.fn() }));
vi.mock("../../extensions/para-knowledge/db-sqlite.js", () => ({
  searchDocs: vi.fn(),
  indexFile: vi.fn(),
}));
vi.mock("../../extensions/batch-create/batch-helpers.js", () => ({
  validateDocuments: vi.fn(),
  buildSkippedNote: vi.fn().mockReturnValue(""),
  createFilesOnDisk: vi.fn(),
  indexDocumentsInDb: vi.fn(),
  autoLinkBatch: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

const KB_DIR = "/tmp/re-kb-errors-test";

type WriteBackToKB = typeof import("../../extensions/research-engine/writeback.js").writeBackToKB;

interface Harness {
  writeBackToKB: WriteBackToKB;
  resolveCitation: ReturnType<typeof vi.fn>;
  validateDocuments: ReturnType<typeof vi.fn>;
  createFilesOnDisk: ReturnType<typeof vi.fn>;
  writeFileSync: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
}

/**
 * Reset the shared module cache, re-import the mocked deps and the subject,
 * and re-stub mock defaults. The returned spies are the instances the
 * freshly-evaluated writeback.js is actually bound to.
 */
async function importFresh(): Promise<Harness> {
  vi.resetModules();
  vi.clearAllMocks();
  const citation = await import("../../common/citation.js");
  const citationValidation = await import("../../common/citation-validation.js");
  const notesDb = await import("../../common/notesDb.js");
  const dbSqlite = await import("../../extensions/para-knowledge/db-sqlite.js");
  const batchHelpers = await import("../../extensions/batch-create/batch-helpers.js");
  const fsPromises = await import("node:fs/promises");
  const fsSync = await import("node:fs");
  const { writeBackToKB } = await import("../../extensions/research-engine/writeback.js");

  vi.mocked(notesDb.ensureNotesDb).mockResolvedValue({} as never);
  vi.mocked(citation.resolveCitation).mockImplementation((params) =>
    Promise.resolve({
      citekey: "key-" + params.source.length,
      bibtex: "",
      isNew: true,
      doi: null,
      source_url: params.source,
    }),
  );
  vi.mocked(batchHelpers.validateDocuments).mockImplementation((docs) =>
    Promise.resolve({ validDocs: docs, validationErrors: [], warnings: [], expandedCount: 0 }),
  );
  vi.mocked(citationValidation.validateCitations).mockReturnValue({ valid: true, missing: [] });
  vi.mocked(batchHelpers.createFilesOnDisk).mockResolvedValue([]);
  vi.mocked(batchHelpers.indexDocumentsInDb).mockResolvedValue(undefined);
  vi.mocked(batchHelpers.autoLinkBatch).mockResolvedValue(0);
  vi.mocked(dbSqlite.searchDocs).mockReturnValue([]);
  vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);
  vi.mocked(fsSync.writeFileSync).mockReturnValue(undefined);
  vi.mocked(fsSync.mkdirSync).mockReturnValue(undefined);

  return {
    writeBackToKB,
    resolveCitation: vi.mocked(citation.resolveCitation),
    validateDocuments: vi.mocked(batchHelpers.validateDocuments),
    createFilesOnDisk: vi.mocked(batchHelpers.createFilesOnDisk),
    writeFileSync: vi.mocked(fsSync.writeFileSync),
    readFile: vi.mocked(fsPromises.readFile),
  };
}

const RESULT = {
  sources: [{ url: "https://a.example/1", snippet: "A", title: "Source A" }],
  questions: ["q"],
  assessment: { sufficient: false, outdatedNotes: [], gaps: [] },
  jobId: "job-err",
  synthesis: "The synthesized answer.",
};
const MODEL = { id: "m", provider: "p" } as never;

describe("writeBackToKB — error surfacing, retry, draft fallback", () => {
  beforeEach(() => {
    process.env.KNOWLEDGE_DIR = KB_DIR;
    process.env.KNOWLEDGE_DB = "notes.db";
  });

  afterEach(() => {
    delete process.env.KNOWLEDGE_DIR;
    delete process.env.KNOWLEDGE_DB;
  });

  it("should embed the real grouping error, retry once, then dump a draft note", async () => {
    const m = await importFresh();
    const groupingFn = vi.fn(() => Promise.resolve({ ok: false, error: "429 rate limited" }));

    const result = await m.writeBackToKB(RESULT, {
      cwd: "/test",
      model: MODEL,
      groupingFn,
    });

    // Retried once -> two calls total
    expect(groupingFn).toHaveBeenCalledTimes(2);
    expect(result.skipped).toContain("write-back skipped: grouping failed: 429 rate limited");
    expect(result.created).toEqual([]);

    // Draft note written with sources, citekeys, and synthesis
    const draftLine = result.skipped.find((s) => s.startsWith("draft: "));
    expect(draftLine).toBeDefined();
    expect(draftLine).toContain(".research/drafts/job-err.md");
    expect(m.writeFileSync).toHaveBeenCalledTimes(1);
    const [path, content] = m.writeFileSync.mock.calls[0] as [string, string];
    expect(path).toBe(KB_DIR + "/.research/drafts/job-err.md");
    expect(content).toContain("https://a.example/1");
    expect(content).toContain("Source A");
    expect(content).toContain("@key-19");
    expect(content).toContain("The synthesized answer.");
  });

  it("should pass source citation metadata (title/authors/year) to resolveCitation", async () => {
    const m = await importFresh();

    await m.writeBackToKB(
      {
        sources: [
          {
            url: "https://promptessor.com/blog/guide",
            snippet: "Key point",
            title: "LLM Guardrails Guide",
            authors: ["Doe, Jane"],
            year: 2026,
          },
        ],
        questions: ["q"],
        assessment: { sufficient: false, outdatedNotes: [], gaps: [] },
      },
      {
        cwd: "/test",
        model: MODEL,
        groupingFn: vi.fn(() => Promise.resolve({ ok: true, value: { notes: [], outdated: [] } })),
      },
    );

    expect(m.resolveCitation).toHaveBeenCalledTimes(1);
    const params = m.resolveCitation.mock.calls[0][0] as Record<string, unknown>;
    expect(params.title).toBe("LLM Guardrails Guide");
    expect(params.authors).toEqual(["Doe, Jane"]);
    expect(params.year).toBe(2026);
  });

  it("should surface atomicity warnings from the batch path as skipped lines", async () => {
    const m = await importFresh();
    const groupingFn = vi.fn(() =>
      Promise.resolve({
        ok: true,
        value: { notes: [{ title: "Note A", content: "Body", tags: ["a"] }], outdated: [] },
      }),
    );
    m.validateDocuments.mockResolvedValue({
      validDocs: [{ title: "Note A", content: "Body", tags: ["a"] }],
      validationErrors: [],
      warnings: [{ title: "Note A", message: "atomicity unverified: auth missing" }],
      expandedCount: 0,
    });
    m.createFilesOnDisk.mockResolvedValue([
      { path: KB_DIR + "/Resources/note-a.md", title: "Note A", relPath: "Resources/note-a.md" },
    ] as never);

    const result = await m.writeBackToKB(RESULT, {
      cwd: "/test",
      model: MODEL,
      groupingFn,
    });

    expect(result.created).toEqual(["Resources/note-a.md"]);
    expect(result.skipped).toContain("atomicity unverified: Note A");
  });

  it("should flag invalid grouping shapes distinctly from call failures", async () => {
    const m = await importFresh();
    const groupingFn = vi.fn(() => Promise.resolve({ ok: true, value: undefined }));

    const result = await m.writeBackToKB(RESULT, {
      cwd: "/test",
      model: MODEL,
      groupingFn,
    });

    expect(result.skipped).toContain(
      "write-back skipped: grouping failed: invalid grouping response",
    );
  });

  it("should surface outdated-note update failures as skipped lines", async () => {
    const m = await importFresh();
    const groupingFn = vi.fn(() =>
      Promise.resolve({
        ok: true,
        value: {
          notes: [],
          outdated: [{ path: "Resources/old.md", reason: "stale", content: "new body" }],
        },
      }),
    );
    m.readFile.mockRejectedValue(new Error("ENOENT"));

    const result = await m.writeBackToKB(RESULT, {
      cwd: "/test",
      model: MODEL,
      groupingFn,
    });

    expect(result.updated).toEqual([]);
    expect(result.skipped[0]).toContain("update failed: Resources/old.md");
  });
});
