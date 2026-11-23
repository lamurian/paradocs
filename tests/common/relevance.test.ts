import { describe, expect, it } from "vitest";

import { coverageScore, createLexicalScorer, relevanceTokens } from "../../common/relevance.ts";

describe("relevanceTokens", () => {
  it("stems plurals, -ing and -ed forms", () => {
    expect(relevanceTokens("caching cache conflicts conflict")).toEqual([
      "cach",
      "cach",
      "conflict",
      "conflict",
    ]);
  });

  it("drops single-character tokens and stop words", () => {
    expect(relevanceTokens("a the git")).toEqual(["git"]);
  });
});

describe("coverageScore", () => {
  it("returns 1 when every query term appears in a strong field", () => {
    const score = coverageScore("cache conflicts", {
      strong: ["Cache conflicts"],
    });

    expect(score).toBe(1);
  });

  it("returns the body weight when every term appears only in the body", () => {
    const score = coverageScore("cache conflicts", {
      strong: ["unrelated"],
      body: "cache conflicts",
    });

    expect(score).toBe(0.5);
  });

  it("returns the IDF-weighted fraction for partial matches", () => {
    const idf = (term: string): number => (term === "cache" ? 3 : 1);
    const score = coverageScore(
      "cache conflicts",
      { strong: ["cache"], body: "conflicts" },
      { idf },
    );

    expect(score).toBeCloseTo(3.5 / 4);
  });

  it("matches whole stemmed tokens only", () => {
    expect(coverageScore("caching", { strong: ["Cache"] })).toBe(1);
    expect(coverageScore("conflicts", { strong: ["conflict"] })).toBe(1);
    expect(coverageScore("git", { strong: ["digital github"] })).toBe(0);
  });

  it("returns 0 for an empty query", () => {
    expect(coverageScore("", { strong: ["anything"] })).toBe(0);
  });
});

describe("createLexicalScorer", () => {
  const idf = (term: string): number => (term === "git" ? 10 : 1);

  it("fails a doc that meets the threshold without an anchor in a strong field", () => {
    const scorer = createLexicalScorer({ threshold: 0.5, idf });
    const verdict = scorer.evaluate("git cache", {
      strong: ["cache"],
      body: "git",
    });

    expect(verdict.score).toBeGreaterThanOrEqual(0.5);
    expect(verdict.pass).toBe(false);
  });

  it("passes when requireAnchor is false", () => {
    const scorer = createLexicalScorer({
      threshold: 0.5,
      idf,
      requireAnchor: false,
    });
    const verdict = scorer.evaluate("git cache", {
      strong: ["cache"],
      body: "git",
    });

    expect(verdict.pass).toBe(true);
  });

  it("passes when the anchor appears in a strong field", () => {
    const scorer = createLexicalScorer({ threshold: 0.5, idf });
    const verdict = scorer.evaluate("git cache", {
      strong: ["git cache"],
    });

    expect(verdict.pass).toBe(true);
  });
});
