/**
 * Tests for update_para_doc — verifies that document updates happen in
 * KNOWLEDGE_DIR rather than ctx.cwd.
 */

import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
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

describe("update_para_doc path resolution", () => {
  let tmpDir: string;
  let fakeHome: string;
  let knowledgeDir: string;
  let projectDir: string;
  let registeredTool: Record<string, unknown> | null;

  function writeDoc(area: string, slug: string, title: string, body: string): string {
    const content = `---\ntitle: "${title}"\nauthor: pi\neditor: lam\ndate: 2026-01-01T00:00:00.000Z\ntags: [test]\n---\n${body}`;
    const dir = join(knowledgeDir, area);
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `${slug}.md`);
    writeFileSync(filePath, content, "utf-8");
    return filePath;
  }

  beforeEach(() => {
    tmpDir = mkdtempSync("/tmp/updateDoc-test-");
    fakeHome = join(tmpDir, "fake-home");
    mkdirSync(fakeHome, { recursive: true });
    vi.mocked(homedir).mockReturnValue(fakeHome);

    knowledgeDir = join(tmpDir, "knowledge");
    projectDir = join(tmpDir, "project");
    mkdirSync(projectDir, { recursive: true });

    process.env.KNOWLEDGE_DIR = knowledgeDir;
    process.env.KNOWLEDGE_DB = ":memory:";

    registeredTool = null;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.KNOWLEDGE_DIR;
    delete process.env.KNOWLEDGE_DB;
  });

  it("should update document inside KNOWLEDGE_DIR, not ctx.cwd", async () => {
    vi.resetModules();
    // Create a doc in KNOWLEDGE_DIR first
    writeDoc("Resources", "existing-doc", "Existing Doc", "Original body.");

    const { registerUpdateDocTool } =
      await import("../../extensions/para-knowledge/tools/updateDoc.js");

    const mockPi = {
      registerTool: (tool: Record<string, unknown>) => {
        registeredTool = tool;
      },
      on: () => {},
    } as unknown as ExtensionAPI;

    registerUpdateDocTool(mockPi);
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
        path: "Resources/existing-doc.md",
        content: "Updated body.",
      },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    // The file should have been updated in KNOWLEDGE_DIR
    const knowledgePath = join(knowledgeDir, "Resources", "existing-doc.md");
    expect(existsSync(knowledgePath)).toBe(true);
    const content = readFileSync(knowledgePath, "utf-8");
    expect(content).toContain("Updated body.");
    expect(content).toContain("title: Existing Doc");
  });

  it("should use KNOWLEDGE_DIR from project .pi/.env when env var is not set", async () => {
    // Create a doc in the knowledge dir
    writeDoc("Resources", "env-doc", "Env Doc", "Original body.");

    // Create .pi/.env in projectDir pointing to knowledgeDir
    const piEnvDir = join(projectDir, ".pi");
    mkdirSync(piEnvDir, { recursive: true });
    writeFileSync(join(piEnvDir, ".env"), `KNOWLEDGE_DIR=${knowledgeDir}\n`);

    // Unset env vars so they must come from .pi/.env via configureEnv
    delete process.env.KNOWLEDGE_DIR;
    delete process.env.KNOWLEDGE_DB;

    vi.resetModules();
    const { registerUpdateDocTool } =
      await import("../../extensions/para-knowledge/tools/updateDoc.js");

    const mockPi = {
      registerTool: (tool: Record<string, unknown>) => {
        registeredTool = tool;
      },
      on: () => {},
    } as unknown as ExtensionAPI;

    registerUpdateDocTool(mockPi);
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
      "call-env",
      {
        path: "Resources/env-doc.md",
        content: "Updated via .env config.",
      },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    // The file should have been updated in KNOWLEDGE_DIR
    const knowledgePath = join(knowledgeDir, "Resources", "env-doc.md");
    expect(existsSync(knowledgePath)).toBe(true);
    const content = readFileSync(knowledgePath, "utf-8");
    expect(content).toContain("Updated via .env config.");

    // Cleanup
    rmSync(piEnvDir, { recursive: true, force: true });
  });

  it("should fall back to ctx.cwd when KNOWLEDGE_DIR is not set", async () => {
    vi.resetModules();
    delete process.env.KNOWLEDGE_DIR;
    delete process.env.KNOWLEDGE_DB;

    // Create a doc in projectDir (since that's where it would live without KNOWLEDGE_DIR)
    const projectResources = join(projectDir, "Resources");
    mkdirSync(projectResources, { recursive: true });
    const projectDocPath = join(projectResources, "cwd-doc.md");
    writeFileSync(
      projectDocPath,
      '---\ntitle: "CWD Doc"\nauthor: pi\neditor: lam\ndate: 2026-01-01T00:00:00.000Z\ntags: [test]\n---\nOriginal.',
      "utf-8",
    );

    const { registerUpdateDocTool } =
      await import("../../extensions/para-knowledge/tools/updateDoc.js");

    const mockPi = {
      registerTool: (tool: Record<string, unknown>) => {
        registeredTool = tool;
      },
      on: () => {},
    } as unknown as ExtensionAPI;

    registerUpdateDocTool(mockPi);

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
        path: "Resources/cwd-doc.md",
        content: "Updated in cwd fallback.",
      },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    const content = readFileSync(projectDocPath, "utf-8");
    expect(content).toContain("Updated in cwd fallback.");
  });
});
