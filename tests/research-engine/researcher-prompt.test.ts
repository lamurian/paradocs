/**
 * Tests for the researcher.md search-subagent prompt contract.
 *
 * The prompt is passed as literal system-prompt text to the search
 * subagent (never as a file path) and must encode: tiered web_search
 * usage, suitability assessment, and the {sources, coveredFacets} JSON
 * output contract. It must NOT instruct fetching or KB writes.
 *
 * @module tests/research-engine/researcher-prompt.test
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = resolve(HERE, "../../extensions/research-engine/prompts/researcher.md");

describe("researcher.md search-subagent prompt", () => {
  it("should exist at the expected path", () => {
    expect(existsSync(PROMPT_PATH)).toBe(true);
  });

  it("should be pure prompt text with no YAML frontmatter fence", () => {
    const content = readFileSync(PROMPT_PATH, "utf-8");
    // The prompt is injected verbatim via --append-system-prompt; a
    // frontmatter block would pollute the system prompt.
    expect(content.startsWith("---")).toBe(false);
  });

  it("should instruct tiered web_search usage", () => {
    const content = readFileSync(PROMPT_PATH, "utf-8");

    expect(content).toContain("web_search");
    expect(content).toContain("tier=1");
    expect(content).toContain("tier=2");
    expect(content).toContain("tier=3");
  });

  it("should instruct suitability assessment of titles and snippets", () => {
    const content = readFileSync(PROMPT_PATH, "utf-8").toLowerCase();

    expect(content).toContain("suitability");
    expect(content).toContain("title");
    expect(content).toContain("snippet");
  });

  it("should specify JSON output with sources and coveredFacets keys", () => {
    const content = readFileSync(PROMPT_PATH, "utf-8");

    expect(content.toLowerCase()).toContain("only valid json");
    expect(content).toContain('"sources"');
    expect(content).toContain('"coveredFacets"');
    expect(content).toContain('"url"');
  });

  it("should forbid fetching and knowledge base writes", () => {
    const content = readFileSync(PROMPT_PATH, "utf-8");

    expect(content).toContain("Never call fetch_url");
    expect(content).toContain("never write to them");
  });

  it("should tell the subagent to deduplicate by URL and cap sources", () => {
    const content = readFileSync(PROMPT_PATH, "utf-8").toLowerCase();

    expect(content).toContain("deduplicate by url");
    expect(content).toContain("at most 20");
  });
});
