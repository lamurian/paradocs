/**
 * Tests for the /ask command handler — deterministic JS orchestrator.
 *
 * @module tests/commands/ask.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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

  it("should require TUI mode (ctx.ui.custom must be a function)", async () => {
    const { createHandler } = await import("../../extensions/commands/ask.js");
    const handler = createHandler(mockPi as never);

    await handler("What is dopamine?", mockCtx as never);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("requires interactive (TUI) mode"),
      "error",
    );
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("should require a selected model", async () => {
    const { createHandler } = await import("../../extensions/commands/ask.js");
    const handler = createHandler(mockPi as never);

    await handler("What is dopamine?", {
      ...mockCtx,
      ui: { notify, custom: vi.fn() },
    } as never);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("No model selected"), "error");
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("should notify the user when research starts", async () => {
    const { createHandler } = await import("../../extensions/commands/ask.js");
    const handler = createHandler(mockPi as never);

    // With TUI mode and model, but no modelRegistry — will hit an error
    // before the orchestration starts
    await handler("What is dopamine?", {
      ...mockCtx,
      ui: { notify, custom: vi.fn() },
      model: { id: "test-model", provider: "test" },
      modelRegistry: {
        getApiKeyAndHeaders: vi.fn().mockRejectedValue(new Error("No registry")),
      },
    } as never);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("🔍 Researching"), "info");
  });

  it("should handle errors gracefully", async () => {
    // Since handler uses ctx.ui.custom that returns immediately with the mock,
    // this test verifies the outer try/catch doesn't throw
    const { createHandler } = await import("../../extensions/commands/ask.js");
    const handler = createHandler(mockPi as never);

    // Should not throw even with minimal mock
    await expect(handler("What is dopamine?", mockCtx as never)).resolves.not.toThrow();
  });

  it("should truncate long question in notification", async () => {
    const { createHandler } = await import("../../extensions/commands/ask.js");
    const handler = createHandler(mockPi as never);

    const longQuestion = "What is ".repeat(20) + "?";
    await handler(longQuestion, {
      ...mockCtx,
      ui: { notify, custom: vi.fn() },
      model: { id: "test-model", provider: "test" },
      modelRegistry: {
        getApiKeyAndHeaders: vi.fn().mockRejectedValue(new Error("No registry")),
      },
    } as never);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("…"), "info");
  });
});
