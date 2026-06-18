import { describe, it, expect } from "vitest";

describe("tokenize", () => {
  it("should tokenize text into lowercase words", async () => {
    const { tokenize } = await import("../common/tokenize.js");
    expect(tokenize("Hello World Testing")).toEqual(["hello", "world", "testing"]);
  });

  it("should remove stop words", async () => {
    const { tokenize } = await import("../common/tokenize.js");
    expect(tokenize("the cat and the dog")).toEqual(["cat", "dog"]);
  });

  it("should remove single-character tokens", async () => {
    const { tokenize } = await import("../common/tokenize.js");
    expect(tokenize("a b c hello")).toEqual(["hello"]);
  });

  it("should split on non-alphanumeric characters", async () => {
    const { tokenize } = await import("../common/tokenize.js");
    expect(tokenize("hello-world, test! num1")).toEqual(["hello", "world", "test", "num1"]);
  });

  it("should return empty array for empty string", async () => {
    const { tokenize } = await import("../common/tokenize.js");
    expect(tokenize("")).toEqual([]);
  });

  it("should return empty array for stop-word-only text", async () => {
    const { tokenize } = await import("../common/tokenize.js");
    expect(tokenize("the and or of")).toEqual([]);
  });
});

describe("bm25TermScore", () => {
  it("should compute a positive score for matching terms", async () => {
    const { bm25TermScore } = await import("../common/tokenize.js");
    const score = bm25TermScore(3, 10, 100, 50, 40);
    expect(score).toBeGreaterThan(0);
  });

  it("should return 0 when df is 0", async () => {
    const { bm25TermScore } = await import("../common/tokenize.js");
    expect(bm25TermScore(3, 0, 100, 50, 40)).toBe(0);
  });

  it("should return 0 when N is 0", async () => {
    const { bm25TermScore } = await import("../common/tokenize.js");
    expect(bm25TermScore(3, 10, 0, 50, 40)).toBe(0);
  });

  it("should use default k1=1.2 and b=0.75", async () => {
    const { bm25TermScore } = await import("../common/tokenize.js");
    const score = bm25TermScore(2, 5, 50, 30, 25);
    expect(score).toBeGreaterThan(0);
  });

  it("should give higher score for higher term frequency", async () => {
    const { bm25TermScore } = await import("../common/tokenize.js");
    const low = bm25TermScore(1, 5, 50, 30, 25);
    const high = bm25TermScore(5, 5, 50, 30, 25);
    expect(high).toBeGreaterThan(low);
  });

  it("should give higher score for rarer terms (lower df)", async () => {
    const { bm25TermScore } = await import("../common/tokenize.js");
    const common = bm25TermScore(2, 40, 100, 50, 40);
    const rare = bm25TermScore(2, 2, 100, 50, 40);
    expect(rare).toBeGreaterThan(common);
  });

  it("should handle docLength of 0 gracefully", async () => {
    const { bm25TermScore } = await import("../common/tokenize.js");
    // avgDocLen=max(1, 40)=40; docLength=0; should not divide by zero
    const score = bm25TermScore(2, 10, 100, 0, 40);
    expect(score).toBeGreaterThan(0);
    expect(isFinite(score)).toBe(true);
  });
});
