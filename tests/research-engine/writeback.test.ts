/**
 * Tests for writeBackToKB — citation resolution, LLM grouping, routing, KNOWLEDGE_DIR.
 *
 * @module tests/research-engine/writeback.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { ResearchResult } from "../../extensions/research-engine/types.js";

// Mocks must be declared before the subject module is imported.
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

const KB_DIR = "/tmp/re-kb-test";

function makeResult(sources: Array<{ url: string; snippet: string }>): ResearchResult {
  return {
    sources,
    questions: ["what is x"],
    assessment: { sufficient: false, outdatedNotes: [], gaps: ["what is x"] },
  };
}

function makeCtx(): Record<string, unknown> {
  return {
    cwd: "/test",
    model: { id: "m", provider: "p" },
    modelRegistry: {
      getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true, apiKey: "sk-test" }),
    },
  };
}

/**
 * Import the subject and its mocks with a fresh module registry so each test
 * gets its own spy instances. The ensureNotesDb singleton caches a real SQLite
 * handle for the process lifetime, so reusing one registry leaks indexFile calls
 * across test files and breaks per-test call counts.
 */
async function importFresh(): Promise<{
  writeBackToKB: typeof import("../../extensions/research-engine/writeback.js").writeBackToKB;
  callLlmDirect: ReturnType<typeof vi.fn>;
  resolveCitation: ReturnType<typeof vi.fn>;
  validateCitations: ReturnType<typeof vi.fn>;
  ensureNotesDb: ReturnType<typeof vi.fn>;
  searchDocs: ReturnType<typeof vi.fn>;
  indexFile: ReturnType<typeof vi.fn>;
  validateDocuments: ReturnType<typeof vi.fn>;
  createFilesOnDisk: ReturnType<typeof vi.fn>;
  indexDocumentsInDb: ReturnType<typeof vi.fn>;
  autoLinkBatch: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
}> {
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
    Promise.resolve({
      validDocs: docs,
      validationErrors: [],
      expandedCount: 0,
    }),
  );
  vi.mocked(citationValidation.validateCitations).mockReturnValue({ valid: true, missing: [] });
  vi.mocked(batchHelpers.createFilesOnDisk).mockResolvedValue([]);
  vi.mocked(batchHelpers.indexDocumentsInDb).mockResolvedValue(undefined);
  vi.mocked(batchHelpers.autoLinkBatch).mockResolvedValue(0);
  vi.mocked(dbSqlite.searchDocs).mockReturnValue([
    {
      title: "Old Doc",
      path: "Resources/old.md",
      body: "Old body about x",
      tags: ["old"],
      created: "2020-01-01T00:00:00.000Z",
      score: -1,
      matchedByTag: false,
    } as never,
  ]);
  vi.mocked(fs.writeFile).mockResolvedValue(undefined);

  return {
    writeBackToKB: writeback.writeBackToKB,
    callLlmDirect: vi.mocked(llm.callLlmDirect),
    resolveCitation: vi.mocked(citation.resolveCitation),
    validateCitations: vi.mocked(citationValidation.validateCitations),
    ensureNotesDb: vi.mocked(notesDb.ensureNotesDb),
    searchDocs: vi.mocked(dbSqlite.searchDocs),
    indexFile: vi.mocked(dbSqlite.indexFile),
    validateDocuments: vi.mocked(batchHelpers.validateDocuments),
    createFilesOnDisk: vi.mocked(batchHelpers.createFilesOnDisk),
    indexDocumentsInDb: vi.mocked(batchHelpers.indexDocumentsInDb),
    autoLinkBatch: vi.mocked(batchHelpers.autoLinkBatch),
    readFile: vi.mocked(fs.readFile),
    writeFile: vi.mocked(fs.writeFile),
  };
}

