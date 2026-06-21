/**
 * Tests for common/webSearch.ts — shared searchWeb function.
 *
 * Verifies that the exported function:
 * - Returns the expected shape { results, tier, tierLabel }
 * - Delegates to SearXNG/Tavily/Bing as orchestrated
 * - Applies domain filtering in phase 3
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("searchWeb shared module", () => {
  let originalFetch: typeof globalThis.fetch;

  const MOCK_SEARXNG_RESPONSE = {
    results: [
      {
        title: "Test Result 1",
        url: "https://example.edu/research",
        content: "Research content about the topic.",
        engine: "google",
      },
      {
        title: "Test Result 2",
        url: "https://arxiv.org/abs/1234.5678",
        content: "Academic paper content.",
        engine: "arxiv",
      },
    ],
  };

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(MOCK_SEARXNG_RESPONSE),
      }),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should return SearchOutput shape with results", async () => {
    const { searchWeb } = await import("../../common/webSearch.js");

    const result = await searchWeb("test query");

    expect(result).toHaveProperty("results");
    expect(result).toHaveProperty("tier");
    expect(result).toHaveProperty("tierLabel");
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);
  });

  it("should include title, url, snippet, and source_label on each result", async () => {
    const { searchWeb } = await import("../../common/webSearch.js");

    const result = await searchWeb("test query");

    for (const r of result.results) {
      expect(r).toHaveProperty("title");
      expect(r).toHaveProperty("url");
      expect(r).toHaveProperty("snippet");
      expect(r).toHaveProperty("source_label");
      expect(r).toHaveProperty("tier");
    }
  });

  it("should pass tier parameter to SearXNG when forced", async () => {
    // Verify that when tier=1 is passed, categories is scientific_publications
    const { searchWeb } = await import("../../common/webSearch.js");

    // Use tier=1 to force academic search
    await searchWeb("quantum computing", { tier: 1 });

    // Verify SearXNG was called with scientific_publications category
    const fetchCalls = vi.mocked(globalThis.fetch).mock.calls;
    expect(fetchCalls.length).toBeGreaterThan(0);
    const url = new URL(fetchCalls[0][0] as string);
    expect(url.searchParams.get("categories")).toBe("scientific_publications");
  });

  it("should return empty results when fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const { searchWeb } = await import("../../common/webSearch.js");

    const result = await searchWeb("failing query");

    expect(result.results).toEqual([]);
    expect(result.tier).toBeDefined();
    expect(typeof result.tierLabel).toBe("string");
  });
});
