/**
 * Tests for extensions/para-evidence — gather_evidence tool behavior.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadEvidencePack } from "../../common/evidence-cache.ts";
import { registerGatherEvidenceTool } from "../../extensions/para-evidence/gather-tool.ts";
import paraEvidence from "../../extensions/para-evidence/index.ts";

import type { GatherKbHit } from "../../common/gather-evidence.ts";
import type { GatherToolDeps } from "../../extensions/para-evidence/gather-tool.ts";
import type { SearchResult } from "../../extensions/web-search/native.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details?: Record<string, unknown>;
  isError?: boolean;
}

interface ToolParams {
  question: string;
  queries: string[];
  maxSources?: number;
  force?: boolean;
  kind?: "general" | "tech" | "academic" | "news";
}

interface RegisteredTool {
  name: string;
  promptGuidelines?: string[];
  execute: (
    toolCallId: string,
    params: ToolParams,
    signal: undefined,
    onUpdate: undefined,
    ctx: { cwd: string },
  ) => Promise<ToolResult>;
}

/** Create a fake pi API capturing every registered tool by name. */
function createFakePi(): {
  pi: ExtensionAPI;
  tools: Map<string, RegisteredTool>;
} {
  const tools = new Map<string, RegisteredTool>();
  const pi = {
    registerTool: (tool: RegisteredTool) => {
      tools.set(tool.name, tool);
    },
  } as unknown as ExtensionAPI;
  return { pi, tools };
}

/** Freshness verdict helper for fake KB hits. */
function freshHit(path: string, title: string): GatherKbHit {
  return {
    path,
    title,
    description: "cached description",
    freshness: {
      status: "fresh",
      ageDays: 10,
      windowDays: 365,
      basis: "reviewed",
      reviewed: "2025-01-01",
      newestSourcePublished: null,
      lastVerified: null,
      noteModified: null,
    },
  };
}

/** Build fake deps with a fresh KB hit, one web result and a long fetch body. */
function makeDeps(overrides: Partial<GatherToolDeps> = {}): {
  deps: GatherToolDeps;
  webCalls: Array<{ query: string; since: string | null; kind: string }>;
} {
  const webCalls: Array<{ query: string; since: string | null; kind: string }> = [];
  const deps: GatherToolDeps = {
    searchKb: () => [freshHit("Resources/cache.md", "Cache Notes")],
    searchWeb: (
      query: string,
      opts: { since: string | null; kind: "general" | "tech" | "academic" | "news" },
    ): Promise<SearchResult[]> => {
      webCalls.push({ query, since: opts.since, kind: opts.kind });
      return Promise.resolve([]);
    },
    fetch: () => Promise.resolve({ title: "Fetched", content: "A".repeat(500) }),
    now: () => new Date("2025-02-03T04:05:06.000Z"),
    ...overrides,
  };
  return { deps, webCalls };
}

