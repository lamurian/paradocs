import { describe, it, expect } from "vitest";

describe("wordTrigrams", () => {
  it("should generate trigrams from text with 4+ words", async () => {
    const { wordTrigrams } = await import("../../extensions/para-knowledge/similarity.js");
    const result = wordTrigrams("the quick brown fox");
    expect(result.size).toBe(2);
    expect(result.has("the quick brown")).toBe(true);
    expect(result.has("quick brown fox")).toBe(true);
  });

  it("should return empty set for text with fewer than 3 words", async () => {
    const { wordTrigrams } = await import("../../extensions/para-knowledge/similarity.js");
    expect(wordTrigrams("hello world").size).toBe(0);
  });

  it("should return empty set for empty string", async () => {
    const { wordTrigrams } = await import("../../extensions/para-knowledge/similarity.js");
    expect(wordTrigrams("").size).toBe(0);
  });

  it("should lowercase text before generating trigrams", async () => {
    const { wordTrigrams } = await import("../../extensions/para-knowledge/similarity.js");
    const result = wordTrigrams("The Quick Brown Fox");
    expect(result.has("the quick brown")).toBe(true);
  });

  it("should split on non-alphanumeric characters", async () => {
    const { wordTrigrams } = await import("../../extensions/para-knowledge/similarity.js");
    const result = wordTrigrams("the quick-brown fox!jumps");
    expect(result.has("the quick brown")).toBe(true);
    expect(result.has("quick brown fox")).toBe(true);
    expect(result.has("brown fox jumps")).toBe(true);
  });
});

describe("jaccardSimilarity", () => {
  it("should return 1 for identical sets", async () => {
    const { jaccardSimilarity } = await import("../../extensions/para-knowledge/similarity.js");
    const a = new Set(["a", "b"]);
    expect(jaccardSimilarity(a, a)).toBe(1);
  });

  it("should return 0 for disjoint sets", async () => {
    const { jaccardSimilarity } = await import("../../extensions/para-knowledge/similarity.js");
    expect(jaccardSimilarity(new Set(["a"]), new Set(["b"]))).toBe(0);
  });

  it("should return correct fraction for partially overlapping sets", async () => {
    const { jaccardSimilarity } = await import("../../extensions/para-knowledge/similarity.js");
    const a = new Set(["a", "b", "c"]);
    const b = new Set(["b", "c", "d"]);
    // intersection = {b, c} = 2, union = {a, b, c, d} = 4
    expect(jaccardSimilarity(a, b)).toBe(0.5);
  });

  it("should return 0 when both sets are empty", async () => {
    const { jaccardSimilarity } = await import("../../extensions/para-knowledge/similarity.js");
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
  });

  it("should handle one empty set", async () => {
    const { jaccardSimilarity } = await import("../../extensions/para-knowledge/similarity.js");
    expect(jaccardSimilarity(new Set(["a"]), new Set())).toBe(0);
  });
});

describe("textSimilarity", () => {
  it("should return 1 for identical text", async () => {
    const { textSimilarity } = await import("../../extensions/para-knowledge/similarity.js");
    expect(textSimilarity("the quick brown fox", "the quick brown fox")).toBe(1);
  });

  it("should return 0 for completely different text", async () => {
    const { textSimilarity } = await import("../../extensions/para-knowledge/similarity.js");
    expect(textSimilarity("the quick brown fox", "jumps over the lazy dog")).toBe(0);
  });

  it("should be symmetric", async () => {
    const { textSimilarity } = await import("../../extensions/para-knowledge/similarity.js");
    const a = "the quick brown fox";
    const b = "the quick brown dog";
    expect(textSimilarity(a, b)).toBe(textSimilarity(b, a));
  });

  it("should return partial similarity for overlapping trigrams", async () => {
    const { textSimilarity } = await import("../../extensions/para-knowledge/similarity.js");
    // "the quick brown fox" → {"the quick brown", "quick brown fox"}
    // "the quick brown dog" → {"the quick brown", "quick brown dog"}
    // intersection = {"the quick brown"} = 1
    // union = {"the quick brown", "quick brown fox", "quick brown dog"} = 3
    const sim = textSimilarity("the quick brown fox", "the quick brown dog");
    expect(sim).toBeCloseTo(1 / 3, 5);
  });

  it("should return 0 when one text is too short for trigrams", async () => {
    const { textSimilarity } = await import("../../extensions/para-knowledge/similarity.js");
    expect(textSimilarity("hi", "the quick brown fox")).toBe(0);
  });
});
