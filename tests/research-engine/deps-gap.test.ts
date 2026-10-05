/**
 * Gap tests for deps.ts uncovered paths: the tui mode branches in the
 * llm and searchSubagent transports (setWorkingMessage) and the
 * searchDocs dep. runSubagent is mocked so no subprocess ever spawns.
 *
 * @module tests/research-engine/deps-gap
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../common/subagent.js", () => ({
  runSubagent: vi.fn(),
  buildSubagentArgs: vi.fn(() => ["--lean-args"]),
  resolveSubagentTimeoutMs: vi.fn(() => 500),
}));
vi.mock("../../extensions/research-engine/writeback.js", () => ({
  writeBackToKB: vi.fn(),
  parseGrouping: vi.fn(),
}));
vi.mock("../../common/notesDb.js", () => ({ ensureNotesDb: vi.fn() }));
vi.mock("../../extensions/para-knowledge/db-sqlite.js", () => ({ searchDocs: vi.fn() }));

type BuildResearchDeps =
  typeof import("../../extensions/research-engine/deps.js").buildResearchDeps;

interface DepsHarness {
  buildResearchDeps: BuildResearchDeps;
  runSubagent: ReturnType<typeof vi.fn>;
  searchDocs: ReturnType<typeof vi.fn>;
  ensureNotesDb: ReturnType<typeof vi.fn>;
}

/** Reset the cache and re-import so spies match the fresh deps.js bindings. */
async function importFresh(): Promise<DepsHarness> {
  vi.resetModules();
  vi.clearAllMocks();
  const subagent = await import("../../common/subagent.js");
  const notesDb = await import("../../common/notesDb.js");
  const dbSqlite = await import("../../extensions/para-knowledge/db-sqlite.js");
  const { buildResearchDeps } = await import("../../extensions/research-engine/deps.js");

  vi.mocked(subagent.resolveSubagentTimeoutMs).mockReturnValue(500);
  vi.mocked(notesDb.ensureNotesDb).mockResolvedValue({} as never);
  vi.mocked(dbSqlite.searchDocs).mockReturnValue([
    { title: "Doc", path: "Resources/doc.md", body: "b", tags: [], created: "2026-01-01" },
  ] as never);

  return {
    buildResearchDeps,
    runSubagent: vi.mocked(subagent.runSubagent),
    searchDocs: vi.mocked(dbSqlite.searchDocs),
    ensureNotesDb: vi.mocked(notesDb.ensureNotesDb),
  };
}

const AUTH = { model: { provider: "p", id: "m" } } as never;

/** Loose tui context: cast to never so the large pi UI interfaces are bypassed. */
function tuiContext(): {
  ctx: never;
  ui: { setWorkingMessage: ReturnType<typeof vi.fn>; notify: ReturnType<typeof vi.fn> };
} {
  const ui = { setWorkingMessage: vi.fn(), notify: vi.fn() };
  const ctx = { mode: "tui", ui, cwd: "/test", modelRegistry: {} } as never;
  return { ctx, ui };
}

describe("buildResearchDeps — tui branches and searchDocs", () => {
  beforeEach(() => {
    process.env.KNOWLEDGE_DIR = "/tmp/re-deps-gap-test";
    process.env.KNOWLEDGE_DB = "notes.db";
  });

  afterEach(() => {
    delete process.env.KNOWLEDGE_DIR;
    delete process.env.KNOWLEDGE_DB;
  });

  it("sets the tui working message in the llm transport and returns the parsed value", async () => {
    const m = await importFresh();
    m.runSubagent.mockResolvedValue({ ok: true, value: { sufficient: true } });
    const { ctx, ui } = tuiContext();
    const deps = m.buildResearchDeps(ctx, AUTH);

    const res = await deps.llm({ system: "s", user: "u", parse: (t: string) => t });

    expect(ui.setWorkingMessage).toHaveBeenCalledWith("Researching…");
    expect(res).toEqual({ ok: true, value: { sufficient: true } });
  });

  it("sets the tui working message in the searchSubagent transport", async () => {
    const m = await importFresh();
    m.runSubagent.mockResolvedValue({ ok: true, value: { sources: [], coveredFacets: [] } });
    const { ctx, ui } = tuiContext();
    const deps = m.buildResearchDeps(ctx, AUTH);

    const res = await deps.searchSubagent({ task: "find sources" });

    expect(ui.setWorkingMessage).toHaveBeenCalledWith("Searching…");
    expect(res.ok).toBe(true);
  });

  it("maps the llm transport failure to { error }", async () => {
    const m = await importFresh();
    m.runSubagent.mockResolvedValue({ ok: false, error: "spawn ENOENT" });
    const deps = m.buildResearchDeps(tuiContext().ctx, AUTH);

    const res = await deps.llm({ system: "s", user: "u", parse: (t: string) => t });

    expect(res).toEqual({ ok: false, error: "spawn ENOENT" });
  });

  it("searchDocs resolves the env db and maps doc metadata", async () => {
    const m = await importFresh();
    const deps = m.buildResearchDeps(tuiContext().ctx, AUTH);

    const docs = await deps.searchDocs("query");

    expect(m.ensureNotesDb).toHaveBeenCalled();
    expect(m.searchDocs).toHaveBeenCalled();
    expect(docs).toEqual([{ title: "Doc", path: "Resources/doc.md", created: "2026-01-01" }]);
  });
});
