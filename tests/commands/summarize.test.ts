/**
 * Tests for the /summarize command — formatSummarizePrompt output.
 *
 * @module tests/commands/summarize.test
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

describe("summarize command handler", () => {
  let sendUserMessage: ReturnType<typeof vi.fn>;
  let notify: ReturnType<typeof vi.fn>;
  let mockPi: Record<string, unknown>;
  let mockCtx: Record<string, unknown>;

  beforeEach(() => {
    sendUserMessage = vi.fn();
    notify = vi.fn();
    mockCtx = { ui: { notify }, cwd: "/test" };
    mockPi = { sendUserMessage, registerCommand: vi.fn() };
  });

  it("should show usage when no URL is provided", async () => {
    const { createHandler } = await import("../../extensions/commands/summarize.js");
    const handler = createHandler(mockPi as never);

    await handler("", mockCtx as never);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Usage: /summarize"), "warning");
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("should show usage for whitespace-only input", async () => {
    const { createHandler } = await import("../../extensions/commands/summarize.js");
    const handler = createHandler(mockPi as never);

    await handler("   ", mockCtx as never);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Usage: /summarize"), "warning");
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("should send a summarization prompt for a valid URL", async () => {
    const { createHandler } = await import("../../extensions/commands/summarize.js");
    const handler = createHandler(mockPi as never);

    await handler("https://example.com/article", mockCtx as never);

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    expect(sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("Please summarise the following URL"),
    );
  });
});

describe("formatSummarizePrompt", () => {
  // Import once and reuse to avoid vi.resetModules() interference.
  let formatSummarizePrompt: (url: string) => string;
  let module: { formatSummarizePrompt: (url: string) => string };

  beforeAll(async () => {
    module = await import("../../extensions/commands/summarize.js");
    formatSummarizePrompt = module.formatSummarizePrompt;
  });

  it("should not include a commit step with commit_changes", () => {
    const prompt = formatSummarizePrompt("https://example.com/article");
    expect(prompt).not.toContain("commit_changes");
  });

  it("should not include commit_amend guideline for iterative work", () => {
    const prompt = formatSummarizePrompt("https://example.com/article");
    expect(prompt).not.toContain("commit_amend");
  });

  it("should not use docs: prefix in the commit message", () => {
    const prompt = formatSummarizePrompt("https://example.com/article");
    expect(prompt).not.toContain("docs:");
  });

  it("should have auto-link as the last step before proceeding", () => {
    const prompt = formatSummarizePrompt("https://example.com/article");

    // Step 7 (auto-link) should be the last numbered step, no step 8
    expect(prompt).toContain("7. **Auto-link**");
    expect(prompt).not.toContain("8. **Commit**");
    expect(prompt).toContain("Proceed step by step");
  });
});
