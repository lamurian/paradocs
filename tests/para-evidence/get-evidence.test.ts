/**
 * Tests for extensions/para-evidence — get_evidence tool behavior.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { saveEvidencePack } from "../../common/evidence-cache.ts";
import paraEvidence from "../../extensions/para-evidence/index.ts";

import type { EvidencePack } from "../../common/evidence-cache.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details?: Record<string, unknown>;
  isError?: boolean;
}

interface ToolParams {
  id: string;
  includeContent?: boolean;
}

interface RegisteredTool {
  name: string;
  execute: (
    toolCallId: string,
    params: ToolParams,
    signal: undefined,
    onUpdate: undefined,
    ctx: { cwd: string },
  ) => Promise<ToolResult>;
}

/** Register the extension and return its get_evidence tool. */
function registerTool(): RegisteredTool {
  let registered: RegisteredTool | undefined;
  const fakePi = {
    registerTool: (tool: RegisteredTool) => {
      registered = tool;
    },
  } as unknown as ExtensionAPI;

  paraEvidence(fakePi);
  if (!registered) throw new Error("get_evidence was not registered");
  return registered;
}

/** Build a pack with one source carrying content. */
function makePack(): Omit<EvidencePack, "id"> {
  return {
    question: "How does evidence caching work?",
    createdAt: "2025-01-02T03:04:05.000Z",
    queries: [
      {
        query: "evidence caching",
        kbCovered: true,
        since: "2024-01-01",
        kbHits: [
          {
            path: "Resources/cache.md",
            title: "Cache",
            freshness: "fresh",
            relevance: 0.92,
            relevant: true,
          },
        ],
      },
    ],
    sources: [
      {
        url: "https://example.com/source",
        canonicalUrl: "https://example.com/source",
        title: "Example Source",
        trust: "unknown",
        tier: 3,
        query: "evidence caching",
        excerpt: "A short excerpt.",
        content: "FULL SOURCE BODY UNIQUE",
      },
    ],
  };
}

describe("get_evidence", () => {
  let tmpDir: string;
  let cwd: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "get-evidence-test-"));
    cwd = join(tmpDir, "project");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("registers a get_evidence tool", () => {
    expect(registerTool().name).toBe("get_evidence");
  });

  it("returns the stored pack without source content by default", async () => {
    const saved = saveEvidencePack(cwd, makePack());
    const tool = registerTool();

    const result = await tool.execute("call-1", { id: saved.id }, undefined, undefined, { cwd });
    const text = result.content[0].text;

    expect(result.isError).toBeUndefined();
    expect(text).toContain(saved.id);
    expect(text).toContain("How does evidence caching work?");
    expect(text).toContain("Example Source");
    expect(text).toContain("A short excerpt.");
    expect(text).toContain("kb hit: Resources/cache.md — Cache (fresh, relevance 0.92 relevant)");
    expect(text).not.toContain("FULL SOURCE BODY UNIQUE");
    expect(result.details).toEqual({ id: saved.id, found: true, includeContent: false });
  });

  it("returns source content when includeContent is true", async () => {
    const saved = saveEvidencePack(cwd, makePack());
    const tool = registerTool();

    const result = await tool.execute(
      "call-2",
      { id: saved.id, includeContent: true },
      undefined,
      undefined,
      { cwd },
    );
    const text = result.content[0].text;

    expect(text).toContain("FULL SOURCE BODY UNIQUE");
    expect(result.details).toEqual({ id: saved.id, found: true, includeContent: true });
  });

  it("prints source relevance and the rejected count", async () => {
    const base = makePack();
    const saved = saveEvidencePack(cwd, {
      ...base,
      sources: [{ ...base.sources[0], relevance: 0.88 }],
      rejected: [{ url: "https://junk.example", reason: "junk" }],
    });
    const text = (
      await registerTool().execute("call-r", { id: saved.id }, undefined, undefined, { cwd })
    ).content[0].text;

    expect(text).toContain("   trust: unknown | tier: 3\n   relevance: 0.88\n   query:");
    expect(text).toContain("Rejected: 1 (low relevance, junk page or fetch error)");
  });

  it("prints the no-relevant-sources hint only when a query was not kb covered", async () => {
    const base = makePack();
    const empty = { ...base, sources: [], queries: [{ ...base.queries[0], kbCovered: false }] };
    const uncovered = saveEvidencePack(cwd, empty);
    const tool = registerTool();
    const text = (await tool.execute("call-u", { id: uncovered.id }, undefined, undefined, { cwd }))
      .content[0].text;
    expect(text).toContain("No relevant sources. Pass `urls` with primary docs.");

    const covered = saveEvidencePack(cwd, { ...empty, queries: [base.queries[0]] });
    const coveredText = (
      await tool.execute("call-c", { id: covered.id }, undefined, undefined, { cwd })
    ).content[0].text;
    expect(coveredText).toContain("- (none)");
    expect(coveredText).not.toContain("No relevant sources");
  });

  it("returns an error naming the id when the pack does not exist", async () => {
    const tool = registerTool();

    const result = await tool.execute("call-3", { id: "ev-missing-0000" }, undefined, undefined, {
      cwd,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("ev-missing-0000");
    expect(result.details).toEqual({ id: "ev-missing-0000", found: false });
  });
});
