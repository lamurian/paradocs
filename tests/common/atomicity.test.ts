/**
 * Tests for common/atomicity.ts — atomicity validation guardrail.
 *
 * Tests the updated limits:
 * - Standard: ≤6 paragraphs, ≤3 headings
 * - In-depth (deep): ≤10 paragraphs, ≤4 headings
 * - Multi-topic detection: threshold 2+ unrelated sections → fail
 *
 * @module tests/common/atomicity.test
 */

import { describe, it, expect } from "vitest";

describe("validateAtomicity — standard limits", () => {
  it("should pass content with 6 paragraphs (new standard limit)", async () => {
    const { validateAtomicity } = await import("../../common/atomicity.js");
    const paragraphs = Array.from(
      { length: 6 },
      (_, i) => `Paragraph ${i + 1}. Some content here.`,
    );
    const content = paragraphs.join("\n\n");
    const result = validateAtomicity(content, "Test Topic");
    expect(result.valid).toBe(true);
  });

  it("should fail content with 7 paragraphs (exceeds standard limit)", async () => {
    const { validateAtomicity } = await import("../../common/atomicity.js");
    const paragraphs = Array.from(
      { length: 7 },
      (_, i) => `Paragraph ${i + 1}. Some content here.`,
    );
    const content = paragraphs.join("\n\n");
    const result = validateAtomicity(content, "Test Topic");
    expect(result.valid).toBe(false);
    expect(result.rule).toBe("paragraph-limit");
    expect(result.count).toBe(7);
  });

  it("should pass content with 3 headings (new standard limit)", async () => {
    const { validateAtomicity } = await import("../../common/atomicity.js");
    const content = [
      "## Topic First Section",
      "Content of first section.",
      "## Topic Second Section",
      "Content of second section.",
      "## Topic Third Section",
      "Content of third section.",
    ].join("\n\n");
    const result = validateAtomicity(content, "Test Topic");
    expect(result.valid).toBe(true);
  });

  it("should fail content with 4 headings (exceeds standard limit)", async () => {
    const { validateAtomicity } = await import("../../common/atomicity.js");
    const content = [
      "## First Section",
      "Content 1.",
      "## Second Section",
      "Content 2.",
      "## Third Section",
      "Content 3.",
      "## Fourth Section",
      "Content 4.",
    ].join("\n\n");
    const result = validateAtomicity(content, "Test Topic");
    expect(result.valid).toBe(false);
    expect(result.rule).toBe("heading-limit");
    expect(result.count).toBe(4);
  });

  it("should pass content exactly at standard paragraph limit (6)", async () => {
    const { validateAtomicity } = await import("../../common/atomicity.js");
    const content = [
      "Para one.",
      "Para two.",
      "Para three.",
      "Para four.",
      "Para five.",
      "Para six.",
    ].join("\n\n");
    const result = validateAtomicity(content, "Boundary Topic");
    expect(result.valid).toBe(true);
  });
});

describe("validateAtomicity — in-depth (deep) limits", () => {
  it("should pass content with 10 paragraphs when deep=true", async () => {
    const { validateAtomicity } = await import("../../common/atomicity.js");
    const paragraphs = Array.from(
      { length: 10 },
      (_, i) => `Paragraph ${i + 1}. Detailed content.`,
    );
    const content = paragraphs.join("\n\n");
    const result = validateAtomicity(content, "Deep Topic", { deep: true });
    expect(result.valid).toBe(true);
  });

  it("should fail content with 11 paragraphs when deep=true", async () => {
    const { validateAtomicity } = await import("../../common/atomicity.js");
    const paragraphs = Array.from({ length: 11 }, (_, i) => `Paragraph ${i + 1}. Content.`);
    const content = paragraphs.join("\n\n");
    const result = validateAtomicity(content, "Deep Topic", { deep: true });
    expect(result.valid).toBe(false);
    expect(result.rule).toBe("paragraph-limit");
    expect(result.count).toBe(11);
  });

  it("should pass content with 4 headings when deep=true", async () => {
    const { validateAtomicity } = await import("../../common/atomicity.js");
    const content = [
      "## Deep First",
      "Content 1.",
      "## Deep Second",
      "Content 2.",
      "## Deep Third",
      "Content 3.",
      "## Deep Fourth",
      "Content 4.",
    ].join("\n\n");
    const result = validateAtomicity(content, "Deep Topic", { deep: true });
    expect(result.valid).toBe(true);
  });

  it("should fail content with 5 headings when deep=true", async () => {
    const { validateAtomicity } = await import("../../common/atomicity.js");
    const content = [
      "## First Section",
      "Content 1.",
      "## Second Section",
      "Content 2.",
      "## Third Section",
      "Content 3.",
      "## Fourth Section",
      "Content 4.",
      "## Fifth Section",
      "Content 5.",
    ].join("\n\n");
    const result = validateAtomicity(content, "Deep Topic", { deep: true });
    expect(result.valid).toBe(false);
    expect(result.rule).toBe("heading-limit");
    expect(result.count).toBe(5);
  });

  it("should reject 10 paragraphs without deep flag (uses standard limit)", async () => {
    const { validateAtomicity } = await import("../../common/atomicity.js");
    const paragraphs = Array.from({ length: 10 }, (_, i) => `Para ${i + 1}. Content.`);
    const content = paragraphs.join("\n\n");
    const result = validateAtomicity(content, "Standard Topic");
    expect(result.valid).toBe(false);
    expect(result.rule).toBe("paragraph-limit");
    expect(result.count).toBe(10);
  });
});

describe("validateAtomicity — single-topic / multi-topic detection", () => {
  it("should fail content with 2+ headings unrelated to title (threshold now 2)", async () => {
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

  it("should pass single-topic depth with 8 paragraphs when deep=true", async () => {
    const { validateAtomicity } = await import("../../common/atomicity.js");
    // 2 headings, each with 4 paragraphs = 8 paragraphs total, ≤4 heading limit
    const content = [
      "## Topic Aspect One",
      "First paragraph under aspect one.",
      "Second paragraph under aspect one.",
      "Third paragraph under aspect one.",
      "Fourth paragraph under aspect one.",
      "## Topic Aspect Two",
      "First paragraph under aspect two.",
      "Second paragraph under aspect two.",
      "Third paragraph under aspect two.",
      "Fourth paragraph under aspect two.",
    ].join("\n\n");
    const result = validateAtomicity(content, "Main Topic", { deep: true });
    expect(result.valid).toBe(true);
  });

  it("should pass content with single heading and no unrelated sections", async () => {
    const { validateAtomicity } = await import("../../common/atomicity.js");
    const content =
      "## All About Topic\n\nThis is all about the topic. It covers various aspects.\n\nMore details about the topic.";
    const result = validateAtomicity(content, "All About Topic");
    expect(result.valid).toBe(true);
  });
});
