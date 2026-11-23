/**
 * Tests for common/gather-sources.ts — web candidate ranking and fetching.
 *
 * Web search results and fetches are supplied directly, so no test touches
 * the network.
 *
 * @module tests/common/gather-sources
 */

import { describe, expect, it } from "vitest";

import { fetchRankedSources, rankCandidates } from "../../common/gather-sources.ts";
import { classifyTrust } from "../../common/trust.ts";
import { canonicalizeUrl } from "../../common/url.ts";

import type { WebCandidate } from "../../common/gather-sources.ts";

/**
 * Build a web candidate for ranking and fetch tests.
 *
 * @param url - Result URL.
 * @param title - Result title.
 * @param snippet - Result snippet.
 * @param query - Query that produced the result.
 * @param order - Discovery order.
 * @returns A complete web candidate.
 */
function candidate(
  url: string,
  title: string,
  snippet: string,
  query: string,
  order: number,
): WebCandidate {
  return {
    result: { title, url, snippet, source_label: "fake", tier: 1 },
    query,
    order,
    canonical: canonicalizeUrl(url),
    trust: classifyTrust(url),
  };
}

describe("rankCandidates", () => {
  it("drops candidates below the prefetch threshold and ranks relevant docs before trust", () => {
    const ranked = rankCandidates([
      candidate(
        "https://doi.org/10.1000/xyz",
        "Unrelated paper",
        "unrelated",
        "vector database",
        0,
      ),
      candidate(
        "https://docs.example.com/vector-database",
        "Vector Database Guide",
        "vector database guide",
        "vector database",
        1,
      ),
      candidate(
        "https://blog.example.com/vector-database?utm_source=feed",
        "Vector database notes",
        "vector database notes",
        "vector database",
        2,
      ),
      candidate(
        "https://docs.example.com/vector-database?utm_source=feed",
        "Vector Database Guide",
        "vector database guide",
        "vector database",
        3,
      ),
    ]);

    expect(ranked.map((entry) => entry.result.url)).toEqual([
      "https://docs.example.com/vector-database",
      "https://blog.example.com/vector-database?utm_source=feed",
    ]);
    expect(ranked[0].trust).toBe("official-docs");
  });
});

describe("fetchRankedSources", () => {
  it("rejects fetch errors, junk and low-relevance pages and backfills accepted sources", async () => {
    const fetched: string[] = [];
    const query = "vector database";
    const ranked = [
      candidate("https://one.test/a", "Vector database", query, query, 0),
      candidate("https://two.test/b", "Vector database", query, query, 1),
      candidate("https://three.test/c", "Vector database", query, query, 2),
      candidate("https://four.test/d", "Vector database", query, query, 3),
      candidate("https://five.test/e", "Vector database", query, query, 4),
    ];

    const result = await fetchRankedSources(ranked, {
      maxSources: 2,
      fetch: (url) => {
        fetched.push(url);
        if (url === "https://one.test/a") return Promise.resolve({ error: "network down" });
        if (url === "https://two.test/b") {
          return Promise.resolve({ title: "Just a moment...", content: "x".repeat(500) });
        }
        if (url === "https://three.test/c") {
          return Promise.resolve({ title: "Unrelated page", content: "A".repeat(500) });
        }
        if (url === "https://four.test/d") {
          return Promise.resolve({
            title: "Vector Database Guide",
            content: `  ${"vector database ".repeat(40)}  `,
          });
        }
        return Promise.resolve({
          title: "Vector database deep dive",
          content: "vector database ".repeat(40),
        });
      },
    });

    expect(fetched).toEqual([
      "https://one.test/a",
      "https://two.test/b",
      "https://three.test/c",
      "https://four.test/d",
      "https://five.test/e",
    ]);
    expect(result.sources.map((source) => source.url)).toEqual([
      "https://four.test/d",
      "https://five.test/e",
    ]);
    expect(result.rejected).toEqual([
      { url: "https://one.test/a", reason: "network down" },
      { url: "https://two.test/b", reason: "captcha" },
      { url: "https://three.test/c", reason: "low-relevance 0.00" },
    ]);
    expect(result.sources[0].relevance).toBe(1);
    expect(result.sources[1].relevance).toBe(1);
    expect(result.sources[0].excerpt).not.toContain("  ");
    expect(result.sources[0].content).toContain("vector database");
  });

  it("stops after at most three fetch attempts per requested source", async () => {
    const fetched: string[] = [];
    const ranked = Array.from({ length: 6 }, (_, index) =>
      candidate(
        `https://example.test/${index}`,
        "Vector database",
        "vector database",
        "vector database",
        index,
      ),
    );

    const result = await fetchRankedSources(ranked, {
      maxSources: 1,
      fetch: (url) => {
        fetched.push(url);
        return Promise.resolve({ title: "Unrelated page", content: "A".repeat(500) });
      },
    });

    expect(fetched).toHaveLength(3);
    expect(result.sources).toHaveLength(0);
    expect(result.rejected).toHaveLength(3);
  });
});
