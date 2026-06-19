/**
 * Tests for create_para_doc — verifies that documents are created in
 * KNOWLEDGE_DIR rather than ctx.cwd.
 */

import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

describe("create_para_doc path resolution", () => {
  let tmpDir: string;
  let knowledgeDir: string;
  let projectDir: string;
  let registeredTool: Record<string, unknown> | null;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(homedir(), "createDoc-test-"));
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

  it("should fall back to ctx.cwd when KNOWLEDGE_DIR is not set", async () => {
    vi.resetModules();
    delete process.env.KNOWLEDGE_DIR;

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
      { title: "Fallback Doc", content: "Falls back to cwd.", tags: ["test"] },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    // File should exist in projectDir/Resources/
    const projectPath = join(projectDir, "Resources", "fallback-doc.md");

    expect(existsSync(projectPath)).toBe(true);
    expect(result.details.path).toBe(projectPath);

    // Cleanup created file
    rmSync(projectPath, { force: true });
    // Cleanup empty directory if it was created
    try {
      rmSync(join(projectDir, "Resources"), { recursive: true, force: true });
    } catch {
      /* directory may not exist */
    }
  });

  it("should handle empty content (autoDesc falls back to null)", async () => {
    vi.resetModules();
    delete process.env.KNOWLEDGE_DIR;

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

    // File should still be created
    const projectPath = join(projectDir, "Resources", "empty-content-doc.md");
    expect(existsSync(projectPath)).toBe(true);

    rmSync(projectPath, { force: true });
    try {
      rmSync(join(projectDir, "Resources"), { recursive: true, force: true });
    } catch {
      /* directory may not exist */
    }
  });
});
