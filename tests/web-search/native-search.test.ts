import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for searchNativeHttp — Bing RSS fallback.
 * Mocks globalThis.fetch to return controlled RSS XML.
 */

const BING_RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Bing Search Results</title>
  <item>
    <title>Example University — Research Page</title>
    <link>https://example.edu/research</link>
    <description>This is a research page at Example University with lots of content about academic topics.</description>
  </item>
  <item>
    <title>Government Report 2024</title>
    <link>https://example.gov/reports/2024</link>
    <description>An official government report covering policy changes and statistical data.</description>
  </item>
  <item>
    <title>Tech Article</title>
    <link>https://techblog.com/article</link>
    <description>A general tech article with useful information about programming.</description>
  </item>
</channel>
</rss>`;

const BING_RSS_NO_RESULTS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel><title>No Results</title></channel>
</rss>`;

describe("searchNativeHttp", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should parse Bing RSS XML and return SearchResult array", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(BING_RSS_XML),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { searchNativeHttp } = await import("../../extensions/web-search/native.js");
    const results = await searchNativeHttp("test query", 3);

    expect(results).toHaveLength(3);
    expect(results[0].title).toBe("Example University — Research Page");
    expect(results[0].url).toBe("https://example.edu/research");
    expect(results[0].snippet).toContain("research page");
    expect(results[0].source_label).toBe("Web");
    expect(results[0].tier).toBe(3);
  });

  it("should request with tier 2 query modifier (site:edu OR site:gov)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(BING_RSS_XML),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { searchNativeHttp } = await import("../../extensions/web-search/native.js");
    await searchNativeHttp("climate change", 2);

    const callUrl = mockFetch.mock.calls[0][0] as string;
    expect(callUrl).toContain(encodeURIComponent("climate change"));
    expect(callUrl).toContain(encodeURIComponent("site:edu"));
    expect(callUrl).toContain(encodeURIComponent("site:gov"));
  });

  it("should deduplicate by URL", async () => {
    const dupXml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>First</title>
    <link>https://example.com/page</link>
    <description>First description</description>
  </item>
  <item>
    <title>Second</title>
    <link>https://example.com/page</link>
    <description>Second description</description>
  </item>
</channel></rss>`;
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(dupXml),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { searchNativeHttp } = await import("../../extensions/web-search/native.js");
    const results = await searchNativeHttp("test", 3);

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("First");
  });

  it("should limit to 10 results", async () => {
    const manyItems: string[] = [];
    for (let i = 0; i < 15; i++) {
      manyItems.push(`<item>
        <title>Result ${i}</title>
        <link>https://example.com/page${i}</link>
        <description>Description ${i}</description>
      </item>`);
    }
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel>${manyItems.join("")}</channel></rss>`;
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(xml),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { searchNativeHttp } = await import("../../extensions/web-search/native.js");
    const results = await searchNativeHttp("test", 3);

    expect(results).toHaveLength(10);
  });

  it("should return empty array when response is not ok", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", mockFetch);

    const { searchNativeHttp } = await import("../../extensions/web-search/native.js");
    const results = await searchNativeHttp("test", 3);

    expect(results).toEqual([]);
  });

  it("should return empty array when fetch throws", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
    vi.stubGlobal("fetch", mockFetch);

    const { searchNativeHttp } = await import("../../extensions/web-search/native.js");
    const results = await searchNativeHttp("test", 3);

    expect(results).toEqual([]);
  });

  it("should return empty array when XML has no items", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(BING_RSS_NO_RESULTS),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { searchNativeHttp } = await import("../../extensions/web-search/native.js");
    const results = await searchNativeHttp("test", 3);

    expect(results).toEqual([]);
  });

  it("should set tier correctly for all 3 tiers", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(BING_RSS_XML),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { searchNativeHttp } = await import("../../extensions/web-search/native.js");

    const r1 = await searchNativeHttp("test", 1);
    expect(r1[0].tier).toBe(1);

    const r2 = await searchNativeHttp("test", 2);
    expect(r2[0].tier).toBe(2);

    const r3 = await searchNativeHttp("test", 3);
    expect(r3[0].tier).toBe(3);
  });
});
