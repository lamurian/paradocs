/**
 * Tests for kind-based web search routing.
 *
 * Verifies the single-request kind path, category routing, relevance-ranked
 * results and Tavily fallback when too few SearXNG results are relevant.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { routeForKind } from "../../common/search-routing.ts";
import { searchWeb } from "../../common/webSearch.ts";

function searxngResponse(count: number): { results: Array<Record<string, string>> } {
  return {
    results: Array.from({ length: count }, (_, i) => ({
      title: `Quantum computing result ${i}`,
      url: `https://example.com/quantum-computing-${i}`,
      content: "Quantum computing overview.",
      engine: "google",
    })),
  };
}

function jsonResponse(body: unknown): Response {
  return { ok: true, json: () => Promise.resolve(body) } as Response;
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

describe("kind-based web search routing", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(searxngResponse(5))));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });
  it("maps each kind to its SearXNG category and Tavily tier", () => {
    expect(routeForKind("general")).toEqual({ category: "general", tavilyTier: 3 });
    expect(routeForKind("tech")).toEqual({ category: "it,general", tavilyTier: 3 });
    expect(routeForKind("academic")).toEqual({
      category: "scientific_publications",
      tavilyTier: 1,
    });
    expect(routeForKind("news")).toEqual({ category: "news", tavilyTier: 3 });
  });

  it("makes one general SearXNG request when neither kind nor tier is given", async () => {
    await searchWeb("quantum computing");

    const calls = vi.mocked(globalThis.fetch).mock.calls;
    const urls = calls.map((call) => new URL(call[0] as string));
    const categories = urls.map((url) => url.searchParams.get("categories"));

    expect(calls).toHaveLength(1);
    expect(categories).toEqual(["general"]);
    expect(categories).not.toContain("scientific_publications");
  });

  it("routes tech, academic and news to their category strings", async () => {
    const cases = [
      { kind: "tech" as const, category: "it,general" },
      { kind: "academic" as const, category: "scientific_publications" },
      { kind: "news" as const, category: "news" },
    ];

    for (const testCase of cases) {
      vi.mocked(globalThis.fetch).mockClear();
      await searchWeb("quantum computing", { kind: testCase.kind });
      const first = vi.mocked(globalThis.fetch).mock.calls[0];
      const url = new URL(first[0] as string);
      expect(url.searchParams.get("categories")).toBe(testCase.category);
    }
  });

  it("falls back to Tavily when fewer than three SearXNG results are relevant", async () => {
    const junk = {
      results: Array.from({ length: 5 }, (_, i) => ({
        title: `Unrelated note ${i}`,
        url: `https://example.com/unrelated-${i}`,
        content: "Nothing to see here.",
        engine: "google",
      })),
    };
    const tavily = {
      results: [
        {
          title: "Cooking recipes",
          url: "https://example.com/recipes",
          content: "Food and cooking.",
        },
        {
          title: "Quantum computing overview",
          url: "https://example.com/quantum-computing",
          content: "Quantum computing overview.",
        },
        {
          title: "Quantum mechanics",
          url: "https://example.com/quantum",
          content: "Quantum physics.",
        },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: string | URL | Request) => {
        const url = requestUrl(input);
        if (url.includes("api.tavily.com")) return Promise.resolve(jsonResponse(tavily));
        if (url.includes("bing.com")) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve("<rss></rss>"),
          } as Response);
        }
        return Promise.resolve(jsonResponse(junk));
      }),
    );

    const hadKey = Object.hasOwn(process.env, "TAVILY_KEY");
    const originalKey = process.env.TAVILY_KEY;
    process.env.TAVILY_KEY = "test-key";

    try {
      const result = await searchWeb("quantum computing");

      expect(result.tierLabel).toContain("Tavily");
      expect(result.results.map((entry) => entry.title)).toEqual([
        "Quantum computing overview",
        "Quantum mechanics",
        "Cooking recipes",
      ]);
    } finally {
      if (hadKey) process.env.TAVILY_KEY = originalKey;
      else delete process.env.TAVILY_KEY;
    }
  });
});
