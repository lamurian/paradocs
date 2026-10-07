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

vi.mock("../../extensions/research-engine/orchestrator.js", async () => {
  const { DEFAULT_STAGE_MESSAGES } =
    await import("../../extensions/research-engine/research-deps.js");
  return { runResearch: vi.fn(), DEFAULT_STAGE_MESSAGES };
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

/**
 * Build a mock ctx.ui with a spy for every UI channel.
 *
 * @param overrides - Replace specific spies (e.g. share a setStatus mock).
 * @returns Mock UI object.
 */
function makeUi(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    notify: vi.fn(),
    setWorkingVisible: vi.fn(),
    setWorkingMessage: vi.fn(),
    setStatus: vi.fn(),
    custom: vi.fn(),
    ...overrides,
  };
}

function makeCtx(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ui: makeUi(),
    cwd: "/test",
    mode: "rpc",
    hasUI: true,
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

  it("should proceed without an API-key lookup (subprocesses resolve credentials)", async () => {
    const { createHandler, runResearch, buildResearchDeps } = await importHandler();
    const notify = vi.fn();
    runResearch.mockResolvedValue(fixtureState());
    const getApiKeyAndHeaders = vi.fn().mockResolvedValue({ ok: false });
    const handler = createHandler({ sendUserMessage } as never);
    await handler(
      "What is x?",
      makeCtx({
        ui: makeUi({ notify }),
        modelRegistry: { getApiKeyAndHeaders },
      }) as never,
    );
    expect(getApiKeyAndHeaders).not.toHaveBeenCalled();
    expect(runResearch).toHaveBeenCalled();
    expect(buildResearchDeps).toHaveBeenCalled();
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
    const setStatus = vi.fn();
    const ctx = makeCtx({ ui: makeUi({ notify, setStatus }) });
    const handler = createHandler({ sendUserMessage } as never);

    const started = Date.now();
    await handler("What is x?", ctx as never);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(500);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Researching:"), "info");
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

  it("rpc: sets 'Researcher: {q}' status before the run, updates it, clears at the end", async () => {
    const { createHandler, runResearch } = await importHandler();
    let resolveRun: (s: ResearchState) => void = () => {};
    runResearch.mockReturnValue(
      new Promise<ResearchState>((r) => {
        resolveRun = r;
      }),
    );
    const setStatus = vi.fn();
    const ui = makeUi({ setStatus });
    const handler = createHandler({ sendUserMessage } as never);

    const started = Date.now();
    await handler("What is x?", makeCtx({ ui }) as never);
    expect(Date.now() - started).toBeLessThan(500);

    // Initial status is set before the pipeline starts.
    expect(setStatus).toHaveBeenNthCalledWith(1, "research", "Researcher: What is x?");
    expect(setStatus.mock.invocationCallOrder[0]).toBeLessThan(
      runResearch.mock.invocationCallOrder[0],
    );

    // onProgress and onDetail both update the same status key mid-run.
    const deps = runResearch.mock.calls[0][0] as ResearchDeps;
    deps.onProgress?.("SEARCH", "searching…");
    deps.onDetail?.("fetched 1/3");
    expect(setStatus).toHaveBeenCalledWith("research", "Researcher: What is x? — searching…");
    expect(setStatus).toHaveBeenCalledWith("research", "Researcher: What is x? — fetched 1/3");

    resolveRun(fixtureState());
    await vi.waitFor(() => expect(sendUserMessage).toHaveBeenCalledTimes(1));
    // The key is cleared after delivery.
    expect(setStatus).toHaveBeenLastCalledWith("research", undefined);
    // TUI channels stay silent in rpc mode.
    expect(ui.setWorkingMessage).not.toHaveBeenCalled();
  });

  it("rpc: clears the status key after a failed run and keeps notify(error)", async () => {
    const { createHandler, runResearch } = await importHandler();
    runResearch.mockRejectedValue(new Error("synthesis timed out after 60000ms"));
    const notify = vi.fn();
    const setStatus = vi.fn();
    const ui = makeUi({ notify, setStatus });
    const handler = createHandler({ sendUserMessage } as never);
    await handler("What is x?", makeCtx({ ui }) as never);

    expect(setStatus).toHaveBeenNthCalledWith(1, "research", "Researcher: What is x?");
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledWith("research", undefined));
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Research failed: synthesis timed out"),
      "error",
    );
    expect(sendUserMessage).not.toHaveBeenCalled();
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
    const ui = makeUi();
    const handler = createHandler({ sendUserMessage } as never);
    await handler("What is x?", makeCtx({ mode: "tui", ui }) as never);

    expect(ui.setWorkingVisible).toHaveBeenCalledWith(true);
    expect(ui.setWorkingMessage).toHaveBeenCalledWith("querying…");
    expect(ui.setWorkingMessage).toHaveBeenCalledWith("fetching…");
    expect(ui.setWorkingMessage).toHaveBeenCalledWith("summarizing…");
    expect(ui.setWorkingMessage).toHaveBeenCalledWith("writing back…");
    expect(ui.setWorkingVisible).toHaveBeenLastCalledWith(false);
    expect(ui.setStatus).not.toHaveBeenCalled();
    expect(sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("## Answer: What is x?"));
  });

  it("should not reference the removed subagent pipeline", () => {
    const source = readFileSync(ASK_TS, "utf-8");
    expect(source).not.toContain("runResearchEngine");
    expect(source).not.toContain("runAskSufficiency");
  });
});
