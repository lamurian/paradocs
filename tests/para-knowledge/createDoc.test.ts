/**
 * Tests for create_para_doc — verifies that documents are created in
 * KNOWLEDGE_DIR rather than ctx.cwd.
 */

import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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

describe("create_para_doc path resolution", () => {
  let tmpDir: string;
  let fakeHome: string;
  let knowledgeDir: string;
  let projectDir: string;
  let registeredTool: Record<string, unknown> | null;

  beforeEach(() => {
    // Use /tmp for temp dir creation (not the mocked homedir)
    tmpDir = mkdtempSync("/tmp/createDoc-test-");
    fakeHome = join(tmpDir, "fake-home");
    mkdirSync(fakeHome, { recursive: true });

    // Point mocked homedir to the sandboxed fake home so configureEnv
    // looks for ~/.pi/agent/.env here, which doesn't exist.
    vi.mocked(homedir).mockReturnValue(fakeHome);

    knowledgeDir = join(tmpDir, "knowledge");
    projectDir = join(tmpDir, "project");
    mkdirSync(knowledgeDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });

    process.env.KNOWLEDGE_DIR = knowledgeDir;

    registeredTool = null;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.KNOWLEDGE_DIR;
  });

  it("should create the document file inside KNOWLEDGE_DIR, not ctx.cwd", async () => {
    vi.resetModules();
    const { registerCreateDocTool } =
      await import("../../extensions/para-knowledge/tools/createDoc.js");

    const mockPi = {
      registerTool: (tool: Record<string, unknown>) => {
        registeredTool = tool;
      },
      on: () => {},
    } as unknown as ExtensionAPI;

    registerCreateDocTool(mockPi);
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

    const result = await execute(
      "call-1",
      { title: "Test Doc CWD", content: "Hello world body.", tags: ["test"] },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    // File should exist in KNOWLEDGE_DIR/Resources/, NOT in projectDir/Resources/
    const knowledgePath = join(knowledgeDir, "Resources", "test-doc-cwd.md");
    const projectPath = join(projectDir, "Resources", "test-doc-cwd.md");

    expect(existsSync(knowledgePath)).toBe(true);
    expect(existsSync(projectPath)).toBe(false);

    // Verify file content
    const content = readFileSync(knowledgePath, "utf-8");
    expect(content).toContain("title: Test Doc CWD");
    expect(content).toContain("Hello world body.");

    // Verify result contains the knowledgeDir path
    expect(result.details.path).toBe(knowledgePath);
  });

  it("should use KNOWLEDGE_DIR from project .pi/.env when process.env.KNOWLEDGE_DIR is not set", async () => {
    // Create .pi/.env in projectDir with KNOWLEDGE_DIR pointing elsewhere
    const envKnowledgeDir = join(tmpDir, "env-knowledge");
    mkdirSync(envKnowledgeDir, { recursive: true });
    const piEnvDir = join(projectDir, ".pi");
    mkdirSync(piEnvDir, { recursive: true });
    writeFileSync(join(piEnvDir, ".env"), `KNOWLEDGE_DIR=${envKnowledgeDir}\n`);

    // Simulate real-world scenario where .env was never loaded into process.env
    delete process.env.KNOWLEDGE_DIR;

    vi.resetModules();
    const { registerCreateDocTool } =
      await import("../../extensions/para-knowledge/tools/createDoc.js");

    const mockPi = {
      registerTool: (tool: Record<string, unknown>) => {
        registeredTool = tool;
      },
      on: () => {},
    } as unknown as ExtensionAPI;

    registerCreateDocTool(mockPi);
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

    const result = await execute(
      "call-4",
      { title: "Env Doc", content: "Test body.", tags: ["test"] },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    // File should exist in envKnowledgeDir/Resources/, NOT in projectDir/Resources/
    const envPath = join(envKnowledgeDir, "Resources", "env-doc.md");
    const projectPath = join(projectDir, "Resources", "env-doc.md");

    expect(existsSync(envPath)).toBe(true);
    expect(existsSync(projectPath)).toBe(false);
    expect(result.details.path).toBe(envPath);

    // Cleanup created files
    rmSync(piEnvDir, { recursive: true, force: true });
    rmSync(envKnowledgeDir, { recursive: true, force: true });
  });

  it("should fall back to default when KNOWLEDGE_DIR is not set, ignoring cwd", async () => {
    vi.resetModules();
    delete process.env.KNOWLEDGE_DIR;

    // Create the default Cognoscere directory in the mocked home directory
    const defaultDir = join(fakeHome, "data", "personal", "Documents", "Cognoscere");

    const { registerCreateDocTool } =
      await import("../../extensions/para-knowledge/tools/createDoc.js");

    const mockPi = {
      registerTool: (tool: Record<string, unknown>) => {
        registeredTool = tool;
      },
      on: () => {},
    } as unknown as ExtensionAPI;

    registerCreateDocTool(mockPi);
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

    const result = await execute(
      "call-2",
      { title: "Fallback Doc", content: "Falls back to default.", tags: ["test"] },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    // File should exist in default path, NOT in projectDir
    const defaultPath = join(defaultDir, "Resources", "fallback-doc.md");
    const projectPath = join(projectDir, "Resources", "fallback-doc.md");

    expect(existsSync(defaultPath)).toBe(true);
    expect(existsSync(projectPath)).toBe(false);
    expect(result.details.path).toBe(defaultPath);

    // Cleanup created files
    rmSync(defaultPath, { force: true });
  });

  it("should handle empty content (autoDesc falls back to null)", async () => {
    vi.resetModules();
    delete process.env.KNOWLEDGE_DIR;

    // Create the default Cognoscere directory in the mocked home directory
    const defaultDir = join(fakeHome, "data", "personal", "Documents", "Cognoscere");

    const { registerCreateDocTool } =
      await import("../../extensions/para-knowledge/tools/createDoc.js");

    const mockPi = {
      registerTool: (tool: Record<string, unknown>) => {
        registeredTool = tool;
      },
      on: () => {},
    } as unknown as ExtensionAPI;

    registerCreateDocTool(mockPi);
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

    const result = await execute(
      "call-3",
      {
        title: "Empty Content Doc",
        content: "",
        tags: ["test"],
        description: "",
      },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    // autoDesc should be null since both description and content are empty
    expect(result.details.description).toBeNull();

    // File should still be created in default path, not projectDir
    const defaultPath = join(defaultDir, "Resources", "empty-content-doc.md");
    const projectPath = join(projectDir, "Resources", "empty-content-doc.md");
    expect(existsSync(defaultPath)).toBe(true);
    expect(existsSync(projectPath)).toBe(false);

    rmSync(defaultPath, { force: true });
  });
});
