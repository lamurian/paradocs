import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for searchSearxng — SearXNG JSON API.
 * Mocks globalThis.fetch and the env config module.
 */

const SEARXNG_JSON_RESPONSE = {
  results: [
    {
      title: "Quantum Computing Overview",
      url: "https://arxiv.org/abs/1234.5678",
      content: "A comprehensive overview of quantum computing principles and applications.",
      engine: "arxiv",
    },
    {
      title: "Machine Learning in Healthcare",
      url: "https://example.edu/research/ml-healthcare",
      content: "Recent advances in machine learning applications for healthcare diagnostics.",
      engine: "google",
    },
    {
      title: "Climate Change Report 2024",
      url: "https://example.gov/climate/report-2024",
      content: "Annual climate change assessment with key findings and recommendations.",
      engine: "bing",
    },
  ],
};

const _SEARXNG_EMPTY_RESPONSE = { results: [] };

describe("searchSearxng", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should parse SearXNG JSON and return SearchResult array", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SEARXNG_JSON_RESPONSE),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { searchSearxng } = await import("../../extensions/web-search/searxng.js");
    const results = await searchSearxng("quantum computing", 1);

    expect(results).toHaveLength(3);
    expect(results[0].title).toBe("Quantum Computing Overview");
    expect(results[0].url).toBe("https://arxiv.org/abs/1234.5678");
    expect(results[0].snippet).toContain("comprehensive overview");
    expect(results[0].source_label).toBe("arxiv");
    expect(results[0].tier).toBe(1);
  });

  it("should use scientific_publications category for tier 1", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SEARXNG_JSON_RESPONSE),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { searchSearxng } = await import("../../extensions/web-search/searxng.js");
    await searchSearxng("quantum", 1);

    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.searchParams.get("categories")).toBe("scientific_publications");
  });

  it("should use web category with site:edu|gov for tier 2", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SEARXNG_JSON_RESPONSE),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { searchSearxng } = await import("../../extensions/web-search/searxng.js");
    await searchSearxng("climate", 2);

    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.searchParams.get("categories")).toBe("web");
    expect(url.searchParams.get("q")).toContain("site:edu");
    expect(url.searchParams.get("q")).toContain("site:gov");
  });

  it("should use general category for tier 3", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SEARXNG_JSON_RESPONSE),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { searchSearxng } = await import("../../extensions/web-search/searxng.js");
    await searchSearxng("news", 3);

    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.searchParams.get("categories")).toBe("general");
  });

  it("should use custom category override when provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SEARXNG_JSON_RESPONSE),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { searchSearxng } = await import("../../extensions/web-search/searxng.js");
    await searchSearxng("python", 2, undefined, "it");

    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.searchParams.get("categories")).toBe("it");
    // Query should NOT have site: modifier when custom category is used
    expect(url.searchParams.get("q")).toBe("python");
  });

  it("should return empty array when response is not ok", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", mockFetch);

    const { searchSearxng } = await import("../../extensions/web-search/searxng.js");
    const results = await searchSearxng("test", 3);

    expect(results).toEqual([]);
  });

  it("should return empty array when fetch throws", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Connection refused"));
    vi.stubGlobal("fetch", mockFetch);

    const { searchSearxng } = await import("../../extensions/web-search/searxng.js");
    const results = await searchSearxng("test", 3);

    expect(results).toEqual([]);
  });

  it("should return empty array when JSON parsing fails", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new Error("Invalid JSON")),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { searchSearxng } = await import("../../extensions/web-search/searxng.js");
    const results = await searchSearxng("test", 3);

    expect(results).toEqual([]);
  });

  it("should return empty array when results field is missing", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { searchSearxng } = await import("../../extensions/web-search/searxng.js");
    const results = await searchSearxng("test", 3);

    expect(results).toEqual([]);
  });

  it("should set safesearch, language and pageno parameters", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SEARXNG_JSON_RESPONSE),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { searchSearxng } = await import("../../extensions/web-search/searxng.js");
    await searchSearxng("test", 3);

    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.searchParams.get("safesearch")).toBe("1");
    expect(url.searchParams.get("language")).toBe("en");
    expect(url.searchParams.get("pageno")).toBe("1");
  });
});
