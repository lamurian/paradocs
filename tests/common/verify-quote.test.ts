/**
 * Tests for common/verify-quote.ts — deterministic quote verification.
 *
 * @module tests/common/verify-quote
 */

import { describe, expect, it } from "vitest";

import { verifyQuote } from "../../common/verify-quote.ts";

describe("verifyQuote — exact matching", () => {
  it("should return exact with score 1 when the normalized quote is a substring", () => {
    const result = verifyQuote(
      "The Quick “Brown” Fox — *really*",
      'Here, THE QUICK "BROWN" FOX - REALLY appears in a sentence.',
    );

    expect(result.match).toBe("exact");
    expect(result.score).toBe(1);
    expect(result.excerpt).toBe('the quick "brown" fox - really');
  });

  it("should strip markdown emphasis and collapse whitespace before matching", () => {
    const result = verifyQuote("alpha   _beta_", "Some alpha\n\nbeta gamma");

    expect(result.match).toBe("exact");
    expect(result.score).toBe(1);
    expect(result.excerpt).toBe("alpha beta");
  });
});

describe("verifyQuote — fuzzy matching", () => {
  it("should return fuzzy with the best window when it scores at or above the threshold", () => {
    const result = verifyQuote("alpha beta gamma delta", "alpha beta gamma epsilon", {
      threshold: 0.7,
    });

    expect(result.match).toBe("fuzzy");
    expect(result.score).toBeCloseTo(0.75, 6);
    expect(result.excerpt).toBe("alpha beta gamma epsilon");
  });

  it("should return not-found below the default threshold with the best score", () => {
    const result = verifyQuote("alpha beta gamma delta", "alpha beta gamma epsilon");

    expect(result.match).toBe("not-found");
    expect(result.score).toBeCloseTo(0.75, 6);
    expect(result.excerpt).toBeNull();
  });

  it("should return not-found when the quote has no tokens", () => {
    const result = verifyQuote("   ", "some source text");

    expect(result.match).toBe("not-found");
    expect(result.score).toBe(0);
    expect(result.excerpt).toBeNull();
  });

  it("should return not-found when the source is shorter than the quote", () => {
    const result = verifyQuote("alpha beta gamma", "alpha beta");

    expect(result.match).toBe("not-found");
    expect(result.score).toBe(0);
    expect(result.excerpt).toBeNull();
  });
});
