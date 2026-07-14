/**
 * Tests for common/atomicity.ts — AI-based atomicity validation.
 *
 * The old keyword-overlap heuristic is removed. Atomicity is now
 * determined by an LLM call that evaluates whether the content
 * serves exactly one question (implicit/explicit) and one answer.
 *
 * @module tests/common/atomicity.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock callLlmDirect from the shared LLM module
vi.mock("../../common/llm.js", () => ({
  callLlmDirect: vi.fn(),
  parseJsonResponse: vi.fn(),
  LlmCallResult: {},
}));

describe("validateAtomicity — AI-based Q&A check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call LLM with the content and return valid result", async () => {
    const { callLlmDirect } = await import("../../common/llm.js");
    vi.mocked(callLlmDirect).mockResolvedValue({
      ok: true,
      value: { valid: true, message: "Single coherent topic." },
    });

    const { validateAtomicity } = await import("../../common/atomicity.js");
    const result = await validateAtomicity("## Summary\n\nSome content.", "Test Title");

    expect(callLlmDirect).toHaveBeenCalledOnce();
    expect(result.valid).toBe(true);
    expect(result.message).toBe("Single coherent topic.");
  });

  it("should return invalid with suggested splits when LLM finds multiple Q&A pairs", async () => {
    const { callLlmDirect } = await import("../../common/llm.js");
    vi.mocked(callLlmDirect).mockResolvedValue({
      ok: true,
      value: {
        valid: false,
        message: "Found 2 distinct Q&A pairs.",
        suggestedSplits: [
          {
            title: "Quantum Computing Basics",
            content: "Content about quantum computing.",
            tags: ["quantum"],
            area: "Resources",
          },
          {
            title: "French Cuisine Overview",
            content: "Content about French cuisine.",
            tags: ["cuisine"],
            area: "Areas",
          },
        ],
      },
    });

    const { validateAtomicity } = await import("../../common/atomicity.js");
    const result = await validateAtomicity(
      "## Quantum Computing\nDetails.\n\n## French Cuisine\nDetails.",
      "Mixed Topics",
    );

    expect(result.valid).toBe(false);
    expect(result.suggestedSplits).toHaveLength(2);
    expect(result.suggestedSplits![0].title).toBe("Quantum Computing Basics");
    expect(result.suggestedSplits![0].area).toBe("Resources");
    expect(result.suggestedSplits![1].title).toBe("French Cuisine Overview");
    expect(result.suggestedSplits![1].area).toBe("Areas");
  });

  it("should handle LLM returning invalid result without splits gracefully", async () => {
    const { callLlmDirect } = await import("../../common/llm.js");
    vi.mocked(callLlmDirect).mockResolvedValue({
      ok: true,
      value: {
        valid: false,
        message: "Multiple topics detected.",
      },
    });

    const { validateAtomicity } = await import("../../common/atomicity.js");
    const result = await validateAtomicity("## A\n\n## B\n\n## C", "Topic");

    expect(result.valid).toBe(false);
    expect(result.suggestedSplits).toBeUndefined();
    expect(result.message).toBe("Multiple topics detected.");
  });

  it("should handle LLM call error gracefully", async () => {
    const { callLlmDirect } = await import("../../common/llm.js");
    vi.mocked(callLlmDirect).mockResolvedValue({
      ok: false,
      type: "error",
      message: "Network error",
    });

    const { validateAtomicity } = await import("../../common/atomicity.js");
    const result = await validateAtomicity("Some content.", "Title");

    // On LLM failure, pass the content through (fail-open)
    expect(result.valid).toBe(true);
    expect(result.message).toContain("LLM check unavailable");
  });

  it("should handle LLM cancellation gracefully (fail-open)", async () => {
    const { callLlmDirect } = await import("../../common/llm.js");
    vi.mocked(callLlmDirect).mockResolvedValue({
      ok: false,
      type: "cancelled",
    });

    const { validateAtomicity } = await import("../../common/atomicity.js");
    const result = await validateAtomicity("Some content.", "Title");

    expect(result.valid).toBe(true);
    expect(result.message).toContain("LLM check cancelled");
  });

  it("should pass model, auth, and signal from context", async () => {
    const { callLlmDirect } = await import("../../common/llm.js");
    vi.mocked(callLlmDirect).mockResolvedValue({
      ok: true,
      value: { valid: true, message: "OK." },
    });

    const { validateAtomicity } = await import("../../common/atomicity.js");
    const signal = new AbortController().signal;
    await validateAtomicity("Content.", "Title", {
      model: {
        id: "gpt-4o",
        provider: "openai",
        name: "gpt-4o",
        api: "test",
        baseUrl: "https://test.com",
        reasoning: false,
      } as never,
      apiKey: "sk-test",
      signal,
    });

    expect(callLlmDirect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "gpt-4o" }),
      expect.objectContaining({ apiKey: "sk-test" }),
      expect.any(String),
      expect.any(Array),
      expect.any(Function),
      signal,
    );
  });
});

describe("validateDocumentsAtomicity — batch variant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call LLM once for all docs and return per-doc results", async () => {
    const { callLlmDirect } = await import("../../common/llm.js");
    vi.mocked(callLlmDirect).mockResolvedValue({
      ok: true,
      value: [
        { valid: true, message: "Single topic." },
        {
          valid: false,
          message: "Found 2 Q&A pairs.",
          suggestedSplits: [
            { title: "Sub A", content: "A", tags: ["a"], area: "Resources" },
            { title: "Sub B", content: "B", tags: ["b"], area: "Areas" },
          ],
        },
        { valid: true, message: "Single topic." },
      ],
    });

    const { validateDocumentsAtomicity } = await import("../../common/atomicity.js");
    const docs = [
      { title: "Doc 1", content: "Content 1", tags: ["t1"] },
      { title: "Doc 2", content: "Content 2", tags: ["t2"] },
      { title: "Doc 3", content: "Content 3", tags: ["t3"] },
    ];

    const results = await validateDocumentsAtomicity(docs);

    expect(callLlmDirect).toHaveBeenCalledOnce();
    expect(results).toHaveLength(3);
    expect(results[0].valid).toBe(true);
    expect(results[1].valid).toBe(false);
    expect(results[1].suggestedSplits).toHaveLength(2);
    expect(results[2].valid).toBe(true);
  });

  it("should handle LLM error in batch mode (fail-open all)", async () => {
    const { callLlmDirect } = await import("../../common/llm.js");
    vi.mocked(callLlmDirect).mockResolvedValue({
      ok: false,
      type: "error",
      message: "Rate limited",
    });

    const { validateDocumentsAtomicity } = await import("../../common/atomicity.js");
    const docs = [
      { title: "Doc 1", content: "Content 1", tags: ["t1"] },
      { title: "Doc 2", content: "Content 2", tags: ["t2"] },
    ];

    const results = await validateDocumentsAtomicity(docs);

    expect(results).toHaveLength(2);
    expect(results[0].valid).toBe(true);
    expect(results[1].valid).toBe(true);
  });

  it("should handle cancellation in batch mode (fail-open all)", async () => {
    const { callLlmDirect } = await import("../../common/llm.js");
    vi.mocked(callLlmDirect).mockResolvedValue({
      ok: false,
      type: "cancelled",
    });

    const { validateDocumentsAtomicity } = await import("../../common/atomicity.js");
    const docs = [{ title: "Doc 1", content: "Content 1", tags: ["t1"] }];

    const results = await validateDocumentsAtomicity(docs);

    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(true);
  });

  it("should handle non-array LLM response in batch mode", async () => {
    const { callLlmDirect } = await import("../../common/llm.js");
    vi.mocked(callLlmDirect).mockResolvedValue({
      ok: true,
      value: { valid: true, message: "Unexpected single response." },
    });

    const { validateDocumentsAtomicity } = await import("../../common/atomicity.js");
    const docs = [{ title: "Doc 1", content: "Content 1", tags: ["t1"] }];

    const results = await validateDocumentsAtomicity(docs);

    // Should degrade gracefully — treat as one valid result
    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(false);
    expect(results[0].message).toContain("Unexpected");
  });
});

describe("AtomicityResult type exports", () => {
  it("should export the AtomicityResult interface", async () => {
    const mod = await import("../../common/atomicity.js");
    // Runtime check: imported function exists with the right signature
    expect(mod.validateAtomicity).toBeDefined();
    expect(mod.validateDocumentsAtomicity).toBeDefined();
    expect(typeof mod.validateAtomicity).toBe("function");
    expect(typeof mod.validateDocumentsAtomicity).toBe("function");
  });
});
