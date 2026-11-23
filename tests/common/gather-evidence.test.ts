/**
 * Tests for common/gather-evidence.ts — deterministic evidence gathering.
 *
 * All KB lookups, web searches and fetches are injected fakes, so no test
 * touches the network.
 *
 * @module tests/common/gather-evidence
 */

import { describe, it, expect, vi } from "vitest";

import { gatherEvidence } from "../../common/gather-evidence.ts";

import type { Freshness } from "../../common/freshness.ts";
import type { GatherEvidenceDeps, GatherKbHit } from "../../common/gather-evidence.ts";
import type { SearchResult } from "../../extensions/web-search/native.ts";

/**
 * Build a freshness verdict with the given status and source date.
 *
 * @param status - Freshness status.
 * @param newestSourcePublished - Newest cited source date, if any.
 * @returns A complete freshness object.
 */
function freshness(status: Freshness["status"], newestSourcePublished: string | null): Freshness {
  return {
    status,
    basis: "source",
    ageDays: 10,
    windowDays: 365,
    reviewed: null,
    newestSourcePublished,
    lastVerified: null,
    noteModified: null,
  };
}

/**
 * Build a KB hit.
 *
 * @param path - Note path.
 * @param freshnessValue - Freshness verdict for the note.
 * @param title - Note title (defaults to the path).
 * @returns A KB hit for the fake searchKb.
 */
function kbHit(path: string, freshnessValue: Freshness, title = path): GatherKbHit {
  return { path, title, description: "", freshness: freshnessValue };
}

/**
 * Build a web search result.
 *
 * @param url - Result URL.
 * @param tier - Search tier reported by the provider.
 * @returns A SearchResult for the fake searchWeb.
 */
function webResult(url: string, tier: number): SearchResult {
  return { title: url, url, snippet: "", source_label: "fake", tier };
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
    searchWeb: () => Promise.resolve([]),
    fetch: () => Promise.resolve({ title: "Fetched", content: "body" }),
    now: () => new Date("2025-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("gatherEvidence — KB coverage", () => {
  it("should skip the web for fresh KB hits unless forced, marking the query kbCovered", async () => {
    const searchWeb = vi.fn(() => Promise.resolve([]));
    const deps = makeDeps({
      searchKb: () => [kbHit("notes/a.md", freshness("fresh", "2024-12-01"), "Fresh topic notes")],
      searchWeb,
    });

    const pack = await gatherEvidence({ question: "q", queries: ["fresh topic"] }, deps);

    expect(searchWeb).not.toHaveBeenCalled();
    expect(pack.queries[0].kbCovered).toBe(true);

    const forced = await gatherEvidence(
      { question: "q", queries: ["fresh topic"], force: true },
      deps,
    );

    expect(searchWeb).toHaveBeenCalledTimes(1);
    expect(forced.queries[0].kbCovered).toBe(false);
  });
});

describe("gatherEvidence — web result handling", () => {
  it("should dedupe by canonical URL, fetch at most maxSources ranked by trust and record failures", async () => {
    const fetched: string[] = [];
    const deps = makeDeps({
      searchKb: () => [kbHit("notes/a.md", freshness("stale", "2020-01-01"), "Topic notes")],
      searchWeb: () =>
        Promise.resolve([
          webResult("https://blog.example.com/post", 1),
          webResult("https://www.nature.com/articles/x", 3),
          webResult("https://www.nature.com/articles/x?utm_source=feed", 1),
          webResult("https://example.edu/study", 2),
        ]),
      fetch: (url) => {
        fetched.push(url);
        if (url.includes("nature.com")) {
          return Promise.resolve({ error: "blocked by paywall" });
        }
        return Promise.resolve({
          title: "Study",
          content: `  Intro   text \n\n ${"x".repeat(2000)}  `,
        });
      },
    });

    const pack = await gatherEvidence({ question: "q", queries: ["topic"], maxSources: 2 }, deps);

    expect(fetched).toEqual(["https://www.nature.com/articles/x", "https://example.edu/study"]);
    expect(pack.sources).toHaveLength(2);
    expect(pack.sources[0].trust).toBe("peer-reviewed");
    expect(pack.sources[0].fetchError).toBe("blocked by paywall");
    expect(pack.sources[1].trust).toBe("gov-edu");
    expect(pack.sources[1].fetchError).toBeUndefined();
    expect(pack.sources[1].excerpt).toHaveLength(1500);
    expect(pack.sources[1].excerpt).not.toContain("  ");
  });
});

describe("gatherEvidence — since date", () => {
  it("should pass the newest source date of stale KB hits as since", async () => {
    const searchWeb = vi.fn(() => Promise.resolve([]));
    const deps = makeDeps({
      searchKb: () => [
        kbHit("notes/old.md", freshness("stale", "2023-01-01"), "Topic old notes"),
        kbHit("notes/newer.md", freshness("aging", "2024-06-15"), "Topic newer notes"),
        kbHit("notes/fresh.md", freshness("fresh", "2025-01-01"), "Topic fresh notes"),
      ],
      searchWeb,
    });

    const pack = await gatherEvidence({ question: "q", queries: ["topic"] }, deps);

    expect(searchWeb).toHaveBeenCalledWith("topic", { since: "2024-06-15" });
    expect(pack.queries[0].since).toBe("2024-06-15");
  });
});
