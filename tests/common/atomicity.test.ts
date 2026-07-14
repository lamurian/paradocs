/**
 * Tests for common/atomicity.ts — atomicity validation guardrail.
 *
 * The only tool-level atomicity check is the single-topic heuristic
 * (keyword overlap between title and heading sections).
 * Paragraph counts and heading counts are no longer validated at the
 * tool level — the primary atomicity gate is LLM decomposition at the
 * command level, guided by the Q&A criterion (one research question,
 * one indicative answer).
 *
 * @module tests/common/atomicity.test
 */

import { describe, it, expect } from "vitest";

describe("validateAtomicity — single-topic / multi-topic detection", () => {
  it("should fail content with 2+ headings unrelated to title", async () => {
    const { validateAtomicity } = await import("../../common/atomicity.js");
    const content = [
      "## Quantum Computing",
      "Details about quantum computing.",
      "## French Cuisine",
      "Details about French cuisine.",
      "## Test Topic",
      "Details about the main topic.",
    ].join("\n\n");
    const result = validateAtomicity(content, "Test Topic");
    expect(result.valid).toBe(false);
    expect(result.rule).toBe("single-topic");
  });

  it("should pass content where all headings share keywords with the title", async () => {
    const { validateAtomicity } = await import("../../common/atomicity.js");
    const content = [
      "## Topic Climate",
      "Impact of climate on the topic.",
      "## Topic Economy",
      "Economic aspects of the topic.",
      "## Topic Society",
      "Social dimensions of the topic.",
    ].join("\n\n");
    const result = validateAtomicity(content, "Topic Analysis");
    expect(result.valid).toBe(true);
  });

  it("should pass content with single heading and no unrelated sections", async () => {
    const { validateAtomicity } = await import("../../common/atomicity.js");
    const content =
      "## All About Topic\n\nThis is all about the topic. It covers various aspects.\n\nMore details about the topic.";
    const result = validateAtomicity(content, "All About Topic");
    expect(result.valid).toBe(true);
  });

  it("should pass content with 20 paragraphs if single-topic (paragraph limit removed)", async () => {
    const { validateAtomicity } = await import("../../common/atomicity.js");
    const paragraphs = Array.from(
      { length: 20 },
      (_, i) => `## Topic Aspect ${i + 1}\n\nDetail about aspect ${i + 1} of the main topic.`,
    );
    const content = paragraphs.join("\n\n");
    const result = validateAtomicity(content, "Main Topic");
    expect(result.valid).toBe(true);
  });

  it("should pass content with 10 headings if single-topic (heading limit removed)", async () => {
    const { validateAtomicity } = await import("../../common/atomicity.js");
    const content = Array.from(
      { length: 10 },
      (_, i) => `## Topic Section ${i + 1}\n\nContent of topic section ${i + 1}.`,
    ).join("\n\n");
    const result = validateAtomicity(content, "Topic");
    expect(result.valid).toBe(true);
  });

  it("should pass content with many paragraphs and headings if coherent", async () => {
    const { validateAtomicity } = await import("../../common/atomicity.js");
    const sections = Array.from(
      { length: 15 },
      (_, i) =>
        `## Topic Aspect ${i + 1}\n\nParagraph A of aspect ${i + 1}.\n\nParagraph B of aspect ${i + 1}.\n\nParagraph C of aspect ${i + 1}.`,
    );
    const content = sections.join("\n\n");
    const result = validateAtomicity(content, "Topic");
    expect(result.valid).toBe(true);
  });
});
