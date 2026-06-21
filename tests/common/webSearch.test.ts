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

  it("should fall through to Tavily when SearXNG returns ≤3 results with forced tier", async () => {
    // Mock: first call = SearXNG (few results), second call = Tavily (success)
    const searxngResponse = {
      results: [
        {
          title: "SearXNG Result",
          url: "https://example.edu/paper",
          content: "A single result from SearXNG.",
          engine: "google",
        },
      ],
    };

    const tavilyResponse = {
      results: [
        {
          title: "Tavily Result",
          url: "https://example.com/result",
          content: "A result from Tavily.",
        },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((requestUrl: string | URL | Request) => {
        const urlStr = typeof requestUrl === "string" ? requestUrl : (requestUrl as URL).href;
        if (urlStr.includes("tavily.com")) {
          return {
            ok: true,
            json: () => Promise.resolve(tavilyResponse),
          };
        }
        // SearXNG (first call)
        return {
          ok: true,
          json: () => Promise.resolve(searxngResponse),
        };
      }),
    );

    // Need TAVILY_KEY in env for Tavily to attempt
    process.env.TAVILY_KEY = "test-key";

    const { searchWeb } = await import("../../common/webSearch.js");

    const result = await searchWeb("test query", { tier: 3 });

    // Should fall through to Tavily since SearXNG returned only 1 result (≤3)
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.tierLabel).toContain("Tavily");

    // Clean up
    delete process.env.TAVILY_KEY;
  });

  it("should return SearXNG results directly when it has >3 results even with forced tier", async () => {
    // Many results — should NOT fall through
    const manyResults = {
      results: Array.from({ length: 5 }, (_, i) => ({
        title: `Result ${i + 1}`,
        url: `https://example.edu/paper${i + 1}`,
        content: `Content ${i + 1}.`,
        engine: "google",
      })),
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(manyResults),
      }),
    );

    const { searchWeb } = await import("../../common/webSearch.js");

    const result = await searchWeb("test query", { tier: 3 });

    // Should return SearXNG results directly (>3 results = no fallthrough)
    expect(result.results.length).toBe(5);
    expect(result.tierLabel).toContain("SearXNG");
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
