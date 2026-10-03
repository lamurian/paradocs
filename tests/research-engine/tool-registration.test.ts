/**
 * Tests for the research_engine tool registration and orchestrator-based
 * execution (rewired index.ts).
 *
 * @module tests/research-engine/tool-registration.test
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../extensions/research-engine/orchestrator.js", () => ({
  runResearch: vi.fn(),
  DEFAULT_STAGE_MESSAGES: {},
}));
vi.mock("../../extensions/research-engine/deps.js", () => ({
  buildResearchDeps: vi.fn(() => ({})),
}));

import { ASK_DEEP_PROFILE } from "../../extensions/research-engine/profiles.js";

import type { ResearchState } from "../../extensions/research-engine/state.js";

function fixtureState(): ResearchState {
  return {
    jobId: "re-1",
    question: "question one | question two",
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
    lastRankCount: 2,
    fetches: [],
    summaries: [
      {
        url: "https://src.example/1",
        canonicalUrl: "https://src.example/1",
        summary: "Source one finding",
      },
      {
        url: "https://src.example/2",
        canonicalUrl: "https://src.example/2",
        summary: "Source two finding",
      },
    ],
    visited: [],
    askedQuestions: ["q1"],
    coveredFacets: [],
    gaps: [],
    cycles: [{ cycle: 1, questions: ["q1"], candidates: 2, fetched: 2, summarized: 2 }],
    failures: [],
    llmErrorCount: 0,
    deadlineHit: false,
    degraded: false,
    synthesis: "Engine synthesized answer.",
    writeback: {
      created: ["Resources/new-note.md"],
      updated: ["Resources/outdated-note.md"],
      skipped: [],
    },
    trace: [],
  };
}

function toolCtx(): Record<string, unknown> {
  return {
    cwd: "/test",
    mode: "rpc",
    model: { id: "m", provider: "p" },
    modelRegistry: {
      getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true, apiKey: "sk-test" }),
    },
  };
}

interface ToolHandle {
  name: string;
  parameters: {
    properties: Record<string, { type: string; items?: { type: string } }>;
    required: string[];
  };
  execute: (
    id: string,
    params: { questions: string[] },
    signal: undefined,
    onUpdate: undefined,
    ctx: Record<string, unknown>,
  ) => Promise<{
    content: Array<{ type: string; text: string }>;
    details: Record<string, unknown>;
  }>;
}

async function importTool(): Promise<{
  tool: ToolHandle;
  runResearch: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  const mod = await import("../../extensions/research-engine/index.js");
  const orch = await import("../../extensions/research-engine/orchestrator.js");
  vi.clearAllMocks();
  const registerTool = vi.fn();
  mod.default({ registerTool, on: vi.fn() } as never);
  return {
    tool: registerTool.mock.calls[0][0] as ToolHandle,
    runResearch: vi.mocked(orch.runResearch),
  };
}

describe("research_engine tool registration", () => {
  it("should register research_engine with a questions: string[] parameter", async () => {
    const { tool } = await importTool();
    expect(tool.name).toBe("research_engine");
    expect(tool.parameters.properties.questions.type).toBe("array");
    expect(tool.parameters.properties.questions.items?.type).toBe("string");
    expect(tool.parameters.required).toContain("questions");
  });

  it("should run the orchestrator with the ask-deep profile and return sources, answer, writeback, digest", async () => {
    const { tool, runResearch } = await importTool();
    runResearch.mockResolvedValue(fixtureState());

    const result = await tool.execute(
      "call",
      { questions: ["question one", "question two"] },
      undefined,
      undefined,
      toolCtx(),
    );

    expect(runResearch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        question: "question one | question two",
        profile: expect.objectContaining({ name: "ask-deep" }) as Record<string, unknown>,
      }),
    );
    const text = result.content[0].text;
    expect(text).toContain("https://src.example/1");
    expect(text).toContain("https://src.example/2");
    expect(text).toContain("Engine synthesized answer.");
    expect(text).toContain("created: Resources/new-note.md");
    expect(text).toContain("updated: Resources/outdated-note.md");
    expect(text).toContain("Digest:");
    expect(result.details.sources).toHaveLength(2);
    expect(result.details.writeback).toBeDefined();
    expect(result.details.digest).toMatchObject({ sourceCount: 2 });
  });

  it("should surface synthesis failures with the real error in the tool text", async () => {
    const { tool, runResearch } = await importTool();
    runResearch.mockResolvedValue({
      ...fixtureState(),
      synthesis: undefined,
      synthesisError: "LLM call timed out after 120000ms",
      stage: "DONE_DEGRADED",
    });

    const result = await tool.execute(
      "call",
      { questions: ["q"] },
      undefined,
      undefined,
      toolCtx(),
    );
    expect(result.content[0].text).toContain(
      "_(synthesis unavailable: LLM call timed out after 120000ms)_",
    );
  });

  it("should error cleanly when no model is selected", async () => {
    const { tool, runResearch } = await importTool();
    const result = await tool.execute("call", { questions: ["q"] }, undefined, undefined, {
      ...toolCtx(),
      model: undefined,
    });
    expect(result.content[0].text).toContain("No model selected");
    expect(runResearch).not.toHaveBeenCalled();
  });
});
