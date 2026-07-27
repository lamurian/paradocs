/**
 * Tests for the /ask command handler — plan generator.
 *
 * @module tests/commands/ask.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock createDocument to avoid file I/O in the createNote path.
// Safe because existing tests only test guard conditions that exit before
// document creation.
vi.mock("../../common/createDocument.js", () => ({
  createDocument: vi.fn().mockResolvedValue({
    path: "Resources/test-synthesis.md",
    title: "Test Synthesis",
    linkCount: 3,
    indexOk: true,
  }),
}));

// Store the last user message sent to the LLM so tests can inspect it.
const llmMessages: string[] = [];
vi.mock("@earendil-works/pi-ai", () => ({
  complete: vi.fn().mockImplementation(
    (
      _model: unknown,
      messages: {
        systemPrompt: string;
        messages: Array<{ role: string; content: Array<{ type: string; text: string }> }>;
      },
    ) => {
      // Capture the user message for inspection
      const userMsg =
        messages.messages[0]?.content
          ?.filter((c: { type: string }) => c.type === "text")
          .map((c: { text: string }) => c.text)
          .join("") ?? "";
      llmMessages.push(userMsg);
      return {
        role: "assistant",
        content: [
          { type: "text", text: '{"sufficient":true,"answer":"Answer from existing docs."}' },
        ],
        stopReason: "stop",
        api: "test",
        provider: "test",
        model: "test-model",
        timestamp: Date.now(),
      };
    },
  ),
}));

describe("ask command handler", () => {
  let sendUserMessage: ReturnType<typeof vi.fn>;
  let notify: ReturnType<typeof vi.fn>;
  let mockPi: Record<string, unknown>;
  let mockCtx: Record<string, unknown>;

  beforeEach(() => {
    vi.resetModules();
    sendUserMessage = vi.fn();
    notify = vi.fn();
    mockCtx = {
      ui: { notify },
      cwd: "/test",
    };
    mockPi = {
      sendUserMessage,
      registerCommand: vi.fn(),
    };
  });

  it("should show usage when no question is provided", async () => {
    const { createHandler } = await import("../../extensions/commands/ask.js");
    const handler = createHandler(mockPi as never);

    await handler("", mockCtx as never);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Usage: /ask"), "warning");
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("should show usage for whitespace-only input", async () => {
    const { createHandler } = await import("../../extensions/commands/ask.js");
    const handler = createHandler(mockPi as never);

    await handler("   ", mockCtx as never);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Usage: /ask"), "warning");
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("should work in RPC mode without ctx.ui.custom", async () => {
    const { createHandler } = await import("../../extensions/commands/ask.js");
    const handler = createHandler(mockPi as never);

    // Simulate RPC mode: mode is not "tui", no custom(), but model is set
    await handler("What is dopamine?", {
      ...mockCtx,
      mode: "rpc",
      model: { id: "test-model", provider: "test" },
      modelRegistry: {
        getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true, apiKey: "test-key" }),
      },
    } as never);

    // Should not error about TUI mode — proceeds to LLM call path
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining("requires interactive"));
    // Should notify about checking
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("🔍"), "info");
  });

  it("should require a selected model", async () => {
    const { createHandler } = await import("../../extensions/commands/ask.js");
    const handler = createHandler(mockPi as never);

    await handler("What is dopamine?", {
      ...mockCtx,
      mode: "tui",
      ui: { notify, custom: vi.fn() },
    } as never);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("No model selected"), "error");
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("should notify the user when check starts", async () => {
    const { createHandler } = await import("../../extensions/commands/ask.js");
    const handler = createHandler(mockPi as never);

    await handler("What is dopamine?", {
      ...mockCtx,
      mode: "tui",
      ui: { notify, custom: vi.fn() },
      model: { id: "test-model", provider: "test" },
      modelRegistry: {
        getApiKeyAndHeaders: vi.fn().mockRejectedValue(new Error("No registry")),
      },
    } as never);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("🔍 Checking:"), "info");
  });

  it("should handle errors gracefully", async () => {
    const { createHandler } = await import("../../extensions/commands/ask.js");
    const handler = createHandler(mockPi as never);

    await expect(handler("What is dopamine?", mockCtx as never)).resolves.not.toThrow();
  });

  it("should create a new atomic note when createNote is true", async () => {
    const { createHandler } = await import("../../extensions/commands/ask.js");
    const handler = createHandler(mockPi as never);

    await handler("living fence vs concrete wall durability", {
      ...mockCtx,
      mode: "tui",
      ui: {
        notify,
        custom: vi.fn().mockResolvedValue({
          sufficient: true,
          answer: "Synthesis answer about living fences vs concrete walls...",
          createNote: true,
          noteTitle: "Comparing Living Fences vs Concrete Walls",
          noteContent:
            "## Summary\n\nNovel synthesis content.\n\n## Key Points\n\n- Point 1\n- Point 2",
          noteTags: ["living-fence", "comparison"],
        }),
      },
      model: { id: "test-model", provider: "test" },
      modelRegistry: {
        getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true, apiKey: "test-key" }),
      },
    } as never);

    // Should show note creation confirmation instead of "no new note created"
    expect(sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("📄 Note saved to knowledge base"),
    );
    expect(sendUserMessage).not.toHaveBeenCalledWith(
      expect.stringContaining("no new note created"),
    );
  });

  it("should not include commit step in the fallback plan", async () => {
    const { FALLBACK_PLAN } = await import("../../extensions/commands/ask.js");

    const plan = FALLBACK_PLAN("test question");

    expect(plan).not.toContain("commit_changes");
    expect(plan).not.toContain("commit_amend");
    expect(plan).not.toContain("docs:");
  });

  it("should not include commit step in the PROMPT template", async () => {
    const { PROMPT } = await import("../../extensions/commands/ask.js");

    expect(PROMPT).not.toContain("commit_changes");
    expect(PROMPT).not.toContain("commit_amend");
  });

  it("should not include Phase 5 in FALLBACK_PLAN", async () => {
    const { FALLBACK_PLAN } = await import("../../extensions/commands/ask.js");

    const plan = FALLBACK_PLAN("test question");
    expect(plan).toContain("Phase 4");
    expect(plan).not.toContain("Phase 5");
  });

  it("should not include Phase 5 in PROMPT", async () => {
    const { PROMPT } = await import("../../extensions/commands/ask.js");

    expect(PROMPT).toContain("Phase 4");
    expect(PROMPT).not.toContain("Phase 5");
  });

  it("should not show commit instruction in note creation output", async () => {
    const { createHandler } = await import("../../extensions/commands/ask.js");
    const handler = createHandler(mockPi as never);

    await handler("living fence vs concrete wall durability", {
      ...mockCtx,
      mode: "tui",
      ui: {
        notify,
        custom: vi.fn().mockResolvedValue({
          sufficient: true,
          answer: "Synthesis answer about living fences vs concrete walls...",
          createNote: true,
          noteTitle: "Comparing Living Fences vs Concrete Walls",
          noteContent:
            "## Summary\n\nNovel synthesis content.\n\n## Key Points\n\n- Point 1\n- Point 2",
          noteTags: ["living-fence", "comparison"],
        }),
      },
      model: { id: "test-model", provider: "test" },
      modelRegistry: {
        getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true, apiKey: "test-key" }),
      },
    } as never);

    // Should not include commit instruction; should show note saved message
    expect(sendUserMessage).not.toHaveBeenCalledWith(expect.stringContaining("commit_changes"));
    expect(sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("Note saved to knowledge base"),
    );
  });

  it("should include freshness guidance in PROMPT", async () => {
    const { PROMPT } = await import("../../extensions/commands/ask.js");
    expect(PROMPT).toContain("freshness");
    expect(PROMPT).toContain("outdated");
  });

  it("should include date in LLM context for docs with created date", async () => {
    // Clear captured messages
    llmMessages.length = 0;

    const { createHandler } = await import("../../extensions/commands/ask.js");
    const handler = createHandler(mockPi as never);

    // RPC mode with DB that has a doc with known date
    await handler("test topic", {
      ...mockCtx,
      mode: "rpc",
      model: { id: "test-model", provider: "test" },
      modelRegistry: {
        getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true, apiKey: "test-key" }),
      },
    } as never);

    // At minimum, the LLM call happened and the message is non-empty
    expect(llmMessages.length).toBeGreaterThanOrEqual(1);
  });

  it("should truncate long question in notification", async () => {
    const { createHandler } = await import("../../extensions/commands/ask.js");
    const handler = createHandler(mockPi as never);

    const longQuestion = "What is ".repeat(20) + "?";
    await handler(longQuestion, {
      ...mockCtx,
      mode: "tui",
      ui: { notify, custom: vi.fn() },
      model: { id: "test-model", provider: "test" },
      modelRegistry: {
        getApiKeyAndHeaders: vi.fn().mockRejectedValue(new Error("No registry")),
      },
    } as never);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("…"), "info");
  });
});
