import { describe, it, expect } from "vitest";

describe("yamlQuote (para-knowledge)", () => {
  it("should return plain values as-is", async () => {
    const { yamlQuote } = await import("../../extensions/para-knowledge/frontmatter.js");
    expect(yamlQuote("hello")).toBe("hello");
  });

  it("should quote values with colon-space", async () => {
    const { yamlQuote } = await import("../../extensions/para-knowledge/frontmatter.js");
    expect(yamlQuote("key: value")).toBe("'key: value'");
  });

  it("should quote values with space-hash", async () => {
    const { yamlQuote } = await import("../../extensions/para-knowledge/frontmatter.js");
    expect(yamlQuote("value # comment")).toBe("'value # comment'");
  });

  it("should quote values starting with YAML special chars", async () => {
    const { yamlQuote } = await import("../../extensions/para-knowledge/frontmatter.js");
    expect(yamlQuote("[brackets]")).toBe("'[brackets]'");
    expect(yamlQuote("{braces}")).toBe("'{braces}'");
  });

  it("should quote boolean-like values", async () => {
    const { yamlQuote } = await import("../../extensions/para-knowledge/frontmatter.js");
    expect(yamlQuote("true")).toBe("'true'");
    expect(yamlQuote("false")).toBe("'false'");
    expect(yamlQuote("yes")).toBe("'yes'");
    expect(yamlQuote("no")).toBe("'no'");
  });

  it("should quote numeric strings", async () => {
    const { yamlQuote } = await import("../../extensions/para-knowledge/frontmatter.js");
    expect(yamlQuote("42")).toBe("'42'");
    expect(yamlQuote("3.14")).toBe("'3.14'");
  });

  it("should quote empty string", async () => {
    const { yamlQuote } = await import("../../extensions/para-knowledge/frontmatter.js");
    expect(yamlQuote("")).toBe("''");
  });

  it("should leave values with single quotes unquoted if YAML-safe", async () => {
    const { yamlQuote } = await import("../../extensions/para-knowledge/frontmatter.js");
    // "it's a test" doesn't start with a YAML-special char and isn't
    // boolean/numeric, so it's YAML-safe unquoted
    expect(yamlQuote("it's a test")).toBe("it's a test");
  });

  it("should use double quotes for values starting with single quote", async () => {
    const { yamlQuote } = await import("../../extensions/para-knowledge/frontmatter.js");
    // Starts with ' which is YAML-special, wraps in double quotes
    const result = yamlQuote("'hello'");
    expect(result).toBe(`"'hello'"`);
  });

  it("should escape internal double quotes when using double-quote wrapping", async () => {
    const { yamlQuote } = await import("../../extensions/para-knowledge/frontmatter.js");
    // Value contains both single quote (triggers double-quote mode) and double quotes
    const result = yamlQuote("'\"");
    expect(result).toBe('"\'\\""');
  });
});

describe("parseFrontmatter (para-knowledge)", () => {
  it("should parse standard frontmatter with title and tags", async () => {
    const { parseFrontmatter } = await import("../../extensions/para-knowledge/frontmatter.js");
    const content = `---
title: Test Doc
tags:
  - tag1
  - tag2
---

Body text`;
    const result = parseFrontmatter(content);
    expect(result.title).toBe("Test Doc");
    expect(result.tags).toEqual(["tag1", "tag2"]);
  });

  it("should return default tags when no frontmatter", async () => {
    const { parseFrontmatter } = await import("../../extensions/para-knowledge/frontmatter.js");
    expect(parseFrontmatter("Just content").tags).toEqual([]);
  });

  it("should parse description field", async () => {
    const { parseFrontmatter } = await import("../../extensions/para-knowledge/frontmatter.js");
    const content = `---
title: Test
description: A short description
---`;
    const result = parseFrontmatter(content);
    expect(result.description).toBe("A short description");
  });

  it("should normalise source URL from source field", async () => {
    const { parseFrontmatter } = await import("../../extensions/para-knowledge/frontmatter.js");
    const content = `---
title: Source Test
source: https://example.com
---`;
    const result = parseFrontmatter(content);
    expect(result.source_url).toBe("https://example.com");
  });

  it("should normalise source URL from url field", async () => {
    const { parseFrontmatter } = await import("../../extensions/para-knowledge/frontmatter.js");
    const content = `---
title: URL Test
url: https://example.org
---`;
    const result = parseFrontmatter(content);
    expect(result.source_url).toBe("https://example.org");
  });

  it("should handle quoted values", async () => {
    const { parseFrontmatter } = await import("../../extensions/para-knowledge/frontmatter.js");
    const content = `---
title: 'Quoted Title'
tags:
  - 'tag:with:colons'
---`;
    const result = parseFrontmatter(content);
    expect(result.title).toBe("Quoted Title");
    expect(result.tags).toContain("tag:with:colons");
  });

  it("should handle double-quoted values with escape sequences", async () => {
    const { parseFrontmatter } = await import("../../extensions/para-knowledge/frontmatter.js");
    const content = `---
title: "Title with \\"quotes\\""
---`;
    const result = parseFrontmatter(content);
    expect(result.title).toBe('Title with "quotes"');
  });
});