describe("gather_evidence", () => {
  let tmpDir: string;
  let cwd: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "gather-tool-test-"));
    cwd = join(tmpDir, "project");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saves the gathered pack and returns its id with per-query coverage and sources", async () => {
    const { pi, tools } = createFakePi();
    const { deps } = makeDeps({
      searchKb: (query: string) =>
        query === "caching" ? [freshHit("Resources/cache.md", "Cache Notes")] : [],
      searchWeb: () =>
        Promise.resolve([
          {
            title: "Web Result",
            url: "https://example.com/web",
            snippet: "snippet text",
            source_label: "Web",
            tier: 1,
          },
        ]),
    });
    registerGatherEvidenceTool(pi, deps);
    const tool = tools.get("gather_evidence");
    if (!tool) throw new Error("gather_evidence was not registered");

    const result = await tool.execute(
      "call-1",
      { question: "How does caching work?", queries: ["caching", "new facet"] },
      undefined,
      undefined,
      { cwd },
    );

    const id = result.details?.id as string;
    expect(id).toMatch(/^ev-/);

    const stored = loadEvidencePack(cwd, id);
    expect(stored).not.toBeNull();
    expect(stored?.question).toBe("How does caching work?");
    expect(stored?.queries).toHaveLength(2);

    const text = result.content[0].text;
    expect(text).toContain(id);
    expect(text).toContain("kb covered: yes");
    expect(text).toContain("Cache Notes");
    expect(text).toContain(
      "kb hit: Resources/cache.md — Cache Notes (fresh, relevance 1.00 relevant)",
    );
    expect(text).toContain("https://example.com/web");
    expect(text).toContain("trust: unknown");
    expect(text).toContain("A".repeat(300));
    expect(text).not.toContain("A".repeat(301));
    expect(result.details?.sources).toEqual([
      { title: "Fetched", url: "https://example.com/web", trust: "unknown" },
    ]);
  });

  it("searches the web only for uncovered queries and attributes freshness hits", async () => {
    const { pi, tools } = createFakePi();
    const { deps, webCalls } = makeDeps({
      searchKb: (query: string) =>
        query === "caching" ? [freshHit("Resources/cache.md", "Cache Notes")] : [],
    });
    registerGatherEvidenceTool(pi, deps);
    const tool = tools.get("gather_evidence");
    if (!tool) throw new Error("gather_evidence was not registered");

    const result = await tool.execute(
      "call-2",
      { question: "Mixed coverage", queries: ["caching", "brand new facet"] },
      undefined,
      undefined,
      { cwd },
    );

    expect(webCalls).toEqual([{ query: "brand new facet", since: null, kind: "general" }]);
    const text = result.content[0].text;
    expect(text).toContain("- caching");
    expect(text).toContain("kb covered: yes");
    expect(text).toContain("- brand new facet");
    expect(text).toContain("kb covered: no");
  });

  it("forwards an explicit kind to every uncovered web query", async () => {
    const { pi, tools } = createFakePi();
    const { deps, webCalls } = makeDeps({
      searchKb: () => [],
    });
    registerGatherEvidenceTool(pi, deps);
    const tool = tools.get("gather_evidence");
    if (!tool) throw new Error("gather_evidence was not registered");

    await tool.execute(
      "call-3",
      { question: "Tech question", queries: ["node streams", "typescript generics"], kind: "tech" },
      undefined,
      undefined,
      { cwd },
    );

    expect(webCalls).toEqual([
      { query: "node streams", since: null, kind: "tech" },
      { query: "typescript generics", since: null, kind: "tech" },
    ]);
  });

  it("defines knowledge questions, excludes repo-internal ones and lists the four call conditions", () => {
    const { pi, tools } = createFakePi();
    registerGatherEvidenceTool(pi, makeDeps().deps);
    const tool = tools.get("gather_evidence");
    if (!tool) throw new Error("gather_evidence was not registered");

    const guidelines = tool.promptGuidelines ?? [];
    expect(guidelines).toHaveLength(5);
    expect(guidelines[0]).toContain("A knowledge question is any claim");
    expect(guidelines[0]).toContain("Repo-internal questions use code search");
    expect(guidelines[1]).toContain("no relevant hit exists or a facet is uncovered");
    expect(guidelines[1]).toContain("stale or unknown");
    expect(guidelines[1]).toContain("fast-changing claim");
    expect(guidelines[1]).toContain("factual claim you cannot cite");
    expect(guidelines[2]).toContain("one query per facet");
    expect(guidelines[2]).toContain("maxSources 3");
    expect(guidelines[3]).toBe("Never call gather_evidence during finalize.");
    expect(guidelines[4]).toBe(
      "Pass kind: 'tech' for software, library, API or tooling questions; use 'academic' only for research literature; default is 'general'.",
    );
  });
});

describe("para-evidence registration", () => {
  it("registers gather_evidence, get_evidence, verify_source and verify_quote", () => {
    const { pi, tools } = createFakePi();
    paraEvidence(pi);

    expect([...tools.keys()].sort()).toEqual([
      "gather_evidence",
      "get_evidence",
      "verify_quote",
      "verify_source",
    ]);
  });
});
