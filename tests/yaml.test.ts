import { describe, it, expect } from "vitest";

describe("yamlQuote", () => {
  it("should return plain values as-is", async () => {
    const { yamlQuote } = await import("../common/yaml.js");
    expect(yamlQuote("hello")).toBe("hello");
  });

  it("should quote values with colons", async () => {
    const { yamlQuote } = await import("../common/yaml.js");
    expect(yamlQuote("key: value")).toBe("'key: value'");
  });

  it("should quote values with hash-space", async () => {
    const { yamlQuote } = await import("../common/yaml.js");
    expect(yamlQuote("value # comment")).toBe("'value # comment'");
  });

  it("should quote values starting with YAML special chars", async () => {
    const { yamlQuote } = await import("../common/yaml.js");
    expect(yamlQuote("[brackets]")).toBe("'[brackets]'");
    expect(yamlQuote("{braces}")).toBe("'{braces}'");
  });

  it("should wrap in single quotes for values starting with double quote", async () => {
    const { yamlQuote } = await import("../common/yaml.js");
    const result = yamlQuote('"hello"');
    expect(result).toBe("'" + '"hello"' + "'");
  });

  it("should wrap in double quotes for values starting with single quote", async () => {
    const { yamlQuote } = await import("../common/yaml.js");
    const result = yamlQuote("'hello'");
    expect(result).toBe('"' + "'hello'" + '"');
  });

  it("should escape internal double quotes when using double-quote wrapping", async () => {
    const { yamlQuote } = await import("../common/yaml.js");
    // Value starts with single quote (needs quoting) and contains both ' and "
    const result = yamlQuote("'\"");
    // Should be wrapped in double quotes
    expect(result[0]).toBe('"');
    expect(result[result.length - 1]).toBe('"');
    // The inner content should have the single quote and escaped double quote
    const inner = result.slice(1, -1);
    expect(inner.includes("'")).toBe(true);
    expect(inner.includes('\\')).toBe(true);
    expect(inner.includes('"')).toBe(true);
  });

  it("should quote boolean-like values", async () => {
    const { yamlQuote } = await import("../common/yaml.js");
    expect(yamlQuote("true")).toBe("'true'");
    expect(yamlQuote("false")).toBe("'false'");
    expect(yamlQuote("yes")).toBe("'yes'");
    expect(yamlQuote("no")).toBe("'no'");
  });

  it("should quote numeric strings", async () => {
    const { yamlQuote } = await import("../common/yaml.js");
    expect(yamlQuote("42")).toBe("'42'");
    expect(yamlQuote("3.14")).toBe("'3.14'");
  });

  it("should quote empty string", async () => {
    const { yamlQuote } = await import("../common/yaml.js");
    expect(yamlQuote("")).toBe("''");
  });
});

describe("formatFrontmatter", () => {
  it("should format complete frontmatter with tags list", async () => {
    const { formatFrontmatter } = await import("../common/yaml.js");
    const result = formatFrontmatter({
      title: "Test Doc",
      description: "A test document",
      author: "Test Author",
      date: "2026-06-18",
      tags: ["tag1", "tag2"],
      source: "https://example.com",
    });
    expect(result).toContain("---\n");
    expect(result).toContain("title: Test Doc");
    expect(result).toContain("tags:\n  - tag1\n  - tag2");
    expect(result).toContain("source: https://example.com");
    expect(result).toContain("---\n");
  });

  it("should handle tags as empty array", async () => {
    const { formatFrontmatter } = await import("../common/yaml.js");
    const result = formatFrontmatter({ title: "No Tags", tags: [] });
    expect(result).not.toContain("tags");
  });

  it("should handle missing optional fields", async () => {
    const { formatFrontmatter } = await import("../common/yaml.js");
    const result = formatFrontmatter({ title: "Minimal" });
    expect(result).toContain("title: Minimal");
    expect(result).not.toContain("description");
    expect(result).not.toContain("author");
  });

  it("should auto-quote values that need quoting", async () => {
    const { formatFrontmatter } = await import("../common/yaml.js");
    const result = formatFrontmatter({
      title: "Doc: Part 2",
      description: "true",
    });
    expect(result).toContain("title: 'Doc: Part 2'");
    expect(result).toContain("description: 'true'");
  });

  it("should support source_url as legacy alias", async () => {
    const { formatFrontmatter } = await import("../common/yaml.js");
    const result = formatFrontmatter({
      title: "Legacy",
      source_url: "https://old.example.com",
    });
    expect(result).toContain("source: https://old.example.com");
  });

  it("should prefer source over source_url", async () => {
    const { formatFrontmatter } = await import("../common/yaml.js");
    const result = formatFrontmatter({
      title: "Both",
      source: "https://new.example.com",
      source_url: "https://old.example.com",
    });
    expect(result).toContain("source: https://new.example.com");
    expect(result).not.toContain("source_url");
  });

  it("should emit fields in the standardised order", async () => {
    const { formatFrontmatter } = await import("../common/yaml.js");
    const result = formatFrontmatter({
      source: "https://example.com",
      tags: ["a"],
      title: "Ordered",
      description: "Check ordering",
      author: "Me",
      date: "2026-01-01",
    });
    const lines = result.split("\n");
    const titleIdx = lines.findIndex((l) => l.startsWith("title:"));
    const descIdx = lines.findIndex((l) => l.startsWith("description:"));
    const tagsIdx = lines.findIndex((l) => l.startsWith("tags:"));
    const sourceIdx = lines.findIndex((l) => l.startsWith("source:"));
    expect(titleIdx).toBeLessThan(descIdx);
    expect(descIdx).toBeLessThan(tagsIdx);
    expect(tagsIdx).toBeLessThan(sourceIdx);
  });
});