describe("formatFrontmatter (para-knowledge)", () => {
  it("should format with standard field order", async () => {
    const { formatFrontmatter } = await import("../../extensions/para-knowledge/frontmatter.js");
    const result = formatFrontmatter({
      title: "Test",
      description: "Desc",
      author: "Author",
      tags: ["a", "b"],
      source: "https://example.com",
    });
    const lines = result.split("\n");
    const titleIdx = lines.findIndex((l) => l.startsWith("title:"));
    const descIdx = lines.findIndex((l) => l.startsWith("description:"));
    const tagsIdx = lines.findIndex((l) => l.startsWith("tags:"));
    const sourceIdx = lines.findIndex((l) => l.startsWith("source:"));
    expect(titleIdx).toBeGreaterThan(0);
    expect(descIdx).toBeGreaterThan(titleIdx);
    expect(tagsIdx).toBeGreaterThan(descIdx);
    expect(sourceIdx).toBeGreaterThan(tagsIdx);
  });

  it("should include --- delimiters", async () => {
    const { formatFrontmatter } = await import("../../extensions/para-knowledge/frontmatter.js");
    const result = formatFrontmatter({ title: "Test" });
    expect(result.startsWith("---\n")).toBe(true);
    expect(result.endsWith("---\n")).toBe(true);
  });

  it("should render tags as YAML block list", async () => {
    const { formatFrontmatter } = await import("../../extensions/para-knowledge/frontmatter.js");
    const result = formatFrontmatter({
      title: "Test",
      tags: ["tag1", "tag2"],
    });
    expect(result).toContain("tags:\n  - tag1\n  - tag2");
  });

  it("should omit tags when array is empty", async () => {
    const { formatFrontmatter } = await import("../../extensions/para-knowledge/frontmatter.js");
    const result = formatFrontmatter({ title: "No Tags", tags: [] });
    expect(result).not.toContain("tags");
  });

  it("should emit legacy fields after standard fields", async () => {
    const { formatFrontmatter } = await import("../../extensions/para-knowledge/frontmatter.js");
    const result = formatFrontmatter({
      title: "Test",
      x_custom: "value",
    });
    expect(result).toContain("x_custom:");
    const titleIdx = result.indexOf("title:");
    const customIdx = result.indexOf("x_custom:");
    expect(customIdx).toBeGreaterThan(titleIdx);
  });

  it("should auto-quote values that need quoting", async () => {
    const { formatFrontmatter } = await import("../../extensions/para-knowledge/frontmatter.js");
    const result = formatFrontmatter({
      title: "Doc: Part 2",
      description: "true",
    });
    expect(result).toContain("title: 'Doc: Part 2'");
    expect(result).toContain("description: 'true'");
  });

  it("should prefer source over source_url", async () => {
    const { formatFrontmatter } = await import("../../extensions/para-knowledge/frontmatter.js");
    const result = formatFrontmatter({
      title: "Both",
      source: "https://new.example.com",
      source_url: "https://old.example.com",
    });
    expect(result).toContain("source: https://new.example.com");
    expect(result).not.toContain("source_url:");
  });
});
