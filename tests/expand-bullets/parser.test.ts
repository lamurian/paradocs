import { describe, it, expect } from "vitest";

describe("parseFrontmatter (expand-bullets)", () => {
  it("should extract tags, title, and body from frontmatter", async () => {
    const { parseFrontmatter } = await import("../../extensions/expand-bullets/parser.js");
    const content = `---
title: My Document
tags:
  - tag1
  - tag2
---

This is the body.`;
    const result = parseFrontmatter(content);
    expect(result.title).toBe("My Document");
    expect(result.tags).toEqual(["tag1", "tag2"]);
    expect(result.body).toBe("This is the body.");
  });

  it("should return full content as body when no frontmatter", async () => {
    const { parseFrontmatter } = await import("../../extensions/expand-bullets/parser.js");
    const result = parseFrontmatter("Just body content");
    expect(result.tags).toEqual([]);
    expect(result.title).toBeUndefined();
    expect(result.body).toBe("Just body content");
  });

  it("should handle frontmatter without tags", async () => {
    const { parseFrontmatter } = await import("../../extensions/expand-bullets/parser.js");
    const content = `---
title: No Tags
---

Body here`;
    const result = parseFrontmatter(content);
    expect(result.title).toBe("No Tags");
    expect(result.tags).toEqual([]);
    expect(result.body).toBe("Body here");
  });
});

describe("extractBullets", () => {
  it("should extract bullet points with heading context", async () => {
    const { extractBullets } = await import("../../extensions/expand-bullets/parser.js");
    const body = `## Section 1
- bullet one
- bullet two

### Subsection
- bullet three`;
    const result = extractBullets(body);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      text: "bullet one",
      context: "Section 1",
    });
    expect(result[1]).toEqual({
      text: "bullet two",
      context: "Section 1",
    });
    expect(result[2]).toEqual({
      text: "bullet three",
      context: "Subsection",
    });
  });

  it("should return empty array for body with no bullets", async () => {
    const { extractBullets } = await import("../../extensions/expand-bullets/parser.js");
    expect(extractBullets("Just plain text")).toEqual([]);
  });

  it("should filter bullets starting with [, http, or @", async () => {
    const { extractBullets } = await import("../../extensions/expand-bullets/parser.js");
    const body = `## Section
- [reference]
- http://example.com
- @user
- valid bullet`;
    const result = extractBullets(body);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("valid bullet");
  });

  it("should filter bullets longer than 200 characters", async () => {
    const { extractBullets } = await import("../../extensions/expand-bullets/parser.js");
    const longText = "a".repeat(201);
    const body = `## Section\n- ${longText}\n- short bullet`;
    const result = extractBullets(body);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("short bullet");
  });

  it("should use empty context for bullets before any heading", async () => {
    const { extractBullets } = await import("../../extensions/expand-bullets/parser.js");
    const body = "- leading bullet\n## Heading\n- headed bullet";
    const result = extractBullets(body);
    expect(result).toHaveLength(2);
    expect(result[0].context).toBe("");
    expect(result[1].context).toBe("Heading");
  });

  it("should handle indented bullet lines", async () => {
    const { extractBullets } = await import("../../extensions/expand-bullets/parser.js");
    const body = "## Stuff\n  - indented bullet\n\t- tabbed bullet";
    const result = extractBullets(body);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe("indented bullet");
    expect(result[1].text).toBe("tabbed bullet");
  });
});

describe("buildSearchQuery", () => {
  it("should build query with context", async () => {
    const { buildSearchQuery } = await import("../../extensions/expand-bullets/parser.js");
    const result = buildSearchQuery({
      text: "machine learning",
      context: "AI",
    });
    expect(result).toBe("(site:edu OR site:ac.* OR site:gov) machine learning AI");
  });

  it("should build query without context", async () => {
    const { buildSearchQuery } = await import("../../extensions/expand-bullets/parser.js");
    const result = buildSearchQuery({ text: "hello world", context: "" });
    expect(result).toBe("(site:edu OR site:ac.* OR site:gov) hello world");
  });

  it("should handle context with spaces", async () => {
    const { buildSearchQuery } = await import("../../extensions/expand-bullets/parser.js");
    const result = buildSearchQuery({
      text: "term",
      context: "multi word context",
    });
    expect(result).toBe("(site:edu OR site:ac.* OR site:gov) term multi word context");
  });
});
