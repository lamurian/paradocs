/**
 * Tests for the /ask command — FSM orchestrator flow (T13, T11).
 *
 * @module tests/commands/ask.test
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect, vi, beforeEach } from "vitest";

import { ASK_DEEP_PROFILE } from "../../extensions/research-engine/profiles.js";

import type { ResearchDeps } from "../../extensions/research-engine/research-deps.js";
import type { ResearchState } from "../../extensions/research-engine/state.js";

vi.mock("../../extensions/research-engine/orchestrator.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../extensions/research-engine/orchestrator.js")>();
  return { ...actual, runResearch: vi.fn() };
});
vi.mock("../../extensions/research-engine/deps.js", () => ({
  buildResearchDeps: vi.fn(() => ({})),
}));

const HERE = dirname(fileURLToPath(import.meta.url));
const ASK_TS = resolve(HERE, "../../extensions/commands/ask.ts");

function fixtureState(overrides: Partial<ResearchState> = {}): ResearchState {
  return {
    jobId: "ask-test",
    question: "what is x",
    mode: "breadth",
    profile: ASK_DEEP_PROFILE,
    stage: "DONE_SUFFICIENT",
    cycle: 1,
    startedAt: 0,
    deadlineAt: 1,
    queries: ["q1"],
    kbDocs: [],
    kbSufficient: null,
    kbFreshRatio: null,
    kbCovered: false,
    candidates: [],
    lastRankCount: 3,
    fetches: [],
    summaries: [
      { url: "https://a.com/1", canonicalUrl: "https://a.com/1", summary: "finding one" },
    ],
    visited: ["https://a.com/1"],
    askedQuestions: ["q1"],
    coveredFacets: [],
    gaps: [],
    cycles: [{ cycle: 1, questions: ["q1"], candidates: 3, fetched: 1, summarized: 1 }],
    failures: [],
    llmErrorCount: 0,
    deadlineHit: false,
    degraded: false,
    synthesis: "Synthesized answer about x.",
    writeback: { created: ["Resources/new-note.md"], updated: [], skipped: [] },
    trace: [],
    ...overrides,
  };
}

function makeCtx(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ui: {
      notify: vi.fn(),
      setWorkingVisible: vi.fn(),
      setWorkingMessage: vi.fn(),
      custom: vi.fn(),
    },
    cwd: "/test",
    mode: "rpc",
    model: { id: "m", provider: "p" },
    modelRegistry: {
      getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true, apiKey: "sk-test" }),
    },
    ...overrides,
  };
}

async function importHandler(): Promise<{
  createHandler: typeof import("../../extensions/commands/ask.js").createHandler;
  runResearch: ReturnType<typeof vi.fn>;
  buildResearchDeps: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  const ask = await import("../../extensions/commands/ask.js");
  const orch = await import("../../extensions/research-engine/orchestrator.js");
  const deps = await import("../../extensions/research-engine/deps.js");
  vi.clearAllMocks();
  return {
    createHandler: ask.createHandler,
    runResearch: vi.mocked(orch.runResearch),
    buildResearchDeps: vi.mocked(deps.buildResearchDeps),
  };
}

describe("/ask command — FSM orchestrator flow (T13)", () => {
  let sendUserMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendUserMessage = vi.fn();
  });

  it("should show usage when no question is provided", async () => {
    const { createHandler } = await importHandler();
    const notify = vi.fn();
    const handler = createHandler({ sendUserMessage } as never);
    await handler("", makeCtx({ ui: { notify } }) as never);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Usage: /ask"), "warning");
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("should require a selected model", async () => {
    const { createHandler } = await importHandler();
    const notify = vi.fn();
    const handler = createHandler({ sendUserMessage } as never);
    await handler("What is x?", makeCtx({ model: undefined, ui: { notify } }) as never);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("No model selected"), "error");
  });

  it("should notify and stop when auth fails", async () => {
    const { createHandler, runResearch } = await importHandler();
    const notify = vi.fn();
    const handler = createHandler({ sendUserMessage } as never);
    await handler(
      "What is x?",
      makeCtx({
        ui: { notify },
        modelRegistry: { getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: false }) },
      }) as never,
    );
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("API key"), "error");
    expect(runResearch).not.toHaveBeenCalled();
  });

  it("rpc: resolve immediately, deliver in background with answer + write-back status", async () => {
    const { createHandler, runResearch } = await importHandler();
    let resolveRun: (s: ResearchState) => void = () => {};
    runResearch.mockReturnValue(
      new Promise<ResearchState>((r) => {
        resolveRun = r;
      }),
    );
    const notify = vi.fn();
    const ctx = makeCtx({ ui: { notify } });
    const handler = createHandler({ sendUserMessage } as never);

    const started = Date.now();
    await handler("What is x?", ctx as never);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(500);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("🔍 Researching:"), "info");
    expect(runResearch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ question: "What is x?", profile: ASK_DEEP_PROFILE }),
    );
    expect(sendUserMessage).not.toHaveBeenCalled();

    resolveRun(fixtureState());
    await vi.waitFor(() => expect(sendUserMessage).toHaveBeenCalledTimes(1));
    const message = sendUserMessage.mock.calls[0][0] as string;
    expect(message).toContain("## Answer: What is x?");
    expect(message).toContain("Synthesized answer about x.");
    expect(message).toContain("created: Resources/new-note.md");
  });

  it("T11: render synthesis failures with the real error message", async () => {
    const { createHandler, runResearch } = await importHandler();
    runResearch.mockResolvedValue(
      fixtureState({
        stage: "DONE_DEGRADED",
        synthesis: undefined,
        synthesisError: "429 rate limited",
        writeback: {
          created: [],
          updated: [],
          skipped: ["write-back skipped: grouping LLM call failed: 429"],
        },
      }),
    );
    const handler = createHandler({ sendUserMessage } as never);
    await handler("What is x?", makeCtx() as never);

    await vi.waitFor(() => expect(sendUserMessage).toHaveBeenCalledTimes(1));
    const message = sendUserMessage.mock.calls[0][0] as string;
    expect(message).toContain("_(synthesis unavailable: 429 rate limited)_");
    expect(message).toContain("skipped: write-back skipped: grouping LLM call failed: 429");
  });

  it("tui: block with per-stage working messages and hide the indicator at the end", async () => {
    const { createHandler, runResearch } = await importHandler();
    runResearch.mockImplementation(((deps: ResearchDeps) => {
      deps.onProgress?.("QUERY_GEN", "querying…");
      deps.onProgress?.("FETCH", "fetching…");
      deps.onProgress?.("SUMMARIZE", "summarizing…");
      deps.onProgress?.("WRITE_BACK", "writing back…");
      return Promise.resolve(fixtureState());
    }) as never);
    const ui = {
      notify: vi.fn(),
      setWorkingVisible: vi.fn(),
      setWorkingMessage: vi.fn(),
      custom: vi.fn(),
    };
    const handler = createHandler({ sendUserMessage } as never);
    await handler("What is x?", makeCtx({ mode: "tui", ui }) as never);

    expect(ui.setWorkingVisible).toHaveBeenCalledWith(true);
    expect(ui.setWorkingMessage).toHaveBeenCalledWith("querying…");
    expect(ui.setWorkingMessage).toHaveBeenCalledWith("fetching…");
    expect(ui.setWorkingMessage).toHaveBeenCalledWith("summarizing…");
    expect(ui.setWorkingMessage).toHaveBeenCalledWith("writing back…");
    expect(ui.setWorkingVisible).toHaveBeenLastCalledWith(false);
    expect(sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("## Answer: What is x?"));
  });

  it("should not reference the removed subagent pipeline", () => {
    const source = readFileSync(ASK_TS, "utf-8");
    expect(source).not.toContain("runResearchEngine");
    expect(source).not.toContain("runAskSufficiency");
  });
});
