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

describe("callLlmDirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return ok:true with parsed value on successful LLM call", async () => {
    const { complete } = await import("@earendil-works/pi-ai");
    vi.mocked(complete).mockResolvedValue({
      role: "assistant",
      content: [{ type: "text", text: '{"sufficient":true,"answer":"Test answer."}' }],
      stopReason: "stop",
      api: "openai-responses",
      provider: "openai",
      model: "gpt-4o",
      timestamp: Date.now(),
      usage: MOCK_USAGE,
    } as never);

    const { callLlmDirect } = await import("../../extensions/commands/research-llm.js");
    const result = await callLlmDirect(
      { id: "test-model", provider: "test" } as never,
      { apiKey: "sk-test" },
      "You are a research analyst.",
      [{ type: "text", text: "Topic: test topic" }],
      (text) => JSON.parse(text) as { sufficient: boolean; answer: string },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ sufficient: true, answer: "Test answer." });
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

    const { callLlmDirect } = await import("../../extensions/commands/research-llm.js");
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

    const { callLlmDirect } = await import("../../extensions/commands/research-llm.js");
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

    const { callLlmDirect } = await import("../../extensions/commands/research-llm.js");
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

  it("SUFFICIENCY_PROMPT should include freshness guidance", async () => {
    const { SUFFICIENCY_PROMPT } = await import("../../extensions/commands/research-llm.js");
    expect(SUFFICIENCY_PROMPT).toContain("freshness");
    expect(SUFFICIENCY_PROMPT).toContain("outdated");
  });

  it("RESEARCH_SUFFICIENCY_PROMPT should include freshness guidance", async () => {
    const { RESEARCH_SUFFICIENCY_PROMPT } =
      await import("../../extensions/commands/research-llm.js");
    expect(RESEARCH_SUFFICIENCY_PROMPT).toContain("freshness");
    expect(RESEARCH_SUFFICIENCY_PROMPT).toContain("stale");
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

    const { callLlmDirect } = await import("../../extensions/commands/research-llm.js");
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
