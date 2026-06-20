/**
 * Tests for the /ask command handler.
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

  it("should send structured research prompt via sendUserMessage", async () => {
    const { createHandler } = await import("../../extensions/commands/ask.js");
    const handler = createHandler(mockPi as never);

    await handler("What is dopamine?", mockCtx as never);

    // Should notify the user
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("🔍 Researching"), "info");

    // Should send structured prompt
    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    const prompt = sendUserMessage.mock.calls[0][0] as string;
    expect(prompt).toContain("QUESTION: What is dopamine?");
    expect(prompt).toContain("search_para_docs");
    expect(prompt).toContain("web_search");
    expect(prompt).toContain("fetch_url");
    expect(prompt).toContain("create_para_doc");
    expect(prompt).toContain("resolve_citation");
    expect(prompt).toContain("Proceed step by step");
  });

  it("should handle errors gracefully", async () => {
    // Simulate a synchronous throw from sendUserMessage
    sendUserMessage.mockImplementationOnce(() => {
      throw new Error("Network error");
    });

    const { createHandler } = await import("../../extensions/commands/ask.js");
    const handler = createHandler(mockPi as never);

    await handler("What is dopamine?", mockCtx as never);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("❌"), "error");
  });

  it("should truncate long question in notification", async () => {
    const { createHandler } = await import("../../extensions/commands/ask.js");
    const handler = createHandler(mockPi as never);

    const longQuestion = "What is ".repeat(20) + "?";
    await handler(longQuestion, mockCtx as never);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("…"), "info");
  });
});
