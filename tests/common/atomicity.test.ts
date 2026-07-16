/**
 * Tests for common/atomicity.ts — sub-agent atomicity validation.
 *
 * Uses createAgentSession from the pi SDK to spawn a minimal sub-agent
 * for evaluation. The tests mock createAgentSession to return
 * predetermined responses.
 *
 * @module tests/common/atomicity.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { CreateAgentSessionResult } from "@earendil-works/pi-coding-agent";

// Mock the pi SDK's createAgentSession
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...actual,
    createAgentSession: vi.fn(),
  };
});

interface SubscribeCallback {
  (event: { type: string; assistantMessageEvent?: { type: string; delta: string } }): void;
}

function makeSessionMock(responseText: string) {
  const callbacks: SubscribeCallback[] = [];
  const session = {
    agent: {
      state: {
        systemPrompt: "",
      },
    },
    subscribe: vi.fn((cb: SubscribeCallback) => {
      callbacks.push(cb);
      return () => {}; // unsubscribe no-op
    }),
    prompt: vi.fn(() => {
      // Simulate streaming the full response as a single delta
      for (const cb of callbacks) {
        cb({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: responseText },
        });
      }
      return Promise.resolve();
    }),
    dispose: vi.fn(),
  };
  return { session, callbacks } as unknown as CreateAgentSessionResult;
}

describe("validateAtomicity — sub-agent Q&A check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should spawn sub-agent with content and return valid result", async () => {
    const { createAgentSession } = await import("@earendil-works/pi-coding-agent");

    const mock = makeSessionMock(
      JSON.stringify({ valid: true, message: "Single coherent topic." }),
    );
    vi.mocked(createAgentSession).mockResolvedValue(mock);

    const { validateAtomicity } = await import("../../common/atomicity.js");
    const result = await validateAtomicity(
      "## Summary\n\nA 2018 cross-sectional study found 21.8% prevalence.",
      "Prevalence of Metabolic Syndrome",
      { id: "test-model", provider: "anthropic", name: "claude-3" } as never,
    );

    expect(createAgentSession).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(mock.session.prompt).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(mock.session.dispose).toHaveBeenCalledOnce();
    expect(result.valid).toBe(true);
    expect(result.message).toBe("Single coherent topic.");
  });

  it("should return invalid with suggested splits when LLM finds multiple Q&A pairs", async () => {
    const { createAgentSession } = await import("@earendil-works/pi-coding-agent");

    const response = JSON.stringify({
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
    });
    const mock = makeSessionMock(response);
    vi.mocked(createAgentSession).mockResolvedValue(mock);

    const { validateAtomicity } = await import("../../common/atomicity.js");
    const result = await validateAtomicity(
      "## Quantum Computing\nDetails.\n\n## French Cuisine\nDetails.",
      "Mixed Topics",
      { id: "test-model" } as never,
    );

    expect(result.valid).toBe(false);
    expect(result.suggestedSplits).toHaveLength(2);
    expect(result.suggestedSplits![0].title).toBe("Quantum Computing Basics");
    expect(result.suggestedSplits![0].area).toBe("Resources");
    expect(result.suggestedSplits![1].title).toBe("French Cuisine Overview");
    expect(result.suggestedSplits![1].area).toBe("Areas");
  });

  it("should handle LLM returning invalid result without splits gracefully", async () => {
    const { createAgentSession } = await import("@earendil-works/pi-coding-agent");

    const mock = makeSessionMock(
      JSON.stringify({ valid: false, message: "Multiple topics detected." }),
    );
    vi.mocked(createAgentSession).mockResolvedValue(mock);

    const { validateAtomicity } = await import("../../common/atomicity.js");
    const result = await validateAtomicity("## A\n\n## B\n\n## C", "Topic", {
      id: "test",
    } as never);

    expect(result.valid).toBe(false);
    expect(result.suggestedSplits).toBeUndefined();
    expect(result.message).toBe("Multiple topics detected.");
  });

  it("should fail-closed when sub-agent creation fails", async () => {
    const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
    vi.mocked(createAgentSession).mockRejectedValue(new Error("Infrastructure unavailable"));

    const { validateAtomicity } = await import("../../common/atomicity.js");
    const result = await validateAtomicity("Some content.", "Title", { id: "test" } as never);

    expect(result.valid).toBe(false);
    expect(result.message).toContain("Sub-agent unavailable");
  });

  it("should fail-open when sub-agent returns non-JSON", async () => {
    const { createAgentSession } = await import("@earendil-works/pi-coding-agent");

    const mock = makeSessionMock("I think this content is atomic and valid.");
    vi.mocked(createAgentSession).mockResolvedValue(mock);

    const { validateAtomicity } = await import("../../common/atomicity.js");
    const result = await validateAtomicity("Some content.", "Title", { id: "test" } as never);

    expect(result.valid).toBe(true);
    expect(result.message).toContain("could not be parsed");
  });

  it("should check cancellation signal before spawning sub-agent", async () => {
    const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
    const mock = makeSessionMock("{}");
    vi.mocked(createAgentSession).mockResolvedValue(mock);

    const abortController = new AbortController();
    abortController.abort();

    const { validateAtomicity } = await import("../../common/atomicity.js");
    const result = await validateAtomicity("Content.", "Title", { id: "test" } as never, {
      signal: abortController.signal,
    });

    // Should NOT have created a sub-agent
    expect(createAgentSession).not.toHaveBeenCalled();
    expect(result.valid).toBe(true);
    expect(result.message).toContain("cancelled");
  });
});

describe("validateDocumentsAtomicity — batch variant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call sub-agent once for all docs and return per-doc results", async () => {
    const { createAgentSession } = await import("@earendil-works/pi-coding-agent");

    const response = JSON.stringify([
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
    ]);
    const mock = makeSessionMock(response);
    vi.mocked(createAgentSession).mockResolvedValue(mock);

    const { validateDocumentsAtomicity } = await import("../../common/atomicity.js");
    const docs = [
      { title: "Doc 1", content: "Content 1", tags: ["t1"] },
      { title: "Doc 2", content: "Content 2", tags: ["t2"] },
      { title: "Doc 3", content: "Content 3", tags: ["t3"] },
    ];

    const results = await validateDocumentsAtomicity(docs, { id: "test" } as never);

    expect(createAgentSession).toHaveBeenCalledOnce();
    expect(results).toHaveLength(3);
    expect(results[0].valid).toBe(true);
    expect(results[1].valid).toBe(false);
    expect(results[1].suggestedSplits).toHaveLength(2);
    expect(results[2].valid).toBe(true);
  });

  it("should handle sub-agent creation failure in batch mode (fail-closed all)", async () => {
    const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
    vi.mocked(createAgentSession).mockRejectedValue(new Error("Rate limited"));

    const { validateDocumentsAtomicity } = await import("../../common/atomicity.js");
    const docs = [
      { title: "Doc 1", content: "Content 1", tags: ["t1"] },
      { title: "Doc 2", content: "Content 2", tags: ["t2"] },
    ];

    const results = await validateDocumentsAtomicity(docs, { id: "test" } as never);

    expect(results).toHaveLength(2);
    expect(results[0].valid).toBe(false);
    expect(results[1].valid).toBe(false);
    expect(results[0].message).toContain("Sub-agent unavailable");
  });

  it("should handle non-array JSON response in batch mode (fail-open)", async () => {
    const { createAgentSession } = await import("@earendil-works/pi-coding-agent");

    const mock = makeSessionMock(JSON.stringify({ valid: true, message: "Single response." }));
    vi.mocked(createAgentSession).mockResolvedValue(mock);

    const { validateDocumentsAtomicity } = await import("../../common/atomicity.js");
    const docs = [{ title: "Doc 1", content: "Content 1", tags: ["t1"] }];

    const results = await validateDocumentsAtomicity(docs, { id: "test" } as never);

    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(true);
    expect(results[0].message).toContain("could not be parsed");
  });

  it("should handle empty docs array", async () => {
    const { validateDocumentsAtomicity } = await import("../../common/atomicity.js");
    const results = await validateDocumentsAtomicity([], { id: "test" } as never);
    expect(results).toHaveLength(0);
  });
});

describe("Type exports", () => {
  it("should export AtomicityResult and BatchDoc interfaces", async () => {
    const mod = await import("../../common/atomicity.js");
    expect(mod.validateAtomicity).toBeDefined();
    expect(mod.validateDocumentsAtomicity).toBeDefined();
    expect(typeof mod.validateAtomicity).toBe("function");
    expect(typeof mod.validateDocumentsAtomicity).toBe("function");
  });
});
