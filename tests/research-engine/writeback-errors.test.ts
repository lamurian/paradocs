/**
 * T6 write-back error surfacing: corrective plan retry quoting bad output,
 * draft-note fallback (sources never discarded), per-note fill degradation.
 * importFresh() resets the module cache for this file's mock instances.
 *
 * @module tests/research-engine/writeback-errors
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  return { ...actual, writeFileSync: vi.fn(), mkdirSync: vi.fn() };
});

const KB_DIR = "/tmp/re-kb-errors-test";

type WriteBackToKB =
  (typeof import("../../extensions/research-engine/writeback.js"))["writeBackToKB"];
type WritebackContext = import("../../extensions/research-engine/writeback.js").WritebackContext;
type PlanFn = NonNullable<WritebackContext["planFn"]>;
type FillFn = NonNullable<WritebackContext["fillFn"]>;

interface Harness {
  writeBackToKB: WriteBackToKB;
  resolveCitation: ReturnType<typeof vi.fn>;
  validateDocuments: ReturnType<typeof vi.fn>;
  createFilesOnDisk: ReturnType<typeof vi.fn>;
  writeFileSync: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
}

/** Reset the module cache, re-import mocks + subject, re-stub defaults. */
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
const CTX = { cwd: "/test", model: MODEL };

const BAD_OUTPUT = 'unparseable subagent response: <list_directory\npath="/kb" />';

const entry = (title: string) => ({
  title,
  tags: ["t"],
  sources: ["https://a.example/1"],
  keyIdea: "k",
});

