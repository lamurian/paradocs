/**
 * Tests for write-back error surfacing and metadata pass-through (T11).
 *
 * @module tests/research-engine/writeback-errors.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../common/llm.js", () => ({ callLlmDirect: vi.fn() }));
vi.mock("../../common/citation.js", () => ({ resolveCitation: vi.fn() }));
vi.mock("../../common/citation-validation.js", () => ({ validateCitations: vi.fn() }));
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

const KB_DIR = "/tmp/re-kb-errors-test";

interface Harness {
  writeBackToKB: typeof import("../../extensions/research-engine/writeback.js").writeBackToKB;
  callLlmDirect: ReturnType<typeof vi.fn>;
  resolveCitation: ReturnType<typeof vi.fn>;
  validateDocuments: ReturnType<typeof vi.fn>;
  createFilesOnDisk: ReturnType<typeof vi.fn>;
}

async function importFresh(): Promise<Harness> {
  vi.resetModules();
  const writeback = await import("../../extensions/research-engine/writeback.js");
  const llm = await import("../../common/llm.js");
  const citation = await import("../../common/citation.js");
  const citationValidation = await import("../../common/citation-validation.js");
  const notesDb = await import("../../common/notesDb.js");
  const dbSqlite = await import("../../extensions/para-knowledge/db-sqlite.js");
  const batchHelpers = await import("../../extensions/batch-create/batch-helpers.js");
  const fs = await import("node:fs/promises");

  vi.clearAllMocks();

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
  vi.mocked(llm.callLlmDirect).mockResolvedValue({
    ok: true,
    value: { notes: [], outdated: [] },
  });
  vi.mocked(batchHelpers.validateDocuments).mockImplementation((docs) =>
    Promise.resolve({ validDocs: docs, validationErrors: [], warnings: [], expandedCount: 0 }),
  );
  vi.mocked(citationValidation.validateCitations).mockReturnValue({ valid: true, missing: [] });
  vi.mocked(batchHelpers.createFilesOnDisk).mockResolvedValue([]);
  vi.mocked(batchHelpers.indexDocumentsInDb).mockResolvedValue(undefined);
  vi.mocked(batchHelpers.autoLinkBatch).mockResolvedValue(0);
  vi.mocked(dbSqlite.searchDocs).mockReturnValue([]);
  vi.mocked(fs.writeFile).mockResolvedValue(undefined);

  return {
    writeBackToKB: writeback.writeBackToKB,
    callLlmDirect: vi.mocked(llm.callLlmDirect),
    resolveCitation: vi.mocked(citation.resolveCitation),
    validateDocuments: vi.mocked(batchHelpers.validateDocuments),
    createFilesOnDisk: vi.mocked(batchHelpers.createFilesOnDisk),
  };
}

const RESULT = {
  sources: [{ url: "https://a.example/1", snippet: "A" }],
  questions: ["q"],
  assessment: { sufficient: false, outdatedNotes: [], gaps: [] },
};
const CTX = {
  cwd: "/test",
  model: { id: "m", provider: "p" },
  modelRegistry: {
    getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true, apiKey: "sk-test" }),
  },
};

describe("writeBackToKB — T11 error surfacing & metadata", () => {
  beforeEach(() => {
    process.env.KNOWLEDGE_DIR = KB_DIR;
    process.env.KNOWLEDGE_DB = "notes.db";
  });

  afterEach(() => {
    delete process.env.KNOWLEDGE_DIR;
    delete process.env.KNOWLEDGE_DB;
  });

  it("should embed the real grouping error message in skipped lines", async () => {
    const m = await importFresh();
    m.callLlmDirect.mockResolvedValue({
      ok: false,
      type: "error",
      message: "429 rate limited",
    });

    const result = await m.writeBackToKB(RESULT, CTX as never);

    expect(result.skipped).toContain(
      "write-back skipped: grouping LLM call failed: 429 rate limited",
    );
    expect(result.created).toEqual([]);
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
      CTX as never,
    );

    expect(m.resolveCitation).toHaveBeenCalledTimes(1);
    const params = m.resolveCitation.mock.calls[0][0] as Record<string, unknown>;
    expect(params.title).toBe("LLM Guardrails Guide");
    expect(params.authors).toEqual(["Doe, Jane"]);
    expect(params.year).toBe(2026);
  });

  it("should surface atomicity warnings from the batch path as skipped lines", async () => {
    const m = await importFresh();

    m.callLlmDirect.mockResolvedValue({
      ok: true,
      value: { notes: [{ title: "Note A", content: "Body", tags: ["a"] }], outdated: [] },
    });
    m.validateDocuments.mockResolvedValue({
      validDocs: [{ title: "Note A", content: "Body", tags: ["a"] }],
      validationErrors: [],
      warnings: [{ title: "Note A", message: "atomicity unverified: auth missing" }],
      expandedCount: 0,
    });
    m.createFilesOnDisk.mockResolvedValue([
      { path: KB_DIR + "/Resources/note-a.md", title: "Note A", relPath: "Resources/note-a.md" },
    ] as never);

    const result = await m.writeBackToKB(RESULT, CTX as never);

    expect(result.created).toEqual(["Resources/note-a.md"]);
    expect(result.skipped).toContain("atomicity unverified: Note A");
  });

  it("should flag invalid grouping shapes distinctly from call failures", async () => {
    const m = await importFresh();
    m.callLlmDirect.mockResolvedValue({ ok: true, value: null });

    const result = await m.writeBackToKB(RESULT, CTX as never);

    expect(result.skipped).toContain(
      "write-back skipped: grouping LLM call failed: invalid LLM response shape",
    );
  });

  it("should surface outdated-note update failures as skipped lines", async () => {
    const m = await importFresh();
    m.callLlmDirect.mockResolvedValue({
      ok: true,
      value: {
        notes: [],
        outdated: [{ path: "Resources/old.md", reason: "stale", content: "new body" }],
      },
    });
    const fs = await import("node:fs/promises");
    vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));

    const result = await m.writeBackToKB(RESULT, CTX as never);

    expect(result.updated).toEqual([]);
    expect(result.skipped[0]).toContain("update failed: Resources/old.md");
  });
});
