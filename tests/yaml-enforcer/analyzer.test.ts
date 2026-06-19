import { describe, it, expect } from "vitest";

describe("analyzeFrontmatter", () => {
  it("should detect valid frontmatter and parse fields", async () => {
    const { analyzeFrontmatter } = await import("../../extensions/yaml-enforcer/analyzer.js");
    const content = `---
title: Hello World
description: A test document
tags:
  - tag1
  - tag2
---

Body text`;
    const result = analyzeFrontmatter(content);
    expect(result.hasFrontmatter).toBe(true);
    expect(result.fields.title).toBe("Hello World");
    expect(result.fields.tags).toEqual(["tag1", "tag2"]);
    expect(result.keyOrder).toContain("title");
    expect(result.keyOrder).toContain("description");
  });

  it("should report missing frontmatter as invalid-yaml issue", async () => {
    const { analyzeFrontmatter } = await import("../../extensions/yaml-enforcer/analyzer.js");
    const result = analyzeFrontmatter("No frontmatter here");
    expect(result.hasFrontmatter).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].type).toBe("invalid-yaml");
  });

  it("should detect unquoted boolean-like values that need quoting", async () => {
    const { analyzeFrontmatter } = await import("../../extensions/yaml-enforcer/analyzer.js");
    const content = `---
title: true
description: yes
---`;
    const result = analyzeFrontmatter(content);
    const needsQuoting = result.issues.filter((i) => i.type === "needs-quoting");
    expect(needsQuoting.length).toBeGreaterThanOrEqual(2);
    const fields = needsQuoting.map((i) => i.field);
    expect(fields).toContain("title");
    expect(fields).toContain("description");
  });

  it("should detect nonstandard field aliases", async () => {
    const { analyzeFrontmatter } = await import("../../extensions/yaml-enforcer/analyzer.js");
    const content = `---
title: Test
source_url: https://example.com
---`;
    const result = analyzeFrontmatter(content);
    const nonstandard = result.issues.filter((i) => i.type === "nonstandard-field");
    expect(nonstandard.length).toBeGreaterThanOrEqual(1);
    expect(nonstandard[0].field).toBe("source_url");
    expect(nonstandard[0].suggestion).toContain("source");
  });

  it("should detect missing standard fields", async () => {
    const { analyzeFrontmatter } = await import("../../extensions/yaml-enforcer/analyzer.js");
    const content = "---\ntitle: Test\n---";
    const result = analyzeFrontmatter(content);
    const missing = result.issues.filter((i) => i.type === "missing-field");
    const missingFields = missing.map((i) => i.field);
    expect(missingFields).toContain("author");
    expect(missingFields).toContain("date");
    expect(missingFields).toContain("editor");
  });

  it("should flag description as missing", async () => {
    const { analyzeFrontmatter } = await import("../../extensions/yaml-enforcer/analyzer.js");
    const content = "---\ntitle: Test\n---";
    const result = analyzeFrontmatter(content);
    const missing = result.issues.filter((i) => i.type === "missing-field");
    const descIssues = missing.filter((i) => i.field === "description");
    expect(descIssues.length).toBeGreaterThanOrEqual(1);
    expect(descIssues[0].message).toContain("is missing");
  });

  it("should track key order", async () => {
    const { analyzeFrontmatter } = await import("../../extensions/yaml-enforcer/analyzer.js");
    const content = `---
date: 2026-01-01
title: My Doc
author: pi
---`;
    const result = analyzeFrontmatter(content);
    expect(result.keyOrder).toEqual(["date", "title", "author"]);
  });

  it("should not flag quoted values as needing quoting", async () => {
    const { analyzeFrontmatter } = await import("../../extensions/yaml-enforcer/analyzer.js");
    const content = `---
title: 'true'
description: "yes"
---`;
    const result = analyzeFrontmatter(content);
    const needsQuoting = result.issues.filter((i) => i.type === "needs-quoting");
    // Quoted values should not trigger needs-quoting
    const quotingForTitle = needsQuoting.filter((i) => i.field === "title");
    const quotingForDesc = needsQuoting.filter((i) => i.field === "description");
    expect(quotingForTitle).toHaveLength(0);
    expect(quotingForDesc).toHaveLength(0);
  });

  it("should handle numeric values", async () => {
    const { analyzeFrontmatter } = await import("../../extensions/yaml-enforcer/analyzer.js");
    const content = `---
title: 42
---
`;
    const result = analyzeFrontmatter(content);
    expect(result.fields.title).toBe("42");
    const needsQuoting = result.issues.filter((i) => i.type === "needs-quoting");
    expect(needsQuoting.some((i) => i.field === "title")).toBe(true);
  });
});