describe("writeBackToKB — corrective retry, per-note skips, draft fallback", () => {
  beforeEach(() => {
    process.env.KNOWLEDGE_DIR = KB_DIR;
    process.env.KNOWLEDGE_DB = "notes.db";
  });

  afterEach(() => {
    delete process.env.KNOWLEDGE_DIR;
    delete process.env.KNOWLEDGE_DB;
  });

  it("retries the plan once quoting bad output, then dumps a draft note", async () => {
    const m = await importFresh();
    const planFn = vi.fn((_input: { user: string }) =>
      Promise.resolve({ ok: false, error: BAD_OUTPUT }),
    );
    const onProgress = vi.fn();

    const result = await m.writeBackToKB(RESULT, { ...CTX, planFn, onProgress });

    expect(planFn).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenCalledWith(
      expect.stringContaining("write-back plan retry after bad output:"),
    );
    expect(onProgress).toHaveBeenCalledWith(expect.stringContaining("<list_directory"));

    const retryUser = planFn.mock.calls[1][0].user;
    expect(retryUser).toContain("Bad output snippet:");
    expect(retryUser).toContain("<list_directory");
    expect(retryUser).toContain("https://a.example/1");

    expect(result.skipped).toContain("write-back skipped: grouping failed: " + BAD_OUTPUT);
    expect(result.created).toEqual([]);
    expect(m.writeFileSync).toHaveBeenCalledTimes(1);
    const [path, content] = m.writeFileSync.mock.calls[0] as [string, string];
    expect(path).toBe(KB_DIR + "/.research/drafts/job-err.md");
    expect(content).toContain("https://a.example/1");
    expect(content).toContain("Source A");
    expect(content).toContain("@key-19");
    expect(content).toContain("The synthesized answer.");
  });

  it("recovers when the corrective plan retry succeeds", async () => {
    const m = await importFresh();
    const planFn: PlanFn = vi.fn((input: { user: string }) =>
      Promise.resolve(
        input.user.includes("Bad output snippet")
          ? { ok: true, value: { plan: [entry("Note A")], outdated: [] } }
          : { ok: false, error: BAD_OUTPUT },
      ),
    );
    const fillFn: FillFn = vi.fn(() => Promise.resolve({ ok: true, value: "Body A" }));
    m.createFilesOnDisk.mockResolvedValue([
      { path: KB_DIR + "/Resources/note-a.md", title: "Note A", relPath: "Resources/note-a.md" },
    ] as never);

    const result = await m.writeBackToKB(RESULT, { ...CTX, planFn, fillFn });

    expect(planFn).toHaveBeenCalledTimes(2);
    expect(fillFn).toHaveBeenCalledTimes(1);
    expect(result.created).toEqual(["Resources/note-a.md"]);
    expect(result.skipped).toEqual([]);
    expect(m.writeFileSync).not.toHaveBeenCalled();
  });

  it("flags invalid plan shapes distinctly from call failures", async () => {
    const m = await importFresh();
    const planFn: PlanFn = vi.fn(() => Promise.resolve({ ok: true, value: undefined }));
    const onProgress = vi.fn();

    const result = await m.writeBackToKB(RESULT, { ...CTX, planFn, onProgress });

    expect(planFn).toHaveBeenCalledTimes(2);
    expect(result.skipped).toContain("write-back skipped: grouping failed: invalid plan response");
    expect(onProgress).toHaveBeenCalledWith(expect.stringContaining("invalid plan response"));
  });

  it("drops only failed notes with note-skipped lines, never the batch", async () => {
    const m = await importFresh();
    const planFn: PlanFn = vi.fn(() =>
      Promise.resolve({
        ok: true,
        value: { plan: [entry("Note A"), entry("Note B"), entry("Note C")], outdated: [] },
      }),
    );
    const fillFn: FillFn = vi.fn((input: { user: string }) => {
      if (input.user.includes("Title: Note B"))
        return Promise.resolve({ ok: false, error: "boom" });
      if (input.user.includes("Title: Note C")) return Promise.resolve({ ok: true, value: "" });
      return Promise.resolve({ ok: true, value: "Body A" });
    });
    const onProgress = vi.fn();
    m.createFilesOnDisk.mockResolvedValue([
      { path: KB_DIR + "/Resources/note-a.md", title: "Note A", relPath: "Resources/note-a.md" },
    ] as never);

    const result = await m.writeBackToKB(RESULT, { ...CTX, planFn, fillFn, onProgress });

    expect(m.createFilesOnDisk).toHaveBeenCalledTimes(1);
    const batchDocs = m.createFilesOnDisk.mock.calls[0][0] as Array<{ title: string }>;
    expect(batchDocs.map((d) => d.title)).toEqual(["Note A"]);
    expect(result.created).toEqual(["Resources/note-a.md"]);

    // Each dropped note gets its own skip line, surfaced to onProgress
    expect(result.skipped).toContain("note skipped: Note B (boom)");
    expect(result.skipped).toContain("note skipped: Note C (empty note body)");
    expect(onProgress).toHaveBeenCalledWith("note skipped: Note B (boom)");
    expect(onProgress).toHaveBeenCalledWith("note skipped: Note C (empty note body)");
  });

  it("should pass source citation metadata (title/authors/year) to resolveCitation", async () => {
    const m = await importFresh();
    const planFn: PlanFn = vi.fn(() =>
      Promise.resolve({ ok: true, value: { plan: [], outdated: [] } }),
    );

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
      { ...CTX, planFn },
    );

    expect(m.resolveCitation).toHaveBeenCalledTimes(1);
    const params = m.resolveCitation.mock.calls[0][0] as Record<string, unknown>;
    expect(params.title).toBe("LLM Guardrails Guide");
    expect(params.authors).toEqual(["Doe, Jane"]);
    expect(params.year).toBe(2026);
  });

  it("should surface outdated-note update failures as skipped lines", async () => {
    const m = await importFresh();
    const planFn: PlanFn = vi.fn(() =>
      Promise.resolve({
        ok: true,
        value: {
          plan: [],
          outdated: [{ path: "Resources/old.md", reason: "stale", content: "new body" }],
        },
      }),
    );
    m.readFile.mockRejectedValue(new Error("ENOENT"));

    const result = await m.writeBackToKB(RESULT, { ...CTX, planFn });

    expect(result.updated).toEqual([]);
    expect(result.skipped.some((s) => s.startsWith("update failed:"))).toBe(true);
  });

  it("should surface atomicity warnings from the batch path as skipped lines", async () => {
    const m = await importFresh();
    const planFn: PlanFn = vi.fn(() =>
      Promise.resolve({ ok: true, value: { plan: [entry("Note A")], outdated: [] } }),
    );
    const fillFn: FillFn = vi.fn(() => Promise.resolve({ ok: true, value: "Body" }));
    m.validateDocuments.mockResolvedValue({
      validDocs: [{ title: "Note A", content: "Body", tags: ["t"] }],
      validationErrors: [],
      warnings: [{ title: "Note A", message: "atomicity unverified: auth missing" }],
      expandedCount: 0,
    });
    m.createFilesOnDisk.mockResolvedValue([
      { path: KB_DIR + "/Resources/note-a.md", title: "Note A", relPath: "Resources/note-a.md" },
    ] as never);

    const result = await m.writeBackToKB(RESULT, { ...CTX, planFn, fillFn });

    expect(result.created).toEqual(["Resources/note-a.md"]);
    expect(result.skipped).toContain("atomicity unverified: Note A");
  });
});
