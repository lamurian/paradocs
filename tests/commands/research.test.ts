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
      model: undefined,
    } as never);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("No model selected"), "error");
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("should show error when ctx.ui.custom is unavailable (non-TUI mode)", async () => {
    const { createHandler } = await import("../../extensions/commands/research.js");
    const handler = createHandler(mockPi as never);

    await handler("dopamine and motivation", {
      ...mockCtx,
      ui: { notify },
    } as never);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("requires interactive"), "error");
    expect(sendUserMessage).not.toHaveBeenCalled();
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
    const { formatResearchPlan } = await import("../../extensions/commands/research.js");

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
    expect(plan).toContain("research-dopamine-and-motivation");
  });

  it("should generate a safe slug from complex topic", async () => {
    const { formatResearchPlan } = await import("../../extensions/commands/research.js");

    const plan = formatResearchPlan("Complex! Topic with @special #chars & more!!!", "{}");

    expect(plan).toContain("research-complex-topic-with-special-chars-more-");
  });

  it("should truncate slug to 40 characters", async () => {
    const { formatResearchPlan } = await import("../../extensions/commands/research.js");

    const plan = formatResearchPlan(
      "a very very very long research topic that should be truncated aggressively for filenames",
      "{}",
    );

    // The slug should be at most 40 chars
    const slugMatch = plan.match(/research-([\w-]+)-\{/);
    expect(slugMatch).not.toBeNull();
    const slug = slugMatch![1];
    expect(slug.length).toBeLessThanOrEqual(40);
  });

  it("should include completion criteria checklist", async () => {
    const { formatResearchPlan } = await import("../../extensions/commands/research.js");

    const plan = formatResearchPlan("test topic", "{}");

    expect(plan).toContain("- [ ] WHY question has ≥1 sourced answer");
    expect(plan).toContain("- [ ] HOW question has ≥1 sourced answer");
    expect(plan).toContain("- [ ] ≤5 search rounds used");
  });

  it("should include confidence scoring rubric", async () => {
    const { formatResearchPlan } = await import("../../extensions/commands/research.js");

    const plan = formatResearchPlan("test topic", "{}");

    expect(plan).toContain("High");
    expect(plan).toContain("Moderate");
    expect(plan).toContain("Low");
    expect(plan).toContain("peer-reviewed");
  });

  it("should include atomic note naming convention", async () => {
    const { formatResearchPlan } = await import("../../extensions/commands/research.js");

    const plan = formatResearchPlan("sleep and memory", "{}");

    expect(plan).toContain("research-sleep-and-memory-{idea-slug}.md");
    expect(plan).toContain("research-sleep-and-memory-executive-summary.md");
  });
});
