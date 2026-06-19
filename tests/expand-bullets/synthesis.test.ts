import { describe, it, expect } from "vitest";

describe("synthesizeExpansion", () => {
  it("should synthesise expansion using first result snippet", async () => {
    const { synthesizeExpansion } = await import("../../extensions/expand-bullets/synthesis.js");
    const bullet = { text: "machine learning", context: "AI" };
    const results = [
      {
        title: "ML Wiki",
        url: "https://en.wikipedia.org/wiki/Machine_learning",
        snippet: "Machine learning (ML) is a field of study in artificial intelligence",
      },
    ];
    const result = synthesizeExpansion(bullet, results);
    expect(result).toContain("**machine learning**");
    expect(result).toContain("field of study");
  });

  it("should generate fallback text when no results are provided", async () => {
    const { synthesizeExpansion } = await import("../../extensions/expand-bullets/synthesis.js");
    const bullet = { text: "quantum computing", context: "Physics" };
    const result = synthesizeExpansion(bullet, []);
    expect(result).toContain("**quantum computing**");
    expect(result).toContain("Physics");
    expect(result).toContain("This concept relates to");
  });

  it("should use 'the broader topic' fallback when context is empty", async () => {
    const { synthesizeExpansion } = await import("../../extensions/expand-bullets/synthesis.js");
    const bullet = { text: "something", context: "" };
    const result = synthesizeExpansion(bullet, []);
    expect(result).toContain("the broader topic");
  });

  it("should include extra snippets from additional results (up to 3 total)", async () => {
    const { synthesizeExpansion } = await import("../../extensions/expand-bullets/synthesis.js");
    const bullet = { text: "term", context: "Context" };
    const results = [
      {
        title: "A",
        url: "https://a.com",
        snippet: "First result snippet",
      },
      {
        title: "B",
        url: "https://b.com",
        snippet: "Second result snippet",
      },
      {
        title: "C",
        url: "https://c.com",
        snippet: "Third result snippet",
      },
    ];
    const result = synthesizeExpansion(bullet, results);
    expect(result).toContain("First result snippet");
    expect(result).toContain("Second result snippet");
    // slice(1, 3) includes index 1 and 2 (all extras)
    expect(result).toContain("Third result snippet");
  });

  it("should handle results with empty snippets gracefully", async () => {
    const { synthesizeExpansion } = await import("../../extensions/expand-bullets/synthesis.js");
    const bullet = { text: "test", context: "Testing" };
    const results = [{ title: "A", url: "https://a.com", snippet: "" }];
    const result = synthesizeExpansion(bullet, results);
    expect(result).toContain("**test**");
    expect(result).toContain("Testing");
  });

  it("should normalise whitespace in snippets", async () => {
    const { synthesizeExpansion } = await import("../../extensions/expand-bullets/synthesis.js");
    const bullet = { text: "test", context: "" };
    const results = [
      {
        title: "A",
        url: "https://a.com",
        snippet: "lots    of   spaces\nand\nnewlines",
      },
    ];
    const result = synthesizeExpansion(bullet, results);
    expect(result).toContain("lots of spaces and newlines");
    expect(result).not.toContain("    ");
  });
});
