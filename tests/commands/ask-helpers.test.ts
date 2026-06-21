/**
 * Tests for ask-helpers.ts — merged LLM helpers for the /ask command.
 *
 * Tests the new evaluateAndPlan and planNextRound functions.
 *
 * @module tests/commands/ask-helpers.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const TEST_MODEL = {
  id: "test",
  provider: "test",
  name: "Test Model",
  api: "openai",
  baseUrl: "https://api.example.com",
  reasoning: false,
  config: {},
  apiKey: "",
  headers: {},
} as const;

describe("evaluateAndPlan", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should return needWebSearch=false when PARA docs are sufficient", async () => {
    vi.doMock("@earendil-works/pi-ai", () => ({
      complete: vi.fn().mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              needWebSearch: false,
              reasoning: "Existing docs fully answer the question.",
              queries: [],
            }),
          },
        ],
      }),
    }));

    const { evaluateAndPlan } = await import("../../extensions/commands/ask-helpers.js");

    const result = await evaluateAndPlan(
      "What is dopamine?",
      [
        {
          title: "Dopamine Basics",
          path: "Resources/dopamine.md",
          snippet: "Dopamine is a neurotransmitter...",
        },
      ],
      { model: TEST_MODEL as never, apiKey: "sk-test" },
    );

    expect(result.needWebSearch).toBe(false);
    expect(result.reasoning).toContain("Existing docs");
  });

  it("should return needWebSearch=true with queries when PARA docs are insufficient", async () => {
    vi.doMock("@earendil-works/pi-ai", () => ({
      complete: vi.fn().mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              needWebSearch: true,
              reasoning: "Need latest prices from web sources.",
              queries: ["ThinkCentre M720q specifications price", "ThinkCentre M920q power draw"],
            }),
          },
        ],
      }),
    }));

    const { evaluateAndPlan } = await import("../../extensions/commands/ask-helpers.js");

    const result = await evaluateAndPlan("ThinkCentre M720q vs M920q", [], {
      model: TEST_MODEL as never,
      apiKey: "sk-test",
    });

    expect(result.needWebSearch).toBe(true);
    expect(result.queries.length).toBeGreaterThan(0);
    expect(result.queries[0]).toContain("ThinkCentre");
  });

  it("should fall back to needWebSearch=true on parse error", async () => {
    vi.doMock("@earendil-works/pi-ai", () => ({
      complete: vi.fn().mockResolvedValue({
        content: [
          {
            type: "text",
            text: "Not JSON at all",
          },
        ],
      }),
    }));

    const { evaluateAndPlan } = await import("../../extensions/commands/ask-helpers.js");

    const result = await evaluateAndPlan("test question", [], {
      model: TEST_MODEL as never,
      apiKey: "sk-test",
    });

    expect(result.needWebSearch).toBe(true);
    expect(result.queries.length).toBeGreaterThan(0);
  });
});

describe("planNextRound", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should return done=true when enough information gathered", async () => {
    vi.doMock("@earendil-works/pi-ai", () => ({
      complete: vi.fn().mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              queries: [],
              done: true,
              reasoning: "All questions answered.",
            }),
          },
        ],
      }),
    }));

    const { planNextRound } = await import("../../extensions/commands/ask-helpers.js");

    const result = await planNextRound(
      "What is dopamine?",
      [
        {
          title: "Dopamine Article",
          url: "https://example.com/dopamine",
          citekey: "smith2024",
          excerpt: "Dopamine is a neurotransmitter involved in reward.",
        },
      ],
      1,
      { model: TEST_MODEL as never, apiKey: "sk-test" },
    );

    expect(result.done).toBe(true);
  });

  it("should return queries and done=false when more info needed", async () => {
    vi.doMock("@earendil-works/pi-ai", () => ({
      complete: vi.fn().mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              queries: ["ThinkCentre M720q power consumption watts"],
              done: false,
              reasoning: "Need power consumption details.",
            }),
          },
        ],
      }),
    }));

    const { planNextRound } = await import("../../extensions/commands/ask-helpers.js");

    const result = await planNextRound("ThinkCentre M720q specs", [], 0, {
      model: TEST_MODEL as never,
      apiKey: "sk-test",
    });

    expect(result.done).toBe(false);
    expect(result.queries).toContain("ThinkCentre M720q power consumption watts");
  });

  it("should fall back to done=true on parse error", async () => {
    vi.doMock("@earendil-works/pi-ai", () => ({
      complete: vi.fn().mockResolvedValue({
        content: [
          {
            type: "text",
            text: "Invalid JSON garbage",
          },
        ],
      }),
    }));

    const { planNextRound } = await import("../../extensions/commands/ask-helpers.js");

    const result = await planNextRound("test question", [], 0, {
      model: TEST_MODEL as never,
      apiKey: "sk-test",
    });

    expect(result.done).toBe(true);
    expect(result.queries).toEqual([]);
  });
});
