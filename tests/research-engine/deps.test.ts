/**
 * Tests for the command-facing dependency builder (research-engine/deps).
 *
 * The builder wires the orchestrator to the subagent transport: llm and
 * searchSubagent spawn lean pi subprocesses; fetch/KB/write-back stay
 * in-process. Verifies CLI flags, role-based timeouts, and adapters.
 *
 * @module tests/research-engine/deps.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { fetchUrlWithTimeout } from "../../common/fetchUrl.js";
import { ensureNotesDb } from "../../common/notesDb.js";
import { runSubagent, buildSubagentArgs, resolveSubagentTimeoutMs } from "../../common/subagent.js";
import { searchDocs } from "../../extensions/para-knowledge/db-sqlite.js";
import { buildResearchDeps } from "../../extensions/research-engine/deps.js";
import { buildSearchAgentArgs } from "../../extensions/research-engine/runner.js";
import { writeBackToKB } from "../../extensions/research-engine/writeback.js";

vi.mock("../../common/subagent.js", () => ({
  buildSubagentArgs: vi.fn((i: Record<string, unknown>) => ["ARGS", i.task]),
  resolveSubagentTimeoutMs: vi.fn(() => 60_000),
  runSubagent: vi.fn(),
}));
vi.mock("../../extensions/research-engine/runner.js", () => ({
  buildSearchAgentArgs: vi.fn((i: Record<string, unknown>) => ["SEARCH-ARGS", i.task]),
  parseSearchResult: vi.fn(),
}));
vi.mock("../../common/fetchUrl.js", () => ({
  fetchUrlWithTimeout: vi.fn(),
  fetchUrlAsText: vi.fn(),
}));
vi.mock("../../common/notesDb.js", () => ({ ensureNotesDb: vi.fn() }));
vi.mock("../../extensions/para-knowledge/db-sqlite.js", () => ({ searchDocs: vi.fn() }));
vi.mock("../../extensions/research-engine/writeback.js", () => ({ writeBackToKB: vi.fn() }));

const AUTH = { model: { id: "mimo-v2.5", provider: "opencode-go" } as never };

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

/**
 * Return the builder plus the mock spies. Static imports keep one module
 * instance (stable v8 coverage attribution in full runs); vi.mock
 * hoisting means these imports already receive the mocks above.
 */
function importDeps(): {
  buildResearchDeps: typeof buildResearchDeps;
  runSubagent: ReturnType<typeof vi.fn>;
  buildSubagentArgs: ReturnType<typeof vi.fn>;
  resolveSubagentTimeoutMs: ReturnType<typeof vi.fn>;
  buildSearchAgentArgs: ReturnType<typeof vi.fn>;
  fetchUrlWithTimeout: ReturnType<typeof vi.fn>;
  ensureNotesDb: ReturnType<typeof vi.fn>;
  searchDocs: ReturnType<typeof vi.fn>;
  writeBackToKB: ReturnType<typeof vi.fn>;
} {
  vi.clearAllMocks();
  return {
    buildResearchDeps,
    runSubagent: vi.mocked(runSubagent),
    buildSubagentArgs: vi.mocked(buildSubagentArgs),
    resolveSubagentTimeoutMs: vi.mocked(resolveSubagentTimeoutMs),
    buildSearchAgentArgs: vi.mocked(buildSearchAgentArgs),
    fetchUrlWithTimeout: vi.mocked(fetchUrlWithTimeout),
    ensureNotesDb: vi.mocked(ensureNotesDb),
    searchDocs: vi.mocked(searchDocs),
    writeBackToKB: vi.mocked(writeBackToKB),
  };
}

