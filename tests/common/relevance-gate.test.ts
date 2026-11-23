import { describe, expect, it } from "vitest";

import { gateByRelevance } from "../../common/relevance-gate.ts";

import type { RelevanceDoc, RelevanceScorer } from "../../common/relevance.ts";

/**
 * Build a scorer from a fixed per-item mapping keyed by item id.
 *
 * @param name Scorer name.
 * @param scores Map of item id to verdict score.
 * @param passingIds Item ids that pass this scorer.
 * @returns A deterministic scorer for tests.
 */
function scorerFrom(
  name: string,
  scores: Record<string, number>,
  passingIds: string[],
): RelevanceScorer {
  return {
    name,
    evaluate(_query: string, doc: RelevanceDoc): { score: number; pass: boolean } {
      const id = doc.strong[0] ?? "";
      return { score: scores[id] ?? 0, pass: passingIds.includes(id) };
    },
  };
}

/**
 * Map an item to a doc whose strong field is the item id.
 *
 * @param item Item identifier.
 * @returns Relevance document for the item.
 */
function toDoc(item: string): RelevanceDoc {
  return { strong: [item] };
}

describe("gateByRelevance", () => {
  it("accepts an item only when every scorer passes", () => {
    const lexical = scorerFrom("lexical", { a: 0.9, b: 0.9 }, ["a", "b"]);
    const semantic = scorerFrom("semantic", { a: 0.2, b: 0.9 }, ["b"]);

    const result = gateByRelevance("query", ["a", "b"], toDoc, {
      scorers: [lexical, semantic],
      relativeCut: 0.5,
      maxHits: 10,
    });

    expect(result.accepted.map((entry) => entry.item)).toEqual(["b"]);
    expect(result.rejected.map((entry) => entry.item)).toEqual(["a"]);
    expect(result.accepted[0]?.scores).toEqual({ lexical: 0.9, semantic: 0.9 });
    expect(result.accepted[0]?.pass).toBe(true);
    expect(result.rejected[0]?.pass).toBe(false);
  });

  it("sorts by score descending and cuts below relativeCut x best", () => {
    const lexical = scorerFrom("lexical", { low: 0.4, high: 0.9, mid: 0.8 }, [
      "low",
      "high",
      "mid",
    ]);

    const result = gateByRelevance("query", ["low", "high", "mid"], toDoc, {
      scorers: [lexical],
      relativeCut: 0.9,
      maxHits: 10,
    });

    expect(result.accepted.map((entry) => entry.item)).toEqual(["high"]);
    expect(result.rejected.map((entry) => entry.item)).toEqual(["low", "mid"]);
  });

  it("keeps ties in input order", () => {
    const lexical = scorerFrom("lexical", { a: 0.8, b: 0.8, c: 0.8 }, ["a", "b", "c"]);

    const result = gateByRelevance("query", ["a", "b", "c"], toDoc, {
      scorers: [lexical],
      relativeCut: 0.9,
      maxHits: 10,
    });

    expect(result.accepted.map((entry) => entry.item)).toEqual(["a", "b", "c"]);
  });

  it("caps accepted at maxHits and rejects the overflow", () => {
    const lexical = scorerFrom("lexical", { a: 0.9, b: 0.85, c: 0.8 }, ["a", "b", "c"]);

    const result = gateByRelevance("query", ["a", "b", "c"], toDoc, {
      scorers: [lexical],
      relativeCut: 0.5,
      maxHits: 2,
    });

    expect(result.accepted.map((entry) => entry.item)).toEqual(["a", "b"]);
    expect(result.rejected.map((entry) => entry.item)).toEqual(["c"]);
  });

  it("abstains with an empty accepted list when nothing passes", () => {
    const lexical = scorerFrom("lexical", { a: 0.2, b: 0.1 }, []);

    const result = gateByRelevance("query", ["a", "b"], toDoc, {
      scorers: [lexical],
      relativeCut: 0.9,
      maxHits: 3,
    });

    expect(result.accepted).toEqual([]);
    expect(result.rejected.map((entry) => entry.item)).toEqual(["a", "b"]);
  });

  it("returns empty results for empty input", () => {
    const lexical = scorerFrom("lexical", {}, []);

    const result = gateByRelevance("query", [], toDoc, {
      scorers: [lexical],
      relativeCut: 0.9,
      maxHits: 3,
    });

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([]);
  });
});
