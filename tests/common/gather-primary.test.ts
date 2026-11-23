/**
 * Tests for primary-URL gathering in common/gather-evidence.ts.
 *
 * KB lookups, web searches and fetches are injected fakes, so no test
 * touches the network.
 *
 * @module tests/common/gather-primary
 */

import { describe, expect, it, vi } from "vitest";

import { gatherEvidence } from "../../common/gather-evidence.ts";

import type { Freshness } from "../../common/freshness.ts";
import type { GatherEvidenceDeps, GatherKbHit } from "../../common/gather-evidence.ts";
import type { SearchResult } from "../../extensions/web-search/native.ts";

/**
 * Build a fresh freshness verdict.
 *
 * @returns A complete fresh freshness object.
 */
function fresh(): Freshness {
  return {
    status: "fresh",
    basis: "reviewed",
    ageDays: 10,
    windowDays: 365,
    reviewed: "2025-01-01",
    newestSourcePublished: null,
    lastVerified: null,
    noteModified: null,
  };
}

/**
 * Build a KB hit for the fake searchKb.
 *
 * @param path - Note path.
 * @param title - Note title.
 * @returns A fresh KB hit.
 */
function kbHit(path: string, title: string): GatherKbHit {
  return { path, title, description: "", freshness: fresh() };
}

/**
 * Build default deps, overriding individual members per test.
 *
 * @param overrides - Dependency members to replace.
 * @returns Complete deps for gatherEvidence.
 */
function makeDeps(overrides: Partial<GatherEvidenceDeps> = {}): GatherEvidenceDeps {
  return {
    searchKb: () => [],
    searchWeb: vi.fn(() => Promise.resolve([])),
    fetch: () => Promise.resolve({ title: "Fetched", content: "body" }),
    now: () => new Date("2025-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("gatherEvidence — primary URLs", () => {
  it("fetches primary urls first, marks them primary and does not count them toward maxSources", async () => {
    const fetched: string[] = [];
    const web: SearchResult = {
      title: "Vector database guide",
      url: "https://web.example.com/vector-database",
      snippet: "vector database guide",
      source_label: "fake",
      tier: 1,
    };
    const deps = makeDeps({
      searchWeb: () => Promise.resolve([web]),
      fetch: (url) => {
        fetched.push(url);
        if (url.startsWith("https://docs.example.com/primary")) {
          return Promise.resolve({
            title: "Primary Handbook",
            content: "unrelated primary handbook body ".repeat(20),
          });
        }
        return Promise.resolve({
          title: "Vector database guide",
          content: "vector database ".repeat(40),
        });
      },
    });

    const pack = await gatherEvidence(
      {
        question: "q",
        queries: ["vector database"],
        maxSources: 1,
        urls: ["https://docs.example.com/primary-a", "https://docs.example.com/primary-b"],
      },
      deps,
    );

    expect(fetched).toEqual([
      "https://docs.example.com/primary-a",
      "https://docs.example.com/primary-b",
      "https://web.example.com/vector-database",
    ]);
    expect(pack.sources).toHaveLength(3);
    const [first, second, third] = pack.sources;
    expect(first.url).toBe("https://docs.example.com/primary-a");
    expect(first.primary).toBe(true);
    expect(first.query).toBe("(primary)");
    expect(first.trust).toBe("official-docs");
    expect(first.tier).toBeNull();
    expect(first.relevance).toBeUndefined();
    expect(second.url).toBe("https://docs.example.com/primary-b");
    expect(second.primary).toBe(true);
    expect(third.primary).toBeUndefined();
    expect(third.query).toBe("vector database");
    expect(pack.rejected).toEqual([]);
  });

  it("fetches primary urls even when every query is covered and records junk or failed primaries", async () => {
    const searchWeb = vi.fn(() => Promise.resolve([]));
    const deps = makeDeps({
      searchKb: () => [kbHit("Resources/topic.md", "Topic notes")],
      searchWeb,
      fetch: (url) => {
        if (url === "https://docs.example.com/fail") {
          return Promise.resolve({ error: "network down" });
        }
        if (url === "https://docs.example.com/junk") {
          return Promise.resolve({ title: "Just a moment...", content: "x".repeat(500) });
        }
        return Promise.resolve({ title: "Primary Docs", content: "short primary content" });
      },
    });

    const pack = await gatherEvidence(
      {
        question: "q",
        queries: ["topic"],
        urls: [
          "https://docs.example.com/good",
          "https://docs.example.com/fail",
          "https://docs.example.com/junk",
        ],
      },
      deps,
    );

    expect(searchWeb).not.toHaveBeenCalled();
    expect(pack.queries[0].kbCovered).toBe(true);
    expect(pack.sources).toHaveLength(1);
    expect(pack.sources[0].url).toBe("https://docs.example.com/good");
    expect(pack.sources[0].primary).toBe(true);
    expect(pack.rejected).toEqual([
      { url: "https://docs.example.com/fail", reason: "network down" },
      { url: "https://docs.example.com/junk", reason: "captcha" },
    ]);
  });

  it("ignores primary urls beyond the first five", async () => {
    const fetched: string[] = [];
    const deps = makeDeps({
      fetch: (url) => {
        fetched.push(url);
        return Promise.resolve({ title: "Primary Docs", content: "primary content" });
      },
    });
    const urls = Array.from(
      { length: 6 },
      (_, index) => `https://docs.example.com/primary-${index}`,
    );

    const pack = await gatherEvidence({ question: "q", queries: ["topic"], urls }, deps);

    expect(fetched).toHaveLength(5);
    expect(pack.sources).toHaveLength(5);
    expect(pack.sources.every((source) => source.primary === true)).toBe(true);
  });
});
