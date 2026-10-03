/**
 * Tests for the in-process search executor (design-B find stage).
 *
 * @module tests/research-engine/search.test
 */

import { describe, it, expect, vi } from "vitest";

import { runSearch } from "../../extensions/research-engine/search.js";

import type { SearchDeps, SearchWebResult } from "../../extensions/research-engine/search.js";

function backend(map: Record<string, SearchWebResult | Error>): SearchDeps {
  return {
    searchWeb: vi.fn((query: string): Promise<SearchWebResult> => {
      const r = map[query];
      if (!r) return Promise.resolve({ results: [], tier: 3 });
      if (r instanceof Error) return Promise.reject(r);
      return Promise.resolve(r);
    }),
  };
}

describe("runSearch", () => {
  it("should collect candidates with tiers, canonicalized and deduped across queries", async () => {
    const deps = backend({
      q1: {
        results: [
          { url: "https://a.com/1?utm_source=x", title: "A1", snippet: "s1" },
          { url: "https://b.com/2", title: "B2", snippet: "s2" },
        ],
        tier: 1,
      },
      q2: {
        results: [
          { url: "https://a.com/1", title: "A1 dup", snippet: "s1b" },
          { url: "https://c.com/3", title: "C3", snippet: "s3" },
        ],
        tier: 3,
      },
    });
    const out = await runSearch(["q1", "q2"], { deps });
    expect(out.map((c) => c.canonicalUrl)).toEqual([
      "https://a.com/1",
      "https://b.com/2",
      "https://c.com/3",
    ]);
    expect(out[0].tier).toBe(1);
    expect(out[2].tier).toBe(3);
    expect(out[0].query).toBe("q1");
  });

  it("should respect the visited exclusion set", async () => {
    const deps = backend({
      q1: { results: [{ url: "https://a.com/1" }, { url: "https://b.com/2" }], tier: 3 },
    });
    const out = await runSearch(["q1"], { deps, exclude: new Set(["https://a.com/1"]) });
    expect(out.map((c) => c.canonicalUrl)).toEqual(["https://b.com/2"]);
  });

  it("should cap candidates and swallow per-query failures", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ url: `https://x.com/${i}` }));
    const deps = backend({
      q1: { results: many, tier: 3 },
      q2: new Error("search backend down"),
      q3: { results: [{ url: "https://late.com/9" }], tier: 2 },
    });
    const out = await runSearch(["q1", "q2", "q3"], { deps, maxCandidates: 10 });
    expect(out).toHaveLength(10);

    const out2 = await runSearch(["q2", "q3"], { deps });
    expect(out2.map((c) => c.canonicalUrl)).toEqual(["https://late.com/9"]);
  });

  it("should stop between queries when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const deps = backend({ q1: { results: [{ url: "https://a.com/1" }], tier: 3 } });
    const out = await runSearch(["q1"], { deps, signal: controller.signal });
    expect(out).toEqual([]);
  });
});
