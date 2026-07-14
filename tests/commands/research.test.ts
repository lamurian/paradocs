/**
 * Tests for the /research command handler.
 *
 * @module tests/commands/research.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

describe("research command handler", () => {
  let sendUserMessage: ReturnType<typeof vi.fn>;
  let notify: ReturnType<typeof vi.fn>;
  let mockPi: Record<string, unknown>;
  let mockCtx: Record<string, unknown>;
  let getApiKeyAndHeaders: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    sendUserMessage = vi.fn();
    notify = vi.fn();
    getApiKeyAndHeaders = vi.fn().mockResolvedValue({ ok: true, apiKey: "sk-test", headers: {} });
    mockCtx = {
      ui: { notify },
      model: { id: "gpt-4o", provider: "openai" },
      modelRegistry: {
        getApiKeyAndHeaders,
      },
      cwd: "/test",
    };
    mockPi = {
      sendUserMessage,
      registerCommand: vi.fn(),
      registerTool: vi.fn(),
    };
  });

  it("should show usage when no topic is provided", async () => {
    const { createHandler } = await import("../../extensions/commands/research.js");
    const handler = createHandler(mockPi as never);

    await handler("", mockCtx as never);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Usage: /research"), "warning");
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("should show usage for whitespace-only input", async () => {
    const { createHandler } = await import("../../extensions/commands/research.js");
    const handler = createHandler(mockPi as never);

    await handler("   ", mockCtx as never);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Usage: /research"), "warning");
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("should show error when no model is selected", async () => {
    const { createHandler } = await import("../../extensions/commands/research.js");
    const handler = createHandler(mockPi as never);

    await handler("dopamine and motivation", {
      ...mockCtx,
      mode: "tui",
      ui: { notify, custom: vi.fn() },
      model: undefined,
    } as never);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("No model selected"), "error");
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("should work in RPC mode without ctx.ui.custom", async () => {
    const { createHandler } = await import("../../extensions/commands/research.js");
    const handler = createHandler(mockPi as never);

    // RPC mode: mode is not "tui", no custom(), direct LLM path
    await handler("dopamine and motivation", {
      ...mockCtx,
      mode: "rpc",
      ui: { notify },
    } as never);

    // Should not error about TUI mode
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining("requires interactive"));
    // Should notify about evaluating existing knowledge
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Evaluating existing knowledge"),
      "info",
    );
  });

  it("should register /research command with description", async () => {
    const mod = await import("../../extensions/commands/index.js");
    mod.default(mockPi as never);

    /* eslint-disable @typescript-eslint/no-unsafe-assignment */
    expect(mockPi.registerCommand).toHaveBeenCalledWith(
      "research",
      expect.objectContaining({
        description: expect.any(String),
        handler: expect.any(Function),
      }),
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    );
  });
});

describe("formatResearchPlan", () => {
  it("should format a research plan with question tree", async () => {
    const { formatResearchPlan } = await import("../../extensions/commands/research-format.js");

    const questionTree = JSON.stringify({
      why: {
        question: "Why is dopamine central to motivation?",
        supporting: [
          "What is the neurobiological evidence?",
          "What distinguishes wanting versus liking?",
          "How do dysregulation disorders affect motivation?",
        ],
      },
      how: {
        question: "How does dopamine signalling drive behaviour?",
        supporting: [
          "What experimental methods reveal reward prediction?",
          "What measurements quantify dopamine release?",
          "How do interventions modulate motivation?",
        ],
      },
    });

    const plan = formatResearchPlan("dopamine and motivation", questionTree);

    expect(plan).toContain("Research Plan: dopamine and motivation");
    expect(plan).toContain("WHY");
    expect(plan).toContain("HOW");
    expect(plan).toContain("web_search");
    expect(plan).toContain("fetch_url");
    expect(plan).toContain("atomic note");
    expect(plan).toContain("Completion Criteria");
    expect(plan).toContain("dopamine and motivation");
  });

  it("should include topic name in plan header even with special chars", async () => {
    const { formatResearchPlan } = await import("../../extensions/commands/research-format.js");

    const plan = formatResearchPlan("Complex! Topic with @special #chars & more!!!", "{}");

    expect(plan).toContain("Research Plan: Complex! Topic with @special #chars & more!!!");
  });

  it("should include topic name in plan header", async () => {
    const { formatResearchPlan } = await import("../../extensions/commands/research-format.js");

    const plan = formatResearchPlan("a very very very long research topic", "{}");

    expect(plan).toContain("Research Plan: a very very very long research topic");
  });

  it("should include completion criteria checklist without subdirectory reference", async () => {
    const { formatResearchPlan } = await import("../../extensions/commands/research-format.js");

    const plan = formatResearchPlan("test topic", "{}");

    expect(plan).toContain("- [ ] WHY question has ≥1 sourced answer");
    expect(plan).toContain("- [ ] HOW question has ≥1 sourced answer");
    expect(plan).toContain("- [ ] ≤5 search rounds used");
    // Should not prescribe a subdirectory convention
    expect(plan).not.toContain("atomic notes created in");
    expect(plan).not.toContain("research-test-topic-");
  });

  it("should include confidence scoring rubric", async () => {
    const { formatResearchPlan } = await import("../../extensions/commands/research-format.js");

    const plan = formatResearchPlan("test topic", "{}");

    expect(plan).toContain("High");
    expect(plan).toContain("Moderate");
    expect(plan).toContain("Low");
    expect(plan).toContain("peer-reviewed");
  });

  it("should include flat atomic note guidance without subdirectory convention", async () => {
    const { formatResearchPlan } = await import("../../extensions/commands/research-format.js");

    const plan = formatResearchPlan("sleep and memory", "{}");

    // Should not prescribe a subdirectory per topic
    expect(plan).not.toContain("research-sleep-and-memory-");
    expect(plan).not.toContain("-executive-summary");
    // Should still mention atomic notes generally
    expect(plan).toContain("atomic note");
    // Should mention the agent decides the PARA directory per note
    expect(plan).toContain("PARA");
    expect(plan).toContain("Resources");
    expect(plan).toContain("Areas");
    expect(plan).toContain("Projects");
  });

  it("should include batch creation guidance in the plan", async () => {
    const { formatResearchPlan } = await import("../../extensions/commands/research-format.js");

    const plan = formatResearchPlan("integrated farming", "{}");

    expect(plan).toContain("batch_create_para_docs");
  });

  it("should not include commit step with commit_changes", async () => {
    const { formatResearchPlan } = await import("../../extensions/commands/research-format.js");

    const plan = formatResearchPlan("dopamine and motivation", "{}");

    expect(plan).not.toContain("commit_changes");
    expect(plan).not.toContain("commit_amend");
    expect(plan).not.toContain("docs:");
  });

  it("should include atomicity split guidance and flat PARA guidance in the plan", async () => {
    const { formatResearchPlan } = await import("../../extensions/commands/research-format.js");

    const plan = formatResearchPlan("integrated farming", "{}");

    expect(plan).toContain("split it into multiple atomic notes");
    // Should guide the agent to decide per-note which directory fits
    expect(plan).toContain("decides per-note");
  });
});