const LLM_INPUT = {
  system: "sys",
  user: "user text",
  parse: (t: string) => t,
  label: "Label…",
  role: "summarize" as const,
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

  it("llm: spawns a --no-tools subagent with role-based timeout and maps outcomes", async () => {
    const m = importDeps();
    const { ctx } = makeCtx("rpc");
    const deps = m.buildResearchDeps(ctx as never, AUTH, {});

    m.runSubagent.mockResolvedValue({ ok: true, text: "v", value: "v" });
    expect(await deps.llm(LLM_INPUT)).toEqual({ ok: true, value: "v" });
    expect(m.buildSubagentArgs).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "opencode-go",
        modelId: "mimo-v2.5",
        systemPrompt: "sys",
        task: "user text",
        extraArgs: ["--no-tools"],
      }),
    );
    expect(m.runSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["ARGS", "user text"],
        cwd: "/test",
        timeoutMs: 60_000,
        parse: LLM_INPUT.parse,
      }),
    );

    m.runSubagent.mockResolvedValue({ ok: false, error: "429 rate limited" });
    expect(await deps.llm(LLM_INPUT)).toEqual({ ok: false, error: "429 rate limited" });
  });

  it("llm: tui mode sets a working message before spawning", async () => {
    const m = importDeps();
    const { ctx, ui } = makeCtx("tui");
    const deps = m.buildResearchDeps(ctx as never, AUTH, {});
    m.runSubagent.mockResolvedValue({ ok: true, text: "v", value: "v" });

    await deps.llm(LLM_INPUT);
    expect(ui.setWorkingMessage).toHaveBeenCalledWith("Label…");
  });

  it("searchSubagent: spawns the web_search subagent and maps outcomes", async () => {
    const m = importDeps();
    const { ctx } = makeCtx("rpc");
    const deps = m.buildResearchDeps(ctx as never, AUTH, {});

    const value = { sources: [{ url: "https://a.example/1", snippet: "s" }], coveredFacets: [] };
    m.runSubagent.mockResolvedValue({ ok: true, text: "{}", value });
    const res = await deps.searchSubagent({ task: "find sources" });
    expect(res).toEqual({ ok: true, value });
    expect(m.buildSearchAgentArgs).toHaveBeenCalledWith({
      provider: "opencode-go",
      modelId: "mimo-v2.5",
      task: "find sources",
    });

    m.runSubagent.mockResolvedValue({ ok: false, error: "spawn failed" });
    expect(await deps.searchSubagent({ task: "t" })).toEqual({
      ok: false,
      error: "spawn failed",
    });
  });

  it("searchDocs adapter maps KB docs and tolerates null created dates", async () => {
    const m = importDeps();
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
    const m = importDeps();
    const { ctx } = makeCtx("rpc");
    const deps = m.buildResearchDeps(ctx as never, AUTH, {});

    m.fetchUrlWithTimeout.mockResolvedValue({ title: "T", content: "body", engine: "http" });
    expect(await deps.fetchUrl("https://x.com", 1000)).toEqual({ title: "T", content: "body" });

    m.fetchUrlWithTimeout.mockResolvedValue({ error: "Request timed out after 1000ms" });
    expect(await deps.fetchUrl("https://x.com", 1000)).toEqual({
      error: "Request timed out after 1000ms",
    });
  });

  it("writeBack adapter forwards sources, jobId, and synthesis with the runtime model", async () => {
    const m = importDeps();
    const { ctx } = makeCtx("rpc");
    const deps = m.buildResearchDeps(ctx as never, AUTH, {});
    m.writeBackToKB.mockResolvedValue({ created: ["Resources/n.md"], updated: [], skipped: [] });

    const sources = [{ url: "https://a.com/1", snippet: "s", title: "T", year: 2026 }];
    const wb = await deps.writeBack({
      sources,
      questions: ["q1"],
      jobId: "job-1",
      synthesis: "the answer",
    });

    expect(wb.created).toEqual(["Resources/n.md"]);
    expect(m.writeBackToKB).toHaveBeenCalledWith(
      {
        sources,
        questions: ["q1"],
        assessment: { sufficient: false, outdatedNotes: [], gaps: [] },
        jobId: "job-1",
        synthesis: "the answer",
      },
      expect.objectContaining({ cwd: "/test", model: AUTH.model }),
    );
  });

  it("should expose knowledgeDir, notify passthrough, and option flags", () => {
    const m = importDeps();
    const { ctx, ui } = makeCtx("rpc");
    const deps = m.buildResearchDeps(ctx as never, AUTH, { allowEscalation: true });
    expect(deps.knowledgeDir).toBe("/kb");
    expect(deps.allowEscalation).toBe(true);
    deps.notify?.("hello");
    expect(ui.notify).toHaveBeenCalledWith("hello", "info");
    expect(deps.fetchTimeoutMs).toBe(20_000);
  });
});
