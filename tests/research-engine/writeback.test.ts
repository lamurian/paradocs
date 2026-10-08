/**
 * writeBackToKB: citation resolution, plan/fill grouping, routing, and
 * KNOWLEDGE_DIR resolution. planFn/fillFn are injected (T6) so no test
 * spawns subprocesses. importFresh() resets the module cache so the subject
 * binds to this file's mock instances (test.isolate=false).
 *
 * @module tests/research-engine/writeback
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.mock factories are hoisted above imports; re-resolved per importFresh() reset.
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
  createFilesOnDisk: vi.fn(),
  indexDocumentsInDb: vi.fn(),
  autoLinkBatch: vi.fn(),
}));
vi.mock("../../extensions/research-engine/draft.js", () => ({
  DRAFT_SUBDIR: ".research/drafts",
  draftPathFor: vi.fn(),
  writeDraftNote: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({ readFile: vi.fn(), writeFile: vi.fn() }));

const KB_DIR = "/tmp/re-kb-test";

type WriteBackToKB = typeof import("../../extensions/research-engine/writeback.js").writeBackToKB;
type PlanFn = ReturnType<typeof vi.fn>;
type FillFn = ReturnType<typeof vi.fn>;

interface Harness {
  writeBackToKB: WriteBackToKB;
  resolveSubagentTimeoutMs: (role: string) => number;
  resolveCitation: ReturnType<typeof vi.fn>;
  validateCitations: ReturnType<typeof vi.fn>;
  searchDocs: ReturnType<typeof vi.fn>;
  indexFile: ReturnType<typeof vi.fn>;
  validateDocuments: ReturnType<typeof vi.fn>;
  createFilesOnDisk: ReturnType<typeof vi.fn>;
  indexDocumentsInDb: ReturnType<typeof vi.fn>;
  autoLinkBatch: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
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
  const subagent = await import("../../common/subagent.js");
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
  vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

  return {
    writeBackToKB,
    resolveSubagentTimeoutMs: subagent.resolveSubagentTimeoutMs,
    resolveCitation: vi.mocked(citation.resolveCitation),
    validateCitations: vi.mocked(citationValidation.validateCitations),
    searchDocs: vi.mocked(dbSqlite.searchDocs),
    indexFile: vi.mocked(dbSqlite.indexFile),
    validateDocuments: vi.mocked(batchHelpers.validateDocuments),
    createFilesOnDisk: vi.mocked(batchHelpers.createFilesOnDisk),
    indexDocumentsInDb: vi.mocked(batchHelpers.indexDocumentsInDb),
    autoLinkBatch: vi.mocked(batchHelpers.autoLinkBatch),
    readFile: vi.mocked(fsPromises.readFile),
    writeFile: vi.mocked(fsPromises.writeFile),
  };
}

const MODEL = { id: "m", provider: "p" } as never;
const ENTRY = {
  title: "New Note",
  tags: ["new"],
  area: "Resources",
  sources: ["https://a.example/1"],
  keyIdea: "k",
};
const RESULT = {
  sources: [{ url: "https://a.example/1", snippet: "Key point A" }],
  questions: ["what is x"],
  assessment: { sufficient: false, outdatedNotes: [], gaps: ["what is x"] },
};

/** Plan stub returning a fixed PlanResult. */
function planOk(value: unknown): PlanFn {
  return vi.fn(() => Promise.resolve({ ok: true, value }));
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

  it("resolves citations once per unique URL and passes sources + KB results to the plan call", async () => {
    const m = await importFresh();
    const planFn = planOk({ plan: [ENTRY], outdated: [] });
    const fillFn: FillFn = vi.fn(() => Promise.resolve({ ok: true, value: "Fresh finding." }));
    const onProgress = vi.fn();

    await m.writeBackToKB(
      {
        ...RESULT,
        sources: [
          { url: "https://a.example/1", snippet: "Key point A" },
          { url: "https://b.example/2", snippet: "Key point B" },
          { url: "https://a.example/1", snippet: "A again" },
        ],
      },
      { cwd: "/test", model: MODEL, planFn, fillFn, onProgress } as never,
    );

    // Citations resolved once per unique URL
    expect(m.resolveCitation).toHaveBeenCalledTimes(2);
    const resolved = m.resolveCitation.mock.calls.map((c) => (c[0] as { source: string }).source);
    expect(resolved).toEqual(["https://a.example/1", "https://b.example/2"]);

    // Plan call carries sources + KB context, grouping budget
    expect(planFn).toHaveBeenCalledTimes(1);
    const planInput = planFn.mock.calls[0][0] as { user: string; timeoutMs: number };
    expect(planInput.user).toContain("Key point A");
    expect(planInput.user).toContain("https://b.example/2 (@key-19): Key point B");
    expect(planInput.user).toContain("Old Doc");
    expect(planInput.timeoutMs).toBe(m.resolveSubagentTimeoutMs("grouping"));
    expect(m.searchDocs).toHaveBeenCalledWith(expect.anything(), "what is x", {}, 10);

    // Fill call gets the mapped entry + 60s per-note budget
    expect(fillFn).toHaveBeenCalledTimes(1);
    const fillInput = fillFn.mock.calls[0][0] as { user: string; timeoutMs: number };
    expect(fillInput.user).toContain("Title: New Note");
    expect(fillInput.user).toContain("Key idea: k");
    expect(fillInput.user).toContain("https://a.example/1 (@key-19)");
    expect(fillInput.timeoutMs).toBe(60_000);

    // The plan never referenced b.example — flagged, never silently dropped
    expect(onProgress).toHaveBeenCalledWith("source not planned: https://b.example/2");
  });

  it("routes outdated notes to the update path and new notes to batch create", async () => {
    const m = await importFresh();
    const planFn = planOk({
      plan: [ENTRY],
      outdated: [
        { path: "Resources/old.md", reason: "Stale since 2020", content: "Refreshed body" },
      ],
    });
    const fillFn: FillFn = vi.fn(() => Promise.resolve({ ok: true, value: "Fresh finding." }));
    m.readFile.mockResolvedValue("---\ntitle: Old Doc\ntags: [old]\n---\n\nOld body");
    m.createFilesOnDisk.mockResolvedValue([
      {
        path: KB_DIR + "/Resources/new-note.md",
        title: "New Note",
        relPath: "Resources/new-note.md",
      },
    ] as never);
    m.autoLinkBatch.mockResolvedValue(1);

    const result = await m.writeBackToKB(RESULT, {
      cwd: "/test",
      model: MODEL,
      planFn,
      fillFn,
    } as never);

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

  it("skips notes with unresolved citations", async () => {
    const m = await importFresh();
    const planFn = planOk({ plan: [{ ...ENTRY, title: "Bad Note" }], outdated: [] });
    const fillFn: FillFn = vi.fn(() => Promise.resolve({ ok: true, value: "Body @missingkey" }));
    m.validateCitations.mockReturnValue({ valid: false, missing: ["missingkey"] });

    const result = await m.writeBackToKB(RESULT, {
      cwd: "/test",
      model: MODEL,
      planFn,
      fillFn,
    } as never);

    expect(m.createFilesOnDisk).not.toHaveBeenCalled();
    expect(result.created).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toContain("Bad Note");
  });

  it("caps fill concurrency at 4 while preserving plan order", async () => {
    const m = await importFresh();
    const entries = Array.from({ length: 6 }, (_, i) => ({ ...ENTRY, title: `Note ${i + 1}` }));
    const planFn = planOk({ plan: entries, outdated: [] });
    let active = 0;
    let maxActive = 0;
    const fillFn: FillFn = vi.fn(async (input: { user: string }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, input.user.startsWith("Title: Note 1") ? 30 : 1));
      active -= 1;
      return { ok: true, value: `Body for ${input.user.split("\n")[0]}` };
    });
    m.createFilesOnDisk.mockImplementation(
      (docs: Array<{ title: string }>) =>
        Promise.resolve(
          docs.map((d) => ({
            path: KB_DIR + "/Resources/note.md",
            title: d.title,
            relPath: "Resources/" + d.title.toLowerCase().replace(" ", "-") + ".md",
          })),
        ) as never,
    );

    const result = await m.writeBackToKB(RESULT, {
      cwd: "/test",
      model: MODEL,
      planFn,
      fillFn,
    } as never);

    expect(fillFn).toHaveBeenCalledTimes(6);
    expect(maxActive).toBeLessThanOrEqual(4);
    expect(result.created).toEqual([
      "Resources/note-1.md",
      "Resources/note-2.md",
      "Resources/note-3.md",
      "Resources/note-4.md",
      "Resources/note-5.md",
      "Resources/note-6.md",
    ]);
  });
});
