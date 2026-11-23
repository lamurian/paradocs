/**
 * Tests for common/gather-kb.ts — KB relevance coverage gating.
 *
 * All hits are in-memory fakes; no KB or network access happens here.
 *
 * @module tests/common/gather-kb
 */

import { describe, expect, it } from "vitest";

import { evaluateKbCoverage } from "../../common/gather-kb.ts";

import type { Freshness } from "../../common/freshness.ts";
import type { GatherKbHit } from "../../common/gather-kb.ts";

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
 * @param title - Note title.
 * @param freshnessValue - Freshness verdict for the note.
 * @param extra - Optional tags and body overrides.
 * @returns A KB hit for evaluateKbCoverage.
 */
function kbHit(
  path: string,
  title: string,
  freshnessValue: Freshness,
  extra: { description?: string; tags?: string[]; body?: string } = {},
): GatherKbHit {
  return {
    path,
    title,
    description: extra.description ?? "",
    freshness: freshnessValue,
    tags: extra.tags,
    body: extra.body,
  };
}

describe("evaluateKbCoverage", () => {
  it("does not cover a fresh query when its hits score below kbThreshold", () => {
    const hit = kbHit("Resources/vimb.md", "Vimb browser", freshness("fresh", "2025-01-01"), {
      description: "A keyboard-driven browser",
    });

    const coverage = evaluateKbCoverage("github app setup url", [hit]);

    expect(coverage.kbCovered).toBe(false);
    expect(coverage.since).toBeNull();
    expect(coverage.kbHits).toHaveLength(1);
    expect(coverage.kbHits[0].relevance).toBe(0);
    expect(coverage.kbHits[0].relevant).toBe(false);
  });

  it("covers a fresh query when title and description carry the query terms", () => {
    const hit = kbHit("Projects/github-app.md", "GitHub App setup", freshness("fresh", null), {
      description: "Set up a GitHub app for your account",
    });

    const coverage = evaluateKbCoverage("github app setup", [hit]);

    expect(coverage.kbCovered).toBe(true);
    expect(coverage.since).toBeNull();
    expect(coverage.kbHits[0].relevance).toBe(1);
    expect(coverage.kbHits[0].relevant).toBe(true);
  });

  it("lists at most the top five hits with their score and label", () => {
    const hits = Array.from({ length: 7 }, (_, index) =>
      kbHit(`Resources/note-${index}.md`, "Topic notes", freshness("fresh", null)),
    );

    const coverage = evaluateKbCoverage("topic", hits);

    expect(coverage.kbHits).toHaveLength(5);
    expect(coverage.kbHits[0].path).toBe("Resources/note-0.md");
    expect(coverage.kbHits[0].relevance).toBe(1);
    expect(coverage.kbHits[0].relevant).toBe(true);
  });

  it("uses the newest date among accepted non-fresh hits as since", () => {
    const hits = [
      kbHit("notes/old.md", "Topic notes old", freshness("stale", "2023-01-01")),
      kbHit("notes/newer.md", "Topic notes newer", freshness("aging", "2024-06-15")),
      kbHit("notes/fresh.md", "Topic notes fresh", freshness("fresh", "2025-01-01")),
    ];

    const coverage = evaluateKbCoverage("topic notes", hits);

    expect(coverage.kbCovered).toBe(false);
    expect(coverage.since).toBe("2024-06-15");
  });

  it("does not cover a forced query even when an accepted hit is fresh", () => {
    const hit = kbHit("Projects/topic.md", "Topic notes", freshness("fresh", null));

    const coverage = evaluateKbCoverage("topic notes", [hit], { force: true });

    expect(coverage.kbCovered).toBe(false);
    expect(coverage.kbHits[0].relevant).toBe(true);
  });

  it("credits tags as a strong field and body at bodyWeight", () => {
    const tagged = kbHit("Resources/topic.md", "Topic", freshness("fresh", null), {
      tags: ["detail"],
    });
    const bodyOnly = kbHit("Resources/body.md", "Topic", freshness("fresh", null), {
      body: "detail",
    });

    const tagCoverage = evaluateKbCoverage("topic detail", [tagged]);
    const bodyCoverage = evaluateKbCoverage("topic detail", [bodyOnly]);

    expect(tagCoverage.kbHits[0].relevance).toBe(1);
    expect(tagCoverage.kbHits[0].relevant).toBe(true);
    expect(bodyCoverage.kbHits[0].relevance).toBe(0.75);
    expect(bodyCoverage.kbHits[0].relevant).toBe(true);
  });
});
