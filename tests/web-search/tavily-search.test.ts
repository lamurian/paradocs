/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for searchTavily — Tavily search API.
 * Mocks globalThis.fetch and sets TAVILY_KEY in the environment.
 */

// Set env var BEFORE any imports to ensure getApiKeys returns a value
beforeEach(() => {
  process.env.TAVILY_KEY = "tvly-mock-key-12345";
});

afterEach(() => {
  delete process.env.TAVILY_KEY;
  vi.restoreAllMocks();
});

const TAVILY_JSON_RESPONSE = {
  results: [
    {
      title: "Quantum Computing Explained",
      url: "https://arxiv.org/abs/quant-ph/1234",
      content: "A detailed explanation of quantum computing fundamentals and algorithms.",
    },
    {
      title: "AI Research Advances",
      url: "https://example.edu/research/ai-2024",
      content: "Recent breakthroughs in artificial intelligence research published this year.",
    },
  ],
};

const _TAVILY_EMPTY_RESPONSE = { results: [] };

describe("searchTavily", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should parse Tavily JSON and return SearchResult array", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(TAVILY_JSON_RESPONSE),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { searchTavily } = await import("../../extensions/web-search/tavily.js");
    const results = await searchTavily("quantum computing", 3);

    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("Quantum Computing Explained");
    expect(results[0].url).toBe("https://arxiv.org/abs/quant-ph/1234");
    expect(results[0].snippet).toContain("detailed explanation");
    expect(results[0].source_label).toBe("Tavily");
    expect(results[0].tier).toBe(3);
  });

  it("should send POST request with correct body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(TAVILY_JSON_RESPONSE),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { searchTavily } = await import("../../extensions/web-search/tavily.js");
    await searchTavily("test query", 3);

    expect(mockFetch).toHaveBeenCalledWith("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: expect.any(String),
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.api_key).toBe("tvly-mock-key-12345");
    expect(body.query).toBe("test query");
    expect(body.max_results).toBe(10);
    expect(body.include_answer).toBe(false);
  });

  it("should use advanced search depth for tier 1 with academic domains", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(TAVILY_JSON_RESPONSE),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { searchTavily } = await import("../../extensions/web-search/tavily.js");
    await searchTavily("machine learning", 1);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.search_depth).toBe("advanced");
    expect(body.include_domains).toContain("arxiv.org");
    expect(body.include_domains).toContain("pubmed.ncbi.nlm.nih.gov");
  });

  it("should use basic search depth for tier 2 with .edu/.gov/.ac.uk domains", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(TAVILY_JSON_RESPONSE),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { searchTavily } = await import("../../extensions/web-search/tavily.js");
    await searchTavily("policy report", 2);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.search_depth).toBe("basic");
    expect(body.include_domains).toEqual([".edu", ".gov", ".ac.uk"]);
  });

  it("should use advanced search depth for tier 3 without domain restriction", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(TAVILY_JSON_RESPONSE),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { searchTavily } = await import("../../extensions/web-search/tavily.js");
    await searchTavily("general topic", 3);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.search_depth).toBe("advanced");
    expect(body.include_domains).toBeUndefined();
  });

  it("should return empty array when no API key is configured", async () => {
    delete process.env.TAVILY_KEY;

    const { searchTavily } = await import("../../extensions/web-search/tavily.js");
    const results = await searchTavily("test", 3);

    expect(results).toEqual([]);
  });

  it("should return empty array when response is not ok", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal("fetch", mockFetch);

    const { searchTavily } = await import("../../extensions/web-search/tavily.js");
    const results = await searchTavily("test", 3);

    expect(results).toEqual([]);
  });

  it("should return empty array when fetch throws", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
    vi.stubGlobal("fetch", mockFetch);

    const { searchTavily } = await import("../../extensions/web-search/tavily.js");
    const results = await searchTavily("test", 3);

    expect(results).toEqual([]);
  });

  it("should return empty array when results field is missing", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { searchTavily } = await import("../../extensions/web-search/tavily.js");
    const results = await searchTavily("test", 3);

    expect(results).toEqual([]);
  });

  it("should pass signal through to fetch call", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(TAVILY_JSON_RESPONSE),
    });
    vi.stubGlobal("fetch", mockFetch);

    const controller = new AbortController();
    const { searchTavily } = await import("../../extensions/web-search/tavily.js");
    await searchTavily("test", 3, controller.signal);

    expect(mockFetch.mock.calls[0][1].signal).toBe(controller.signal);
  });
});
