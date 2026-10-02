/**
 * Tests for the researcher.md agent definition — deterministic workflow.
 *
 * @module tests/research-engine/researcher-prompt.test
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = resolve(HERE, "../../extensions/research-engine/prompts/researcher.md");

/** Parse simple YAML frontmatter (key: value lines) from the agent file. */
function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return fm;
}

/** Extract the body after the closing frontmatter fence. */
function getBody(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match ? match[1] : content;
}

describe("researcher.md agent definition", () => {
  it("should exist at the expected path", () => {
    expect(existsSync(PROMPT_PATH)).toBe(true);
  });

  it("should declare name=researcher and required tools in frontmatter", () => {
    const content = readFileSync(PROMPT_PATH, "utf-8");
    const fm = parseFrontmatter(content);

    expect(fm.name).toBe("researcher");
    expect(fm.tools).toContain("search_para_docs");
    expect(fm.tools).toContain("web_search");
    expect(fm.tools).toContain("fetch_url");
    expect(fm.tools).toContain("batch_extract_failed");
    expect(fm.tools).toContain("resolve_citation");
  });

  it("should encode KB-first search as the mandatory first workflow step", () => {
    const body = getBody(readFileSync(PROMPT_PATH, "utf-8"));

    expect(body).toContain("search_para_docs");
    expect(body.toLowerCase()).toMatch(/first|MUST/);
    // The KB search instruction must appear before any web search instruction
    const kbIdx = body.indexOf("search_para_docs");
    const webIdx = body.indexOf("web_search");
    expect(kbIdx).toBeGreaterThan(-1);
    if (webIdx > -1) expect(kbIdx).toBeLessThan(webIdx);
  });

  it("should instruct sufficiency and freshness assessment of KB results", () => {
    const body = getBody(readFileSync(PROMPT_PATH, "utf-8")).toLowerCase();

    expect(body).toContain("sufficien");
    expect(body).toContain("freshness");
  });

  it("should instruct follow-up question construction when KB is insufficient", () => {
    const body = getBody(readFileSync(PROMPT_PATH, "utf-8")).toLowerCase();

    expect(body).toContain("follow-up");
    expect(body).toContain("question");
  });

  it("should bound source collection between 10 and 50", () => {
    const body = getBody(readFileSync(PROMPT_PATH, "utf-8"));

    expect(body).toMatch(/10/);
    expect(body).toMatch(/50/);
  });

  it("should specify JSON array output of {url, snippet} objects", () => {
    const body = getBody(readFileSync(PROMPT_PATH, "utf-8"));

    expect(body).toContain("url");
    expect(body).toContain("snippet");
    expect(body.toLowerCase()).toContain("json");
  });

  it("should include KNOWLEDGE_DIR guidance that files are not in cwd", () => {
    const body = getBody(readFileSync(PROMPT_PATH, "utf-8"));

    expect(body).toContain("KNOWLEDGE_DIR");
    expect(body).toContain(".env");
    expect(body).toContain("create_para_doc");
    expect(body).toContain("batch_create_para_docs");
  });
});
