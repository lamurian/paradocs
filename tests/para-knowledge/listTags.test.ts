/**
 * Tests for list_para_tags — verifies that tags are queried from
 * KNOWLEDGE_DIR loaded via configureEnv rather than ctx.cwd.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: vi.fn(),
  };
});

describe("list_para_tags env integration", () => {
  let tmpDir: string;
  let fakeHome: string;
  let knowledgeDir: string;
  let projectDir: string;
  let registeredTool: Record<string, unknown> | null;

  beforeEach(() => {
    tmpDir = mkdtempSync("/tmp/listTags-test-");
    fakeHome = join(tmpDir, "fake-home");
    mkdirSync(fakeHome, { recursive: true });
    vi.mocked(homedir).mockReturnValue(fakeHome);

    knowledgeDir = join(tmpDir, "knowledge");
    projectDir = join(tmpDir, "project");
    mkdirSync(knowledgeDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });

    // Use KNOWLEDGE_DIR for the initial DB setup
    process.env.KNOWLEDGE_DIR = knowledgeDir;
    registeredTool = null;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.KNOWLEDGE_DIR;
  });

  it("should use KNOWLEDGE_DIR from project .pi/.env when env var is not set", async () => {
    // Create notes.db with a tagged document
    const { createDb, initDb, indexFile } =
      await import("../../extensions/para-knowledge/db-sqlite.js");
    const dbPath = resolve(knowledgeDir, "notes.db");
    mkdirSync(knowledgeDir, { recursive: true });
    const db = createDb(dbPath);
    initDb(db);
    indexFile(db, {
      path: "Resources/test.md",
      title: "Test Doc",
      body: "Test body.",
      tags: ["alpha", "beta"],
      author: "test",
      editor: "",
      created: "2026-01-01T00:00:00.000Z",
      modified: "2026-01-01T00:00:00.000Z",
      file_mtime: "2026-01-01T00:00:00.000Z",
      source_url: null,
    });
    db.close();

    // Create .pi/.env in projectDir pointing to knowledgeDir
    const piEnvDir = join(projectDir, ".pi");
    mkdirSync(piEnvDir, { recursive: true });
    writeFileSync(join(piEnvDir, ".env"), `KNOWLEDGE_DIR=${knowledgeDir}\n`);

    // Unset KNOWLEDGE_DIR so it must come from .pi/.env via configureEnv
    delete process.env.KNOWLEDGE_DIR;

    vi.resetModules();
    const { registerListTagsTool } =
      await import("../../extensions/para-knowledge/tools/listTags.js");

    const mockPi = {
      registerTool: (tool: Record<string, unknown>) => {
        registeredTool = tool;
      },
      on: () => {},
    } as unknown as ExtensionAPI;

    registerListTagsTool(mockPi);
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

    const result = await execute("call-tags", {}, undefined, undefined, {
      cwd: projectDir,
    } as ExtensionContext);

    const details = result.details;
    expect(details.count).toBe(2);
    expect(details.tags).toContain("alpha");
    expect(details.tags).toContain("beta");
  });
});
