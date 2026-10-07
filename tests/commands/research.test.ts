/**
 * Tests for the /research command — FSM orchestrator flow (T13 pattern).
 *
 * @module tests/commands/research.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { RESEARCH_PROFILE } from "../../extensions/research-engine/profiles.js";

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

function fixtureState(): ResearchState {
  return {
    jobId: "research-test",
    question: "topic",
    mode: "breadth",
    profile: RESEARCH_PROFILE,
    stage: "DONE_DEGRADED",
    cycle: 2,
    startedAt: 0,
    deadlineAt: 1,
    queries: ["q1"],
    kbDocs: [],
    kbSufficient: null,
    kbFreshRatio: null,
    kbCovered: false,
    candidates: [],
    lastRankCount: 10,
    fetches: [],
    summaries: [],
    visited: [],
    askedQuestions: ["q1", "q2"],
    coveredFacets: ["mechanisms"],
    gaps: ["missing field evidence"],
    cycles: [],
    failures: [],
    llmErrorCount: 0,
    deadlineHit: true,
    degraded: true,
    synthesis: "# Report\n\nStructured findings.",
    writeback: { created: [], updated: [], skipped: ["atomicity unverified: Note A"] },
    trace: [],
  };
}

function makeCtx(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ui: {
      notify: vi.fn(),
      setWorkingVisible: vi.fn(),
      setWorkingMessage: vi.fn(),
      setStatus: vi.fn(),
      custom: vi.fn(),
    },
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

describe("/research command — FSM orchestrator flow", () => {
  let sendUserMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendUserMessage = vi.fn();
  });

  it("should use the wide research profile and deliver a Research Report", async () => {
    vi.resetModules();
    const { createHandler } = await import("../../extensions/commands/research.js");
    const { runResearch } = await import("../../extensions/research-engine/orchestrator.js");
    vi.clearAllMocks();
    vi.mocked(runResearch).mockResolvedValue(fixtureState());

    const handler = createHandler({ sendUserMessage } as never);
    await handler("AI agent guardrails", makeCtx() as never);

    expect(runResearch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ question: "AI agent guardrails", profile: RESEARCH_PROFILE }),
    );
    await vi.waitFor(() => expect(sendUserMessage).toHaveBeenCalledTimes(1));
    const message = sendUserMessage.mock.calls[0][0] as string;
    expect(message).toContain("## Research Report: AI agent guardrails");
    expect(message).toContain("Structured findings.");
    expect(message).toContain("skipped: atomicity unverified: Note A");
  });

  it("rpc: sets 'Researcher: {topic}' status before the run, updates it, clears at the end", async () => {
    vi.resetModules();
    const { createHandler } = await import("../../extensions/commands/research.js");
    const { runResearch } = await import("../../extensions/research-engine/orchestrator.js");
    vi.clearAllMocks();
    let resolveRun: (s: ResearchState) => void = () => {};
    vi.mocked(runResearch).mockReturnValue(
      new Promise<ResearchState>((r) => {
        resolveRun = r;
      }),
    );
    const setStatus = vi.fn();
    const ui = {
      notify: vi.fn(),
      setWorkingVisible: vi.fn(),
      setWorkingMessage: vi.fn(),
      setStatus,
      custom: vi.fn(),
    };
    const handler = createHandler({ sendUserMessage } as never);
    await handler("topic", makeCtx({ ui }) as never);

    // Initial status is set before the pipeline starts.
    expect(setStatus).toHaveBeenNthCalledWith(1, "research", "Researcher: topic");
    expect(setStatus.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(runResearch).mock.invocationCallOrder[0],
    );

    // onProgress and onDetail both update the same status key mid-run.
    const deps = vi.mocked(runResearch).mock.calls[0][0];
    deps.onProgress?.("SEARCH", "searching…");
    deps.onDetail?.("fetched 1/3");
    expect(setStatus).toHaveBeenCalledWith("research", "Researcher: topic — searching…");
    expect(setStatus).toHaveBeenCalledWith("research", "Researcher: topic — fetched 1/3");

    resolveRun(fixtureState());
    await vi.waitFor(() => expect(sendUserMessage).toHaveBeenCalledTimes(1));
    // The key is cleared after delivery.
    expect(setStatus).toHaveBeenLastCalledWith("research", undefined);
    // TUI channels stay silent in rpc mode.
    expect(ui.setWorkingMessage).not.toHaveBeenCalled();
  });

  it("rpc: clears the status key after a failed run and keeps notify(error)", async () => {
    vi.resetModules();
    const { createHandler } = await import("../../extensions/commands/research.js");
    const { runResearch } = await import("../../extensions/research-engine/orchestrator.js");
    vi.clearAllMocks();
    vi.mocked(runResearch).mockRejectedValue(new Error("search subagent crashed"));
    const notify = vi.fn();
    const setStatus = vi.fn();
    const ui = {
      notify,
      setWorkingVisible: vi.fn(),
      setWorkingMessage: vi.fn(),
      setStatus,
      custom: vi.fn(),
    };
    const handler = createHandler({ sendUserMessage } as never);
    await handler("topic", makeCtx({ ui }) as never);

    expect(setStatus).toHaveBeenNthCalledWith(1, "research", "Researcher: topic");
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledWith("research", undefined));
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Research failed: search subagent crashed"),
      "error",
    );
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("should notify usage errors without running the pipeline", async () => {
    vi.resetModules();
    const { createHandler } = await import("../../extensions/commands/research.js");
    const { runResearch } = await import("../../extensions/research-engine/orchestrator.js");
    vi.clearAllMocks();
    const notify = vi.fn();
    const handler = createHandler({ sendUserMessage } as never);

    await handler("  ", makeCtx({ ui: { notify } }) as never);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Usage: /research"), "warning");
    expect(runResearch).not.toHaveBeenCalled();
  });

  it("tui: block with per-stage progress", async () => {
    vi.resetModules();
    const { createHandler } = await import("../../extensions/commands/research.js");
    const { runResearch } = await import("../../extensions/research-engine/orchestrator.js");
    vi.clearAllMocks();
    vi.mocked(runResearch).mockImplementation((deps: ResearchDeps) => {
      deps.onProgress?.("SEARCH", "searching…");
      return Promise.resolve(fixtureState());
    });
    const ui = {
      notify: vi.fn(),
      setWorkingVisible: vi.fn(),
      setWorkingMessage: vi.fn(),
      setStatus: vi.fn(),
      custom: vi.fn(),
    };
    const handler = createHandler({ sendUserMessage } as never);
    await handler("topic", makeCtx({ mode: "tui", ui }) as never);

    expect(ui.setWorkingVisible).toHaveBeenCalledWith(true);
    expect(ui.setWorkingMessage).toHaveBeenCalledWith("searching…");
    expect(ui.setWorkingVisible).toHaveBeenLastCalledWith(false);
    expect(ui.setStatus).not.toHaveBeenCalled();
    expect(sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("## Research Report: topic"),
    );
  });
});
