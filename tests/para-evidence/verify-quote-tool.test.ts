/**
 * Tests for extensions/para-evidence — verify_quote tool behavior.
 *
 * URL fetching is injected so no test touches the network.
 *
 * @module tests/para-evidence/verify-quote-tool
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { saveEvidencePack } from "../../common/evidence-cache.ts";
import { registerVerifyQuoteTool } from "../../extensions/para-evidence/verify-tools.ts";

import type { EvidencePack } from "../../common/evidence-cache.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details?: Record<string, unknown>;
  isError?: boolean;
}

interface ToolParams {
  quote: string;
  url?: string;
  evidenceId?: string;
  sourceIndex?: number;
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

interface TestDeps {
  fetchUrlAsText?: (
    url: string,
    signal?: AbortSignal,
  ) => Promise<{ title: string; content: string; engine: string } | { error: string }>;
}

/** Register the extension and return its verify_quote tool. */
function registerTool(deps: TestDeps = {}): RegisteredTool {
  let registered: RegisteredTool | undefined;
  const fakePi = {
    registerTool: (tool: RegisteredTool) => {
      registered = tool;
    },
  } as unknown as ExtensionAPI;

  registerVerifyQuoteTool(fakePi, deps);
  if (!registered) throw new Error("verify_quote was not registered");
  return registered;
}

/** Build a pack whose sources carry distinct content bodies. */
function makePack(): Omit<EvidencePack, "id"> {
  return {
    question: "Does the quote appear?",
    createdAt: "2025-01-02T03:04:05.000Z",
    queries: [],
    sources: [
      {
        url: "https://example.com/first",
        canonicalUrl: "https://example.com/first",
        title: "First Source",
        trust: "unknown",
        tier: null,
        query: "quote",
        excerpt: "first excerpt",
        content: "The first source contains the exact phrase we need.",
      },
      {
        url: "https://example.com/second",
        canonicalUrl: "https://example.com/second",
        title: "Second Source",
        trust: "unknown",
        tier: null,
        query: "quote",
        excerpt: "second excerpt",
        content: "The second source contains a different phrase entirely.",
      },
    ],
  };
}

describe("verify_quote", () => {
  let tmpDir: string;
  let cwd: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "verify-quote-test-"));
    cwd = join(tmpDir, "project");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("registers a verify_quote tool", () => {
    expect(registerTool().name).toBe("verify_quote");
  });

  it("should read the source text from an evidence pack when evidenceId is given", async () => {
    const saved = saveEvidencePack(cwd, makePack());
    const fetchUrlAsTextMock = vi.fn();
    const tool = registerTool({ fetchUrlAsText: fetchUrlAsTextMock });

    const result = await tool.execute(
      "call-1",
      { quote: "EXACT phrase", evidenceId: saved.id },
      undefined,
      undefined,
      { cwd },
    );

    expect(fetchUrlAsTextMock).not.toHaveBeenCalled();
    expect(result.isError).toBeUndefined();
    expect(result.details?.match).toBe("exact");
    expect(result.details?.score).toBe(1);
    expect(result.details?.excerpt).toBe("exact phrase");
    expect(result.content[0].text).toContain("exact phrase");
  });

  it("should use sourceIndex to pick the source inside the pack", async () => {
    const saved = saveEvidencePack(cwd, makePack());
    const tool = registerTool();

    const result = await tool.execute(
      "call-2",
      { quote: "different phrase entirely", evidenceId: saved.id, sourceIndex: 1 },
      undefined,
      undefined,
      { cwd },
    );

    expect(result.details?.match).toBe("exact");
    expect(result.details?.excerpt).toBe("different phrase entirely");
  });

  it("should fetch the url when no evidenceId is given", async () => {
    const fetchUrlAsTextMock = vi.fn().mockResolvedValue({
      title: "Fetched",
      content: "The fetched page contains a matching quote inside it.",
      engine: "http-fallback",
    });
    const tool = registerTool({ fetchUrlAsText: fetchUrlAsTextMock });

    const result = await tool.execute(
      "call-3",
      { quote: "matching quote", url: "https://example.com/page" },
      undefined,
      undefined,
      { cwd },
    );

    expect(fetchUrlAsTextMock).toHaveBeenCalledWith("https://example.com/page");
    expect(result.details?.match).toBe("exact");
    expect(result.content[0].text).toContain("matching quote");
  });

  it("should report an error when the evidence pack is missing", async () => {
    const tool = registerTool();

    const result = await tool.execute(
      "call-4",
      { quote: "anything", evidenceId: "ev-missing-0000" },
      undefined,
      undefined,
      { cwd },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("ev-missing-0000");
  });

  it("should report an error when neither evidenceId nor url is provided", async () => {
    const tool = registerTool();

    const result = await tool.execute("call-5", { quote: "anything" }, undefined, undefined, {
      cwd,
    });

    expect(result.isError).toBe(true);
  });

  it("should report an error when the URL fetch fails", async () => {
    const fetchUrlAsTextMock = vi.fn().mockResolvedValue({ error: "Network down" });
    const tool = registerTool({ fetchUrlAsText: fetchUrlAsTextMock });

    const result = await tool.execute(
      "call-6",
      { quote: "anything", url: "https://example.com/page" },
      undefined,
      undefined,
      { cwd },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Network down");
  });
});
