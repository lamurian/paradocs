/**
 * Gap tests for writeback.ts uncovered paths: the default subagentGrouping
 * path (no injected groupingFn), the draft-note success/failure branches,
 * and the unresolved-citation skip in writeback-helpers.resolveAllCitations.
 *
 * Uses the async resetModules importFresh pattern — with test.isolate=false
 * the shared module cache can hold stale mock bindings; see writeback.test.
 *
 * @module tests/research-engine/writeback-gap
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { MockedFunction } from "vitest";

vi.mock("../../common/subagent.js", () => ({
  runSubagent: vi.fn(),
  buildSubagentArgs: vi.fn(() => ["--lean-args"]),
  resolveSubagentTimeoutMs: vi.fn(() => 1000),
}));
vi.mock("../../extensions/research-engine/draft.js", () => ({
  DRAFT_SUBDIR: ".research/drafts",
  draftPathFor: vi.fn(),
  writeDraftNote: vi.fn(),
}));
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

const KB_DIR = "/tmp/re-kb-gap-test";

type WriteBackToKB = typeof import("../../extensions/research-engine/writeback.js").writeBackToKB;
type ResolveCitation = MockedFunction<typeof import("../../common/citation.js").resolveCitation>;

interface Harness {
  writeBackToKB: WriteBackToKB;
  runSubagent: ReturnType<typeof vi.fn>;
  writeDraftNote: ReturnType<typeof vi.fn>;
  resolveCitation: ResolveCitation;
  validateDocuments: ReturnType<typeof vi.fn>;
}

/**
 * Reset the module cache and re-import mocked deps + the subject so the
 * returned spies are the instances the fresh writeback.js is bound to.
 */
async function importFresh(): Promise<Harness> {
  vi.resetModules();
  vi.clearAllMocks();
  const subagent = await import("../../common/subagent.js");
  const draft = await import("../../extensions/research-engine/draft.js");
  const citation = await import("../../common/citation.js");
  const citationValidation = await import("../../common/citation-validation.js");
  const notesDb = await import("../../common/notesDb.js");
  const dbSqlite = await import("../../extensions/para-knowledge/db-sqlite.js");
  const batchHelpers = await import("../../extensions/batch-create/batch-helpers.js");
  const fsPromises = await import("node:fs/promises");
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
  vi.mocked(subagent.resolveSubagentTimeoutMs).mockReturnValue(1000);

  return {
    writeBackToKB,
    runSubagent: vi.mocked(subagent.runSubagent),
    writeDraftNote: vi.mocked(draft.writeDraftNote),
    resolveCitation: vi.mocked(citation.resolveCitation),
    validateDocuments: vi.mocked(batchHelpers.validateDocuments),
  };
}

const RESULT = {
  sources: [{ url: "https://gap.example/1", snippet: "G", title: "Gap Source" }],
  questions: ["q"],
  assessment: { sufficient: false, outdatedNotes: [], gaps: [] },
  jobId: "job-gap",
  synthesis: "Gap synthesis.",
};
const MODEL = { id: "m", provider: "p" } as never;

const CTX = { cwd: "/test", model: MODEL } as never;

describe("writeback gap paths — default grouping, draft branches, citations", () => {
  beforeEach(() => {
    process.env.KNOWLEDGE_DIR = KB_DIR;
    process.env.KNOWLEDGE_DB = "notes.db";
  });

  afterEach(() => {
    delete process.env.KNOWLEDGE_DIR;
    delete process.env.KNOWLEDGE_DB;
  });

  it("routes grouping through the default subagent path when no groupingFn is injected", async () => {
    const m = await importFresh();
    m.runSubagent.mockResolvedValue({
      ok: true,
      value: { notes: [], outdated: [] },
    });

    const result = await m.writeBackToKB(RESULT, CTX);

    expect(m.runSubagent).toHaveBeenCalledTimes(1);
    const call = m.runSubagent.mock.calls[0][0] as Record<string, unknown>;
    expect(call.args).toEqual(["--lean-args"]);
    expect(call.cwd).toBe("/test");
    expect(call.timeoutMs).toBe(1000);
    expect(call.parse).toEqual(expect.any(Function));
    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("retries the subagent once on failure, then writes the draft note", async () => {
    const m = await importFresh();
    m.runSubagent.mockResolvedValue({ ok: false, error: "subagent down" });
    m.writeDraftNote.mockReturnValue(KB_DIR + "/.research/drafts/job-gap.md");

    const result = await m.writeBackToKB(RESULT, CTX);

    expect(m.runSubagent).toHaveBeenCalledTimes(2);
    expect(result.skipped).toContain("write-back skipped: grouping failed: subagent down");
    expect(result.skipped).toContain("draft: " + KB_DIR + "/.research/drafts/job-gap.md");
  });

  it("surfaces a draft-note write failure as a skipped line instead of throwing", async () => {
    const m = await importFresh();
    m.runSubagent.mockResolvedValue({ ok: false, error: "subagent down" });
    m.writeDraftNote.mockImplementation(() => {
      throw new Error("disk full");
    });

    const result = await m.writeBackToKB(RESULT, CTX);

    expect(result.skipped).toContain("write-back skipped: grouping failed: subagent down");
    expect(result.skipped.some((s) => s.startsWith("draft failed: disk full"))).toBe(true);
  });

  it("skips sources whose citation resolution yields no citekey", async () => {
    const m = await importFresh();
    m.resolveCitation.mockImplementation((params) =>
      Promise.resolve(
        params.source.includes("nocite")
          ? { citekey: null, bibtex: "", isNew: false, doi: null, source_url: params.source }
          : {
              citekey: "key-ok",
              bibtex: "",
              isNew: true,
              doi: null,
              source_url: params.source,
            },
      ),
    );
    m.runSubagent.mockResolvedValue({ ok: true, value: { notes: [], outdated: [] } });

    const result = await m.writeBackToKB(
      {
        ...RESULT,
        sources: [{ url: "https://nocite.example/9", snippet: "N" }],
      },
      CTX,
    );

    expect(result.skipped).toContain("citation unresolved: https://nocite.example/9");
  });
});
