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
    const { searchWeb } = await import("../../common/webSearch.ts");

    const result = await searchWeb("test query");

    expect(result).toHaveProperty("results");
    expect(result).toHaveProperty("tier");
    expect(result).toHaveProperty("tierLabel");
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);
  });

  it("should include title, url, snippet, and source_label on each result", async () => {
    const { searchWeb } = await import("../../common/webSearch.ts");

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
    const { searchWeb } = await import("../../common/webSearch.ts");

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

    const { searchWeb } = await import("../../common/webSearch.ts");

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

    const { searchWeb } = await import("../../common/webSearch.ts");

    const result = await searchWeb("test query", { tier: 3 });

    // Should return SearXNG results directly (>3 results = no fallthrough)
    expect(result.results.length).toBe(5);
    expect(result.tierLabel).toContain("SearXNG");
  });

  it("should return empty results when fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const { searchWeb } = await import("../../common/webSearch.ts");

    const result = await searchWeb("failing query");

    expect(result.results).toEqual([]);
    expect(result.tier).toBeDefined();
    expect(typeof result.tierLabel).toBe("string");
  });

  it("should map a recent date to the month range", async () => {
    const { sinceToTimeRange } = await import("../../common/webSearch.ts");
    const now = new Date("2024-06-01T00:00:00Z");
    expect(sinceToTimeRange("2024-05-15", now)).toBe("month");
  });

  it("should map a date within a year to the year range", async () => {
    const { sinceToTimeRange } = await import("../../common/webSearch.ts");
    const now = new Date("2024-06-01T00:00:00Z");
    expect(sinceToTimeRange("2024-01-01", now)).toBe("year");
  });

  it("should return undefined for older, missing or invalid dates", async () => {
    const { sinceToTimeRange } = await import("../../common/webSearch.ts");
    const now = new Date("2024-06-01T00:00:00Z");
    expect(sinceToTimeRange("2020-01-01", now)).toBeUndefined();
    expect(sinceToTimeRange(undefined, now)).toBeUndefined();
    expect(sinceToTimeRange(null, now)).toBeUndefined();
    expect(sinceToTimeRange("not-a-date", now)).toBeUndefined();
  });

  it("should forward the mapped range to SearXNG as time_range", async () => {
    const { searchWeb } = await import("../../common/webSearch.ts");
    const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    await searchWeb("recent query", { tier: 3, since: recent });

    const fetchCalls = vi.mocked(globalThis.fetch).mock.calls;
    const url = new URL(fetchCalls[0][0] as string);
    expect(url.searchParams.get("time_range")).toBe("month");
  });

  it("should not send time_range when since is absent", async () => {
    const { searchWeb } = await import("../../common/webSearch.ts");

    await searchWeb("no since query", { tier: 3 });

    const fetchCalls = vi.mocked(globalThis.fetch).mock.calls;
    const url = new URL(fetchCalls[0][0] as string);
    expect(url.searchParams.get("time_range")).toBeNull();
  });

  it("should append the trust class to each formatted result line", async () => {
    const { formatResults } = await import("../../common/webSearch.ts");

    const text = formatResults(
      [
        {
          title: "Paper",
          url: "https://www.nature.com/articles/1",
          snippet: "Peer reviewed.",
          source_label: "Web",
          tier: 1,
        },
        {
          title: "Preprint",
          url: "https://arxiv.org/abs/1234.5678",
          snippet: "Preprint.",
          source_label: "arXiv",
          tier: 1,
        },
        {
          title: "Docs",
          url: "https://docs.example.com/guide",
          snippet: "Docs.",
          source_label: "Web",
          tier: 1,
        },
        {
          title: "Blog",
          url: "https://example.com/blog/post",
          snippet: "Blog.",
          source_label: "Web",
          tier: 1,
        },
      ],
      "trust query",
      "Phase 1 — SearXNG Tier 1",
    );

    expect(text).toContain("[trust: peer-reviewed]");
    expect(text).toContain("[trust: preprint]");
    expect(text).toContain("[trust: official-docs]");
    expect(text).toContain("[trust: blog-forum]");
  });
});
