/**
 * Tests for validateDocumentsAtomicity — batch variant (incl. T12 warnings).
 *
 * @module tests/common/atomicity-batch.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { CreateAgentSessionResult } from "@earendil-works/pi-coding-agent";

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
    agent: { state: { systemPrompt: "" } },
    subscribe: vi.fn((cb: SubscribeCallback) => {
      callbacks.push(cb);
      return () => {};
    }),
    prompt: vi.fn(() => {
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

  it("should list per-doc warnings instead of rejecting when sub-agent fails (T12)", async () => {
    const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
    vi.mocked(createAgentSession).mockRejectedValue(new Error("Rate limited"));

    const { validateDocumentsAtomicity } = await import("../../common/atomicity.js");
    const docs = [
      { title: "Doc 1", content: "Content 1", tags: ["t1"] },
      { title: "Doc 2", content: "Content 2", tags: ["t2"] },
    ];

    const results = await validateDocumentsAtomicity(docs, { id: "test" } as never);

    expect(results).toHaveLength(2);
    expect(results[0].valid).toBe(true);
    expect(results[1].valid).toBe(true);
    expect(results[0].warning).toBe("atomicity unverified: Rate limited");
    expect(results[1].warning).toBe("atomicity unverified: Rate limited");
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