describe("writeBackToKB", () => {
  beforeEach(() => {
    process.env.KNOWLEDGE_DIR = KB_DIR;
    process.env.KNOWLEDGE_DB = "notes.db";
  });

  afterEach(() => {
    delete process.env.KNOWLEDGE_DIR;
    delete process.env.KNOWLEDGE_DB;
  });

  it("should resolve citations once per unique source URL", async () => {
    const m = await importFresh();

    await m.writeBackToKB(
      makeResult([
        { url: "https://a.example/1", snippet: "A" },
        { url: "https://b.example/2", snippet: "B" },
        { url: "https://a.example/1", snippet: "A again" },
      ]),
      makeCtx() as never,
    );

    expect(m.resolveCitation).toHaveBeenCalledTimes(2);
    const sources = m.resolveCitation.mock.calls.map((c) => (c[0] as { source: string }).source);
    expect(sources).toEqual(["https://a.example/1", "https://b.example/2"]);
  });

  it("should pass sources plus KB search results to one grouping LLM call", async () => {
    const m = await importFresh();

    await m.writeBackToKB(
      makeResult([{ url: "https://a.example/1", snippet: "Key point A" }]),
      makeCtx() as never,
    );

    expect(m.callLlmDirect).toHaveBeenCalledTimes(1);
    const messageContent = m.callLlmDirect.mock.calls[0][3] as Array<{
      type: string;
      text: string;
    }>;
    const text = messageContent.map((c) => c.text).join("\n");
    expect(text).toContain("https://a.example/1");
    expect(text).toContain("Key point A");
    expect(text).toContain("Old Doc");
  });

  it("should route outdated notes to the update path and new notes to batch create", async () => {
    const m = await importFresh();

    m.callLlmDirect.mockResolvedValue({
      ok: true,
      value: {
        notes: [
          {
            title: "New Note",
            content: "## Summary\n\nFresh finding.",
            tags: ["new"],
            source: "https://a.example/1",
          },
        ],
        outdated: [
          { path: "Resources/old.md", reason: "Stale since 2020", content: "Refreshed body" },
        ],
      },
    });
    m.readFile.mockResolvedValue("---\ntitle: Old Doc\ntags: [old]\n---\n\nOld body");
    m.createFilesOnDisk.mockResolvedValue([
      {
        path: KB_DIR + "/Resources/new-note.md",
        title: "New Note",
        relPath: "Resources/new-note.md",
      },
    ] as never);
    m.autoLinkBatch.mockResolvedValue(1);

    const result = await m.writeBackToKB(
      makeResult([{ url: "https://a.example/1", snippet: "Key point A" }]),
      makeCtx() as never,
    );

    // Update path: read + write + reindex under KNOWLEDGE_DIR
    expect(m.readFile).toHaveBeenCalledWith(KB_DIR + "/Resources/old.md", "utf-8");
    expect(m.writeFile).toHaveBeenCalledWith(
      KB_DIR + "/Resources/old.md",
      expect.stringContaining("Refreshed body"),
      "utf-8",
    );
    expect(m.indexFile).toHaveBeenCalledTimes(1);

    // Batch-create path: grouped notes written under KNOWLEDGE_DIR
    expect(m.createFilesOnDisk).toHaveBeenCalledTimes(1);
    const batchArgs = m.createFilesOnDisk.mock.calls[0] as [Array<{ title: string }>, string];
    expect(batchArgs[0]).toHaveLength(1);
    expect(batchArgs[0][0].title).toBe("New Note");
    expect(batchArgs[1]).toBe(KB_DIR);
    expect(m.indexDocumentsInDb).toHaveBeenCalledTimes(1);
    expect(m.autoLinkBatch).toHaveBeenCalledTimes(1);

    expect(result.created).toEqual(["Resources/new-note.md"]);
    expect(result.updated).toEqual(["Resources/old.md"]);
  });

  it("should skip notes with unresolved citations", async () => {
    const m = await importFresh();

    m.callLlmDirect.mockResolvedValue({
      ok: true,
      value: {
        notes: [{ title: "Bad Note", content: "Body @missingkey", tags: ["bad"] }],
        outdated: [],
      },
    });
    m.validateCitations.mockReturnValue({ valid: false, missing: ["missingkey"] });

    const result = await m.writeBackToKB(
      makeResult([{ url: "https://a.example/1", snippet: "A" }]),
      makeCtx() as never,
    );

    expect(m.createFilesOnDisk).not.toHaveBeenCalled();
    expect(result.created).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toContain("Bad Note");
  });

  it("should resolve the knowledge directory from the KNOWLEDGE_DIR env var", async () => {
    const m = await importFresh();

    m.callLlmDirect.mockResolvedValue({
      ok: true,
      value: {
        notes: [{ title: "Env Note", content: "Body", tags: ["env"] }],
        outdated: [],
      },
    });
    m.createFilesOnDisk.mockResolvedValue([
      {
        path: KB_DIR + "/Resources/env-note.md",
        title: "Env Note",
        relPath: "Resources/env-note.md",
      },
    ] as never);

    await m.writeBackToKB(
      makeResult([{ url: "https://a.example/1", snippet: "A" }]),
      makeCtx() as never,
    );

    const batchArgs = m.createFilesOnDisk.mock.calls[0] as [unknown, string];
    expect(batchArgs[1]).toBe(KB_DIR);
  });
});
