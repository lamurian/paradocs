/**
 * Tests for the command-facing dependency builder (research-engine/deps).
 *
 * @module tests/research-engine/deps.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../common/llm.js", () => ({
  callLlmDirect: vi.fn(),
  callLlmWithLoader: vi.fn(),
}));
vi.mock("../../common/fetchUrl.js", () => ({
  fetchUrlWithTimeout: vi.fn(),
  fetchUrlAsText: vi.fn(),
}));
vi.mock("../../common/notesDb.js", () => ({ ensureNotesDb: vi.fn() }));
vi.mock("../../extensions/para-knowledge/db-sqlite.js", () => ({ searchDocs: vi.fn() }));
vi.mock("../../common/webSearch.js", () => ({ searchWeb: vi.fn() }));
vi.mock("../../extensions/research-engine/writeback.js", () => ({ writeBackToKB: vi.fn() }));

const AUTH = { model: { id: "m", provider: "p" } as never, apiKey: "sk-test" };

function makeCtx(mode: string): {
  ctx: {
    cwd: string;
    mode: string;
    modelRegistry: Record<string, unknown>;
    ui: Record<string, ReturnType<typeof vi.fn>>;
  };
  ui: Record<string, ReturnType<typeof vi.fn>>;
} {
  const ui = {
    notify: vi.fn(),
    setWorkingVisible: vi.fn(),
    setWorkingMessage: vi.fn(),
    custom: vi.fn(),
  };
  return {
    ctx: {
      cwd: "/test",
      mode,
      modelRegistry: { getApiKeyAndHeaders: vi.fn() },
      ui,
    },
    ui,
  };
}

async function importDeps(): Promise<{
  buildResearchDeps: typeof import("../../extensions/research-engine/deps.js").buildResearchDeps;
  callLlmDirect: ReturnType<typeof vi.fn>;
  callLlmWithLoader: ReturnType<typeof vi.fn>;
  fetchUrlWithTimeout: ReturnType<typeof vi.fn>;
  ensureNotesDb: ReturnType<typeof vi.fn>;
  searchDocs: ReturnType<typeof vi.fn>;
  writeBackToKB: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  const deps = await import("../../extensions/research-engine/deps.js");
  const llm = await import("../../common/llm.js");
  const fetchUrl = await import("../../common/fetchUrl.js");
  const notesDb = await import("../../common/notesDb.js");
  const dbSqlite = await import("../../extensions/para-knowledge/db-sqlite.js");
  const writeback = await import("../../extensions/research-engine/writeback.js");
  vi.clearAllMocks();
  return {
    buildResearchDeps: deps.buildResearchDeps,
    callLlmDirect: vi.mocked(llm.callLlmDirect),
    callLlmWithLoader: vi.mocked(llm.callLlmWithLoader),
    fetchUrlWithTimeout: vi.mocked(fetchUrl.fetchUrlWithTimeout),
    ensureNotesDb: vi.mocked(notesDb.ensureNotesDb),
    searchDocs: vi.mocked(dbSqlite.searchDocs),
    writeBackToKB: vi.mocked(writeback.writeBackToKB),
  };
}

const LLM_INPUT = {
  system: "sys",
  user: "user text",
  parse: (t: string) => t,
  timeoutMs: 5000,
  label: "Label…",
};

describe("buildResearchDeps", () => {
  beforeEach(() => {
    process.env.KNOWLEDGE_DIR = "/kb";
    process.env.KNOWLEDGE_DB = "notes.db";
  });
  afterEach(() => {
    delete process.env.KNOWLEDGE_DIR;
    delete process.env.KNOWLEDGE_DB;
  });

  it("rpc llm path: delegates to callLlmDirect with signal + timeout and normalizes results", async () => {
    const m = await importDeps();
    const { ctx } = makeCtx("rpc");
    const deps = m.buildResearchDeps(ctx as never, AUTH, { signal: undefined });

    m.callLlmDirect.mockResolvedValue({ ok: true, value: "v" });
    expect(await deps.llm(LLM_INPUT)).toEqual({ ok: true, value: "v" });
    expect(m.callLlmDirect).toHaveBeenCalledWith(
      AUTH.model,
      AUTH,
      "sys",
      [{ type: "text", text: "user text" }],
      LLM_INPUT.parse,
      undefined,
      5000,
    );

    m.callLlmDirect.mockResolvedValue({
      ok: false,
      type: "error",
      message: "429 rate limited",
    });
    expect(await deps.llm(LLM_INPUT)).toEqual({ ok: false, error: "429 rate limited" });

    m.callLlmDirect.mockResolvedValue({ ok: false, type: "cancelled" });
    expect(await deps.llm(LLM_INPUT)).toEqual({ ok: false, error: "cancelled" });
  });

  it("tui llm path: routes through ctx.ui.custom + callLlmWithLoader, handles null results", async () => {
    const m = await importDeps();
    const { ctx, ui } = makeCtx("tui");
    ui.custom.mockImplementation(
      (factory: (t: unknown, th: unknown, kb: unknown, done: (v: unknown) => void) => void) => {
        factory("tui", "theme", "kb", vi.fn());
        return { ok: true, value: "tui-v" } as never;
      },
    );
    const deps = m.buildResearchDeps(ctx as never, AUTH, {});
    expect(await deps.llm(LLM_INPUT)).toEqual({ ok: true, value: "tui-v" });
    expect(m.callLlmWithLoader).toHaveBeenCalledTimes(1);

    ui.custom.mockResolvedValue(null);
    expect(await deps.llm(LLM_INPUT)).toEqual({ ok: false, error: "cancelled" });
  });

  it("searchDocs adapter maps KB docs and tolerates null created dates", async () => {
    const m = await importDeps();
    const { ctx } = makeCtx("rpc");
    const deps = m.buildResearchDeps(ctx as never, AUTH, {});
    m.ensureNotesDb.mockResolvedValue({});
    m.searchDocs.mockReturnValue([
      { title: "A", path: "a.md", created: "2026-01-01" },
      { title: "B", path: "b.md", created: null },
    ] as never);

    const docs = await deps.searchDocs("q");
    expect(docs).toEqual([
      { title: "A", path: "a.md", created: "2026-01-01" },
      { title: "B", path: "b.md", created: undefined },
    ]);
  });

  it("fetchUrl adapter maps content and errors", async () => {
    const m = await importDeps();
    const { ctx } = makeCtx("rpc");
    const deps = m.buildResearchDeps(ctx as never, AUTH, {});

    m.fetchUrlWithTimeout.mockResolvedValue({
      title: "T",
      content: "body",
      engine: "http",
    });
    expect(await deps.fetchUrl("https://x.com", 1000)).toEqual({ title: "T", content: "body" });

    m.fetchUrlWithTimeout.mockResolvedValue({ error: "Request timed out after 1000ms" });
    expect(await deps.fetchUrl("https://x.com", 1000)).toEqual({
      error: "Request timed out after 1000ms",
    });
  });

  it("writeBack adapter forwards metadata-bearing sources with a stub assessment", async () => {
    const m = await importDeps();
    const { ctx } = makeCtx("rpc");
    const deps = m.buildResearchDeps(ctx as never, AUTH, {});
    m.writeBackToKB.mockResolvedValue({ created: ["Resources/n.md"], updated: [], skipped: [] });

    const sources = [{ url: "https://a.com/1", snippet: "s", title: "T", year: 2026 }];
    const wb = await deps.writeBack({ sources, questions: ["q1"] });

    expect(wb.created).toEqual(["Resources/n.md"]);
    expect(m.writeBackToKB).toHaveBeenCalledWith(
      {
        sources,
        questions: ["q1"],
        assessment: { sufficient: false, outdatedNotes: [], gaps: [] },
      },
      expect.objectContaining({ cwd: "/test", model: AUTH.model }),
    );
  });

  it("should expose knowledgeDir, notify passthrough, and option flags", async () => {
    const m = await importDeps();
    const { ctx, ui } = makeCtx("rpc");
    const deps = m.buildResearchDeps(ctx as never, AUTH, {
      allowEscalation: true,
      searchDeps: { searchWeb: vi.fn() },
    });
    expect(deps.knowledgeDir).toBe("/kb");
    expect(deps.allowEscalation).toBe(true);
    deps.notify?.("hello");
    expect(ui.notify).toHaveBeenCalledWith("hello", "info");
    expect(deps.fetchTimeoutMs).toBe(20_000);
    expect(deps.llmTimeoutMs).toBe(120_000);
  });
});
