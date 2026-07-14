/**
 * Tests for common/llm.ts — shared LLM utilities.
 *
 * Tests cover:
 * - parseJsonResponse: strips markdown fences and parses JSON
 * - callLlmDirect: direct LLM call without TUI components
 *
 * @module tests/common/llm.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@earendil-works/pi-ai", () => ({
  complete: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

const MOCK_USAGE = {
  input: 10,
  output: 20,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 30,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

describe("parseJsonResponse", () => {
  it("should parse plain JSON object", async () => {
    const { parseJsonResponse } = await import("../../common/llm.js");
    const result = parseJsonResponse<{ key: string }>('{"key": "value"}');
    expect(result).toEqual({ key: "value" });
  });

  it("should strip markdown code fences and parse", async () => {
    const { parseJsonResponse } = await import("../../common/llm.js");
    const text = '```json\n{"key": "value"}\n```';
    const result = parseJsonResponse<{ key: string }>(text);
    expect(result).toEqual({ key: "value" });
  });

  it("should strip code fences without language tag", async () => {
    const { parseJsonResponse } = await import("../../common/llm.js");
    const text = '```\n{"key": "value"}\n```';
    const result = parseJsonResponse<{ key: string }>(text);
    expect(result).toEqual({ key: "value" });
  });

  it("should return null for invalid JSON", async () => {
    const { parseJsonResponse } = await import("../../common/llm.js");
    const result = parseJsonResponse("not json at all");
    expect(result).toBeNull();
  });

  it("should return null for empty string", async () => {
    const { parseJsonResponse } = await import("../../common/llm.js");
    const result = parseJsonResponse("");
    expect(result).toBeNull();
  });

  it("should handle JSON with surrounding whitespace but no fences", async () => {
    const { parseJsonResponse } = await import("../../common/llm.js");
    const result = parseJsonResponse<{ a: number }>('  {"a": 1}  ');
    expect(result).toEqual({ a: 1 });
  });

  it("should handle code fences with leading/trailing text", async () => {
    const { parseJsonResponse } = await import("../../common/llm.js");
    const text = 'Here is the result:\n```json\n{"valid": true}\n```\nEnd.';
    const result = parseJsonResponse<{ valid: boolean }>(text);
    expect(result).toEqual({ valid: true });
  });
});

describe("callLlmDirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return ok:true with parsed value on successful LLM call", async () => {
    const { complete } = await import("@earendil-works/pi-ai");
    vi.mocked(complete).mockResolvedValue({
      role: "assistant",
      content: [{ type: "text", text: '{"valid":true}' }],
      stopReason: "stop",
      api: "openai-responses",
      provider: "openai",
      model: "gpt-4o",
      timestamp: Date.now(),
      usage: MOCK_USAGE,
    } as never);

    const { callLlmDirect } = await import("../../common/llm.js");
    const result = await callLlmDirect(
      { id: "test-model", provider: "test" } as never,
      { apiKey: "sk-test" },
      "You are a test.",
      [{ type: "text", text: "test" }],
      (text) => JSON.parse(text) as { valid: boolean },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ valid: true });
    }
  });

  it("should return error when LLM returns invalid JSON", async () => {
    const { complete } = await import("@earendil-works/pi-ai");
    vi.mocked(complete).mockResolvedValue({
      role: "assistant",
      content: [{ type: "text", text: "Not JSON at all" }],
      stopReason: "stop",
      api: "openai-responses",
      provider: "openai",
      model: "gpt-4o",
      timestamp: Date.now(),
      usage: MOCK_USAGE,
    } as never);

    const { callLlmDirect } = await import("../../common/llm.js");
    const result = await callLlmDirect(
      { id: "test-model", provider: "test" } as never,
      { apiKey: "sk-test" },
      "system prompt",
      [{ type: "text", text: "test" }],
      () => null,
    );

    expect(result.ok).toBe(false);
    if (!result.ok && result.type === "error") {
      expect(result.message).toBe("LLM returned invalid JSON");
    }
  });

  it("should return cancelled when LLM response is aborted", async () => {
    const { complete } = await import("@earendil-works/pi-ai");
    vi.mocked(complete).mockResolvedValue({
      role: "assistant",
      content: [],
      stopReason: "aborted",
      api: "openai-responses",
      provider: "openai",
      model: "gpt-4o",
      timestamp: Date.now(),
      usage: MOCK_USAGE,
    } as never);

    const { callLlmDirect } = await import("../../common/llm.js");
    const result = await callLlmDirect(
      { id: "test-model", provider: "test" } as never,
      { apiKey: "sk-test" },
      "system prompt",
      [{ type: "text", text: "test" }],
      vi.fn(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.type).toBe("cancelled");
    }
  });

  it("should return error when complete() throws", async () => {
    const { complete } = await import("@earendil-works/pi-ai");
    vi.mocked(complete).mockRejectedValue(new Error("Network error"));

    const { callLlmDirect } = await import("../../common/llm.js");
    const result = await callLlmDirect(
      { id: "test-model", provider: "test" } as never,
      { apiKey: "sk-test" },
      "system prompt",
      [{ type: "text", text: "test" }],
      vi.fn(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok && result.type === "error") {
      expect(result.message).toBe("Network error");
    }
  });

  it("should pass signal to complete when provided", async () => {
    const { complete } = await import("@earendil-works/pi-ai");
    vi.mocked(complete).mockResolvedValue({
      role: "assistant",
      content: [{ type: "text", text: "{}" }],
      stopReason: "stop",
      api: "openai-responses",
      provider: "openai",
      model: "gpt-4o",
      timestamp: Date.now(),
      usage: MOCK_USAGE,
    } as never);

    const { callLlmDirect } = await import("../../common/llm.js");
    const abortController = new AbortController();
    await callLlmDirect(
      { id: "test-model", provider: "test" } as never,
      { apiKey: "sk-test" },
      "system prompt",
      [{ type: "text", text: "test" }],
      () => ({}),
      abortController.signal,
    );

    expect(vi.mocked(complete).mock.calls[0][2]?.signal).toBe(abortController.signal);
  });
});
