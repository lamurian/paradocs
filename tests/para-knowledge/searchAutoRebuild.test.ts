/**
 * Tests that search_para_docs auto-rebuilds notes.db when it's missing.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Mock homedir so configureEnv looks for ~/.pi/agent/.env in a sandboxed temp
// directory, avoiding interference from the real global config.
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: vi.fn(),
  };
});

describe("search_para_docs auto-rebuild", () => {
  let tmpDir: string;
  let fakeHome: string;
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
    tmpDir = mkdtempSync("/tmp/searchRebuild-test-");
    fakeHome = join(tmpDir, "fake-home");
    mkdirSync(fakeHome, { recursive: true });
    vi.mocked(homedir).mockReturnValue(fakeHome);

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

  it("should use KNOWLEDGE_DIR from project .pi/.env when env var is not set", async () => {
    // Create a separate knowledge dir with docs
    const envKnowledgeDir = join(tmpDir, "env-knowledge");
    mkdirSync(join(envKnowledgeDir, "Resources"), { recursive: true });
    writeFileSync(
      join(envKnowledgeDir, "Resources", "my-doc.md"),
      `---\ntitle: "My Doc"\ntags: [test]\n---\n\nBody with unique-search-term.`,
      "utf-8",
    );

    // Create .pi/.env in projectDir pointing to envKnowledgeDir
    const piEnvDir = join(projectDir, ".pi");
    mkdirSync(piEnvDir, { recursive: true });
    writeFileSync(join(piEnvDir, ".env"), `KNOWLEDGE_DIR=${envKnowledgeDir}\n`);

    // Unset KNOWLEDGE_DIR so it must come from .pi/.env via configureEnv
    delete process.env.KNOWLEDGE_DIR;

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
    expect(existsSync(resolve(envKnowledgeDir, "notes.db"))).toBe(false);

    const result = await execute(
      "call-env",
      { query: "unique-search-term" },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    // notes.db should now exist in envKnowledgeDir after rebuild
    expect(existsSync(resolve(envKnowledgeDir, "notes.db"))).toBe(true);

    // Should find the doc with "unique-search-term"
    const details = result.details;
    expect(details.count).toBe(1);

    // Cleanup
    rmSync(piEnvDir, { recursive: true, force: true });
    rmSync(envKnowledgeDir, { recursive: true, force: true });
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
