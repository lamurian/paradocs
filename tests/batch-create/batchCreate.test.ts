/**
 * Tests for batch_create_para_docs — verifies that documents and DB index
 * are created in KNOWLEDGE_DIR rather than ctx.cwd.
 */

import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: vi.fn(),
  };
});

describe("batch_create_para_docs path resolution", () => {
  let tmpDir: string;
  let fakeHome: string;
  let knowledgeDir: string;
  let projectDir: string;
  let registeredTool: Record<string, unknown> | null;

  beforeEach(() => {
    tmpDir = mkdtempSync("/tmp/batchCreate-test-");
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

  it("should create document files inside KNOWLEDGE_DIR, not ctx.cwd", async () => {
    vi.resetModules();
    const mod = await import("../../extensions/batch-create/index.js");

    const mockPi = {
      registerTool: (tool: Record<string, unknown>) => {
        registeredTool = tool;
      },
      on: () => {},
    } as unknown as ExtensionAPI;

    mod.default(mockPi);
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

    const _result = await execute(
      "call-1",
      {
        documents: [
          { title: "Batch Doc One", content: "First doc.", tags: ["batch"] },
          { title: "Batch Doc Two", content: "Second doc.", tags: ["batch"] },
        ],
        autoLink: false,
      },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    // Files should exist in KNOWLEDGE_DIR
    const knowledgePaths = [
      join(knowledgeDir, "Resources", "batch-doc-one.md"),
      join(knowledgeDir, "Resources", "batch-doc-two.md"),
    ];
    const projectPaths = [
      join(projectDir, "Resources", "batch-doc-one.md"),
      join(projectDir, "Resources", "batch-doc-two.md"),
    ];

    for (const p of knowledgePaths) {
      expect(existsSync(p), `Expected file at ${p}`).toBe(true);
      const content = readFileSync(p, "utf-8");
      expect(content).toContain("batch");
    }
    for (const p of projectPaths) {
      expect(existsSync(p), `File should NOT exist at ${p}`).toBe(false);
    }

    // DB should be in KNOWLEDGE_DIR too
    const knowledgeDb = join(knowledgeDir, "notes.db");
    const projectDb = join(projectDir, "notes.db");
    expect(existsSync(knowledgeDb), `DB should exist at ${knowledgeDb}`).toBe(true);
    expect(existsSync(projectDb), `DB should NOT exist at ${projectDb}`).toBe(false);
  });

  it("should fall back to ctx.cwd when KNOWLEDGE_DIR is not set", async () => {
    vi.resetModules();
    delete process.env.KNOWLEDGE_DIR;
    delete process.env.KNOWLEDGE_DB;

    const mod = await import("../../extensions/batch-create/index.js");

    const mockPi = {
      registerTool: (tool: Record<string, unknown>) => {
        registeredTool = tool;
      },
      on: () => {},
    } as unknown as ExtensionAPI;

    mod.default(mockPi);
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

    await execute(
      "call-2",
      {
        documents: [{ title: "CWD Doc", content: "Falls back.", tags: ["test"] }],
        autoLink: false,
      },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    const projectPath = join(projectDir, "Resources", "cwd-doc.md");
    expect(existsSync(projectPath)).toBe(true);
  });
});
