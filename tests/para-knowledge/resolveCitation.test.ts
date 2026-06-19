/**
 * Tests for resolve_citation — verifies that ref.bib is written to
 * KNOWLEDGE_DIR rather than ctx.cwd.
 */

import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

describe("resolve_citation ref.bib path", () => {
  let tmpDir: string;
  let knowledgeDir: string;
  let projectDir: string;
  let registeredTool: Record<string, unknown> | null;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(homedir(), "resolveCitation-test-"));
    knowledgeDir = join(tmpDir, "knowledge");
    projectDir = join(tmpDir, "project");
    mkdirSync(knowledgeDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });

    process.env.KNOWLEDGE_DIR = knowledgeDir;
    process.env.KNOWLEDGE_DB = "notes.db";

    registeredTool = null;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.KNOWLEDGE_DIR;
    delete process.env.KNOWLEDGE_DB;
  });

  it("should write ref.bib to KNOWLEDGE_DIR, not ctx.cwd", async () => {
    vi.resetModules();
    const { registerResolveCitationTool } =
      await import("../../extensions/para-knowledge/tools/resolveCitation.js");

    const mockPi = {
      registerTool: (tool: Record<string, unknown>) => {
        registeredTool = tool;
      },
      on: () => {},
    } as unknown as ExtensionAPI;

    registerResolveCitationTool(mockPi);
    expect(registeredTool).not.toBeNull();

    const tool = registeredTool!;
    const execute = tool.execute as (
      toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal | undefined,
      onUpdate: unknown,
      ctx: ExtensionContext,
    ) => Promise<{
      content: Array<{ type: string; text: string }>;
      details: Record<string, unknown>;
    }>;

    // Provide fallback metadata because citation.js can't parse plain URLs
    // without DOI support
    await execute(
      "call-1",
      {
        source: "https://example.com/test-paper",
        title: "Test Paper about Something",
        authors: ["Smith, John"],
        year: 2024,
      },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    // ref.bib should be in KNOWLEDGE_DIR, not projectDir
    const knowledgeBib = resolve(knowledgeDir, "ref.bib");
    const projectBib = resolve(projectDir, "ref.bib");

    expect(existsSync(knowledgeBib), `ref.bib should be at ${knowledgeBib}`).toBe(true);
    expect(existsSync(projectBib), `ref.bib should NOT be at ${projectBib}`).toBe(false);

    const content = readFileSync(knowledgeBib, "utf-8");
    expect(content).toContain("@misc{smith2024,");
    expect(content).toContain("Test Paper about Something");
  });
});
