/**
 * Tests that search_para_docs auto-rebuilds notes.db when it's missing.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

describe("search_para_docs auto-rebuild", () => {
  let tmpDir: string;
  let knowledgeDir: string;
  let projectDir: string;
  let registeredTool: Record<string, unknown> | null;

  function writeDoc(area: string, slug: string): void {
    const content = `---
title: "${slug}"
tags: [test]
---

Body of ${slug}.`;
    const areaDir = join(knowledgeDir, area);
    mkdirSync(areaDir, { recursive: true });
    writeFileSync(join(areaDir, `${slug}.md`), content, "utf-8");
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(homedir(), "searchRebuild-test-"));
    knowledgeDir = join(tmpDir, "knowledge");
    projectDir = join(tmpDir, "project");
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

  it("should rebuild notes.db when missing and return search results", async () => {
    vi.resetModules();
    // Write some docs in KNOWLEDGE_DIR (no notes.db exists yet)
    writeDoc("Resources", "unique-term-foo");
    writeDoc("Projects", "other-bar");

    const { registerSearchDocsTool } =
      await import("../../extensions/para-knowledge/tools/searchDocs.js");

    const mockPi = {
      registerTool: (tool: Record<string, unknown>) => {
        registeredTool = tool;
      },
      on: () => {},
    } as unknown as ExtensionAPI;

    registerSearchDocsTool(mockPi);
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

    // notes.db should not exist before search
    expect(existsSync(resolve(knowledgeDir, "notes.db"))).toBe(false);

    const result = await execute("call-1", { query: "unique-term" }, undefined, undefined, {
      cwd: projectDir,
    } as ExtensionContext);

    // notes.db should now exist after rebuild
    expect(existsSync(resolve(knowledgeDir, "notes.db"))).toBe(true);

    // Should find only the doc with "unique-term"
    const details = result.details;
    expect(details.count).toBe(1);

    const content = result.content?.[0]?.text ?? "";
    expect(content).toContain("unique-term-foo");
    expect(content).not.toContain("other-bar");
  });

  it("should return empty results when no docs exist on disk", async () => {
    vi.resetModules();

    const { registerSearchDocsTool } =
      await import("../../extensions/para-knowledge/tools/searchDocs.js");

    const mockPi = {
      registerTool: (tool: Record<string, unknown>) => {
        registeredTool = tool;
      },
      on: () => {},
    } as unknown as ExtensionAPI;

    registerSearchDocsTool(mockPi);

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

    const result = await execute("call-2", { query: "anything" }, undefined, undefined, {
      cwd: projectDir,
    } as ExtensionContext);

    const details = result.details;
    expect(details.count).toBe(0);
  });
});