// ── RESEARCH_SUFFICIENCY_PROMPT content ────────────────────────────

describe("RESEARCH_SUFFICIENCY_PROMPT", () => {
  it("should be stricter than the generic sufficiency prompt", async () => {
    const { RESEARCH_SUFFICIENCY_PROMPT } =
      await import("../../extensions/commands/research-llm.js");

    // Must use stricter language about exhaustive coverage
    expect(RESEARCH_SUFFICIENCY_PROMPT).toContain("exhaustive");
    expect(RESEARCH_SUFFICIENCY_PROMPT).toContain("partial");
  });

  it("should instruct multi-note decomposition via notes[]", async () => {
    const { RESEARCH_SUFFICIENCY_PROMPT } =
      await import("../../extensions/commands/research-llm.js");

    expect(RESEARCH_SUFFICIENCY_PROMPT).toContain("notes[]");
    expect(RESEARCH_SUFFICIENCY_PROMPT).toContain("6 paragraphs");
    expect(RESEARCH_SUFFICIENCY_PROMPT).toContain("3 headings");
  });

  it("should forbid markdown code fences with negative examples", async () => {
    const { RESEARCH_SUFFICIENCY_PROMPT } =
      await import("../../extensions/commands/research-llm.js");

    // Must explicitly tell the LLM not to use markdown code fences
    expect(RESEARCH_SUFFICIENCY_PROMPT).toContain("DO NOT");
    expect(RESEARCH_SUFFICIENCY_PROMPT).toContain("```");
    expect(RESEARCH_SUFFICIENCY_PROMPT).toContain("❌ Bad");
    expect(RESEARCH_SUFFICIENCY_PROMPT).toContain("✅ Good");
  });

  it("should forbid any explanatory text before or after JSON", async () => {
    const { RESEARCH_SUFFICIENCY_PROMPT } =
      await import("../../extensions/commands/research-llm.js");

    expect(RESEARCH_SUFFICIENCY_PROMPT).toContain("explanatory text");
  });
});

// ── SufficiencyResult type shape ──────────────────────────────────

describe("SufficiencyResult type", () => {
  it("should export notes-aware types and strict prompt", async () => {
    const mod = await import("../../extensions/commands/research-llm.js");

    // Runtime check: verify the module exports the expected items
    expect(mod.SUFFICIENCY_PROMPT).toBeDefined();
    expect(mod.RESEARCH_SUFFICIENCY_PROMPT).toBeDefined();
  });

  it("should preserve legacy single-note fields for backward compat", async () => {
    const mod = await import("../../extensions/commands/research-llm.js");

    // Check that the SUFFICIENCY_PROMPT still mentions createNote
    expect(mod.SUFFICIENCY_PROMPT).toContain("createNote");
    expect(mod.SUFFICIENCY_PROMPT).toContain("noteTitle");
    expect(mod.SUFFICIENCY_PROMPT).toContain("noteContent");
  });

  it("should also forbid markdown code fences in generic SUFFICIENCY_PROMPT", async () => {
    const { SUFFICIENCY_PROMPT } = await import("../../extensions/commands/research-llm.js");

    expect(SUFFICIENCY_PROMPT).toContain("DO NOT");
    expect(SUFFICIENCY_PROMPT).toContain("✅ Good");
    expect(SUFFICIENCY_PROMPT).toContain("❌ Bad");
  });
});
